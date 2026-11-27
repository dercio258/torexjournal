import sys
import tempfile
import unittest
from pathlib import Path
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch, MagicMock

# Adiciona a raiz do mt5-server ao sys.path
ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from config.settings import settings
from core.account_manager import AccountManager, _encrypt_secret, _decrypt_secret
from core.local_queue import LocalQueue
import core.sync_engine as sync_engine_mod
from core.sync_engine import SyncEngine


class TestAccountManagerVault(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.orig_data_dir = settings.data_dir
        settings.data_dir = self.tmp_dir.name

    def tearDown(self):
        settings.data_dir = self.orig_data_dir
        self.tmp_dir.cleanup()

    def test_encryption_and_cold_restart_persistence(self):
        mgr = AccountManager()
        deal_time = datetime(2026, 11, 4, 10, 0, 0, tzinfo=timezone.utc)
        mgr.add_or_update_account(
            account_id=123456,
            login="123456",
            server="Exness-MT5Real",
            password="MySuperSecretPassword!2026",
            last_deal_ticket=998877,
            last_deal_time=deal_time,
        )

        # Verifica que o arquivo foi salvo no data_dir configurado e que a senha não está em texto puro
        raw_json = mgr.pool_file.read_text(encoding="utf-8")
        self.assertNotIn("MySuperSecretPassword!2026", raw_json)
        self.assertIn("password_enc", raw_json)

        # Simula cold-restart criando nova instância de AccountManager
        mgr_restarted = AccountManager()
        acc = mgr_restarted.get_account(123456)
        self.assertIsNotNone(acc)
        self.assertEqual(acc.password, "MySuperSecretPassword!2026")
        self.assertEqual(acc.last_deal_ticket, 998877)
        self.assertEqual(acc.last_deal_time, deal_time)


class TestLocalQueueOutboxAndDLQ(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.orig_data_dir = settings.data_dir
        settings.data_dir = self.tmp_dir.name
        self.queue = LocalQueue()

    def tearDown(self):
        settings.data_dir = self.orig_data_dir
        self.tmp_dir.cleanup()

    def test_enqueue_retry_backoff_and_dead_letter(self):
        self.queue.enqueue("/sync/trades", {"accountId": 10, "trades": []})
        batch = self.queue.peek_batch()
        self.assertEqual(len(batch), 1)
        item_id, endpoint, payload = batch[0]
        self.assertEqual(endpoint, "/sync/trades")

        # Falha temporária aplica backoff (item não deve aparecer imediatamente no peek_batch)
        self.queue.mark_failed(item_id, "Timeout de rede", permanent=False)
        self.assertEqual(len(self.queue.peek_batch()), 0)

        # Falha permanente move imediatamente para DEAD_LETTER
        self.queue.mark_failed(item_id, "Account not found", permanent=True)
        with self.queue._get_connection() as conn:
            row = conn.execute("SELECT status, attempts FROM offline_buffer WHERE id = ?", (item_id,)).fetchone()
            self.assertEqual(row[0], "DEAD_LETTER")
            self.assertEqual(row[1], 2)


class TestSyncEnginePositionPairingAndStartupPrompt(unittest.TestCase):
    def test_in_out_deal_pairing_reconstructs_true_open_price_time_and_direction(self):
        engine = SyncEngine()

        # Simula um BUY aberto a 1.08500 às 10:00 (DEAL_ENTRY_IN=0, DEAL_TYPE_BUY=0)
        deal_in = SimpleNamespace(
            ticket=1001,
            order=2001,
            position_id=5001,
            symbol="EURUSD",
            type=0,         # BUY na entrada
            entry=0,        # DEAL_ENTRY_IN
            volume=1.0,
            price=1.08500,
            profit=0.0,
            commission=-1.75,
            fee=0.0,
            swap=0.0,
            magic=10,
            comment="Entry Buy",
            time=1700000000,
        )
        # Simula o fechamento dessa posição BUY a 1.09000 às 11:00 (no MT5 gera DEAL_ENTRY_OUT=1, DEAL_TYPE_SELL=1)
        deal_out = SimpleNamespace(
            ticket=1002,
            order=2002,
            position_id=5001,
            symbol="EURUSD",
            type=1,         # SELL para fechar o BUY
            entry=1,        # DEAL_ENTRY_OUT
            volume=1.0,
            price=1.09000,
            profit=500.0,
            commission=-1.75,
            fee=0.0,
            swap=-0.50,
            magic=10,
            comment="TP Hit",
            time=1700003600,
        )

        mock_mt5 = MagicMock()
        mock_mt5.account_info.return_value = SimpleNamespace(login=777)
        mock_mt5.history_deals_get.return_value = [deal_in, deal_out]

        with patch.object(sync_engine_mod, "MT5_AVAILABLE", True), \
             patch.object(sync_engine_mod, "mt5", mock_mt5, create=True):
            payload = engine.fetch_incremental_deals(
                account_id=777,
                login="777",
                server="Broker-Real",
                last_deal_ticket=0,
            )

        # Deve emitir apenas 1 trade fechado (não o deal_in com profit=0), mas com max_ticket=1002
        self.assertEqual(payload.lastDealTicket, 1002)
        self.assertEqual(len(payload.trades), 1)

        trade = payload.trades[0]
        self.assertEqual(trade.ticket, 1002)
        self.assertEqual(trade.positionId, 5001)
        # A direção da operação deve ser BUY (direção da posição aberta), não SELL!
        self.assertEqual(trade.type, "DEAL_TYPE_BUY")
        self.assertEqual(trade.openPrice, 1.08500)
        self.assertEqual(trade.price, 1.09000)
        # Comissão combinada (entrada -1.75 + saída -1.75 = -3.50)
        self.assertAlmostEqual(trade.commission, -3.50)
        self.assertEqual(int(trade.openTime.timestamp()), 1700000000)
        self.assertEqual(int(trade.time.timestamp()), 1700003600)

    def test_connect_account_injects_credentials_in_initialize_and_dismisses_prompts(self):
        engine = SyncEngine()
        mock_mt5 = MagicMock()
        # Simula que nenhum terminal está aberto na tentativa rápida, abrindo no Passo 2 com credenciais
        mock_mt5.initialize.side_effect = [False, False, True]
        mock_mt5.account_info.return_value = SimpleNamespace(login=556677)
        mock_mt5.terminal_info.return_value = SimpleNamespace(connected=True)

        with patch.object(sync_engine_mod, "MT5_AVAILABLE", True), \
             patch.object(sync_engine_mod, "mt5", mock_mt5, create=True), \
             patch.object(engine, "_dismiss_mt5_dialogs") as mock_dismiss, \
             patch.object(engine, "_kill_stuck_terminals"), \
             patch("time.sleep"):
            ok = engine.connect_account(
                account_id=1,
                login="556677",
                server="Exness-MT5Real",
                password="SecretPassword",
                path=r"C:\Program Files\MetaTrader 5\terminal64.exe",
            )

        self.assertTrue(ok)
        self.assertGreaterEqual(mock_dismiss.call_count, 2)
        # Verifica que o 3º chamado de initialize recebeu login, password e server
        third_call_kwargs = mock_mt5.initialize.call_args_list[2].kwargs
        self.assertEqual(third_call_kwargs["login"], 556677)
        self.assertEqual(third_call_kwargs["password"], "SecretPassword")
        self.assertEqual(third_call_kwargs["server"], "Exness-MT5Real")
        # Como o caminho está em C:\Program Files, portable deve ser False para evitar bloqueio UAC do Windows
        self.assertFalse(third_call_kwargs["portable"])


class TestWorkerManagerOrchestrator(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.orig_data_dir = settings.data_dir
        settings.data_dir = self.tmp_dir.name

    def tearDown(self):
        settings.data_dir = self.orig_data_dir
        self.tmp_dir.cleanup()

    def test_single_tick_executes_tasks_by_priority_and_flushes_outbox(self):
        from core.worker_manager import WorkerManager
        from models.schemas import Task, TaskType

        mgr = WorkerManager()
        mgr.is_running = True

        # Mocka o SyncEngine e o ProcessManager para teste unitário rápido e isolado
        from models.schemas import SyncPositionsPayload, SyncOrdersPayload, SyncTradesPayload
        mgr.sync_engine.ensure_connected = MagicMock(return_value=True)
        mgr.sync_engine.fetch_account_info = MagicMock(return_value=None)
        mgr.sync_engine.fetch_positions = MagicMock(return_value=SyncPositionsPayload(accountId=101, positions=[]))
        mgr.sync_engine.fetch_orders = MagicMock(return_value=SyncOrdersPayload(accountId=101, orders=[]))
        mgr.sync_engine.fetch_incremental_deals = MagicMock(
            return_value=SyncTradesPayload(accountId=101, lastDealTicket=0, trades=[])
        )
        from pathlib import Path
        mgr.process_manager.instances_dir = Path(self.tmp_dir.name) / "instances"
        mgr.process_manager.get_or_prepare_isolated_terminal_exe = MagicMock(
            return_value="C:\\fake\\terminal64.exe"
        )
        mgr.process_manager.is_running = MagicMock(return_value=True)

        # Simula 2 tarefas fora de ordem (prioridade 10 e prioridade 1)
        t_low = Task(id="t-low", type=TaskType.SYNC_ACCOUNT, priority=10, accountId=101, login="101", server="Srv")
        t_high = Task(id="t-high", type=TaskType.START_ACCOUNT, priority=1, accountId=101, login="101", server="Srv")

        executed_order = []
        mgr.api_client.register = MagicMock(return_value=True)
        mgr.api_client.get_tasks = MagicMock(return_value=[t_low, t_high])
        mgr.api_client.ack_task = MagicMock(return_value=True)
        mgr.api_client.heartbeat = MagicMock(return_value=True)
        mgr.api_client.send_event = MagicMock(return_value=True)
        mgr.api_client.sync_account = MagicMock(return_value=True)
        mgr.api_client.sync_positions = MagicMock(return_value=True)
        mgr.api_client.sync_orders = MagicMock(return_value=True)
        mgr.api_client.sync_trades = MagicMock(return_value=True)

        orig_execute = mgr._execute_task

        def track_execute(task):
            executed_order.append(task.id)
            orig_execute(task)

        mgr._execute_task = track_execute

        # Executa 1 tick completo do orquestrador determinístico
        mgr.run_single_tick(now=1000.0)

        # Tarefa de prioridade 1 (START_ACCOUNT) deve rodar antes da tarefa de prioridade 10 (SYNC_ACCOUNT)
        self.assertEqual(executed_order, ["t-high", "t-low"])
        self.assertTrue(mgr.is_registered)
        mgr.api_client.heartbeat.assert_called_once()


class TestPhase1SecurityHardening(unittest.TestCase):
    """Testes unitários de isolamento multi-tenant, credenciais INI e DPAPI Win64."""

    def test_process_manager_omits_accounts_dat_and_ini_passwords(self):
        from pathlib import Path
        from core.process_manager import MT5ProcessManager

        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            instances_dir = tmp_path / "instances"
            master_root = tmp_path / "master_appdata"
            master_config = master_root / "Config"
            master_config.mkdir(parents=True, exist_ok=True)
            (master_config / "servers.dat").write_bytes(b"SERVERS")
            (master_config / "accounts.dat").write_bytes(b"SENSITIVE_ACCOUNTS")
            (master_config / "common.ini").write_text("[Common]\nLogin=999\nPassword=Leak!\n", encoding="utf-8")

            fake_terminal = tmp_path / "terminal64.exe"
            fake_terminal.write_bytes(b"MZ")

            pm = MT5ProcessManager()
            pm.terminal_path = str(fake_terminal)
            pm.instances_dir = instances_dir

            with patch("core.process_manager.os.path.expandvars", return_value=str(tmp_path)), \
                 patch.object(pm, "_deploy_calendar_ea"):
                exe_path = pm.get_or_prepare_isolated_terminal_exe(
                    account_id=42,
                    login="4200\r\nBadKey=Injected",
                    server="Broker-Live\nX=1",
                    password="SuperSecretPassword",
                )

            acc_dir = instances_dir / "acc_42"
            self.assertTrue(Path(exe_path).exists())
            self.assertFalse((acc_dir / "Config" / "accounts.dat").exists())
            common_txt = (acc_dir / "Config" / "common.ini").read_text(encoding="utf-8")
            self.assertNotIn("\nPassword=", common_txt)
            self.assertNotIn("\nBadKey=", common_txt)
            self.assertNotIn("SuperSecretPassword", common_txt)
            self.assertNotIn("\nX=1", common_txt)

            startup_path = pm.create_startup_config(
                account_id=42,
                login="4200",
                server="Broker-Live",
                password="SuperSecretPassword",
            )
            startup_txt = startup_path.read_text(encoding="utf-8")
            self.assertNotIn("Password=", startup_txt)
            self.assertNotIn("SuperSecretPassword", startup_txt)

            # is_running exige exe exatamente em acc_<id>/terminal64.exe (sem colisão acc_4 vs acc_42)
            fake_proc = MagicMock()
            fake_proc.info = {
                "pid": 1234,
                "name": "terminal64.exe",
                "exe": str(acc_dir / "terminal64.exe"),
                "status": "running",
            }
            with patch("core.process_manager.psutil.process_iter", return_value=[fake_proc]):
                self.assertTrue(pm.is_running(42))
                self.assertFalse(pm.is_running(4))

    def test_sync_engine_blocks_cached_bypass_and_passwordless_fallback(self):
        from types import SimpleNamespace
        from pathlib import Path
        import core.sync_engine as sync_engine_mod
        from core.sync_engine import SyncEngine

        with tempfile.TemporaryDirectory() as tmp:
            fake_pm = MagicMock()
            fake_pm.get_account_instance_dir.return_value = Path(tmp) / "acc_99"
            fake_pm.get_or_prepare_isolated_terminal_exe.return_value = "C:\\fake\\terminal64.exe"
            fake_pm.is_running.return_value = True

            engine = SyncEngine()
            engine.process_manager = fake_pm
            mock_mt5 = MagicMock()
            mock_mt5.initialize.return_value = True
            mock_mt5.terminal_info.return_value = SimpleNamespace(connected=True)
            mock_mt5.account_info.return_value = SimpleNamespace(
                login=999999,
                server="Broker-Live",
                name="Holder",
                balance=1000.0,
            )
            mock_mt5.login.return_value = False
            mock_mt5.last_error.return_value = (-6, "Authorization failed")

            with patch.object(sync_engine_mod, "MT5_AVAILABLE", True), \
                 patch.object(sync_engine_mod, "mt5", mock_mt5, create=True), \
                 patch("core.sync_engine.time.sleep", return_value=None):
                ok = engine.connect_account(
                    account_id=99,
                    login="999999",
                    server="Broker-Live",
                    password="WrongPassword",
                )

            self.assertFalse(ok)
            self.assertGreaterEqual(mock_mt5.login.call_count, 1)
            for call in mock_mt5.login.call_args_list:
                self.assertIn("password", call.kwargs)
                self.assertEqual(call.kwargs["password"], "WrongPassword")

    def test_dpapi_win64_configures_localfree_pointer_argtypes(self):
        import ctypes
        import sys
        from core.account_manager import _configure_dpapi_win64

        if sys.platform != "win32":
            self.skipTest("DPAPI Win64 pointer config applies to win32")

        crypt32 = ctypes.windll.crypt32
        kernel32 = ctypes.windll.kernel32
        _configure_dpapi_win64(crypt32, kernel32)
        self.assertEqual(list(kernel32.LocalFree.argtypes), [ctypes.c_void_p])


class TestSettingsEnvPrecedence(unittest.TestCase):
    def test_worker_local_env_overrides_parent_and_backend_env(self):
        import os
        from config.settings import Settings, BASE_DIR

        env_files = [str(p) for p in Settings.model_config["env_file"]]
        self.assertEqual(env_files[-1], str(BASE_DIR / ".env"))

        clean_env = {k: v for k, v in os.environ.items() if k not in ("WORKER_ID", "WORKER_KEY")}
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, clean_env, clear=True):
            root = Path(tmp)
            backend_env = root / "backend.env"
            parent_env = root / "parent.env"
            worker_env = root / "worker.env"
            backend_env.write_text("WORKER_ID=worker-backend\nWORKER_KEY=from_backend_key\n", encoding="utf-8")
            parent_env.write_text("WORKER_ID=worker-parent\nWORKER_KEY=from_parent_key\n", encoding="utf-8")
            worker_env.write_text("WORKER_ID=win-worker-02\nWORKER_KEY=from_worker_key\n", encoding="utf-8")

            loaded = Settings(_env_file=(str(backend_env), str(parent_env), str(worker_env)))
            self.assertEqual(loaded.worker_id, "win-worker-02")
            self.assertEqual(loaded.worker_key, "from_worker_key")


class TestBrokerServerNormalization(unittest.TestCase):
    def test_normalizes_exness_and_major_broker_servers(self):
        cases = [
            ("exness-mt5real", "Exness-MT5Real"),
            ("exness-mt5real37", "Exness-MT5Real37"),
            ("Exness MT5 Real 45", "Exness-MT5Real45"),
            ("exness-mt5-trial15", "Exness-MT5Trial15"),
            ("exnesske-mt5real", "ExnessKE-MT5Real"),
            ("xmglobal-mt5 14", "XMGlobal-MT5 14"),
            ("hfmarketsglobal-live12", "HFMarketsGlobal-Live12"),
            ("icmarketssc-mt5-6", "ICMarketsSC-MT5-6"),
            ("pepperstone-mt5-live2", "Pepperstone-MT5-Live02"),
            ("dooprime-live 5", "DooPrime-Live 5"),
            ("cptmarkets-live3", "CPTMarkets-Live03"),
            ("ftmo-server6", "FTMO-Server6"),
            ("fundednext-server 5", "FundedNext-Server 5"),
            ("fusionmarkets-live 2", "FusionMarkets-Live 2"),
            ("btgpactual-prd", "BTGPactual-PRD"),
            ("fundedtradingplus-live", "FundedTradingPlus-Live"),
            ("deric-demo", "Deriv-Demo"),
        ]
        for raw, expected in cases:
            self.assertEqual(SyncEngine._normalize_broker_server(raw), expected)


class TestHealthMonitorAntiFalsePositive(unittest.TestCase):
    def setUp(self):
        from core.health_monitor import reset_cpu_sampler_for_tests
        reset_cpu_sampler_for_tests()
        self.orig_guard = settings.enable_resource_guard
        self.orig_max_cpu = settings.max_cpu_percent
        self.orig_max_mem = settings.max_memory_percent
        self.orig_min_mb = settings.min_available_memory_mb
        settings.enable_resource_guard = True
        settings.max_cpu_percent = 95.0
        settings.max_memory_percent = 92.0
        settings.min_available_memory_mb = 150.0

    def tearDown(self):
        from core.health_monitor import reset_cpu_sampler_for_tests
        settings.enable_resource_guard = self.orig_guard
        settings.max_cpu_percent = self.orig_max_cpu
        settings.max_memory_percent = self.orig_max_mem
        settings.min_available_memory_mb = self.orig_min_mb
        reset_cpu_sampler_for_tests()

    def test_ignores_single_cpu_spike_and_triggers_only_on_sustained_saturation_with_early_recovery(self):
        from core.health_monitor import HealthMonitor

        hm = HealthMonitor(MagicMock())
        healthy_mem = SimpleNamespace(
            total=2048 * 1024 * 1024,
            available=416 * 1024 * 1024,
            percent=79.7,
        )

        # Prime (t=100), normal (t=103), single transient spike 97.6% (t=106), then back to 21.8% (t=109)
        cpu_values = [0.0, 12.0, 97.6, 21.8]
        with patch("core.health_monitor.psutil.virtual_memory", return_value=healthy_mem), \
             patch("core.health_monitor.psutil.cpu_percent", side_effect=cpu_values):
            for t in (100.0, 103.0, 106.0, 109.0):
                is_safe, err, _ = hm.check_resource_guard(operation="Sync", now=t)
                self.assertTrue(is_safe, f"Transient CPU spike at t={t} must not trip guard: {err}")

        # Now simulate genuinely sustained >= 96% CPU for > 15s (4 samples across 20s)
        sustained_cpus = [96.5, 97.0, 98.0, 98.5, 97.5, 97.0, 98.0, 98.5]
        with patch("core.health_monitor.psutil.virtual_memory", return_value=healthy_mem), \
             patch("core.health_monitor.psutil.cpu_percent", side_effect=sustained_cpus):
            tripped = False
            for idx, t in enumerate([120.0, 124.0, 128.0, 132.0, 137.0, 142.0, 147.0, 152.0]):
                is_safe, _, _ = hm.check_resource_guard(operation="Sync", now=t)
                if not is_safe:
                    tripped = True
                    trip_t = t
                    break
            self.assertTrue(tripped, "Sustained CPU saturation >=15s must trigger guard")

        # After CPU drops back to 15% and 6s pass, cooldown must auto-clear early instead of waiting 30s
        with patch("core.health_monitor.psutil.virtual_memory", return_value=healthy_mem), \
             patch("core.health_monitor.psutil.cpu_percent", side_effect=[15.0, 14.0, 13.0, 12.0]):
            hm.get_resource_metrics(now=trip_t + 3.0)
            hm.get_resource_metrics(now=trip_t + 6.0)
            hm.get_resource_metrics(now=trip_t + 9.0)
            is_safe, err, _ = hm.check_resource_guard(operation="Sync", now=trip_t + 12.0)
            self.assertTrue(is_safe, f"Cooldown should clear early once CPU normalizes: {err}")


class TestIpcTimeoutRecovery(unittest.TestCase):
    def test_recovers_from_ipc_timeout_via_split_initialize_and_explicit_login(self):
        engine = SyncEngine()
        mock_mt5 = MagicMock()
        # Passo 1 fails (-10005), Passo 2 fails (-10005), Passo 2b succeeds opening pipe without inline creds
        mock_mt5.initialize.side_effect = [False, False, True]
        mock_mt5.last_error.return_value = (-10005, "IPC timeout")
        mock_mt5.account_info.side_effect = [
            None,
            None,
            SimpleNamespace(login=439300462, server="GoatFunded-Server2", name="Trader", balance=10000.0),
        ]
        mock_mt5.terminal_info.return_value = SimpleNamespace(connected=True, ping_last=50000)
        mock_mt5.login.return_value = True

        with patch.object(sync_engine_mod, "MT5_AVAILABLE", True), \
             patch.object(sync_engine_mod, "mt5", mock_mt5, create=True), \
             patch.object(engine, "_run_with_dialog_watchdog", side_effect=lambda fn, initial_delay=0.5: fn()), \
             patch.object(engine, "_dismiss_mt5_dialogs"), \
             patch.object(engine, "_kill_stuck_terminals"), \
             patch.object(engine, "_reclaim_memory_from_other_terminals", return_value=1) as mock_reclaim, \
             patch.object(engine, "_clean_pending_liveupdate") as mock_clean, \
             patch("core.sync_engine.time.sleep", return_value=None):
            ok = engine.connect_account(
                account_id=439300462,
                login="439300462",
                server="GoatFunded-Server2",
                password="SecretPassword",
                path=r"C:\torex\mt5-server\instances\acc_test\terminal64.exe",
            )

        self.assertTrue(ok)
        self.assertGreaterEqual(mock_reclaim.call_count, 1)
        self.assertGreaterEqual(mock_clean.call_count, 1)
        # Passo 2b initialized pipe without inline login, then Passo 3 called mt5.login with password
        self.assertEqual(mock_mt5.initialize.call_count, 3)
        self.assertNotIn("login", mock_mt5.initialize.call_args_list[2].kwargs)
        mock_mt5.login.assert_called_once_with(
            login=439300462,
            password="SecretPassword",
            server="GoatFunded-Server2",
            timeout=20000,
        )

    def test_quarantines_non_numeric_email_logins_and_fixes_exness_typo(self):
        self.assertEqual(SyncEngine._normalize_broker_server("Exness-MT5Reala30"), "Exness-MT5Real30")

        with tempfile.TemporaryDirectory() as tmp:
            orig_data_dir = settings.data_dir
            settings.data_dir = tmp
            try:
                pool_path = Path(tmp) / "accounts_pool.json"
                pool_path.write_text(
                    '[{"account_id": 1, "login": "Alberto.cossv@icloud.com", "server": "FivePercentOnline-Real", "status": "ONLINE"},'
                    ' {"account_id": 222707555, "login": "222707555", "server": "Exness-MT5Real30", "status": "ONLINE"}]',
                    encoding="utf-8",
                )
                mgr = AccountManager()
                self.assertEqual(mgr.get_account(1).status, "FAILED")
                self.assertEqual(mgr.get_active_account_ids(), [222707555])
            finally:
                settings.data_dir = orig_data_dir

    def test_process_manager_selects_richest_servers_dat_instead_of_first_alphabetical_appdata_dir(self):
        import os
        from core.process_manager import MT5ProcessManager

        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            fake_appdata = tmp_path / "AppData"
            fake_install = tmp_path / "Program Files" / "MetaTrader 5"
            fake_install.mkdir(parents=True, exist_ok=True)
            fake_exe = fake_install / "terminal64.exe"
            fake_exe.write_bytes(b"MZ_FAKE_TERMINAL")

            # Pasta alfabeticamente ANTERIOR (ex.: 11111111... criada por instancia antiga) com servers.dat pequeno
            stale_dir = fake_appdata / "MetaQuotes" / "Terminal" / "11111111111111111111111111111111" / "config"
            stale_dir.mkdir(parents=True, exist_ok=True)
            (stale_dir / "servers.dat").write_bytes(b"SMALL_DEFAULT_72KB")

            # Pasta AppData exata da instalacao principal (ex.: D0E8209F...) com servers.dat completo (muito maior)
            main_hash = MT5ProcessManager._compute_mt5_appdata_hash(fake_install)
            main_dir = fake_appdata / "MetaQuotes" / "Terminal" / main_hash / "config"
            main_dir.mkdir(parents=True, exist_ok=True)
            rich_payload = b"RICH_BROKERS_EXNESS_GOATFUNDED_DERIV_" * 200
            (main_dir / "servers.dat").write_bytes(rich_payload)

            orig_data_dir = settings.data_dir
            settings.data_dir = str(tmp_path / "data")
            Path(settings.data_dir).mkdir(parents=True, exist_ok=True)
            try:
                pm = MT5ProcessManager()
                pm.terminal_path = str(fake_exe)
                pm.instances_dir = tmp_path / "instances"

                with patch.dict(os.environ, {"APPDATA": str(fake_appdata)}), \
                     patch.object(pm, "_deploy_calendar_ea"):
                    pm.get_or_prepare_isolated_terminal_exe(
                        account_id=202658742,
                        login="202658742",
                        server="Exness-MT5Trial2",
                        password="Secret",
                        account_uuid="acc-uuid-1",
                    )

                copied_srv = pm.instances_dir / "acc_acc-uuid-1" / "config" / "servers.dat"
                self.assertTrue(copied_srv.exists())
                self.assertEqual(copied_srv.read_bytes(), rich_payload)

                # Se master_servers.dat em data_dir for ainda maior, ele passa a vencer
                master_payload = rich_payload + (b"EXTRA_PROP_FIRMS_" * 50)
                (Path(settings.data_dir) / "master_servers.dat").write_bytes(master_payload)
                with patch.dict(os.environ, {"APPDATA": str(fake_appdata)}), \
                     patch.object(pm, "_deploy_calendar_ea"):
                    pm.get_or_prepare_isolated_terminal_exe(
                        account_id=202658742,
                        login="202658742",
                        server="Exness-MT5Trial2",
                        password="Secret",
                        account_uuid="acc-uuid-1",
                    )
                self.assertEqual(copied_srv.read_bytes(), master_payload)
            finally:
                settings.data_dir = orig_data_dir

    def test_detects_missing_broker_server_in_servers_dat_via_metaquotes_demo_probe(self):
        engine = SyncEngine()
        mock_mt5 = MagicMock()
        # Passo 1, Passo 2, Passo 2b falham com -10005; probe MetaQuotes-Demo responde rapidamente com -6
        mock_mt5.initialize.side_effect = [False, False, False, False]
        mock_mt5.last_error.side_effect = [
            (-10005, "IPC timeout"),  # check Passo 2b
            (-10005, "IPC timeout"),  # final err before probe
            (-6, "Terminal: Authorization failed"),  # probe MetaQuotes-Demo -> prova IPC saudavel!
        ]

        with patch.object(sync_engine_mod, "MT5_AVAILABLE", True), \
             patch.object(sync_engine_mod, "mt5", mock_mt5, create=True), \
             patch.object(engine, "_run_with_dialog_watchdog", side_effect=lambda fn, initial_delay=0.5: fn()), \
             patch.object(engine, "_dismiss_mt5_dialogs"), \
             patch.object(engine, "_kill_stuck_terminals"), \
             patch.object(engine, "_reclaim_memory_from_other_terminals", return_value=0), \
             patch.object(engine, "_clean_pending_liveupdate"), \
             patch.object(engine, "inspect_mt5_ui_state", return_value={"pids": [1234], "main_windows": [], "modals": []}), \
             patch("core.sync_engine.time.sleep", return_value=None):
            ok = engine.connect_account(
                account_id=202658742,
                login="202658742",
                server="Exness-MT5Trial2",
                password="SecretPassword",
                path=r"C:\torex\mt5-server\instances\acc_test\terminal64.exe",
            )

        self.assertFalse(ok)
        self.assertIn("servers.dat", engine.last_connect_error or "")
        self.assertIn("Exness-MT5Trial2", engine.last_connect_error or "")
        self.assertIn("Exness", engine.last_connect_error or "")
        # Probe deve ter consultado MetaQuotes-Demo
        self.assertEqual(mock_mt5.initialize.call_args_list[-1].kwargs.get("server"), "MetaQuotes-Demo")


if __name__ == "__main__":
    unittest.main(verbosity=2)
