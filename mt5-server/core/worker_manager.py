import time
import threading
from typing import Optional, Dict, Any
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
from .sync_engine import SyncEngine, MT5_AVAILABLE, mt5
from .local_queue import LocalQueue
from .health_monitor import HealthMonitor


class WorkerManager:
    """
    Orquestrador principal do TorexJournal MT5 Worker.
    Opera em arquitetura Single-Loop Determinística (Zero Race Condition no IPC do MT5).
    """

    def __init__(self):
        self.api_client = BackendApiClient()
        self.account_manager = AccountManager()
        self.process_manager = MT5ProcessManager()
        self.sync_engine = SyncEngine()
        self.local_queue = LocalQueue()
        self.health_monitor = HealthMonitor(self.process_manager)

        self.is_running = False
        self.is_registered = False
        self._orchestrator_thread: Optional[threading.Thread] = None
        self.last_resource_alert_time: float = 0

        # Timestamps de controle do Event Tick Loop
        self._last_poll_ts: float = 0.0
        self._last_sync_ts: float = 0.0
        self._last_heartbeat_ts: float = 0.0
        self._last_flush_ts: float = 0.0
        self._last_calendar_sync_ts: float = 0.0
        # Deduplicação local de tarefas (task_id -> timestamp de processamento)
        self._processed_tasks: dict[str, float] = {}
        # Controle de cooldown individual por conta (evita thrashing e reduz frequência de contas $0.00 ociosas)
        self._account_last_sync_ts: dict[int, float] = {}
        self._account_idle_map: dict[int, bool] = {}
        # Contador de falhas transitórias consecutivas de IPC por conta (evita falso ACCOUNT_DISCONNECTED em blips)
        self._consecutive_connect_failures: dict[int, int] = {}
        # Garante que na primeira sincronização após iniciar o worker seja feita reconciliação completa (last_ticket=0)
        self._initial_full_synced: set[int] = set()

    def _ensure_registered(self) -> bool:
        if self.is_registered:
            return True
        system_info = {
            "max_accounts": settings.max_accounts,
            "poll_interval": settings.poll_interval_seconds,
            "sync_interval": settings.sync_interval_seconds,
        }
        self.is_registered = self.api_client.register(
            capacity=settings.max_accounts,
            system_info=system_info,
        )
        return self.is_registered

    def start(self):
        """Inicia o orquestrador determinístico em loop único."""
        logger.info(f"=== Inicializando TorexJournal MT5 Worker [{settings.worker_id}] ===")
        logger.info(f"Capacidade máxima configurada: {settings.max_accounts} contas")

        if not self._ensure_registered():
            logger.warning("Falha no handshake inicial com o backend. O worker tentará registrar novamente nos próximos ciclos.")

        self.is_running = True
        self._orchestrator_thread = threading.Thread(
            target=self._orchestrator_loop,
            name="MT5OrchestratorLoop",
            daemon=True,
        )
        self._orchestrator_thread.start()
        logger.success("Worker iniciado em modo Single-Loop Determinístico.")

    def stop(self):
        """Encerra o worker de forma limpa (graceful shutdown)."""
        logger.info("Encerrando TorexJournal MT5 Worker...")
        self.is_running = False
        if self._orchestrator_thread and self._orchestrator_thread.is_alive():
            self._orchestrator_thread.join(timeout=5.0)

        self.process_manager.stop_all()
        self.sync_engine.disconnect()
        logger.info("Todos os recursos foram liberados.")

    # -------------------------------------------------------------
    # LOOP CENTRAL DETERMINÍSTICO (TICK DE 0.5s)
    # -------------------------------------------------------------
    def _orchestrator_loop(self):
        while self.is_running:
            try:
                self.run_single_tick()
            except Exception as e:
                logger.error(f"Erro inesperado no ciclo do orquestrador: {e}")
            time.sleep(0.5)

    def run_single_tick(self, now: Optional[float] = None):
        """Executa uma iteração determinística do orquestrador respeitando prioridades."""
        current_ts = now if now is not None else time.time()

        # 1. PRIORIDADE MÁXIMA: Polling e execução imediata de tarefas do usuário (a cada poll_interval_seconds)
        if current_ts - self._last_poll_ts >= settings.poll_interval_seconds:
            self._last_poll_ts = time.time()
            self._poll_and_execute_tasks()

        # 2. TELEMETRIA & AUTO-REGISTRO: Heartbeat periódico (a cada heartbeat_interval_seconds)
        if current_ts - self._last_heartbeat_ts >= settings.heartbeat_interval_seconds:
            self._last_heartbeat_ts = time.time()
            self._ensure_registered()
            self._send_heartbeat()

        # 3. WATCHDOG & SINCRONIZAÇÃO INCREMENTAL ROUND-ROBIN (a cada sync_interval_seconds APÓS concluir o ciclo anterior)
        if current_ts - self._last_sync_ts >= settings.sync_interval_seconds:
            self._run_watchdog_and_sync_cycle()
            self._last_sync_ts = time.time()

        # 4. FLUSH DO BUFFER OFFLINE SQLITE (a cada 15s)
        if current_ts - self._last_flush_ts >= 15.0:
            self._last_flush_ts = time.time()
            self._flush_offline_batch()

        # 5. CALENDÁRIO ECONÔMICO MT5 VIA CONTA DEMO (consulta novas notícias a cada 10 minutos = 600s)
        if current_ts - self._last_calendar_sync_ts >= 600.0:
            self._last_calendar_sync_ts = time.time()
            self._run_periodic_calendar_sync_10m()

    # -------------------------------------------------------------
    # 1. EXECUÇÃO DE TAREFAS (PRIORIDADE ALTA + DEDUPLICAÇÃO)
    # -------------------------------------------------------------
    def _poll_and_execute_tasks(self):
        try:
            tasks = self.api_client.get_tasks()
            if not tasks:
                return
            now = time.time()
            # Limpa IDs expirados (> 120s) do cache de deduplicação
            self._processed_tasks = {tid: ts for tid, ts in self._processed_tasks.items() if now - ts < 120.0}

            # Ordena por prioridade (menor valor numérico = mais urgente)
            tasks.sort(key=lambda t: t.priority)
            for task in tasks:
                if not self.is_running:
                    break
                if task.id in self._processed_tasks:
                    continue
                self._processed_tasks[task.id] = time.time()
                self._execute_task(task)
        except Exception as e:
            logger.error(f"Erro ao consultar/executar tarefas pendentes: {e}")

    def _send_resource_alert(self, message: str, metrics: dict, account_id: Optional[int] = None):
        """Envia evento técnico de alerta para o backend respeitando rate limit."""
        if not settings.enable_resource_guard:
            return
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
            elif task.type == TaskType.FETCH_MARKET_BATCHES:
                self._handle_fetch_market_batches(task)
            elif task.type == TaskType.SYNC_CALENDAR:
                self._handle_sync_calendar(task)
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
        existing_acc = self.account_manager.get_account(task.accountId)
        password = existing_acc.password if existing_acc else None
        normalized_server = self.sync_engine._normalize_broker_server(task.server)
        if task.credentialToken:
            self.api_client.ack_task(
                task.id,
                TaskStatus.IN_PROGRESS,
                f"Resgatando credenciais seguras para conta {task.login}@{normalized_server}...",
                details={"step": "EXCHANGE_CREDENTIALS", "login": task.login, "server": normalized_server}
            )
            cred_response = self.api_client.exchange_credential(
                task_id=task.id,
                account_id=task.accountId,
                credential_token=task.credentialToken
            )
            if cred_response:
                password = cred_response.password
                pwd_diag = self.sync_engine._mask_password_diagnostic(password)
                logger.info(
                    f"Credencial resgatada com sucesso para conta {task.accountId} "
                    f"(Login: {task.login} @ {normalized_server} | Senha: {pwd_diag})"
                )
                # Salva imediatamente no cofre local (accounts_pool.json) para nunca perder a senha de uso único
                self.account_manager.add_or_update_account(
                    account_id=task.accountId,
                    login=task.login,
                    server=normalized_server,
                    password=password,
                )
            else:
                err_msg = "Falha na troca de credentialToken (token expirado ou inválido)"
                self.api_client.ack_task(task.id, TaskStatus.FAILED, err_msg, details={"error": err_msg})
                return

        self.api_client.ack_task(
            task.id,
            TaskStatus.IN_PROGRESS,
            f"Inicializando MT5 e autenticando conta {task.login} no servidor {normalized_server}...",
            details={"step": "AUTHENTICATING_MT5", "login": task.login, "server": normalized_server}
        )
        self.api_client.send_event(WorkerEvent(
            workerId=settings.worker_id,
            accountId=task.accountId,
            login=task.login,
            server=normalized_server,
            eventType="ACCOUNT_CONNECTING",
            severity="INFO",
            message=f"Autenticando conta {task.login} no servidor {normalized_server}..."
        ))

        def _report_progress(step_msg: str):
            try:
                self.api_client.ack_task(
                    task.id,
                    TaskStatus.IN_PROGRESS,
                    step_msg,
                    details={"step": "AUTHENTICATING_MT5", "login": task.login, "server": normalized_server}
                )
            except Exception:
                pass

        isolated_path = self.process_manager.get_or_prepare_isolated_terminal_exe(
            task.accountId,
            login=task.login,
            server=normalized_server,
            password=password,
        )
        connected = self.sync_engine.ensure_connected(
            account_id=task.accountId,
            login=task.login,
            server=normalized_server,
            password=password,
            path=isolated_path,
            progress_callback=_report_progress,
        )

        if connected:
            self.account_manager.add_or_update_account(
                account_id=task.accountId,
                login=task.login,
                server=normalized_server,
                password=password
            )
            self.api_client.ack_task(
                task.id,
                TaskStatus.IN_PROGRESS,
                f"Conta {task.login} autenticada! Sincronizando saldo, posições e histórico de operações...",
                details={"step": "SYNCING_DATA", "login": task.login, "server": normalized_server}
            )
            sync_summary = self._sync_single_account(task.accountId) or {}
            bal_str = f"${sync_summary.get('balance', 0.0):.2f}" if "balance" in sync_summary else ""
            trades_cnt = sync_summary.get("syncedTradesCount", 0)
            success_msg = (
                f"Terminal MT5 conectado e sincronizado com sucesso! "
                f"{f'Saldo: {bal_str} | ' if bal_str else ''}{trades_cnt} novos negócios importados."
            )
            self.api_client.ack_task(task.id, TaskStatus.SUCCESS, success_msg, details=sync_summary)
            self.api_client.send_event(WorkerEvent(
                workerId=settings.worker_id,
                accountId=task.accountId,
                login=task.login,
                server=normalized_server,
                eventType="ACCOUNT_CONNECTED",
                severity="INFO",
                message=success_msg,
                metadata=sync_summary
            ))
        else:
            err_detail = getattr(self.sync_engine, "last_connect_error", None) or (
                "Não foi possível conectar o terminal MT5 e autenticar a conta. Verifique login, senha e servidor."
            )
            is_auth_err = getattr(self.sync_engine, "last_error_code", None) == -6
            if self.account_manager.get_account(task.accountId):
                self.account_manager.mark_error(task.accountId, err_detail, is_auth_error=is_auth_err)
            self.api_client.ack_task(
                task.id,
                TaskStatus.FAILED,
                err_detail,
                details={"step": "FAILED", "error": err_detail, "login": task.login, "server": normalized_server}
            )
            self.api_client.send_event(WorkerEvent(
                workerId=settings.worker_id,
                accountId=task.accountId,
                login=task.login,
                server=normalized_server,
                eventType="ACCOUNT_LOGIN_FAILED",
                severity="ERROR",
                message=err_detail,
                metadata={"error": err_detail}
            ))

    def _handle_stop_account(self, task: Task):
        self.process_manager.stop_terminal(task.accountId)
        self.account_manager.remove_account(task.accountId)
        self.api_client.ack_task(task.id, TaskStatus.SUCCESS, "Conta e terminal encerrados.")
        self.api_client.send_event(WorkerEvent(
            workerId=settings.worker_id,
            accountId=task.accountId,
            login=task.login,
            eventType="ACCOUNT_STOPPED",
            severity="INFO",
            message=f"Monitoramento da conta {task.login} encerrado a pedido do usuário."
        ))

    def _handle_sync_account(self, task: Task):
        summary = self._sync_single_account(task.accountId) or {}
        self.api_client.ack_task(task.id, TaskStatus.SUCCESS, "Sincronização concluída.", details=summary)

    def _handle_force_full_sync(self, task: Task):
        summary = self._sync_single_account(task.accountId, force_full=True) or {}
        self.api_client.ack_task(task.id, TaskStatus.SUCCESS, "Sincronização completa concluída.", details=summary)

    def _handle_restart_terminal(self, task: Task):
        acc = self.account_manager.get_account(task.accountId)
        if not acc:
            self.api_client.ack_task(task.id, TaskStatus.FAILED, "Conta não encontrada no pool.")
            return

        self.process_manager.stop_terminal(task.accountId)
        time.sleep(2)
        isolated_path = self.process_manager.get_or_prepare_isolated_terminal_exe(
            acc.account_id,
            login=acc.login,
            server=acc.server,
            password=acc.password,
        )
        restarted = self.sync_engine.connect_account(
            account_id=acc.account_id,
            login=acc.login,
            server=acc.server,
            password=acc.password,
            path=isolated_path,
        )
        if restarted:
            summary = self._sync_single_account(acc.account_id) or {}
            self.api_client.ack_task(task.id, TaskStatus.SUCCESS, "Terminal reiniciado e autenticado com sucesso.", details=summary)
        else:
            err_detail = getattr(self.sync_engine, "last_connect_error", None) or "Falha ao reiniciar terminal."
            self.api_client.ack_task(task.id, TaskStatus.FAILED, err_detail)

    def _handle_fetch_market_batches(self, task: Task):
        """
        Conecta à Conta Demo compartilhada (ou conta sincronizada) no MT5, salva-a no pool local
        e extrai lotes históricos de 500 velas (OHLCV) para alimentar o Backtesting/Replay.
        """
        existing_acc = self.account_manager.get_account(task.accountId)
        password = existing_acc.password if existing_acc else None
        normalized_server = self.sync_engine._normalize_broker_server(task.server)

        if task.credentialToken:
            cred = self.api_client.exchange_credential(task.id, task.accountId, task.credentialToken)
            if cred and cred.password:
                password = cred.password
                self.account_manager.add_or_update_account(
                    account_id=task.accountId,
                    login=task.login,
                    server=normalized_server,
                    password=password,
                )

        isolated_path = self.process_manager.get_or_prepare_isolated_terminal_exe(
            task.accountId,
            login=task.login,
            server=normalized_server,
            password=password,
        )
        connected = self.sync_engine.ensure_connected(
            account_id=task.accountId,
            login=task.login,
            server=normalized_server,
            password=password,
            path=isolated_path,
        )
        if not connected:
            err_detail = getattr(self.sync_engine, "last_connect_error", None) or "Falha ao conectar conta Demo no MT5 para extração de velas."
            self.api_client.ack_task(task.id, TaskStatus.FAILED, err_detail)
            return

        opts = task.options or {}
        symbols = opts.get("symbols") or ["XAUUSD", "EURUSD", "GBPUSD"]
        timeframes = opts.get("timeframes") or ["15m", "5m", "1h"]
        from_ts = opts.get("fromTs")
        to_ts = opts.get("toTs")
        chunk_size = int(opts.get("chunkSize") or 500)

        logger.info(
            f"[MT5-DEMO-BATCHES] Conta Demo #{task.login}@{normalized_server} autenticada! "
            f"Extraindo lotes de {chunk_size} velas para ativos={symbols} nos timeframes={timeframes}..."
        )

        batches = self.sync_engine.fetch_candle_batches(
            symbols=symbols,
            timeframes=timeframes,
            from_ts_ms=from_ts,
            to_ts_ms=to_ts,
            chunk_size=chunk_size,
        )
        if batches:
            total_bars_synced = sum(len(b.get("candles", [])) for b in batches)
            logger.info(
                f"[MT5-DEMO-BATCHES] Enviando {len(batches)} lotes ({total_bars_synced} velas) ao Backend para a Conta #{task.login}..."
            )
            self.api_client.sync_candles({
                "accountId": task.accountId,
                "login": task.login,
                "server": normalized_server,
                "batches": batches,
            })

        # Também sincroniza eventos do Calendário Econômico se disponíveis no terminal MT5
        cal_events = self.sync_engine.fetch_economic_calendar_events()
        if cal_events:
            logger.info(
                f"[MT5-DEMO-CALENDAR] Enviando {len(cal_events)} notícias do Calendário Econômico ao Backend via Conta Demo #{task.login}..."
            )
            self.api_client.sync_calendar({
                "login": task.login,
                "server": normalized_server,
                "events": cal_events,
            })

        total_bars = sum(len(b.get("candles", [])) for b in batches)
        self.api_client.ack_task(
            task.id,
            TaskStatus.SUCCESS,
            f"Lotes de mercado extraídos via Conta MT5 {task.login}: {len(batches)} lotes ({total_bars} velas).",
            details={"batchesCount": len(batches), "totalCandles": total_bars},
        )

    def _handle_sync_calendar(self, task: Task):
        """
        Autentica a Conta Demo no MT5 (se necessário) e sincroniza novas notícias do Calendário Econômico
        nativo do MT5 para o backend (ciclo de 10 minutos).
        """
        existing_acc = self.account_manager.get_account(task.accountId)
        password = existing_acc.password if existing_acc else None
        normalized_server = self.sync_engine._normalize_broker_server(task.server)

        if task.credentialToken:
            cred = self.api_client.exchange_credential(task.id, task.accountId, task.credentialToken)
            if cred and cred.password:
                password = cred.password
                self.account_manager.add_or_update_account(
                    account_id=task.accountId,
                    login=task.login,
                    server=normalized_server,
                    password=password,
                )

        logger.info(
            f"[MT5-CALENDAR-TASK] Iniciando tarefa SYNC_CALENDAR [{task.id}] usando Conta Demo #{task.login}@{normalized_server}..."
        )

        if task.login and str(task.login).strip().isdigit():
            isolated_path = self.process_manager.get_or_prepare_isolated_terminal_exe(
                task.accountId,
                login=task.login,
                server=normalized_server,
                password=password,
            )
            connected = self.sync_engine.ensure_connected(
                account_id=task.accountId,
                login=task.login,
                server=normalized_server,
                password=password,
                path=isolated_path,
            )
            logger.info(
                f"[MT5-CALENDAR-TASK] Status da conexão MT5 para Conta Demo #{task.login}@{normalized_server}: {'CONECTADO' if connected else 'OFFLINE/LOCAL'}"
            )

        cal_events = self.sync_engine.fetch_economic_calendar_events()
        if cal_events:
            logger.info(
                f"[MT5-CALENDAR-TASK] {len(cal_events)} notícias encontradas no MT5! Sincronizando com o Backend..."
            )
            self.api_client.sync_calendar({
                "login": task.login,
                "server": normalized_server,
                "events": cal_events,
            })
        else:
            logger.info(
                f"[MT5-CALENDAR-TASK] Nenhuma nova notícia pendente no arquivo do terminal MT5 para Conta Demo #{task.login}."
            )
        self.api_client.ack_task(
            task.id,
            TaskStatus.SUCCESS,
            f"Calendário Econômico MT5 sincronizado via Conta Demo {task.login} ({len(cal_events)} notícias verificadas).",
            details={"eventsCount": len(cal_events), "pollIntervalMinutes": 10},
        )

    def _run_periodic_calendar_sync_10m(self):
        """Consulta novas notícias do Calendário Econômico no MT5 a cada 10 minutos usando a conta Demo/ativa."""
        try:
            active_ids = self.account_manager.get_active_account_ids()
            target_login = "DEMO_FEED"
            target_server = "MetaQuotes-Demo"
            if active_ids:
                acc = self.account_manager.get_account(active_ids[0])
                if acc:
                    target_login = acc.login
                    target_server = acc.server
                    logger.info(
                        f"[CALENDAR-10MIN] Ciclo automático de 10 minutos: consultando novas notícias no MT5 via Conta #{target_login}@{target_server}..."
                    )
                    isolated_path = self.process_manager.get_or_prepare_isolated_terminal_exe(
                        acc.account_id,
                        login=acc.login,
                        server=acc.server,
                        password=acc.password,
                    )
                    self.sync_engine.ensure_connected(
                        account_id=acc.account_id,
                        login=acc.login,
                        server=acc.server,
                        password=acc.password,
                        path=isolated_path,
                    )
            else:
                logger.info("[CALENDAR-10MIN] Ciclo automático de 10 minutos: verificando notícias locais do Calendário MT5...")

            cal_events = self.sync_engine.fetch_economic_calendar_events()
            if cal_events:
                logger.success(
                    f"[CALENDAR-10MIN] {len(cal_events)} notícias do Calendário MT5 extraídas via conta #{target_login} e enviadas ao Backend!"
                )
                self.api_client.sync_calendar({
                    "login": target_login,
                    "server": target_server,
                    "events": cal_events,
                })
            else:
                logger.info(f"[CALENDAR-10MIN] Verificação de 10min concluída (0 novas notícias no buffer local do MT5).")
        except Exception as e:
            logger.warning(f"[CALENDAR-10MIN] Falha no ciclo periódico de 10min do Calendário MT5: {e}")

    # -------------------------------------------------------------
    # 2. WATCHDOG INTEGRADO & SINCRONIZAÇÃO ROUND-ROBIN
    # -------------------------------------------------------------
    def _run_watchdog_and_sync_cycle(self):
        is_safe, error_msg, metrics = self.health_monitor.check_resource_guard(
            operation="Sincronização Incremental"
        )
        if not is_safe:
            self._send_resource_alert(error_msg, metrics)
            return

        active_ids = self.account_manager.get_active_account_ids()
        if not active_ids:
            return

        # Watchdog: verifica terminais caídos antes da rodada
        dead_accounts = set(self.health_monitor.check_and_recover_dead_terminals(active_ids))
        for acc_id in dead_accounts:
            self.api_client.send_event(WorkerEvent(
                workerId=settings.worker_id,
                accountId=acc_id,
                eventType="TERMINAL_CRASH_DETECTED",
                severity="WARNING",
                message=f"Terminal da conta {acc_id} inativo. Auto-recovery acionado no ciclo de sync."
            ))

        # Verifica se há pelo menos uma conta ativa com saldo/posições para manter Sticky Session nela
        has_funded_active = any(not self._account_idle_map.get(aid, False) for aid in active_ids if aid in self._account_idle_map)

        for account_id in active_ids:
            if not self.is_running:
                break
            now = time.time()
            last_acc_sync = self._account_last_sync_ts.get(account_id, 0.0)
            is_idle = self._account_idle_map.get(account_id, False)
            # Se a conta está com saldo $0.00 e 0 posições (ex: 408953138) e existe outra conta ativa operando (ex: 6371945),
            # aplica cooldown de 30 minutos (1800s) para NÃO deslogar a conta ativa do terminal único MT5 (porta 22346)!
            if is_idle and has_funded_active:
                min_cooldown = 1800.0
            elif len(active_ids) > 1:
                min_cooldown = 90.0
            else:
                min_cooldown = max(float(settings.sync_interval_seconds), 15.0)

            if now - last_acc_sync < min_cooldown:
                continue

            self._sync_single_account(account_id)

    def _sync_single_account(self, account_id: int, force_full: bool = False) -> Optional[Dict[str, Any]]:
        acc = self.account_manager.get_account(account_id)
        if not acc:
            return None

        is_safe, error_msg, metrics = self.health_monitor.check_account_resource_guard(
            account_id,
            operation=f"Extração Conta {acc.login}"
        )
        if not is_safe:
            return None

        try:
            self._account_last_sync_ts[account_id] = time.time()
            isolated_path = self.process_manager.get_or_prepare_isolated_terminal_exe(
                account_id,
                login=acc.login,
                server=acc.server,
                password=acc.password,
            )
            if not self.sync_engine.ensure_connected(account_id, acc.login, acc.server, acc.password, isolated_path):
                err_detail = getattr(self.sync_engine, "last_connect_error", None) or "Falha de conexão IPC/Login no MT5"
                is_auth_err = getattr(self.sync_engine, "last_error_code", None) == -6
                failures = self._consecutive_connect_failures.get(account_id, 0) + 1
                self._consecutive_connect_failures[account_id] = failures

                logger.warning(
                    f"Falha de conexão IPC/MT5 para a conta {acc.login}@{acc.server} "
                    f"(tentativa consecutiva #{failures}, auth_err={is_auth_err}): {err_detail}"
                )
                self.account_manager.mark_error(account_id, err_detail, is_auth_error=is_auth_err)

                if is_auth_err:
                    self.api_client.send_event(WorkerEvent(
                        workerId=settings.worker_id,
                        accountId=account_id,
                        login=acc.login,
                        server=acc.server,
                        eventType="ACCOUNT_LOGIN_FAILED",
                        severity="ERROR",
                        message=err_detail,
                        metadata={"error": err_detail, "consecutiveFailures": failures}
                    ))
                elif failures >= 3:
                    self.api_client.send_event(WorkerEvent(
                        workerId=settings.worker_id,
                        accountId=account_id,
                        login=acc.login,
                        server=acc.server,
                        eventType="ACCOUNT_DISCONNECTED",
                        severity="WARNING",
                        message=err_detail,
                        metadata={"error": err_detail, "consecutiveFailures": failures}
                    ))
                return None

            # Resetar contador de falhas transitórias assim que a conexão IPC é confirmada
            self._consecutive_connect_failures[account_id] = 0

            summary: Dict[str, Any] = {
                "accountId": account_id,
                "login": acc.login,
                "server": acc.server,
                "connected": True,
            }

            # 1. Atualizar métricas financeiras
            acc_info = self.sync_engine.fetch_account_info(account_id, acc.login, acc.server)
            if acc_info:
                summary.update({
                    "balance": acc_info.balance,
                    "equity": acc_info.equity,
                    "margin": acc_info.margin,
                    "freeMargin": acc_info.freeMargin,
                    "marginLevel": acc_info.marginLevel,
                    "leverage": acc_info.leverage,
                    "currency": acc_info.currency,
                    "company": acc_info.company,
                    "accountHolderName": acc_info.name,
                    "tradeMode": acc_info.tradeMode,
                    "pingMs": acc_info.pingMs,
                    "terminalBuild": acc_info.terminalBuild,
                })
                logger.info(
                    f"[SYNC] Enviando métricas da conta {acc.login} "
                    f"(Saldo: ${acc_info.balance:.2f}, Equity: ${acc_info.equity:.2f}, Ping: {acc_info.pingMs}ms)..."
                )
                success = self.api_client.sync_account(acc_info)
                if not success:
                    err_reason = getattr(self.api_client, "last_error_reason", None)
                    if err_reason == "ACCOUNT_NOT_FOUND":
                        logger.warning(
                            f"Conta {acc.login} (ID: {account_id}) não existe no Backend ('Account not found'). "
                            f"Removendo conta órfã do cofre local para não bloquear o terminal."
                        )
                        self.account_manager.remove_account(account_id)
                        return None
                    if err_reason in (None, "NETWORK_ERROR"):
                        self.local_queue.enqueue("/sync/accounts", acc_info.model_dump(mode="json"))

            # 2. Atualizar posições abertas (apenas se o snapshot não foi ignorado por isolamento de sessão)
            positions_payload = self.sync_engine.fetch_positions(account_id, login=acc.login)
            if not getattr(positions_payload, "skipped", False):
                summary["openPositionsCount"] = len(positions_payload.positions)
                pos_success = self.api_client.sync_positions(positions_payload)
                if not pos_success:
                    err_reason = getattr(self.api_client, "last_error_reason", None)
                    if err_reason in (None, "NETWORK_ERROR"):
                        self.local_queue.enqueue("/sync/positions", positions_payload.model_dump(mode="json"))

            # 3. Atualizar ordens pendentes
            orders_payload = self.sync_engine.fetch_orders(account_id, login=acc.login)
            summary["pendingOrdersCount"] = len(orders_payload.orders)
            ord_success = self.api_client.sync_orders(orders_payload)
            if not ord_success:
                self.local_queue.enqueue("/sync/orders", orders_payload.model_dump(mode="json"))

            # 4. Sincronização incremental de histórico de Deals com Watermark
            # Na primeira rodada da sessão do worker para a conta (ou quando tz_sync_version < 2 para reconciliar fuso horário UTC),
            # força last_ticket=0 para reconciliar todos os horários e valores de deals no PostgreSQL!
            needs_tz_reconcile = getattr(acc, "tz_sync_version", 0) < 2
            effective_full = force_full or (account_id not in self._initial_full_synced) or needs_tz_reconcile
            last_ticket = 0 if effective_full else acc.last_deal_ticket
            last_deal_time = None if effective_full else acc.last_deal_time
            deals_payload = self.sync_engine.fetch_incremental_deals(
                account_id=account_id,
                login=acc.login,
                server=acc.server,
                last_deal_ticket=last_ticket,
                last_deal_time=last_deal_time,
            )

            summary["syncedTradesCount"] = len(deals_payload.trades)
            summary["lastDealTicket"] = deals_payload.lastDealTicket
            summary["serverTzOffsetSec"] = deals_payload.serverTzOffsetSec

            if deals_payload.trades:
                latest_time = max((t.time for t in deals_payload.trades if t.time), default=acc.last_deal_time)
                logger.info(
                    f"[SYNC] Sincronizando {len(deals_payload.trades)} negócios da conta {acc.login} "
                    f"(offset servidor MT5={deals_payload.serverTzOffsetSec}s)..."
                )
                deal_success = self.api_client.sync_trades(deals_payload)
                if deal_success:
                    self._initial_full_synced.add(account_id)
                    self.account_manager.update_checkpoint(
                        account_id,
                        deals_payload.lastDealTicket,
                        last_deal_time=latest_time,
                        tz_sync_version=2,
                    )
                    # 5. Extrai automaticamente lotes históricos de 500 velas (OHLCV) para os ativos operados nos trades sincronizados
                    try:
                        traded_syms = sorted(list({t.symbol for t in deals_payload.trades if t.symbol}))[:6]
                        if traded_syms:
                            candle_batches = self.sync_engine.fetch_candle_batches(
                                symbols=traded_syms,
                                timeframes=["15m", "5m", "1h"],
                                chunk_size=500,
                            )
                            if candle_batches:
                                self.api_client.sync_candles({
                                    "accountId": account_id,
                                    "login": acc.login,
                                    "server": acc.server,
                                    "batches": candle_batches,
                                })
                    except Exception as cb_err:
                        logger.debug(f"Extração complementar de lotes OHLCV pós-sync: {cb_err}")
                else:
                    err_reason = getattr(self.api_client, "last_error_reason", None)
                    if err_reason in (None, "NETWORK_ERROR"):
                        self.local_queue.enqueue("/sync/trades", deals_payload.model_dump(mode="json"))
            else:
                self._initial_full_synced.add(account_id)
                self.account_manager.update_checkpoint(
                    account_id,
                    max(acc.last_deal_ticket, deals_payload.lastDealTicket),
                    last_deal_time=acc.last_deal_time,
                    tz_sync_version=2,
                )

            bal_val = float(summary.get("balance", 0.0) or 0.0)
            eq_val = float(summary.get("equity", 0.0) or 0.0)
            open_pos_cnt = int(summary.get("openPositionsCount", 0) or 0)
            synced_tr_cnt = int(summary.get("syncedTradesCount", 0) or 0)
            self._account_idle_map[account_id] = (
                bal_val <= 0.0 and eq_val <= 0.0 and open_pos_cnt == 0 and synced_tr_cnt == 0
            )
            self._account_last_sync_ts[account_id] = time.time()

            return summary

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
    # 3. HEARTBEAT E FLUSH DE BUFFER OFFLINE
    # -------------------------------------------------------------
    def _send_heartbeat(self):
        try:
            monitored = self.account_manager.get_active_account_ids()
            heartbeat_data = self.health_monitor.collect_telemetry(monitored)
            self.api_client.heartbeat(heartbeat_data)
        except Exception as e:
            logger.warning(f"Erro no envio de heartbeat: {e}")

    def _flush_offline_batch(self):
        try:
            batch = self.local_queue.peek_batch(limit=20)
            for item_id, endpoint, payload in batch:
                res = self.api_client._post(endpoint, payload)
                if res is None:
                    self.local_queue.mark_failed(item_id, "Falha de conexão HTTP com backend")
                    continue

                if res.status_code in (200, 201):
                    try:
                        body = res.json()
                        if isinstance(body, dict) and body.get("success") is False:
                            msg = str(body.get("message") or "Recusado pelo backend")
                            is_perm = "not found" in msg.lower()
                            self.local_queue.mark_failed(item_id, msg, permanent=is_perm)
                            if is_perm and isinstance(payload, dict):
                                orphan_acc = payload.get("accountId") or payload.get("login")
                                if orphan_acc:
                                    self.local_queue.purge_account_items(orphan_acc)
                        else:
                            self.local_queue.remove(item_id)
                    except Exception:
                        self.local_queue.remove(item_id)
                elif 400 <= res.status_code < 500 and res.status_code != 429:
                    self.local_queue.mark_failed(
                        item_id,
                        f"HTTP {res.status_code}: {res.text[:200]}",
                        permanent=True
                    )
                else:
                    self.local_queue.mark_failed(
                        item_id,
                        f"HTTP {res.status_code}: {res.text[:200]}"
                    )
        except Exception as e:
            logger.warning(f"Erro ao descarregar buffer offline: {e}")

