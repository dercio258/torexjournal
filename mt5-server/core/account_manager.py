import json
import os
from pathlib import Path
from typing import Dict, Optional, List
from pydantic import BaseModel, Field
from datetime import datetime
from loguru import logger
from config.settings import settings

class AccountSession(BaseModel):
    account_id: int
    login: str
    server: str
    password: Optional[str] = None  # Mantido apenas em memória
    status: str = "INITIALIZING"     # INITIALIZING, ONLINE, SYNCING, FAILED, OFFLINE
    last_deal_ticket: int = 0
    last_sync_time: Optional[datetime] = None
    error_count: int = 0
    last_error: Optional[str] = None

class AccountManager:
    """Gerencia o ciclo de vida e estado das contas sob controle do worker (capacidade máxima de 10)."""

    def __init__(self):
        self.max_capacity = settings.max_accounts
        self.accounts: Dict[int, AccountSession] = {}
        self.pool_file = Path("data/accounts_pool.json")
        self._load_pool()

    def _load_pool(self):
        """Carrega contas persistidas para não perder monitoramento em caso de restart"""
        try:
            if self.pool_file.exists():
                with open(self.pool_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    for item in data:
                        acc_id = int(item["account_id"])
                        session = AccountSession(
                            account_id=acc_id,
                            login=str(item["login"]),
                            server=str(item["server"]),
                            last_deal_ticket=int(item.get("last_deal_ticket", 0)),
                            status="ONLINE"
                        )
                        self.accounts[acc_id] = session
                logger.info(f"Carregadas {len(self.accounts)} contas persistidas do pool ({self.pool_file})")
        except Exception as e:
            logger.warning(f"Não foi possível carregar pool de contas salvas: {e}")

    def _save_pool(self):
        """Salva metadados do pool em disco (sem salvar senhas em texto puro)"""
        try:
            self.pool_file.parent.mkdir(parents=True, exist_ok=True)
            export_data = []
            for acc in self.accounts.values():
                export_data.append({
                    "account_id": acc.account_id,
                    "login": acc.login,
                    "server": acc.server,
                    "last_deal_ticket": acc.last_deal_ticket,
                    "last_sync_time": acc.last_sync_time.isoformat() if acc.last_sync_time else None
                })
            with open(self.pool_file, "w", encoding="utf-8") as f:
                json.dump(export_data, f, indent=2)
        except Exception as e:
            logger.debug(f"Falha ao persistir pool de contas: {e}")

    def can_accept_account(self) -> bool:
        """Verifica se o worker ainda tem capacidade para gerenciar novas contas"""
        return len(self.accounts) < self.max_capacity

    def add_or_update_account(
        self,
        account_id: int,
        login: str,
        server: str,
        password: Optional[str] = None,
        last_deal_ticket: int = 0
    ) -> AccountSession:
        if account_id in self.accounts:
            acc = self.accounts[account_id]
            acc.login = login
            acc.server = server
            if password:
                acc.password = password
            if last_deal_ticket > acc.last_deal_ticket:
                acc.last_deal_ticket = last_deal_ticket
            self._save_pool()
            return acc

        if not self.can_accept_account():
            raise RuntimeError(f"Capacidade máxima do worker atingida ({self.max_capacity} contas).")

        session = AccountSession(
            account_id=account_id,
            login=login,
            server=server,
            password=password,
            last_deal_ticket=last_deal_ticket
        )
        self.accounts[account_id] = session
        logger.info(f"Conta {account_id} ({login}@{server}) adicionada ao pool. Total: {len(self.accounts)}/{self.max_capacity}")
        self._save_pool()
        return session

    def get_account(self, account_id: int) -> Optional[AccountSession]:
        return self.accounts.get(account_id)

    def remove_account(self, account_id: int):
        if account_id in self.accounts:
            self.accounts.pop(account_id)
            logger.info(f"Conta {account_id} removida do pool do worker. Total restante: {len(self.accounts)}")
            self._save_pool()

    def get_active_account_ids(self) -> List[int]:
        return list(self.accounts.keys())

    def update_checkpoint(self, account_id: int, last_deal_ticket: int):
        acc = self.accounts.get(account_id)
        if acc:
            if last_deal_ticket > acc.last_deal_ticket:
                acc.last_deal_ticket = last_deal_ticket
            acc.last_sync_time = datetime.utcnow()
            acc.error_count = 0
            acc.last_error = None
            acc.status = "ONLINE"
            self._save_pool()

    def mark_error(self, account_id: int, error_message: str):
        acc = self.accounts.get(account_id)
        if acc:
            acc.error_count += 1
            acc.last_error = error_message
            if acc.error_count >= 3:
                acc.status = "FAILED"
            else:
                acc.status = "OFFLINE"
            self._save_pool()
