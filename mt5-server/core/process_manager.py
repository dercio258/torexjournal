import os
import hashlib
import shutil
import time
import subprocess
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import psutil
from loguru import logger
from config.settings import settings

class MT5ProcessManager:
    """Gerencia o ciclo de vida dos processos terminal64.exe isolados por conta."""

    def __init__(self):
        self.terminal_path = settings.mt5_default_path
        self.instances_dir = Path(settings.instances_dir).resolve()
        self.processes: Dict[int, subprocess.Popen] = {}
        self.pids: Dict[int, int] = {}
        self.account_uuids: Dict[int, str] = {}

    def register_account_uuid(self, account_id: int, account_uuid: Optional[str]) -> None:
        """Registra o UUID canônico da conta para evitar divergência entre acc_<uuid> e acc_<id>."""
        clean_uuid = (account_uuid or "").strip()
        if clean_uuid:
            self.account_uuids[int(account_id)] = clean_uuid

    @staticmethod
    def _sanitize_ini_value(value: Optional[str]) -> str:
        if value is None:
            return ""
        return str(value).replace("\r", "").replace("\n", "").replace("\x00", "").strip()

    @staticmethod
    def _compute_mt5_appdata_hash(install_dir: Path) -> str:
        """Calcula o hash MD5 exato (UTF-16LE em maiúsculas) usado pelo MT5 em %APPDATA%\\MetaQuotes\\Terminal\\<HASH>."""
        norm = str(install_dir.resolve()).rstrip("\\/").upper()
        return hashlib.md5(norm.encode("utf-16-le")).hexdigest().upper()

    def _collect_source_config_dirs(self, base_dir: Path) -> List[Tuple[int, Path]]:
        """
        Lista diretórios de configuração MT5 com prioridade determinística:
        tier 2 = pasta AppData exata da instalação principal (ex.: D0E8209F... para Program Files\\MetaTrader 5),
        tier 1 = outras pastas AppData\\MetaQuotes\\Terminal\\<HASH>\\config,
        tier 0 = pasta Config junto ao executável base e instâncias isoladas existentes.
        """
        candidates: List[Tuple[int, Path]] = []
        seen = set()

        def _add(tier: int, cfg_dir: Path):
            if not cfg_dir.is_dir():
                return
            key = os.path.normcase(os.path.abspath(str(cfg_dir)))
            if key not in seen:
                seen.add(key)
                candidates.append((tier, cfg_dir))

        base_hash = self._compute_mt5_appdata_hash(base_dir)
        appdata = os.environ.get("APPDATA")
        if appdata:
            mq_dir = Path(appdata) / "MetaQuotes" / "Terminal"
            if mq_dir.exists():
                # Primeiro a pasta exata da instalação principal (evita pegar instâncias vazias por ordem alfabética!)
                main_sub = mq_dir / base_hash
                for sub_name in ("config", "Config"):
                    _add(2, main_sub / sub_name)

                for sub in mq_dir.iterdir():
                    if sub.is_dir() and sub.name.lower() not in ("common", "community", "help"):
                        tier = 2 if sub.name.upper() == base_hash else 1
                        for sub_name in ("config", "Config"):
                            _add(tier, sub / sub_name)

        for sub_name in ("Config", "config"):
            _add(0, base_dir / sub_name)

        if self.instances_dir.exists():
            try:
                for inst in self.instances_dir.iterdir():
                    if inst.is_dir() and inst.name.lower().startswith("acc_"):
                        for sub_name in ("config", "Config"):
                            _add(0, inst / sub_name)
            except Exception:
                pass

        return candidates

    def find_best_servers_dat(self, base_dir: Optional[Path] = None, exclude_dir: Optional[Path] = None) -> Optional[Path]:
        """
        Seleciona o arquivo servers.dat mais completo (maior tamanho em bytes) entre:
        1) data/master_servers.dat (ou data/servers.dat) — cache mestre compartilhável entre VPSs
        2) %APPDATA%\\MetaQuotes\\Terminal\\<HASH_PRINCIPAL>\\config\\servers.dat (instalação principal do MT5)
        3) Demais pastas AppData, instâncias isoladas e Program Files.
        Corrige o bug de pegar a primeira pasta alfabética em AppData (que costuma ter apenas MetaQuotes-Demo).
        """
        b_dir = base_dir or Path(self.terminal_path).resolve().parent
        norm_exclude = os.path.normcase(os.path.abspath(str(exclude_dir))) if exclude_dir else None

        scored: List[Tuple[int, int, float, Path]] = []
        seen_files = set()

        def _consider(tier: int, file_path: Path):
            try:
                if not file_path.is_file():
                    return
                resolved = file_path.resolve()
                norm_p = os.path.normcase(os.path.abspath(str(resolved)))
                if norm_exclude and norm_p.startswith(norm_exclude):
                    return
                if norm_p in seen_files:
                    return
                st = resolved.stat()
                if st.st_size <= 0:
                    return
                seen_files.add(norm_p)
                scored.append((st.st_size, tier, st.st_mtime, resolved))
            except Exception:
                pass

        # Tier 3: arquivo mestre explícito em data_dir (ex.: copiado da VPS 1 para VPS 2)
        try:
            data_root = Path(settings.data_dir).resolve()
            _consider(3, data_root / "master_servers.dat")
            _consider(3, data_root / "servers.dat")
        except Exception:
            pass

        for tier, cfg_dir in self._collect_source_config_dirs(b_dir):
            _consider(tier, cfg_dir / "servers.dat")

        if not scored:
            return None

        # Maior tamanho primeiro (cada corretora adicionada via Open an Account aumenta servers.dat);
        # em empate de tamanho, vence maior tier (master > principal > outros) e mtime mais recente.
        scored.sort(key=lambda item: (item[0], item[1], item[2]), reverse=True)
        return scored[0][3]

    def get_account_instance_dir(
        self,
        account_id: int,
        account_uuid: Optional[str] = None,
        create: bool = True,
    ) -> Path:
        raw_scope = (account_uuid or "").strip() if account_uuid else ""
        if raw_scope:
            self.account_uuids[int(account_id)] = raw_scope
        else:
            raw_scope = self.account_uuids.get(int(account_id), "")
        safe_scope = "".join(c for c in raw_scope if c.isalnum() or c in ("-", "_"))[:48] if raw_scope else ""
        dir_name = f"acc_{safe_scope}" if safe_scope else f"acc_{account_id}"
        instance_dir = (self.instances_dir / dir_name).resolve()
        if create:
            instance_dir.mkdir(parents=True, exist_ok=True)
        return instance_dir

    def get_or_prepare_isolated_terminal_exe(
        self,
        account_id: int,
        login: Optional[str] = None,
        server: Optional[str] = None,
        password: Optional[str] = None,
        account_uuid: Optional[str] = None,
    ) -> str:
        """
        Prepara um diretório portátil exclusivo para a conta (instances/acc_<account_uuid|account_id>/terminal64.exe)
        copiando o executável base (cópia real, sem hardlink os.link) e apenas servers.dat / layouts seguros.
        Assim cada tenant/conta roda em sua própria janela terminal64.exe sem compartilhar accounts.dat!
        """
        if not self.terminal_path or not os.path.exists(self.terminal_path):
            return self.terminal_path

        instance_dir = self.get_account_instance_dir(account_id, account_uuid=account_uuid)
        isolated_exe = (instance_dir / "terminal64.exe").resolve()
        base_exe = Path(self.terminal_path).resolve()
        base_dir = base_exe.parent

        # Se a instância isolada desta conta já está em execução, retorna imediatamente sem sobrescrever
        # common.ini/startup.ini/servers.dat em uso nem gerar I/O desnecessário.
        if isolated_exe.exists() and self.is_running(account_id, account_uuid=account_uuid):
            return str(isolated_exe)

        try:
            # Se existia hardlink antigo (nlink > 1) ou executável base foi atualizado (build novo), sincroniza cópia independente
            need_copy_exe = not isolated_exe.exists()
            if not need_copy_exe:
                try:
                    iso_stat = os.stat(isolated_exe)
                    base_stat = os.stat(base_exe)
                    if iso_stat.st_nlink > 1:
                        isolated_exe.unlink()
                        need_copy_exe = True
                    elif (
                        iso_stat.st_size != base_stat.st_size
                        and not self.is_running(account_id, account_uuid=account_uuid)
                    ):
                        need_copy_exe = True
                except Exception:
                    pass

            if need_copy_exe:
                shutil.copy2(str(base_exe), str(isolated_exe))
                logger.info(f"[ISOLAMENTO MT5] Executável exclusivo copiado para conta {account_id}: {isolated_exe}")

            # Copia o melhor servers.dat (maior/mais completo, priorizando master_servers.dat e o MT5 principal)
            # e arquivos de layout seguros (terminal.ini, charts.ini) — nunca copia accounts.dat ou common.ini!
            isolated_cfg_dir = instance_dir / "config"
            isolated_cfg_dir.mkdir(parents=True, exist_ok=True)
            isolated_cfg_upper = instance_dir / "Config"
            isolated_cfg_upper.mkdir(parents=True, exist_ok=True)
            cfg_targets = [isolated_cfg_dir]
            if os.path.normcase(os.path.abspath(str(isolated_cfg_upper))) != os.path.normcase(os.path.abspath(str(isolated_cfg_dir))):
                cfg_targets.append(isolated_cfg_upper)

            best_servers_dat = self.find_best_servers_dat(base_dir=base_dir, exclude_dir=instance_dir)
            if best_servers_dat and best_servers_dat.exists():
                best_stat = best_servers_dat.stat()
                for cfg_dir_dst in cfg_targets:
                    dst_srv = cfg_dir_dst / "servers.dat"
                    should_copy_srv = not dst_srv.exists()
                    if not should_copy_srv:
                        try:
                            dst_stat = dst_srv.stat()
                            # Nunca sobrescreve um servers.dat maior por um menor; atualiza se a fonte for maior
                            # ou significativamente mais recente (>2s evita cópias repetidas por jitter de mtime no NTFS)
                            if best_stat.st_size > dst_stat.st_size or (
                                best_stat.st_size == dst_stat.st_size and (best_stat.st_mtime - dst_stat.st_mtime) > 2.0
                            ):
                                should_copy_srv = True
                        except Exception:
                            should_copy_srv = True
                    if should_copy_srv:
                        try:
                            shutil.copy2(str(best_servers_dat), str(dst_srv))
                            logger.info(
                                f"[SERVERS.DAT] Sincronizado cache de corretoras ({round(best_stat.st_size / 1024, 1)} KB) "
                                f"de '{best_servers_dat}' -> '{dst_srv}'"
                            )
                        except Exception:
                            pass

            source_cfg_dirs = self._collect_source_config_dirs(base_dir)
            source_cfg_dirs.sort(key=lambda item: item[0], reverse=True)
            for _tier, src_cfg in source_cfg_dirs:
                if os.path.normcase(os.path.abspath(str(src_cfg))).startswith(
                    os.path.normcase(os.path.abspath(str(instance_dir)))
                ):
                    continue
                copied_any_layout = False
                for fname in ("terminal.ini", "charts.ini"):
                    src_file = src_cfg / fname
                    if src_file.exists():
                        for cfg_dir_dst in cfg_targets:
                            dst_file = cfg_dir_dst / fname
                            if not dst_file.exists():
                                try:
                                    shutil.copy2(str(src_file), str(dst_file))
                                    copied_any_layout = True
                                except Exception:
                                    pass
                if copied_any_layout:
                    break

            # Implanta EA headless TorexCalendarSync.ex5 em MQL5/Experts/ da instância isolada
            self._deploy_calendar_ea(instance_dir)

            # Prepara startup.ini / common.ini com Login e Server (nunca grava Password em texto puro em common.ini)
            if login and server:
                self.create_startup_config(account_id, login, server, password, account_uuid=account_uuid)
                common_lines = [
                    "[Common]",
                    f"Login={self._sanitize_ini_value(login)}",
                    f"Server={self._sanitize_ini_value(server)}",
                    "NewsEnable=1",
                    "CertInstall=0",
                    "ProxyEnable=0",
                    "KeepPrivate=1",
                    "MCPServer=0",
                    "[Experts]",
                    "Enabled=1",
                    "AllowLiveTrading=0",
                    "AllowDllImport=0",
                    "Api=0",
                ]
                common_content = "\r\n".join(common_lines) + "\r\n"
                for cfg_dir_dst in cfg_targets:
                    try:
                        with open(cfg_dir_dst / "common.ini", "w", encoding="utf-8-sig", newline="\r\n") as f:
                            f.write(common_content)
                    except Exception:
                        pass

            return str(isolated_exe)
        except Exception as e:
            logger.warning(f"Não foi possível preparar executável isolado para conta {account_id} (usando caminho padrão): {e}")
            return self.terminal_path

    def _deploy_calendar_ea(self, instance_dir: Path) -> None:
        """Copia TorexCalendarSync.ex5 compilado para MQL5/Experts/ da instância isolada."""
        try:
            experts_dir = instance_dir / "MQL5" / "Experts"
            files_dir = instance_dir / "MQL5" / "Files"
            experts_dir.mkdir(parents=True, exist_ok=True)
            files_dir.mkdir(parents=True, exist_ok=True)

            ea_src = (Path(__file__).resolve().parent.parent / "mql5" / "TorexCalendarSync.ex5").resolve()
            if ea_src.exists():
                ea_dst = experts_dir / "TorexCalendarSync.ex5"
                if (
                    not ea_dst.exists()
                    or ea_dst.stat().st_size != ea_src.stat().st_size
                    or ea_dst.stat().st_mtime < ea_src.stat().st_mtime
                ):
                    shutil.copy2(str(ea_src), str(ea_dst))
                    logger.info(f"[CALENDAR-EA] Implantado {ea_src.name} em {ea_dst}")
            else:
                logger.warning(f"[CALENDAR-EA] Arquivo compilado não encontrado em {ea_src}")
        except Exception as e:
            logger.warning(f"[CALENDAR-EA] Falha ao implantar TorexCalendarSync.ex5: {e}")

    def create_startup_config(
        self,
        account_id: int,
        login: str,
        server: str,
        password: Optional[str] = None,
        account_uuid: Optional[str] = None,
    ) -> Path:
        """Gera arquivo de inicialização .ini para o terminal com formatação compatível com Windows/MT5"""
        instance_dir = self.get_account_instance_dir(account_id, account_uuid=account_uuid)
        self._deploy_calendar_ea(instance_dir)
        config_path = (instance_dir / "startup.ini").resolve()
        
        login_str = self._sanitize_ini_value(login)
        server_str = self._sanitize_ini_value(server)

        content = [
            "; TorexJournal MT5 Auto-Generated Config",
            "[Common]",
            f"Login={login_str}",
            f"Server={server_str}",
            "NewsEnable=1",
            "CertInstall=0",
            "ProxyEnable=0",
            "KeepPrivate=1",
            "MCPServer=0",
            "[Experts]",
            "Enabled=1",
            "AllowLiveTrading=0",
            "AllowDllImport=0",
            "AllowExternalExperts=0",
            "[StartUp]",
            "Expert=TorexCalendarSync",
            "Symbol=EURUSD",
            "Period=H1",
        ]
        
        # Windows INI requer quebras de linha CRLF (\r\n) e UTF-8 com BOM para o parser do MT5
        with open(config_path, "w", encoding="utf-8-sig", newline="\r\n") as f:
            f.write("\r\n".join(content) + "\r\n")
            
        return config_path

    def start_terminal(self, account_id: int, login: str, server: str, password: Optional[str] = None, account_uuid: Optional[str] = None) -> bool:
        """Inicia uma instância portátil do MT5 verificando antes recursos disponíveis."""
        if self.is_running(account_id, account_uuid=account_uuid):
            logger.info(f"Terminal MT5 já está em execução (PID: {self.pids.get(account_id)})")
            return True

        if not os.path.exists(self.terminal_path):
            logger.error(f"Executável do MT5 não encontrado em: {self.terminal_path}")
            return False

        mem = psutil.virtual_memory()
        available_mb = round(mem.available / (1024 * 1024), 1)

        if settings.enable_resource_guard:
            from .health_monitor import sample_smoothed_cpu_percent
            cpu_usage, _ = sample_smoothed_cpu_percent()
            used_mb = round((mem.total - mem.available) / (1024 * 1024), 1)
            total_mb = round(mem.total / (1024 * 1024), 1)
            mem_pct = round(mem.percent, 1)

            if mem_pct >= settings.max_memory_percent or available_mb < settings.min_available_memory_mb:
                logger.error(
                    f"[RECURSOS CRÍTICOS] Impossível iniciar terminal da conta {account_id}! "
                    f"RAM consumida: {used_mb} MB / {total_mb} MB ({mem_pct}%) | "
                    f"RAM livre: {available_mb} MB | CPU média: {cpu_usage}%. "
                    f"Operação cancelada para evitar congelamento da VPS."
                )
                return False

        instance_dir = self.get_account_instance_dir(account_id, account_uuid=account_uuid)
        isolated_exe = self.get_or_prepare_isolated_terminal_exe(
            account_id,
            login=login,
            server=server,
            password=password,
            account_uuid=account_uuid,
        )
        config_path = self.create_startup_config(account_id, login, server, password, account_uuid=account_uuid)

        cmd = [
            isolated_exe,
            "/portable",
            f"/config:{config_path.resolve()}"
        ]

        try:
            logger.info(f"Iniciando terminal isolado para conta {account_id} ({isolated_exe} | RAM livre: {available_mb} MB)...")
            proc = subprocess.Popen(
                cmd,
                cwd=str(instance_dir),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
            self.processes[account_id] = proc
            self.pids[account_id] = proc.pid
            logger.success(f"Terminal iniciado com sucesso para conta {account_id} (PID: {proc.pid})")
            return True
        except Exception as e:
            logger.error(f"Falha ao iniciar terminal para conta {account_id}: {e}")
            return False

    def is_running(self, account_id: Optional[int] = None, account_uuid: Optional[str] = None) -> bool:
        """Verifica se o processo terminal64.exe específico da conta está ativo."""
        target_exe = None
        if account_id is not None:
            inst_dir = self.get_account_instance_dir(account_id, account_uuid=account_uuid, create=False)
            target_exe = os.path.normcase(
                os.path.abspath(str((inst_dir / "terminal64.exe").resolve()))
            )

        for proc in psutil.process_iter(['pid', 'name', 'exe', 'status']):
            try:
                if proc.info.get('status') == psutil.STATUS_ZOMBIE:
                    continue
                if target_exe is not None:
                    p_exe = proc.info.get('exe')
                    if p_exe and os.path.normcase(os.path.abspath(p_exe)) == target_exe:
                        self.pids[account_id] = proc.info['pid']
                        return True
                else:
                    name = proc.info.get('name') or ''
                    if 'terminal64' in name.lower():
                        return True
            except Exception:
                pass
        if account_id is not None:
            self.pids.pop(account_id, None)
        return False

    def stop_terminal(self, account_id: int, timeout: int = 5, account_uuid: Optional[str] = None) -> bool:
        """Encerra a instância do terminal da conta de forma limpa (inclusive processos abertos via mt5.initialize)."""
        pid = self.pids.get(account_id)
        if not pid:
            # Descobre PID de terminais iniciados diretamente por mt5.initialize(path=...)
            if self.is_running(account_id, account_uuid=account_uuid):
                pid = self.pids.get(account_id)
        if not pid:
            return True

        logger.info(f"Encerrando terminal da conta {account_id} (PID: {pid})...")
        try:
            p = psutil.Process(pid)
            p.terminate()
            p.wait(timeout=timeout)
            logger.info(f"Terminal da conta {account_id} finalizado.")
        except psutil.TimeoutExpired:
            logger.warning(f"Timeout ao encerrar PID {pid}. Forçando kill...")
            try:
                p.kill()
                p.wait(timeout=3)
            except Exception:
                pass
        except psutil.NoSuchProcess:
            pass
        finally:
            self.cleanup_account(account_id)
        return True

    def cleanup_account(self, account_id: int):
        self.processes.pop(account_id, None)
        self.pids.pop(account_id, None)

    def kill_all_terminals(self):
        """Encerra todas as instâncias de terminal64 para desimpedir a porta IPC 22346 e evitar erro 10048"""
        killed = 0
        for proc in psutil.process_iter(['pid', 'name']):
            try:
                name = proc.info.get('name') or ''
                if 'terminal64' in name.lower():
                    logger.warning(f"Encerrando terminal MT5 anterior/órfão (PID: {proc.info['pid']}) para desimpedir a porta 22346...")
                    proc.kill()
                    killed += 1
            except Exception:
                pass
        if killed > 0:
            time.sleep(2)
        self.processes.clear()
        self.pids.clear()

    def stop_all(self):
        """Encerra todos os terminais gerenciados pelo worker"""
        logger.info(f"Encerrando todas as {len(self.pids)} instâncias de terminais MT5 ativas...")
        for acc_id in list(self.pids.keys()):
            self.stop_terminal(acc_id)
