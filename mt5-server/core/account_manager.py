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


import ctypes
import ctypes.wintypes
import os


class _DATA_BLOB(ctypes.Structure):
    _fields_ = [
        ("cbData", ctypes.wintypes.DWORD),
        ("pbData", ctypes.POINTER(ctypes.c_char)),
    ]


def _dpapi_encrypt(raw_bytes: bytes) -> Optional[bytes]:
    if os.name != "nt":
        return None
    try:
        crypt32 = ctypes.windll.crypt32
        kernel32 = ctypes.windll.kernel32
        buf = ctypes.create_string_buffer(raw_bytes, len(raw_bytes))
        blob_in = _DATA_BLOB(len(raw_bytes), buf)
        blob_out = _DATA_BLOB()
        if crypt32.CryptProtectData(ctypes.byref(blob_in), None, None, None, None, 0, ctypes.byref(blob_out)):
            encrypted = ctypes.string_at(blob_out.pbData, blob_out.cbData)
            kernel32.LocalFree(blob_out.pbData)
            return encrypted
    except Exception:
        pass
    return None


def _dpapi_decrypt(enc_bytes: bytes) -> Optional[bytes]:
    if os.name != "nt":
        return None
    try:
        crypt32 = ctypes.windll.crypt32
        kernel32 = ctypes.windll.kernel32
        buf = ctypes.create_string_buffer(enc_bytes, len(enc_bytes))
        blob_in = _DATA_BLOB(len(enc_bytes), buf)
        blob_out = _DATA_BLOB()
        if crypt32.CryptUnprotectData(ctypes.byref(blob_in), None, None, None, None, 0, ctypes.byref(blob_out)):
            decrypted = ctypes.string_at(blob_out.pbData, blob_out.cbData)
            kernel32.LocalFree(blob_out.pbData)
            return decrypted
    except Exception:
        pass
    return None


def _derive_key(secret: str) -> bytes:
    return hashlib.sha256((secret or "torex-default-key").encode("utf-8")).digest()


def _encrypt_secret(plain_text: Optional[str]) -> Optional[str]:
    if not plain_text:
        return None
    try:
        raw = plain_text.encode("utf-8")
        dpapi_bytes = _dpapi_encrypt(raw)
        if dpapi_bytes is not None:
            return "dpapi:" + base64.urlsafe_b64encode(dpapi_bytes).decode("ascii")
        key = _derive_key(settings.worker_key)
        xored = bytes(b ^ key[i % len(key)] for i, b in enumerate(raw))
        return base64.urlsafe_b64encode(xored).decode("ascii")
    except Exception as e:
        logger.debug(f"Falha ao criptografar credencial local: {e}")
        return None


def _decrypt_secret(cipher_text: Optional[str]) -> Optional[str]:
    if not cipher_text:
        return None
    try:
        if cipher_text.startswith("dpapi:"):
            enc_bytes = base64.urlsafe_b64decode(cipher_text[6:].encode("ascii"))
            dec_bytes = _dpapi_decrypt(enc_bytes)
            return dec_bytes.decode("utf-8") if dec_bytes is not None else None
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

                            saved_status = str(item.get("status", "ONLINE") or "ONLINE").upper()
                            initial_status = "FAILED" if saved_status in ("FAILED", "AUTH_FAILED") else "ONLINE"

                            session = AccountSession(
                                account_id=acc_id,
                                login=str(item["login"]),
                                server=str(item["server"]),
                                password=decrypted_pwd,
                                last_deal_ticket=int(item.get("last_deal_ticket", 0)),
                                last_deal_time=last_deal_dt,
                                last_sync_time=last_sync_dt,
                                status=initial_status,
                                error_count=int(item.get("error_count", 0) or 0),
                                last_error=item.get("last_error"),
                            )
                            self.accounts[acc_id] = session
                    active_cnt = len([a for a in self.accounts.values() if a.status not in ("FAILED", "AUTH_FAILED")])
                    quarantined_cnt = len(self.accounts) - active_cnt
                    logger.info(
                        f"Carregadas {len(self.accounts)} contas do cofre local ({self.pool_file}) "
                        f"[Ativas: {active_cnt} | Em quarentena por falha de login: {quarantined_cnt}]"
                    )
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
                        "error_count": acc.error_count,
                        "last_error": acc.last_error,
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
        """Retorna apenas contas operacionais (ignora contas em quarentena por falha de autenticação -6)."""
        with self._lock:
            return [
                acc_id
                for acc_id, acc in self.accounts.items()
                if acc.status not in ("FAILED", "AUTH_FAILED")
            ]

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

    def mark_error(self, account_id: int, error_message: str, is_auth_error: bool = False):
        with self._lock:
            acc = self.accounts.get(account_id)
            if acc:
                acc.error_count += 1
                acc.last_error = error_message
                if is_auth_error or "Authorization failed" in (error_message or "") or acc.error_count >= 2:
                    prev_status = acc.status
                    acc.status = "FAILED"
                    if prev_status != "FAILED":
                        logger.error(
                            f"[QUARENTENA] Conta {acc.login}@{acc.server} (ID: {account_id}) pausada do ciclo automático "
                            f"após falha de autenticação/conexão ({error_message}). "
                            f"Ela não derrubará a sessão das demais contas até que novas credenciais sejam enviadas."
                        )
                else:
                    acc.status = "OFFLINE"
                self._save_pool()

