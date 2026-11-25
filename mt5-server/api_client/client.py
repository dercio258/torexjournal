import hashlib
import hmac
import json
import secrets
import threading
import time
import requests
from urllib.parse import urlparse
from typing import List, Optional, Dict, Any
from loguru import logger
from config.settings import settings
from models.schemas import (
    Task,
    TaskAck,
    TaskStatus,
    CredentialResponse,
    AccountInfo,
    SyncTradesPayload,
    SyncOrdersPayload,
    SyncPositionsPayload,
    WorkerHeartbeat,
    WorkerEvent,
)

class BackendApiClient:
    def __init__(self):
        self._http_lock = threading.RLock()
        self.base_url = settings.backend_url.rstrip("/") + "/api/v1/mt5-worker"
        self.session = requests.Session()
        self.session.headers.update({
            "Content-Type": "application/json",
            "X-Worker-Id": settings.worker_id,
            "X-Worker-Key": settings.worker_key,
        })
        self.timeout = 10  # 10s timeout default

    @staticmethod
    def _format_error_body(status_code: int, text: str) -> str:
        raw = (text or "").strip()
        if "<!doctype html" in raw.lower() or "<html" in raw.lower():
            if status_code == 502:
                return "502 Bad Gateway (Cloudflare -> Backend Linux offline ou reiniciando no PM2)"
            if status_code in (503, 504):
                return f"{status_code} Gateway Unavailable/Timeout (Backend Linux ocupado ou offline)"
            return f"Página HTML de erro (HTTP {status_code})"
        return raw[:300]

    def _build_hmac_headers(self, method: str, full_url: str, body_bytes: bytes) -> Dict[str, str]:
        timestamp = str(int(time.time()))
        nonce = secrets.token_hex(12)
        path = urlparse(full_url).path
        body_hash = hashlib.sha256(body_bytes or b"").hexdigest()
        canonical = "\n".join([method.upper(), path, timestamp, nonce, body_hash]).encode("utf-8")
        signature = hmac.new(
            settings.worker_key.encode("utf-8"),
            canonical,
            hashlib.sha256,
        ).hexdigest()
        return {
            "X-Worker-Timestamp": timestamp,
            "X-Worker-Nonce": nonce,
            "X-Worker-Signature": f"sha256={signature}",
        }

    def _post(self, endpoint: str, json_data: Any) -> Optional[requests.Response]:
        url = f"{self.base_url}{endpoint}"
        body_bytes = json.dumps(json_data, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        headers = self._build_hmac_headers("POST", url, body_bytes)
        with self._http_lock:
            try:
                response = self.session.post(url, data=body_bytes, headers=headers, timeout=self.timeout)
                if not response.ok:
                    summary = self._format_error_body(response.status_code, response.text)
                    logger.warning(f"Resposta do backend ({response.status_code}) em POST {endpoint}: {summary}")
                return response
            except requests.exceptions.RequestException as e:
                logger.warning(f"Erro na comunicação POST {endpoint}: {e}")
                return None

    def _get(self, endpoint: str, params: Optional[Dict[str, Any]] = None) -> Optional[requests.Response]:
        url = f"{self.base_url}{endpoint}"
        headers = self._build_hmac_headers("GET", url, b"")
        with self._http_lock:
            try:
                response = self.session.get(url, params=params, headers=headers, timeout=self.timeout)
                if not response.ok:
                    summary = self._format_error_body(response.status_code, response.text)
                    logger.warning(f"Resposta do backend ({response.status_code}) em GET {endpoint}: {summary}")
                return response
            except requests.exceptions.RequestException as e:
                logger.warning(f"Erro na comunicação GET {endpoint}: {e}")
                return None

    def register(self, capacity: int, system_info: Dict[str, Any]) -> bool:
        """Registra o worker no Backend Linux"""
        payload = {
            "workerId": settings.worker_id,
            "capacity": capacity,
            "systemInfo": system_info
        }
        res = self._post("/register", payload)
        if res and res.status_code in (200, 201):
            logger.success(f"Worker registrado com sucesso no backend Linux: {settings.worker_id}")
            return True
        return False

    def heartbeat(self, heartbeat: WorkerHeartbeat) -> Optional[Dict[str, Any]]:
        """Envia métricas de telemetria e recebe diretivas do Load Balancer (evictLogins, isDraining)"""
        res = self._post("/heartbeat", heartbeat.model_dump(mode="json"))
        if res is not None and res.status_code == 200:
            try:
                data = res.json()
                return data if isinstance(data, dict) else {"success": True}
            except Exception:
                return {"success": True}
        return None

    def get_tasks(self) -> List[Task]:
        """Consulta tarefas pendentes atribuídas ao worker"""
        res = self._get("/tasks")
        if not res or res.status_code != 200:
            return []
        try:
            data = res.json()
            raw_tasks = data.get("tasks", [])
            return [Task.model_validate(t) for t in raw_tasks]
        except Exception as e:
            logger.error(f"Falha ao deserializar tarefas: {e}")
            return []

    def ack_task(self, task_id: str, status: TaskStatus, message: Optional[str] = None, details: Optional[Dict[str, Any]] = None) -> bool:
        """Confirma recebimento, status ou conclusão de uma tarefa"""
        payload = TaskAck(
            taskId=task_id,
            status=status,
            message=message,
            details=details or {}
        )
        res = self._post(f"/tasks/{task_id}/ack", payload.model_dump(mode="json"))
        return res is not None and res.status_code == 200

    def exchange_credential(self, task_id: str, account_id: int, credential_token: str) -> Optional[CredentialResponse]:
        """Troca o token temporário (one-time) pela senha para login no terminal"""
        payload = {
            "taskId": task_id,
            "accountId": account_id,
            "credentialToken": credential_token
        }
        res = self._post("/credentials/exchange", payload)
        if res and res.status_code == 200:
            return CredentialResponse.model_validate(res.json())
        logger.error(f"Falha ao resgatar credencial para conta {account_id}")
        return None

    def sync_account(self, account_info: AccountInfo) -> bool:
        """Atualiza saldo, equity, margem e alavancagem"""
        self.last_error_reason = None
        res = self._post("/sync/accounts", account_info.model_dump(mode="json"))
        if res and res.status_code == 200:
            try:
                data = res.json()
                if data.get("success"):
                    logger.info(f"Métricas da conta {account_info.login} sincronizadas com sucesso (Saldo: ${account_info.balance:.2f}, Equity: ${account_info.equity:.2f})")
                    return True
                else:
                    msg = str(data.get("message") or "")
                    if data.get("evict") is True or "stale_worker_lease" in msg.lower():
                        self.last_error_reason = "STALE_LEASE"
                    elif "account not found" in msg.lower():
                        self.last_error_reason = "ACCOUNT_NOT_FOUND"
                    else:
                        self.last_error_reason = "REJECTED"
                    logger.warning(f"Backend recusou métricas da conta {account_info.login}: {msg}")
                    return False
            except Exception:
                return True
        self.last_error_reason = "NETWORK_ERROR"
        return False

    def sync_trades(self, payload: SyncTradesPayload) -> bool:
        """Envia histórico incremental de negociações (Deals)"""
        self.last_error_reason = None
        res = self._post("/sync/trades", payload.model_dump(mode="json"))
        if res and res.status_code == 200:
            try:
                data = res.json()
                if data.get("success"):
                    saved_count = data.get("saved", len(payload.trades))
                    logger.success(f"{saved_count} trades da conta {payload.login or payload.accountId} persistidos com sucesso no backend!")
                    return True
                else:
                    msg = str(data.get("message") or "")
                    if data.get("evict") is True or "stale_worker_lease" in msg.lower():
                        self.last_error_reason = "STALE_LEASE"
                    elif "account not found" in msg.lower():
                        self.last_error_reason = "ACCOUNT_NOT_FOUND"
                    else:
                        self.last_error_reason = "REJECTED"
                    logger.warning(f"Backend recusou trades da conta {payload.login or payload.accountId}: {msg}")
                    return False
            except Exception:
                return True
        self.last_error_reason = "NETWORK_ERROR"
        return False

    def sync_orders(self, payload: SyncOrdersPayload) -> bool:
        """Envia lista atualizada de ordens pendentes"""
        res = self._post("/sync/orders", payload.model_dump(mode="json"))
        return res is not None and res.status_code == 200

    def sync_positions(self, payload: SyncPositionsPayload) -> bool:
        """Envia posições abertas em tempo real"""
        self.last_error_reason = None
        res = self._post("/sync/positions", payload.model_dump(mode="json"))
        if res and res.status_code == 200:
            try:
                data = res.json()
                if data.get("success", False) is True:
                    return True
                msg = str(data.get("message") or "")
                if "account not found" in msg.lower():
                    self.last_error_reason = "ACCOUNT_NOT_FOUND"
                else:
                    self.last_error_reason = "REJECTED"
                return False
            except Exception:
                return True
        self.last_error_reason = "NETWORK_ERROR"
        return False

    def send_event(self, event: WorkerEvent) -> bool:
        """Envia notificação de eventos críticos para o dashboard"""
        res = self._post("/events", event.model_dump(mode="json"))
        return res is not None and res.status_code in (200, 201)

    def sync_candles(self, payload: Dict[str, Any]) -> bool:
        """Envia lotes históricos de velas (OHLCV) extraídos do MT5 para o cache de Backtesting/Replay"""
        res = self._post("/sync/candles", payload)
        return res is not None and res.status_code in (200, 201)

    def sync_calendar(self, payload: Dict[str, Any]) -> bool:
        """Envia eventos do Calendário Econômico extraídos do MT5 para o backend"""
        res = self._post("/sync/calendar", payload)
        return res is not None and res.status_code in (200, 201)
