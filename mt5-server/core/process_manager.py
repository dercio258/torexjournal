import os
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

    def create_startup_config(self, account_id: int, login: str, server: str, password: Optional[str] = None) -> Path:
        """Gera arquivo de inicialização .ini para o terminal"""
        instance_dir = self.get_account_instance_dir(account_id)
        config_path = (instance_dir / "startup.ini").resolve()
        
        content = [
            "; TorexJournal MT5 Auto-Generated Config",
            "[Common]",
            f"Login={login}",
            f"Server={server}",
        ]
        if password:
            content.append(f"Password={password}")
        content.extend([
            "EnableNews=0",
            "CertInstall=0",
            "[Start]",
            "Profile=Default"
        ])
        
        with open(config_path, "w", encoding="utf-8") as f:
            f.write("\n".join(content))
            
        return config_path

    def start_terminal(self, account_id: int, login: str, server: str, password: Optional[str] = None) -> bool:
        """Inicia uma instância portátil do MT5 isolada para a conta verificando antes recursos disponíveis"""
        if self.is_running(account_id):
            logger.info(f"Terminal da conta {account_id} já está em execução (PID: {self.pids.get(account_id)})")
            return True

        if not os.path.exists(self.terminal_path):
            logger.error(f"Executável do MT5 não encontrado em: {self.terminal_path}")
            return False

        # Verificação técnica de recursos antes de abrir o processo pesado do MT5
        mem = psutil.virtual_memory()
        cpu_usage = psutil.cpu_percent(interval=None)
        used_mb = round((mem.total - mem.available) / (1024 * 1024), 1)
        total_mb = round(mem.total / (1024 * 1024), 1)
        available_mb = round(mem.available / (1024 * 1024), 1)
        mem_pct = round(mem.percent, 1)

        if mem_pct >= 90.0 or available_mb < 200.0 or cpu_usage >= 95.0:
            logger.error(
                f"[RECURSOS CRÍTICOS] Impossível iniciar terminal da conta {account_id}! "
                f"RAM consumida: {used_mb} MB / {total_mb} MB ({mem_pct}%) | "
                f"RAM livre: {available_mb} MB | CPU: {cpu_usage}%. "
                f"Operação cancelada para evitar congelamento da VPS."
            )
            return False

        instance_dir = self.get_account_instance_dir(account_id)
        config_path = self.create_startup_config(account_id, login, server, password)

        # Passa o caminho absoluto do arquivo para o comando
        cmd = [
            self.terminal_path,
            "/portable",
            f"/config:{config_path.resolve()}"
        ]

        try:
            logger.info(f"Iniciando terminal para conta {account_id} (RAM livre: {available_mb} MB)...")
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

    def is_running(self, account_id: int) -> bool:
        """Verifica se o processo do terminal da conta ainda está ativo"""
        pid = self.pids.get(account_id)
        if pid:
            try:
                p = psutil.Process(pid)
                if p.is_running() and p.status() != psutil.STATUS_ZOMBIE:
                    return True
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass

        # Verifica se o processo terminal64 foi spawnado por nós ou para esta conta
        instance_dir = self.get_account_instance_dir(account_id)
        instance_str = str(instance_dir).lower()
        try:
            for proc in psutil.process_iter(['pid', 'name', 'cmdline']):
                try:
                    name = proc.info.get('name') or ''
                    if 'terminal64' in name.lower():
                        cmdline = " ".join(proc.info.get('cmdline') or []).lower()
                        if instance_str in cmdline or f"acc_{account_id}" in cmdline:
                            self.pids[account_id] = proc.info['pid']
                            return True
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    continue
        except Exception:
            pass

        self.cleanup_account(account_id)
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

    def stop_all(self):
        """Encerra todos os terminais gerenciados pelo worker"""
        logger.info(f"Encerrando todas as {len(self.pids)} instâncias de terminais MT5 ativas...")
        for acc_id in list(self.pids.keys()):
            self.stop_terminal(acc_id)
