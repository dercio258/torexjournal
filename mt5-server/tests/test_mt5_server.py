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


if __name__ == "__main__":
    unittest.main(verbosity=2)
