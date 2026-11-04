import base64
import hashlib
import json
import threading
from pathlib import Path
from typing import Dict, Optional, List
from pydantic import BaseModel
from datetime import datetime, timezone
from loguru import logger
from config.settings import settings


def _derive_key(secret: str) -> bytes:
    return hashlib.sha256((secret or "torex-default-key").encode("utf-8")).digest()


def _encrypt_secret(plain_text: Optional[str]) -> Optional[str]:
    if not plain_text:
        return None
    try:
        key = _derive_key(settings.worker_key)
        raw = plain_text.encode("utf-8")
        xored = bytes(b ^ key[i % len(key)] for i, b in enumerate(raw))
        return base64.urlsafe_b64encode(xored).decode("ascii")
    except Exception as e:
        logger.debug(f"Falha ao criptografar credencial local: {e}")
        return None


def _decrypt_secret(cipher_text: Optional[str]) -> Optional[str]:
    if not cipher_text:
        return None
    try:
        key = _derive_key(settings.worker_key)
        xored = base64.urlsafe_b64decode(cipher_text.encode("ascii"))
        raw = bytes(b ^ key[i % len(key)] for i, b in enumerate(xored))
        return raw.decode("utf-8")
    except Exception as e:
        logger.debug(f"Falha ao descriptografar credencial local: {e}")
        return None


class AccountSession(BaseModel):
    account_id: int
    login: str
    server: str
    password: Optional[str] = None
    status: str = "INITIALIZING"     # INITIALIZING, ONLINE, SYNCING, FAILED, OFFLINE
    last_deal_ticket: int = 0
    last_deal_time: Optional[datetime] = None
    last_sync_time: Optional[datetime] = None
    error_count: int = 0
    last_error: Optional[str] = None


class AccountManager:
    """Gerencia o ciclo de vida, credenciais protegidas e watermark das contas sob controle do worker."""

    def __init__(self):
        self._lock = threading.RLock()
        self.max_capacity = settings.max_accounts
        self.accounts: Dict[int, AccountSession] = {}
        self.pool_file = Path(settings.data_dir).resolve() / "accounts_pool.json"
        self._load_pool()

    def _load_pool(self):
        """Carrega contas persistidas (incluindo senha criptografada e watermark) para cold-restart autônomo."""
        with self._lock:
            try:
                if self.pool_file.exists():
                    with open(self.pool_file, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        for item in data:
                            acc_id = int(item["account_id"])
                            decrypted_pwd = _decrypt_secret(item.get("password_enc"))
                            last_sync_str = item.get("last_sync_time")
                            last_deal_str = item.get("last_deal_time")

                            last_sync_dt = datetime.fromisoformat(last_sync_str) if last_sync_str else None
                            last_deal_dt = datetime.fromisoformat(last_deal_str) if last_deal_str else None

                            session = AccountSession(
                                account_id=acc_id,
                                login=str(item["login"]),
                                server=str(item["server"]),
                                password=decrypted_pwd,
                                last_deal_ticket=int(item.get("last_deal_ticket", 0)),
                                last_deal_time=last_deal_dt,
                                last_sync_time=last_sync_dt,
                                status="ONLINE"
                            )
                            self.accounts[acc_id] = session
                    logger.info(f"Carregadas {len(self.accounts)} contas persistidas do cofre local ({self.pool_file})")
            except Exception as e:
                logger.warning(f"Não foi possível carregar pool de contas salvas: {e}")

    def _save_pool(self):
        """Salva metadados do pool em disco com senha criptografada via chave do worker."""
        with self._lock:
            try:
                self.pool_file.parent.mkdir(parents=True, exist_ok=True)
                export_data = []
                for acc in self.accounts.values():
                    export_data.append({
                        "account_id": acc.account_id,
                        "login": acc.login,
                        "server": acc.server,
                        "password_enc": _encrypt_secret(acc.password),
                        "last_deal_ticket": acc.last_deal_ticket,
                        "last_deal_time": acc.last_deal_time.isoformat() if acc.last_deal_time else None,
                        "last_sync_time": acc.last_sync_time.isoformat() if acc.last_sync_time else None,
                        "status": acc.status,
                    })
                temp_file = self.pool_file.with_suffix(".tmp")
                with open(temp_file, "w", encoding="utf-8") as f:
                    json.dump(export_data, f, indent=2)
                temp_file.replace(self.pool_file)
            except Exception as e:
                logger.warning(f"Falha ao persistir pool de contas em {self.pool_file}: {e}")

    def can_accept_account(self) -> bool:
        """Verifica se o worker ainda tem capacidade para gerenciar novas contas."""
        with self._lock:
            return len(self.accounts) < self.max_capacity

    def add_or_update_account(
        self,
        account_id: int,
        login: str,
        server: str,
        password: Optional[str] = None,
        last_deal_ticket: int = 0,
        last_deal_time: Optional[datetime] = None,
    ) -> AccountSession:
        with self._lock:
            if account_id in self.accounts:
                acc = self.accounts[account_id]
                acc.login = login
                acc.server = server
                if password:
                    acc.password = password
                if last_deal_ticket > acc.last_deal_ticket:
                    acc.last_deal_ticket = last_deal_ticket
                if last_deal_time and (not acc.last_deal_time or last_deal_time > acc.last_deal_time):
                    acc.last_deal_time = last_deal_time
                acc.status = "ONLINE"
                acc.error_count = 0
                acc.last_error = None
                self._save_pool()
                return acc

            if not self.can_accept_account():
                raise RuntimeError(f"Capacidade máxima do worker atingida ({self.max_capacity} contas).")

            session = AccountSession(
                account_id=account_id,
                login=login,
                server=server,
                password=password,
                last_deal_ticket=last_deal_ticket,
                last_deal_time=last_deal_time,
                status="ONLINE",
            )
            self.accounts[account_id] = session
            logger.info(f"Conta {account_id} ({login}@{server}) adicionada ao pool. Total: {len(self.accounts)}/{self.max_capacity}")
            self._save_pool()
            return session

    def get_account(self, account_id: int) -> Optional[AccountSession]:
        with self._lock:
            return self.accounts.get(account_id)

    def remove_account(self, account_id: int):
        with self._lock:
            if account_id in self.accounts:
                self.accounts.pop(account_id)
                logger.info(f"Conta {account_id} removida do pool do worker. Total restante: {len(self.accounts)}")
                self._save_pool()

    def get_active_account_ids(self) -> List[int]:
        with self._lock:
            return list(self.accounts.keys())

    def update_checkpoint(
        self,
        account_id: int,
        last_deal_ticket: int,
        last_deal_time: Optional[datetime] = None,
    ):
        with self._lock:
            acc = self.accounts.get(account_id)
            if acc:
                if last_deal_ticket > acc.last_deal_ticket:
                    acc.last_deal_ticket = last_deal_ticket
                if last_deal_time and (not acc.last_deal_time or last_deal_time > acc.last_deal_time):
                    acc.last_deal_time = last_deal_time
                acc.last_sync_time = datetime.now(timezone.utc)
                acc.error_count = 0
                acc.last_error = None
                acc.status = "ONLINE"
                self._save_pool()

    def mark_error(self, account_id: int, error_message: str):
        with self._lock:
            acc = self.accounts.get(account_id)
            if acc:
                acc.error_count += 1
                acc.last_error = error_message
                if acc.error_count >= 3:
                    acc.status = "FAILED"
                else:
                    acc.status = "OFFLINE"
                self._save_pool()

