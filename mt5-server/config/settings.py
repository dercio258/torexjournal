from pathlib import Path
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
import os

BASE_DIR = Path(__file__).resolve().parent.parent

class Settings(BaseSettings):
    # Backend Linux Hub
    backend_url: str = Field(default="http://localhost:3000", alias="BACKEND_URL")
    worker_id: str = Field(default="win-worker-01", alias="WORKER_ID")
    worker_key: str = Field(default="secret_worker_key_change_me", alias="WORKER_KEY")
    
    # Timing
    poll_interval_seconds: int = Field(default=3, alias="POLL_INTERVAL_SECONDS")
    heartbeat_interval_seconds: int = Field(default=15, alias="HEARTBEAT_INTERVAL_SECONDS")
    sync_interval_seconds: int = Field(default=10, alias="SYNC_INTERVAL_SECONDS")
    
    # Capacity & Paths
    max_accounts: int = Field(default=10, alias="MAX_ACCOUNTS")
    mt5_default_path: str = Field(default=r"C:\Program Files\MetaTrader 5\terminal64.exe", alias="MT5_DEFAULT_PATH")
    instances_dir: str = Field(default=str(BASE_DIR / "instances"), alias="INSTANCES_DIR")
    data_dir: str = Field(default=str(BASE_DIR / "data"), alias="DATA_DIR")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")

    model_config = SettingsConfigDict(
        env_file=(
            str(BASE_DIR / ".env"),
            str(BASE_DIR.parent / ".env"),
            str(BASE_DIR.parent / "backend-nest" / ".env"),
        ),
        env_file_encoding="utf-8",
        extra="ignore"
    )

    def ensure_directories(self):
        Path(self.instances_dir).mkdir(parents=True, exist_ok=True)
        Path(self.data_dir).mkdir(parents=True, exist_ok=True)

settings = Settings()
settings.ensure_directories()
