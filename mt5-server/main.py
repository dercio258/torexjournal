import os
import sys
import time
import signal
import subprocess
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
os.chdir(BASE_DIR)


def _ensure_venv_and_dependencies():
    """
    Se o usuário executar `python main.py` diretamente no PowerShell usando o Python
    global (sem o venv ativado e sem loguru instalado), redireciona automaticamente
    a execução para `venv\\Scripts\\python.exe` (ou cria o venv e instala requirements.txt).
    """
    try:
        import loguru  # noqa: F401
        import MetaTrader5  # noqa: F401
        import pydantic_settings  # noqa: F401
        return
    except ModuleNotFoundError as missing_err:
        venv_python = BASE_DIR / "venv" / "Scripts" / "python.exe"
        current_exe = Path(sys.executable).resolve()

        if os.environ.get("MT5_WORKER_BOOTSTRAPPED") == "1":
            print(f"[ERRO CRITICO] Dependencia ausente mesmo apos bootstrap: {missing_err}")
            sys.exit(1)

        os.environ["MT5_WORKER_BOOTSTRAPPED"] = "1"

        if not venv_python.exists():
            print("[SETUP] Ambiente virtual (venv) nao encontrado. Criando automaticamente...")
            subprocess.check_call([sys.executable, "-m", "venv", "--system-site-packages", str(BASE_DIR / "venv")])

        # Verifica se o venv ja possui os pacotes instalados
        check_cmd = [str(venv_python), "-c", "import loguru, MetaTrader5, pydantic_settings, psutil, requests"]
        if subprocess.call(check_cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) != 0:
            print("[SETUP] Instalando dependencias do requirements.txt no venv...")
            subprocess.check_call([str(venv_python), "-m", "pip", "install", "-r", str(BASE_DIR / "requirements.txt")])

        if current_exe != venv_python.resolve():
            print(f"[INFO] Reiniciando execucao automaticamente dentro do venv: {venv_python}")
            result = subprocess.run([str(venv_python), str( Path(__file__).resolve() ), *sys.argv[1:]])
            sys.exit(result.returncode)


_ensure_venv_and_dependencies()

from loguru import logger  # noqa: E402
from config.settings import settings  # noqa: E402
from core.worker_manager import WorkerManager  # noqa: E402


def _acquire_single_instance_mutex(worker_id: str):
    """
    Garante que apenas 1 instância do Worker rode por vez no Windows Server,
    evitando que dois processos Python disputem o mesmo terminal64.exe via IPC.
    """
    if sys.platform != "win32":
        return None
    try:
        import ctypes
        mutex_name = f"Global\\TorexJournal_MT5_Worker_{worker_id}"
        kernel32 = ctypes.windll.kernel32
        handle = kernel32.CreateMutexW(None, False, mutex_name)
        last_error = kernel32.GetLastError()
        ERROR_ALREADY_EXISTS = 183
        if last_error == ERROR_ALREADY_EXISTS:
            logger.error(
                f"Outra instância do MT5 Worker ({worker_id}) já está em execução neste servidor! "
                "Feche a janela anterior antes de iniciar uma nova."
            )
            sys.exit(1)
        return handle
    except Exception as e:
        logger.debug(f"Não foi possível criar mutex de instância única: {e}")
        return None


def setup_logging():
    log_dir = Path(settings.data_dir).resolve() / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)

    logger.remove()
    # Console output
    logger.add(
        sys.stdout,
        format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>",
        level=settings.log_level,
        colorize=True
    )
    # File output with rotation
    logger.add(
        str(log_dir / "worker_{time:YYYY-MM-DD}.log"),
        rotation="50 MB",
        retention="14 days",
        level="DEBUG",
        encoding="utf-8"
    )


def main():
    setup_logging()
    _mutex_handle = _acquire_single_instance_mutex(settings.worker_id)

    logger.info("========================================================")
    logger.info("  Iniciando TorexJournal MT5 Server Worker (Production)")
    logger.info(f"  Backend URL : {settings.backend_url}")
    logger.info(f"  Worker ID   : {settings.worker_id}")
    logger.info(f"  MT5 Path    : {settings.mt5_default_path}")
    logger.info(f"  Data Dir    : {Path(settings.data_dir).resolve()}")
    logger.info("========================================================")

    manager = WorkerManager()

    def signal_handler(sig, frame):
        logger.warning(f"Sinal de interrupção recebido ({sig}). Parando worker de forma segura...")
        manager.stop()
        sys.exit(0)

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    try:
        manager.start()
        # Mantém processo principal vivo aguardando sinais
        while manager.is_running:
            time.sleep(1)
    except KeyboardInterrupt:
        logger.warning("Interrupção por teclado (Ctrl+C). Encerrando worker...")
        manager.stop()
        sys.exit(0)
    except Exception as e:
        logger.critical(f"Erro fatal na execução do worker: {e}")
        manager.stop()
        sys.exit(1)


if __name__ == "__main__":
    main()

