import os
import shutil
import time
import subprocess
from pathlib import Path
from typing import Dict, Optional
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

    def get_account_instance_dir(self, account_id: int) -> Path:
        instance_dir = (self.instances_dir / f"acc_{account_id}").resolve()
        instance_dir.mkdir(parents=True, exist_ok=True)
        return instance_dir

    def get_or_prepare_isolated_terminal_exe(
        self,
        account_id: int,
        login: Optional[str] = None,
        server: Optional[str] = None,
        password: Optional[str] = None,
    ) -> str:
        """
        Prepara um diretório portátil exclusivo para a conta (instances/acc_<account_id>/terminal64.exe)
        copiando o executável base (cópia real, sem hardlink os.link) e todos os arquivos de configuração
        de corretoras (servers.dat, accounts.dat, common.ini) do AppData principal.
        Assim cada conta roda em sua própria janela terminal64.exe sem deslogar outras contas!
        """
        if not self.terminal_path or not os.path.exists(self.terminal_path):
            return self.terminal_path

        instance_dir = self.get_account_instance_dir(account_id)
        isolated_exe = (instance_dir / "terminal64.exe").resolve()
        base_exe = Path(self.terminal_path).resolve()
        base_dir = base_exe.parent

        try:
            # Se existia um hardlink antigo (nlink > 1), substitui por cópia independente do executável
            need_copy_exe = not isolated_exe.exists()
            if not need_copy_exe:
                try:
                    if os.stat(isolated_exe).st_nlink > 1:
                        isolated_exe.unlink()
                        need_copy_exe = True
                except Exception:
                    pass

            if need_copy_exe:
                shutil.copy2(str(base_exe), str(isolated_exe))
                logger.info(f"[ISOLAMENTO MT5] Executável exclusivo copiado para conta {account_id}: {isolated_exe}")

            # Copia arquivos de suporte essenciais (servers.dat, accounts.dat, cert/bases) para que o modo /portable
            # reconheça imediatamente todas as corretoras (Deriv-Demo, Exness-MT5Real10, GoatFunded-Server2, etc.)
            isolated_cfg_dir = instance_dir / "config"
            isolated_cfg_dir.mkdir(parents=True, exist_ok=True)
            isolated_cfg_upper = instance_dir / "Config"
            isolated_cfg_upper.mkdir(parents=True, exist_ok=True)

            # Localiza a pasta de dados ativa do MT5 em %APPDATA%\MetaQuotes\Terminal\<HASH>
            appdata = os.environ.get("APPDATA")
            source_data_dirs = []
            if appdata:
                mq_dir = Path(appdata) / "MetaQuotes" / "Terminal"
                if mq_dir.exists():
                    for sub in mq_dir.iterdir():
                        if sub.is_dir() and sub.name.lower() not in ("common", "community", "help"):
                            if (sub / "config").exists() or (sub / "Config").exists():
                                source_data_dirs.append(sub)

            for s_dir in source_data_dirs:
                src_cfg = s_dir / "config" if (s_dir / "config").exists() else (s_dir / "Config")
                if src_cfg.exists():
                    for fname in ("servers.dat", "accounts.dat", "common.ini", "terminal.ini", "charts.ini"):
                        src_file = src_cfg / fname
                        if src_file.exists():
                            dst_lower = isolated_cfg_dir / fname
                            dst_upper = isolated_cfg_upper / fname
                            if not dst_lower.exists() or fname == "servers.dat":
                                try:
                                    shutil.copy2(str(src_file), str(dst_lower))
                                except Exception:
                                    pass
                            if not dst_upper.exists() or fname == "servers.dat":
                                try:
                                    shutil.copy2(str(src_file), str(dst_upper))
                                except Exception:
                                    pass
                    break

            # Fallback caso servers.dat esteja na pasta de instalação em Program Files
            for pf_cfg in (base_dir / "Config" / "servers.dat", base_dir / "config" / "servers.dat"):
                if pf_cfg.exists():
                    if not (isolated_cfg_dir / "servers.dat").exists():
                        shutil.copy2(str(pf_cfg), str(isolated_cfg_dir / "servers.dat"))
                    if not (isolated_cfg_upper / "servers.dat").exists():
                        shutil.copy2(str(pf_cfg), str(isolated_cfg_upper / "servers.dat"))

            # Prepara startup.ini / common.ini com Login, Password e Server da conta
            if login and server:
                self.create_startup_config(account_id, login, server, password)
                common_lines = [
                    "[Common]",
                    f"Login={str(login).strip()}",
                ]
                if password:
                    common_lines.append(f"Password={str(password).strip()}")
                common_lines.extend([
                    f"Server={str(server).strip()}",
                    "NewsEnable=0",
                    "CertInstall=0",
                    "ProxyEnable=0",
                    "KeepPrivate=1",
                    "MCPServer=0",
                ])
                common_content = "\r\n".join(common_lines) + "\r\n"
                for cfg_target in (isolated_cfg_dir / "common.ini", isolated_cfg_upper / "common.ini"):
                    try:
                        with open(cfg_target, "w", encoding="utf-8-sig", newline="\r\n") as f:
                            f.write(common_content)
                    except Exception:
                        pass

            return str(isolated_exe)
        except Exception as e:
            logger.warning(f"Não foi possível preparar executável isolado para conta {account_id} (usando caminho padrão): {e}")
            return self.terminal_path

    def create_startup_config(self, account_id: int, login: str, server: str, password: Optional[str] = None) -> Path:
        """Gera arquivo de inicialização .ini para o terminal com formatação compatível com Windows/MT5"""
        instance_dir = self.get_account_instance_dir(account_id)
        config_path = (instance_dir / "startup.ini").resolve()
        
        login_str = str(login).strip()
        server_str = str(server).strip()
        pass_str = str(password).strip() if password else ""

        content = [
            "; TorexJournal MT5 Auto-Generated Config",
            "[Common]",
            f"Login={login_str}",
        ]
        if pass_str:
            content.append(f"Password={pass_str}")
        content.extend([
            f"Server={server_str}",
            "NewsEnable=0",
            "CertInstall=0",
            "ProxyEnable=0",
            "KeepPrivate=1",
            "[Start]",
            "Profile=Default"
        ])
        
        # Windows INI requer quebras de linha CRLF (\r\n) e UTF-8 com BOM para o parser do MT5
        with open(config_path, "w", encoding="utf-8-sig", newline="\r\n") as f:
            f.write("\r\n".join(content) + "\r\n")
            
        return config_path

    def start_terminal(self, account_id: int, login: str, server: str, password: Optional[str] = None) -> bool:
        """Inicia uma instância portátil do MT5 verificando antes recursos disponíveis."""
        if self.is_running(account_id):
            logger.info(f"Terminal MT5 já está em execução (PID: {self.pids.get(account_id)})")
            return True

        if not os.path.exists(self.terminal_path):
            logger.error(f"Executável do MT5 não encontrado em: {self.terminal_path}")
            return False

        mem = psutil.virtual_memory()
        available_mb = round(mem.available / (1024 * 1024), 1)

        if settings.enable_resource_guard:
            cpu_usage = psutil.cpu_percent(interval=None)
            used_mb = round((mem.total - mem.available) / (1024 * 1024), 1)
            total_mb = round(mem.total / (1024 * 1024), 1)
            mem_pct = round(mem.percent, 1)

            if mem_pct >= settings.max_memory_percent or available_mb < settings.min_available_memory_mb or cpu_usage >= settings.max_cpu_percent:
                logger.error(
                    f"[RECURSOS CRÍTICOS] Impossível iniciar terminal da conta {account_id}! "
                    f"RAM consumida: {used_mb} MB / {total_mb} MB ({mem_pct}%) | "
                    f"RAM livre: {available_mb} MB | CPU: {cpu_usage}%. "
                    f"Operação cancelada para evitar congelamento da VPS."
                )
                return False

        instance_dir = self.get_account_instance_dir(account_id)
        isolated_exe = self.get_or_prepare_isolated_terminal_exe(account_id)
        config_path = self.create_startup_config(account_id, login, server, password)

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

    def is_running(self, account_id: Optional[int] = None) -> bool:
        """Verifica se o processo terminal64.exe principal está ativo."""
        for proc in psutil.process_iter(['pid', 'name', 'status']):
            try:
                name = proc.info.get('name') or ''
                if 'terminal64' in name.lower() and proc.info.get('status') != psutil.STATUS_ZOMBIE:
                    if account_id is not None:
                        self.pids[account_id] = proc.info['pid']
                    return True
            except Exception:
                pass
        return False

    def stop_terminal(self, account_id: int, timeout: int = 5) -> bool:
        """Encerra a instância do terminal da conta de forma limpa"""
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
