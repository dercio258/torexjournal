import requests
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
        self.base_url = settings.backend_url.rstrip("/") + "/api/v1/mt5-worker"
        self.session = requests.Session()
        self.session.headers.update({
            "Content-Type": "application/json",
            "X-Worker-Id": settings.worker_id,
            "X-Worker-Key": settings.worker_key,
        })
        self.timeout = 10  # 10s timeout default

    def _post(self, endpoint: str, json_data: Any) -> Optional[requests.Response]:
        url = f"{self.base_url}{endpoint}"
        try:
            response = self.session.post(url, json=json_data, timeout=self.timeout)
            if not response.ok:
                logger.warning(f"Resposta do backend ({response.status_code}) em POST {endpoint}: {response.text}")
            return response
        except requests.exceptions.RequestException as e:
            logger.warning(f"Erro na comunicação POST {endpoint}: {e}")
            return None

    def _get(self, endpoint: str, params: Optional[Dict[str, Any]] = None) -> Optional[requests.Response]:
        url = f"{self.base_url}{endpoint}"
        try:
            response = self.session.get(url, params=params, timeout=self.timeout)
            if not response.ok:
                logger.warning(f"Resposta do backend ({response.status_code}) em GET {endpoint}: {response.text}")
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

    def heartbeat(self, heartbeat: WorkerHeartbeat) -> bool:
        """Envia métricas de telemetria e integridade"""
        res = self._post("/heartbeat", heartbeat.model_dump(mode="json"))
        return res is not None and res.status_code == 200

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
        res = self._post("/sync/accounts", account_info.model_dump(mode="json"))
        if res and res.status_code == 200:
            try:
                data = res.json()
                if data.get("success"):
                    logger.info(f"Métricas da conta {account_info.login} sincronizadas com sucesso (Saldo: ${account_info.balance:.2f}, Equity: ${account_info.equity:.2f})")
                    return True
                else:
                    logger.warning(f"Backend recusou métricas da conta {account_info.login}: {data.get('message')}")
                    return False
            except Exception:
                return True
        return False

    def sync_trades(self, payload: SyncTradesPayload) -> bool:
        """Envia histórico incremental de negociações (Deals)"""
        res = self._post("/sync/trades", payload.model_dump(mode="json"))
        if res and res.status_code == 200:
            try:
                data = res.json()
                if data.get("success"):
                    saved_count = data.get("saved", len(payload.trades))
                    logger.success(f"{saved_count} trades da conta {payload.login or payload.accountId} persistidos com sucesso no backend!")
                    return True
                else:
                    logger.warning(f"Backend recusou trades da conta {payload.login or payload.accountId}: {data.get('message')}")
                    return False
            except Exception:
                return True
        return False

    def sync_orders(self, payload: SyncOrdersPayload) -> bool:
        """Envia lista atualizada de ordens pendentes"""
        res = self._post("/sync/orders", payload.model_dump(mode="json"))
        return res is not None and res.status_code == 200

    def sync_positions(self, payload: SyncPositionsPayload) -> bool:
        """Envia posições abertas em tempo real"""
        res = self._post("/sync/positions", payload.model_dump(mode="json"))
        if res and res.status_code == 200:
            try:
                data = res.json()
                return data.get("success", False) is True
            except Exception:
                return True
        return False

    def send_event(self, event: WorkerEvent) -> bool:
        """Envia notificação de eventos críticos para o dashboard"""
        res = self._post("/events", event.model_dump(mode="json"))
        return res is not None and res.status_code in (200, 201)
