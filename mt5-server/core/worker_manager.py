import time
import threading
from typing import Optional
from loguru import logger

from config.settings import settings
from models.schemas import (
    Task,
    TaskType,
    TaskStatus,
    WorkerEvent,
    ResourceExhaustionError,
)
from api_client.client import BackendApiClient
from .account_manager import AccountManager
from .process_manager import MT5ProcessManager
from .sync_engine import SyncEngine
from .local_queue import LocalQueue
from .health_monitor import HealthMonitor
from .retry_manager import RetryManager

class WorkerManager:
    """Orquestrador principal do TorexJournal MT5 Worker."""

    def __init__(self):
        self.api_client = BackendApiClient()
        self.account_manager = AccountManager()
        self.process_manager = MT5ProcessManager()
        self.sync_engine = SyncEngine()
        self.local_queue = LocalQueue()
        self.health_monitor = HealthMonitor(self.process_manager)
        
        self.is_running = False
        self._threads = []
        self.last_resource_alert_time: float = 0

    def start(self):
        """Inicia os loops assíncronos do worker"""
        logger.info(f"=== Inicializando TorexJournal MT5 Worker [{settings.worker_id}] ===")
        logger.info(f"Capacidade máxima configurada: {settings.max_accounts} contas")
        
        # 1. Registro no Backend Linux
        system_info = {
            "max_accounts": settings.max_accounts,
            "poll_interval": settings.poll_interval_seconds,
            "sync_interval": settings.sync_interval_seconds,
        }
        registered = self.api_client.register(capacity=settings.max_accounts, system_info=system_info)
        if not registered:
            logger.warning("Falha no handshake inicial com o backend Linux. O worker continuará em modo retry.")

        self.is_running = True

        # Inicia threads operacionais
        self._spawn_thread(self._polling_loop, "TaskPolling")
        self._spawn_thread(self._heartbeat_loop, "Heartbeat")
        self._spawn_thread(self._sync_loop, "IncrementalSync")
        self._spawn_thread(self._watchdog_loop, "WatchdogAutoRecovery")
        self._spawn_thread(self._offline_flush_loop, "OfflineBufferFlush")

        logger.success("Worker iniciado e operando em segundo plano.")

    def stop(self):
        """Encerra o worker de forma limpa (graceful shutdown)"""
        logger.info("Encerrando TorexJournal MT5 Worker...")
        self.is_running = False
        
        # Encerra processos
        self.process_manager.stop_all()
        self.sync_engine.disconnect()
        logger.info("Todos os recursos foram liberados.")

    def _spawn_thread(self, target, name: str):
        t = threading.Thread(target=target, name=name, daemon=True)
        t.start()
        self._threads.append(t)

    # -------------------------------------------------------------
    # 1. LOOP DE POLLING DE TAREFAS
    # -------------------------------------------------------------
    def _polling_loop(self):
        while self.is_running:
            try:
                tasks = self.api_client.get_tasks()
                for task in tasks:
                    self._execute_task(task)
            except Exception as e:
                logger.error(f"Erro no loop de polling de tarefas: {e}")
            time.sleep(settings.poll_interval_seconds)

    def _send_resource_alert(self, message: str, metrics: dict, account_id: Optional[int] = None):
        """Envia evento técnico de alerta para o backend respeitando rate limit para evitar storm de logs/rede."""
        now = time.time()
        if now - self.last_resource_alert_time >= 30:
            self.last_resource_alert_time = now
            try:
                self.api_client.send_event(WorkerEvent(
                    workerId=settings.worker_id,
                    accountId=account_id,
                    eventType="RESOURCE_EXHAUSTION_ALERT",
                    severity="CRITICAL",
                    message=message,
                    metadata=metrics
                ))
            except Exception as e:
                logger.warning(f"Não foi possível enviar alerta de recursos ao backend: {e}")

    def _execute_task(self, task: Task):
        logger.info(f"Processando tarefa [{task.id}] - Tipo: {task.type} (Conta {task.accountId})")

        # 1. Checagem prévia de viabilidade de recursos e anti-loop
        is_safe, error_msg, metrics = self.health_monitor.check_resource_guard(
            operation=f"Execução de Tarefa {task.type}",
            account_id=task.accountId
        )
        if not is_safe:
            logger.critical(f"[TAREFA ABORTADA - ESGOTAMENTO DE RECURSOS] {error_msg}")
            self.api_client.ack_task(
                task.id,
                TaskStatus.FAILED,
                message=f"Tarefa cancelada preventivamente para proteger a VPS: {error_msg}",
                details=metrics
            )
            self._send_resource_alert(error_msg, metrics, account_id=task.accountId)
            return

        self.api_client.ack_task(task.id, TaskStatus.IN_PROGRESS, "Iniciando execução...")

        try:
            if task.type == TaskType.START_ACCOUNT:
                self._handle_start_account(task)
            elif task.type == TaskType.STOP_ACCOUNT:
                self._handle_stop_account(task)
            elif task.type == TaskType.SYNC_ACCOUNT:
                self._handle_sync_account(task)
            elif task.type == TaskType.FORCE_FULL_SYNC:
                self._handle_force_full_sync(task)
            elif task.type == TaskType.RESTART_TERMINAL:
                self._handle_restart_terminal(task)
            else:
                self.api_client.ack_task(task.id, TaskStatus.FAILED, f"Tipo de tarefa desconhecido: {task.type}")
        except ResourceExhaustionError as re:
            logger.critical(f"[FALHA DE RECURSOS EM TAREFA {task.id}] {re.message}")
            self.api_client.ack_task(task.id, TaskStatus.FAILED, message=re.message, details=re.metrics)
            self._send_resource_alert(re.message, re.metrics, account_id=task.accountId)
        except Exception as e:
            res_metrics = self.health_monitor.get_resource_metrics()
            tech_error = (
                f"[ERRO TÉCNICO EM TAREFA {task.id}] {e}. "
                f"Memória Consumida: {res_metrics['memory_used_mb']} MB / {res_metrics['memory_total_mb']} MB ({res_metrics['memory_percent']}%) | "
                f"RAM Livre: {res_metrics['memory_available_mb']} MB | CPU: {res_metrics['cpu_percent']}%"
            )
            logger.error(tech_error)
            self.api_client.ack_task(task.id, TaskStatus.FAILED, message=tech_error, details=res_metrics)

    def _handle_start_account(self, task: Task):
        password = None
        # Resgate de credencial protegida via token temporário (one-time)
        if task.credentialToken:
            cred_response = self.api_client.exchange_credential(
                task_id=task.id,
                account_id=task.accountId,
                credential_token=task.credentialToken
            )
            if cred_response:
                password = cred_response.password
                logger.info(f"Credencial resgatada com sucesso para conta {task.accountId}")
            else:
                self.api_client.ack_task(task.id, TaskStatus.FAILED, "Falha na troca de credentialToken")
                return

        # Registra no pool de contas
        self.account_manager.add_or_update_account(
            account_id=task.accountId,
            login=task.login,
            server=task.server,
            password=password
        )

        # Inicia processo do terminal
        started = self.process_manager.start_terminal(
            account_id=task.accountId,
            login=task.login,
            server=task.server,
            password=password
        )

        if started:
            self.api_client.ack_task(task.id, TaskStatus.SUCCESS, "Terminal MT5 iniciado e conta online.")
            # Dispara sincronização inicial
            self._sync_single_account(task.accountId)
        else:
            self.api_client.ack_task(task.id, TaskStatus.FAILED, "Não foi possível iniciar o terminal MT5.")

    def _handle_stop_account(self, task: Task):
        self.process_manager.stop_terminal(task.accountId)
        self.account_manager.remove_account(task.accountId)
        self.api_client.ack_task(task.id, TaskStatus.SUCCESS, "Conta e terminal encerrados.")

    def _handle_sync_account(self, task: Task):
        self._sync_single_account(task.accountId)
        self.api_client.ack_task(task.id, TaskStatus.SUCCESS, "Sincronização concluída.")

    def _handle_force_full_sync(self, task: Task):
        self._sync_single_account(task.accountId, force_full=True)
        self.api_client.ack_task(task.id, TaskStatus.SUCCESS, "Sincronização completa concluída.")

    def _handle_restart_terminal(self, task: Task):
        acc = self.account_manager.get_account(task.accountId)
        if not acc:
            self.api_client.ack_task(task.id, TaskStatus.FAILED, "Conta não encontrada no pool.")
            return

        self.process_manager.stop_terminal(task.accountId)
        time.sleep(2)
        started = self.process_manager.start_terminal(acc.account_id, acc.login, acc.server, acc.password)
        if started:
            self.api_client.ack_task(task.id, TaskStatus.SUCCESS, "Terminal reiniciado com sucesso.")
        else:
            self.api_client.ack_task(task.id, TaskStatus.FAILED, "Falha ao reiniciar terminal.")

    # -------------------------------------------------------------
    # 2. SINCRONIZAÇÃO INCREMENTAL
    # -------------------------------------------------------------
    def _sync_loop(self):
        while self.is_running:
            try:
                # Checagem preventiva de hardware antes de iniciar a rodada de sincronização
                is_safe, error_msg, metrics = self.health_monitor.check_resource_guard(
                    operation="Sincronização Incremental"
                )
                if not is_safe:
                    self._send_resource_alert(error_msg, metrics)
                    # Dorme o período de cooldown sem iterar sobre as contas, evitando loops e consumo excessivo
                    time.sleep(settings.resource_cooldown_seconds)
                    continue

                for account_id in self.account_manager.get_active_account_ids():
                    if not self.is_running:
                        break
                    self._sync_single_account(account_id)
            except Exception as e:
                logger.error(f"Erro no loop de sincronização incremental: {e}")
            time.sleep(settings.sync_interval_seconds)

    def _sync_single_account(self, account_id: int, force_full: bool = False):
        acc = self.account_manager.get_account(account_id)
        if not acc:
            return

        # Checagem de integridade e quarentena da conta com métricas de memória/CPU
        is_safe, error_msg, metrics = self.health_monitor.check_account_resource_guard(
            account_id,
            operation=f"Extração Conta {account_id}"
        )
        if not is_safe:
            return

        try:
            # Garante a conexão IPC do MT5 para esta conta antes de extrair os dados
            if not self.sync_engine.ensure_connected(account_id, acc.login, acc.server, acc.password, settings.mt5_default_path):
                logger.warning(f"Não foi possível conectar IPC com MT5 para a conta {account_id}")
                return

            # 1. Atualizar métricas financeiras
            acc_info = self.sync_engine.fetch_account_info(account_id, acc.login, acc.server)
            if acc_info:
                success = self.api_client.sync_account(acc_info)
                if not success:
                    self.local_queue.enqueue("/sync/accounts", acc_info.model_dump(mode="json"))

            # 2. Atualizar posições abertas
            positions_payload = self.sync_engine.fetch_positions(account_id)
            pos_success = self.api_client.sync_positions(positions_payload)
            if not pos_success:
                self.local_queue.enqueue("/sync/positions", positions_payload.model_dump(mode="json"))

            # 3. Atualizar ordens pendentes
            orders_payload = self.sync_engine.fetch_orders(account_id)
            ord_success = self.api_client.sync_orders(orders_payload)
            if not ord_success:
                self.local_queue.enqueue("/sync/orders", orders_payload.model_dump(mode="json"))

            # 4. Sincronização incremental de histórico de Deals
            last_ticket = 0 if force_full else acc.last_deal_ticket
            deals_payload = self.sync_engine.fetch_incremental_deals(account_id, last_deal_ticket=last_ticket)
            
            if deals_payload.trades:
                logger.info(f"Sincronizando {len(deals_payload.trades)} novos negócios da conta {account_id}...")
                deal_success = self.api_client.sync_trades(deals_payload)
                if deal_success:
                    self.account_manager.update_checkpoint(account_id, deals_payload.lastDealTicket)
                else:
                    self.local_queue.enqueue("/sync/trades", deals_payload.model_dump(mode="json"))
            else:
                self.account_manager.update_checkpoint(account_id, acc.last_deal_ticket)

        except ResourceExhaustionError as re:
            logger.critical(f"[PROTEÇÃO ATIVA - EXTRAÇÃO SUSPENSA] {re.message}")
            self.health_monitor.record_account_resource_failure(account_id, re.message, re.metrics)
            self._send_resource_alert(re.message, re.metrics, account_id=account_id)
        except Exception as e:
            res_metrics = self.health_monitor.get_resource_metrics()
            technical_msg = (
                f"[FALHA NA EXTRAÇÃO CONTA {account_id}] Erro: {e}. "
                f"Memória Consumida: {res_metrics['memory_used_mb']} MB / {res_metrics['memory_total_mb']} MB ({res_metrics['memory_percent']}%) | "
                f"RAM Livre: {res_metrics['memory_available_mb']} MB | CPU: {res_metrics['cpu_percent']}%."
            )
            logger.error(technical_msg)
            self.health_monitor.record_account_resource_failure(account_id, str(e), res_metrics)

    # -------------------------------------------------------------
    # 3. TELEMETRIA E HEARTBEAT
    # -------------------------------------------------------------
    def _heartbeat_loop(self):
        while self.is_running:
            try:
                monitored = self.account_manager.get_active_account_ids()
                heartbeat_data = self.health_monitor.collect_telemetry(monitored)
                self.api_client.heartbeat(heartbeat_data)
            except Exception as e:
                logger.warning(f"Erro no envio de heartbeat: {e}")
            time.sleep(settings.heartbeat_interval_seconds)

    # -------------------------------------------------------------
    # 4. WATCHDOG E AUTO-RECOVERY
    # -------------------------------------------------------------
    def _watchdog_loop(self):
        while self.is_running:
            try:
                monitored = self.account_manager.get_active_account_ids()
                dead_accounts = self.health_monitor.check_and_recover_dead_terminals(monitored)
                for acc_id in dead_accounts:
                    acc = self.account_manager.get_account(acc_id)
                    if acc:
                        logger.warning(f"[Auto-Recovery] Tentando ressuscitar terminal da conta {acc_id}...")
                        self.api_client.send_event(WorkerEvent(
                            workerId=settings.worker_id,
                            accountId=acc_id,
                            eventType="TERMINAL_CRASH_DETECTED",
                            severity="WARNING",
                            message=f"Terminal da conta {acc_id} caiu. Iniciando auto-recovery."
                        ))
                        # Reinicia processo
                        restarted = self.process_manager.start_terminal(acc.account_id, acc.login, acc.server, acc.password)
                        if restarted:
                            logger.success(f"[Auto-Recovery] Terminal da conta {acc_id} recuperado com sucesso!")
                            self._sync_single_account(acc_id)
            except Exception as e:
                logger.error(f"Erro no loop do Watchdog: {e}")
            time.sleep(5)

    # -------------------------------------------------------------
    # 5. FLUSH DE BUFFER OFFLINE
    # -------------------------------------------------------------
    def _offline_flush_loop(self):
        while self.is_running:
            try:
                batch = self.local_queue.peek_batch(limit=20)
                for item_id, endpoint, payload in batch:
                    res = self.api_client._post(endpoint, payload)
                    if res and res.status_code in (200, 201):
                        self.local_queue.remove(item_id)
            except Exception as e:
                logger.warning(f"Erro ao descarregar buffer offline: {e}")
            time.sleep(15)
