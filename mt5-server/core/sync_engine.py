import time
import datetime
import threading
from pathlib import Path
import psutil
from typing import List, Optional, Dict, Any
from loguru import logger

try:
    import MetaTrader5 as mt5
    MT5_AVAILABLE = True
except ImportError:
    MT5_AVAILABLE = False
    logger.warning("Biblioteca MetaTrader5 oficial não encontrada no ambiente Python. Modo de desenvolvimento ativo.")

from models.schemas import (
    AccountInfo,
    PositionData,
    OrderData,
    DealData,
    SyncTradesPayload,
    SyncPositionsPayload,
    SyncOrdersPayload,
    ResourceExhaustionError,
)

DEAL_ENTRY_MAP = {
    0: "DEAL_ENTRY_IN",
    1: "DEAL_ENTRY_OUT",
    2: "DEAL_ENTRY_INOUT",
    3: "DEAL_ENTRY_OUT_BY",
}

DEAL_TYPE_MAP = {
    0: "DEAL_TYPE_BUY",
    1: "DEAL_TYPE_SELL",
    2: "DEAL_TYPE_BALANCE",
    3: "DEAL_TYPE_CREDIT",
    4: "DEAL_TYPE_CHARGE",
    5: "DEAL_TYPE_CORRECTION",
    6: "DEAL_TYPE_BONUS",
    7: "DEAL_TYPE_COMMISSION",
    8: "DEAL_TYPE_COMMISSION_DAILY",
    9: "DEAL_TYPE_COMMISSION_MONTHLY",
    10: "DEAL_TYPE_COMMISSION_AGENT_DAILY",
    11: "DEAL_TYPE_COMMISSION_AGENT_MONTHLY",
    12: "DEAL_TYPE_INTEREST",
    13: "DEAL_TYPE_BUY_CANCELED",
    14: "DEAL_TYPE_SELL_CANCELED",
}


class SyncEngine:
    """Motor de extração incremental de dados financeiros e operacionais do MetaTrader 5 com IPC Lock exclusivo."""

    def __init__(self):
        self._ipc_lock = threading.RLock()
        self.connected_account: Optional[int] = None

    @staticmethod
    def _dismiss_mt5_dialogs():
        """
        Detecta e fecha automaticamente janelas modais/popups padrão do MT5 no Windows
        (ex: wizard 'Abrir Conta Demo', prompt de login manual ou avisos bloqueantes - classe Win32 '#32770').
        """
        try:
            import sys
            if sys.platform != "win32":
                return
            import ctypes
            from ctypes import wintypes

            user32 = ctypes.windll.user32
            WM_CLOSE = 0x0010

            mt5_pids = set()
            for proc in psutil.process_iter(['pid', 'name']):
                try:
                    name = (proc.info.get('name') or '').lower()
                    if 'terminal64' in name:
                        mt5_pids.add(proc.info['pid'])
                except Exception:
                    pass

            if not mt5_pids:
                return

            WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

            def enum_windows_callback(hwnd, lparam):
                try:
                    if not user32.IsWindowVisible(hwnd):
                        return True
                    pid = wintypes.DWORD()
                    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                    if pid.value not in mt5_pids:
                        return True

                    class_buf = ctypes.create_unicode_buffer(64)
                    user32.GetClassNameW(hwnd, class_buf, 64)
                    # '#32770' é a classe padrão de Dialog/Popup modal do Windows usada pelo MT5 para prompts
                    if class_buf.value == "#32770":
                        title_buf = ctypes.create_unicode_buffer(256)
                        user32.GetWindowTextW(hwnd, title_buf, 256)
                        logger.info(f"Fechando popup modal padrão do MT5 automaticamente (Título: '{title_buf.value}')...")
                        user32.PostMessageW(hwnd, WM_CLOSE, 0, 0)
                except Exception:
                    pass
                return True

            user32.EnumWindows(WNDENUMPROC(enum_windows_callback), 0)
        except Exception as e:
            logger.debug(f"Verificação de popups Win32 ignorada: {e}")

    @staticmethod
    def _clean_pending_liveupdate():
        """
        Remove executáveis pendentes na pasta 'liveupdate' do MetaQuotes em AppData.
        Quando o MT5 baixa um update em background, ao iniciar ele tenta rodar liveupdate\\terminal64.exe,
        o que abre um prompt UAC do Windows e congela o Pipe Server IPC (-10003) por 60 segundos.
        """
        try:
            import os
            import shutil
            appdata = os.environ.get("APPDATA")
            if not appdata:
                return
            terminals_root = Path(appdata) / "MetaQuotes" / "Terminal"
            if not terminals_root.exists():
                return
            for liveupdate_dir in terminals_root.glob("*/liveupdate"):
                if liveupdate_dir.is_dir():
                    logger.info(f"Removendo pasta de LiveUpdate pendente que bloqueia o IPC: {liveupdate_dir}")
                    shutil.rmtree(liveupdate_dir, ignore_errors=True)
            # Também verifica em Common/liveupdate
            common_lu = terminals_root / "Common" / "liveupdate"
            if common_lu.is_dir():
                shutil.rmtree(common_lu, ignore_errors=True)
        except Exception as e:
            logger.debug(f"Limpeza preventiva de liveupdate ignorada: {e}")

    @staticmethod
    def _kill_stuck_terminals():
        """Encerra processos terminal64.exe presos que possam estar bloqueando a porta IPC 22346."""
        for proc in psutil.process_iter(['pid', 'name']):
            try:
                name = proc.info.get('name') or ''
                if 'terminal64' in name.lower():
                    logger.warning(f"Encerrando processo terminal64 órfão (PID: {proc.info['pid']}) para liberar portas...")
                    proc.kill()
            except Exception:
                pass

    def _wait_for_broker_sync(self, expected_login: int, timeout_sec: float = 12.0) -> bool:
        """
        Aguarda até que o terminal MT5 finalize o handshake de rede com a corretora (terminal_info.connected)
        para evitar ler saldo 0.0 ou histórico vazio imediatamente após o login.
        """
        if not MT5_AVAILABLE:
            return True
        deadline = time.time() + timeout_sec
        while time.time() < deadline:
            self._dismiss_mt5_dialogs()
            info = mt5.account_info()
            term = mt5.terminal_info()
            if info is not None and (not expected_login or int(info.login) == int(expected_login)):
                if term is None or getattr(term, "connected", True):
                    return True
            time.sleep(0.5)
        info = mt5.account_info()
        return info is not None and (not expected_login or int(info.login) == int(expected_login))

    @staticmethod
    def _normalize_broker_server(server: str) -> str:
        """Corrige erros comuns de digitação de servidores de corretoras (ex: Deric-demo -> Deriv-Demo)."""
        s = (server or "").strip()
        lower = s.lower()
        typo_map = {
            "deric-demo": "Deriv-Demo",
            "deriv-demo": "Deriv-Demo",
            "deric-server": "Deriv-Server",
            "deriv-server": "Deriv-Server",
            "deric-server-02": "Deriv-Server-02",
            "deriv-server-02": "Deriv-Server-02",
        }
        return typo_map.get(lower, s)

    @staticmethod
    def _is_account_authenticated(info: Any, expected_login: int) -> bool:
        """Verifica se a conta está realmente autenticada na corretora (evita falso positivo com saldo $0 após falha de login)."""
        if info is None or str(getattr(info, "login", "")) != str(expected_login):
            return False
        term = mt5.terminal_info() if MT5_AVAILABLE else None
        if term is not None and not getattr(term, "connected", True):
            # Se o terminal está desconectado e alavancagem/saldo estão zerados, o login ainda não autenticou
            if getattr(info, "leverage", 0) == 0 and getattr(info, "balance", 0.0) == 0.0:
                return False
        return True

    def ensure_connected(
        self,
        account_id: int,
        login: str,
        server: str,
        password: Optional[str] = None,
        path: Optional[str] = None
    ) -> bool:
        """Garante que a sessão IPC com o terminal MT5 está ativa e na conta correta antes da sincronização."""
        with self._ipc_lock:
            if not MT5_AVAILABLE:
                self.connected_account = account_id
                return True

            self._dismiss_mt5_dialogs()
            login_clean = int(str(login).strip()) if str(login).strip().isdigit() else 0

            try:
                info = mt5.account_info()
                if self._is_account_authenticated(info, login_clean):
                    self.connected_account = account_id
                    return True
            except Exception:
                pass

            return self.connect_account(account_id, login, server, password, path)

    def connect_account(
        self,
        account_id: int,
        login: str,
        server: str,
        password: Optional[str] = None,
        path: Optional[str] = None
    ) -> bool:
        """Conecta ao terminal MT5 (suprimindo LiveUpdate/prompts modais de primeiro uso) e efetua login seguro."""
        with self._ipc_lock:
            if not MT5_AVAILABLE:
                logger.warning(f"[Mock] Conectando mock MT5 para conta {account_id}")
                self.connected_account = account_id
                return True

            login_clean = int(str(login).strip()) if str(login).strip().isdigit() else 0
            server_clean = self._normalize_broker_server(server)
            if server and server_clean != server.strip():
                logger.info(f"Servidor da corretora normalizado automaticamente: '{server}' -> '{server_clean}'")
            pass_clean = str(password).strip() if password else ""
            from config.settings import settings
            term_path = path or settings.mt5_default_path

            # Se o executável estiver em C:\Program Files, portable=True exige UAC para gravar na pasta.
            # Só usa portable=True automaticamente se estiver em diretório fora de Program Files.
            use_portable = "program files" not in (term_path or "").lower()

            # Remove qualquer atualização automática pendente que trave o Pipe Server (-10003) e fecha popups
            self._clean_pending_liveupdate()
            self._dismiss_mt5_dialogs()

            # Passo 1: Verifica se o IPC já está ativo ou reutiliza terminal MT5 já aberto (evita matar o processo à toa)
            init_ok = False
            try:
                term_info = mt5.terminal_info()
                if term_info is not None and isinstance(getattr(term_info, "name", None), str):
                    init_ok = True
                else:
                    init_ok = mt5.initialize(timeout=15000)
                    if not init_ok and term_path:
                        init_ok = mt5.initialize(path=term_path, portable=use_portable, timeout=20000)
            except Exception as e:
                logger.debug(f"Terminal ativo não respondeu na tentativa rápida: {e}")

            # Passo 2: Se nenhum terminal responder, limpa processos presos e abre injetando credenciais
            if not init_ok:
                logger.info(f"Nenhum terminal ativo respondeu. Inicializando MT5 via: {term_path}")
                self._kill_stuck_terminals()
                self._clean_pending_liveupdate()
                time.sleep(2)
                try:
                    init_kwargs: Dict[str, Any] = {
                        "path": term_path,
                        "portable": use_portable,
                        "timeout": 60000,
                    }
                    if login_clean and pass_clean and server_clean:
                        init_kwargs.update({
                            "login": login_clean,
                            "password": pass_clean,
                            "server": server_clean,
                        })
                    init_ok = mt5.initialize(**init_kwargs)
                    if not init_ok:
                        # Fallback sem credenciais no initialize (fará mt5.login logo abaixo)
                        init_ok = mt5.initialize(path=term_path, portable=use_portable, timeout=60000)
                except Exception as e:
                    logger.error(f"Erro ao inicializar terminal MT5 via path: {e}")

            self._dismiss_mt5_dialogs()

            if not init_ok:
                logger.error(f"Não foi possível inicializar o MT5: {mt5.last_error()}")
                return False

            # Passo 3: Garante login na conta correta
            if login_clean:
                info = mt5.account_info()
                if self._is_account_authenticated(info, login_clean):
                    self._wait_for_broker_sync(login_clean, timeout_sec=8.0)
                    self.connected_account = account_id
                    return True

                if server_clean:
                    for attempt in range(1, 6):
                        self._dismiss_mt5_dialogs()
                        info = mt5.account_info()
                        if self._is_account_authenticated(info, login_clean):
                            break

                        logger.info(f"Tentativa {attempt}/5: Efetuando login no MT5 ({login_clean} @ {server_clean})...")
                        if pass_clean:
                            login_ok = mt5.login(login=login_clean, password=pass_clean, server=server_clean, timeout=30000)
                        else:
                            login_ok = mt5.login(login=login_clean, server=server_clean, timeout=30000)

                        if login_ok:
                            logger.success(f"Login efetuado com sucesso na conta {login_clean} ({server_clean})!")
                            break

                        err = mt5.last_error()
                        logger.warning(f"Tentativa {attempt}/5 de login falhou: {err}. Aguardando 2s...")
                        time.sleep(2)
                    else:
                        final_info = mt5.account_info()
                        if not self._is_account_authenticated(final_info, login_clean):
                            logger.error(f"Falha de autenticação no MT5 para {login_clean}@{server_clean} após 5 tentativas: {mt5.last_error()}")
                            return False

                self._wait_for_broker_sync(login_clean, timeout_sec=10.0)

            self.connected_account = account_id
            return True

    def disconnect(self):
        """Desconecta a sessão MT5 atual."""
        with self._ipc_lock:
            if MT5_AVAILABLE:
                mt5.shutdown()
            self.connected_account = None

    @staticmethod
    def get_resource_snapshot() -> dict:
        """Coleta snapshot imediato de memória e CPU para diagnóstico técnico de extração."""
        cpu_usage = psutil.cpu_percent(interval=None)
        mem = psutil.virtual_memory()
        used_mb = round((mem.total - mem.available) / (1024 * 1024), 1)
        total_mb = round(mem.total / (1024 * 1024), 1)
        available_mb = round(mem.available / (1024 * 1024), 1)
        mem_percent = round(mem.percent, 1)
        return {
            "cpu_percent": cpu_usage,
            "memory_percent": mem_percent,
            "memory_used_mb": used_mb,
            "memory_total_mb": total_mb,
            "memory_available_mb": available_mb
        }

    def fetch_account_info(self, account_id: int, login: str, server: str) -> Optional[AccountInfo]:
        """Obtém dados de saldo, patrimônio e margem da conta."""
        with self._ipc_lock:
            if not MT5_AVAILABLE:
                return AccountInfo(
                    accountId=account_id,
                    login=login,
                    server=server,
                    currency="USD",
                    balance=10000.0,
                    equity=10050.0,
                    margin=250.0,
                    freeMargin=9800.0,
                    marginLevel=4020.0,
                    leverage=100,
                    profit=50.0,
                )

            try:
                info = mt5.account_info()
                if info is None:
                    logger.warning(f"Não foi possível obter account_info(): {mt5.last_error()}")
                    return None

                return AccountInfo(
                    accountId=account_id,
                    login=login,
                    server=server,
                    currency=info.currency,
                    balance=info.balance,
                    equity=info.equity,
                    margin=info.margin,
                    freeMargin=info.margin_free,
                    marginLevel=info.margin_level,
                    leverage=info.leverage,
                    profit=info.profit,
                    company=info.company,
                    name=info.name,
                    tradeAllowed=info.trade_allowed,
                )
            except MemoryError:
                res = self.get_resource_snapshot()
                err_msg = (
                    f"[ESGOTAMENTO DE MEMÓRIA] Falha ao extrair account_info para conta {account_id}! "
                    f"Memória Consumida: {res['memory_used_mb']} MB / {res['memory_total_mb']} MB ({res['memory_percent']}%) | "
                    f"RAM Livre: {res['memory_available_mb']} MB | CPU: {res['cpu_percent']}%. Abortando."
                )
                logger.critical(err_msg)
                raise ResourceExhaustionError(err_msg, res, operation="fetch_account_info", account_id=account_id)
            except Exception as e:
                logger.error(f"Erro inesperado ao extrair account_info para conta {account_id}: {e}")
                return None

    def fetch_positions(self, account_id: int, login: Optional[str] = None) -> SyncPositionsPayload:
        """Obtém todas as posições abertas no momento."""
        with self._ipc_lock:
            positions_list: List[PositionData] = []
            if not MT5_AVAILABLE:
                return SyncPositionsPayload(accountId=account_id, login=login, positions=positions_list)

            try:
                positions = mt5.positions_get()
                if positions is not None:
                    for pos in positions:
                        positions_list.append(PositionData(
                            ticket=pos.ticket,
                            symbol=pos.symbol,
                            type="POSITION_TYPE_BUY" if pos.type == mt5.POSITION_TYPE_BUY else "POSITION_TYPE_SELL",
                            volume=pos.volume,
                            priceOpen=pos.price_open,
                            priceCurrent=pos.price_current,
                            sl=pos.sl,
                            tp=pos.tp,
                            profit=pos.profit,
                            swap=pos.swap,
                            magic=pos.magic,
                            comment=pos.comment,
                            time=datetime.datetime.fromtimestamp(pos.time, tz=datetime.timezone.utc),
                        ))

                return SyncPositionsPayload(accountId=account_id, login=login, positions=positions_list)
            except MemoryError:
                res = self.get_resource_snapshot()
                err_msg = (
                    f"[ESGOTAMENTO DE MEMÓRIA] Falha ao extrair posições para conta {account_id}! "
                    f"Memória Consumida: {res['memory_used_mb']} MB / {res['memory_total_mb']} MB ({res['memory_percent']}%) | "
                    f"RAM Livre: {res['memory_available_mb']} MB | CPU: {res['cpu_percent']}%. Abortando."
                )
                logger.critical(err_msg)
                raise ResourceExhaustionError(err_msg, res, operation="fetch_positions", account_id=account_id)

    def fetch_orders(self, account_id: int, login: Optional[str] = None) -> SyncOrdersPayload:
        """Obtém ordens pendentes ativas."""
        with self._ipc_lock:
            orders_list: List[OrderData] = []
            if not MT5_AVAILABLE:
                return SyncOrdersPayload(accountId=account_id, login=login, orders=orders_list)

            try:
                orders = mt5.orders_get()
                if orders is not None:
                    for ord_item in orders:
                        orders_list.append(OrderData(
                            ticket=ord_item.ticket,
                            symbol=ord_item.symbol,
                            type=str(ord_item.type),
                            state=str(ord_item.state),
                            volumeInitial=ord_item.volume_initial,
                            volumeCurrent=ord_item.volume_current,
                            priceOpen=ord_item.price_open,
                            sl=ord_item.sl,
                            tp=ord_item.tp,
                            timeSetup=datetime.datetime.fromtimestamp(ord_item.time_setup, tz=datetime.timezone.utc),
                            magic=ord_item.magic,
                            comment=ord_item.comment,
                        ))

                return SyncOrdersPayload(accountId=account_id, login=login, orders=orders_list)
            except MemoryError:
                res = self.get_resource_snapshot()
                err_msg = (
                    f"[ESGOTAMENTO DE MEMÓRIA] Falha ao extrair ordens para conta {account_id}! "
                    f"Memória Consumida: {res['memory_used_mb']} MB / {res['memory_total_mb']} MB ({res['memory_percent']}%) | "
                    f"RAM Livre: {res['memory_available_mb']} MB | CPU: {res['cpu_percent']}%. Abortando."
                )
                logger.critical(err_msg)
                raise ResourceExhaustionError(err_msg, res, operation="fetch_orders", account_id=account_id)

    def _find_entry_deal(self, position_id: int, cached_entries: Dict[int, Any]) -> Optional[Any]:
        """Localiza o deal de abertura (DEAL_ENTRY_IN) de uma posição para reconstruir preço/hora de entrada."""
        if not position_id:
            return None
        if position_id in cached_entries:
            return cached_entries[position_id]
        try:
            pos_deals = mt5.history_deals_get(position=position_id)
            if pos_deals:
                for pd in pos_deals:
                    if pd.entry == 0:  # DEAL_ENTRY_IN
                        cached_entries[position_id] = pd
                        return pd
        except Exception:
            pass
        return None

    def fetch_incremental_deals(
        self,
        account_id: int,
        login: Optional[str] = None,
        server: Optional[str] = None,
        last_deal_ticket: int = 0,
        last_deal_time: Optional[datetime.datetime] = None,
        from_date: Optional[datetime.datetime] = None
    ) -> SyncTradesPayload:
        """
        Coleta negócios fechados (deals) de forma incremental com Watermark de data
        e reconstrói preços/horários/direção reais pareando DEAL_ENTRY_IN + DEAL_ENTRY_OUT via position_id.
        """
        with self._ipc_lock:
            trades_list: List[DealData] = []
            max_ticket = last_deal_ticket

            if not MT5_AVAILABLE:
                return SyncTradesPayload(
                    accountId=account_id,
                    login=login,
                    server=server,
                    lastDealTicket=max_ticket,
                    trades=[]
                )

            now_utc = datetime.datetime.now(datetime.timezone.utc)
            # +24h garante cobertura para qualquer fuso horário de corretora (ex: UTC+2, UTC+3)
            end_time = (now_utc + datetime.timedelta(days=1)).replace(tzinfo=None)

            if from_date is not None:
                start_time = from_date
            elif last_deal_ticket > 0 and last_deal_time is not None:
                # Janela deslizante incremental com folga de 7 dias
                start_time = last_deal_time - datetime.timedelta(days=7)
            elif last_deal_ticket > 0:
                start_time = now_utc - datetime.timedelta(days=14)
            else:
                # Primeira sincronização completa
                start_time = datetime.datetime(2020, 1, 1)

            if isinstance(start_time, datetime.datetime) and start_time.tzinfo is not None:
                start_time = start_time.replace(tzinfo=None)

            try:
                deals = mt5.history_deals_get(start_time, end_time)
                if deals is None:
                    start_ts = int(start_time.timestamp())
                    end_ts = int(end_time.timestamp())
                    deals = mt5.history_deals_get(start_ts, end_ts)

                if deals is None:
                    err = mt5.last_error()
                    logger.warning(f"mt5.history_deals_get retornou None para conta {login or account_id}: {err}")
                    return SyncTradesPayload(
                        accountId=account_id,
                        login=login,
                        server=server,
                        lastDealTicket=last_deal_ticket,
                        trades=[]
                    )

                # Cache rápido dos deals de entrada (DEAL_ENTRY_IN) presentes na janela
                entry_by_position: Dict[int, Any] = {}
                out_count_by_position: Dict[int, int] = {}
                for d in deals:
                    if d.ticket > max_ticket:
                        max_ticket = d.ticket
                    if d.entry == 0 and d.position_id:
                        entry_by_position[d.position_id] = d
                    elif d.entry in (1, 2, 3) and d.position_id:
                        out_count_by_position[d.position_id] = out_count_by_position.get(d.position_id, 0) + 1

                for d in deals:
                    if d.ticket <= last_deal_ticket:
                        continue

                    # Posições em aberto já vão via /sync/positions; em /sync/trades enviamos deals de fechamento
                    # (DEAL_ENTRY_OUT=1, DEAL_ENTRY_INOUT=2, DEAL_ENTRY_OUT_BY=3) para evitar colisão de positionId com profit=0
                    if d.entry == 0 and d.type in (0, 1):
                        continue

                    entry_type = DEAL_ENTRY_MAP.get(d.entry, "DEAL_ENTRY_OUT")
                    raw_deal_type = DEAL_TYPE_MAP.get(d.type, "DEAL_TYPE_BALANCE")

                    close_time = datetime.datetime.fromtimestamp(d.time, tz=datetime.timezone.utc)
                    open_price = d.price
                    open_time = close_time - datetime.timedelta(seconds=60)
                    total_commission = float(d.commission or 0.0) + float(getattr(d, "fee", 0.0) or 0.0)
                    trade_direction = raw_deal_type

                    if d.type in (0, 1):
                        entry_deal = self._find_entry_deal(d.position_id, entry_by_position)
                        if entry_deal is not None:
                            open_price = float(entry_deal.price)
                            open_time = datetime.datetime.fromtimestamp(entry_deal.time, tz=datetime.timezone.utc)
                            # Soma a comissão cobrada na abertura quando não houver múltiplas saídas parciais
                            if out_count_by_position.get(d.position_id, 1) <= 1:
                                total_commission += float(entry_deal.commission or 0.0) + float(getattr(entry_deal, "fee", 0.0) or 0.0)
                            trade_direction = "DEAL_TYPE_BUY" if entry_deal.type == 0 else "DEAL_TYPE_SELL"
                        elif d.entry in (1, 3):
                            # No MT5, um DEAL_ENTRY_OUT de SELL fecha uma posição de BUY (e vice-versa)
                            trade_direction = "DEAL_TYPE_BUY" if d.type == 1 else "DEAL_TYPE_SELL"

                    deal_obj = DealData(
                        ticket=d.ticket,
                        orderTicket=d.order,
                        positionId=d.position_id if out_count_by_position.get(d.position_id, 1) <= 1 else d.ticket,
                        symbol=d.symbol or "",
                        type=trade_direction,
                        entry=entry_type,
                        volume=d.volume,
                        price=d.price,
                        openPrice=open_price,
                        profit=d.profit,
                        commission=round(total_commission, 2),
                        swap=d.swap,
                        magic=d.magic,
                        comment=d.comment or "",
                        time=close_time,
                        openTime=open_time,
                    )
                    trades_list.append(deal_obj)

                return SyncTradesPayload(
                    accountId=account_id,
                    login=login,
                    server=server,
                    lastDealTicket=max_ticket,
                    trades=trades_list
                )
            except MemoryError:
                res = self.get_resource_snapshot()
                err_msg = (
                    f"[ESGOTAMENTO DE MEMÓRIA] Falha ao extrair negócios (deals) da conta {account_id}! "
                    f"Memória Consumida: {res['memory_used_mb']} MB / {res['memory_total_mb']} MB ({res['memory_percent']}%) | "
                    f"RAM Livre: {res['memory_available_mb']} MB | CPU: {res['cpu_percent']}%. Interrompendo para evitar colapso."
                )
                logger.critical(err_msg)
                raise ResourceExhaustionError(err_msg, res, operation="fetch_incremental_deals", account_id=account_id)
            except Exception as e:
                res = self.get_resource_snapshot()
                logger.error(
                    f"[ERRO EXTRAÇÃO DEALS] Falha ao processar deals da conta {account_id}: {e}. "
                    f"Memória Consumida: {res['memory_used_mb']} MB ({res['memory_percent']}%) | CPU: {res['cpu_percent']}%"
                )
                return SyncTradesPayload(
                    accountId=account_id,
                    login=login,
                    server=server,
                    lastDealTicket=last_deal_ticket,
                    trades=[]
                )

