import sys
import time
import signal
from pathlib import Path
from loguru import logger
from config.settings import settings
from core.worker_manager import WorkerManager

def setup_logging():
    log_dir = Path(settings.data_dir) / "logs"
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
    logger.info("Iniciando TorexJournal MT5 Server Worker...")
    logger.info(f"Backend URL: {settings.backend_url}")
    logger.info(f"Worker ID: {settings.worker_id}")
    
    manager = WorkerManager()

    def signal_handler(sig, frame):
        logger.warning(f"Sinal de interrupção recebido ({sig}). Parando worker...")
        manager.stop()
        sys.exit(0)

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    try:
        manager.start()
        # Mantém processo principal vivo aguardando sinais
        while manager.is_running:
            time.sleep(1)
    except Exception as e:
        logger.critical(f"Erro fatal na execução do worker: {e}")
        manager.stop()
        sys.exit(1)

if __name__ == "__main__":
    main()
