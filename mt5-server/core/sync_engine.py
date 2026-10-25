import datetime
from typing import List, Optional, Tuple
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
)

class SyncEngine:
    """Motor de extração incremental de dados financeiros e operacionais do MetaTrader 5."""

    def __init__(self):
        self.connected_account: Optional[int] = None

    def ensure_connected(self, account_id: int, login: str, server: str, password: Optional[str] = None, path: Optional[str] = None) -> bool:
        """Garante que a sessão IPC com o terminal MT5 está ativa para esta conta antes da sincronização"""
        if not MT5_AVAILABLE:
            self.connected_account = account_id
            return True

        if self.connected_account == account_id:
            info = mt5.account_info()
            if info is not None:
                return True

        return self.connect_account(account_id, login, server, password, path)

    def connect_account(self, account_id: int, login: str, server: str, password: Optional[str] = None, path: Optional[str] = None) -> bool:
        """Inicializa a conexão IPC com o terminal MT5 da conta especificada"""
        if not MT5_AVAILABLE:
            logger.warning(f"[Mock] Conectando mock MT5 para conta {account_id}")
            self.connected_account = account_id
            return True

        # Se já estava conectado a outra conta, desconectar antes de chavear
        if self.connected_account is not None and self.connected_account != account_id:
            try:
                mt5.shutdown()
            except Exception:
                pass
            self.connected_account = None

        login_int = int(login) if str(login).isdigit() else 0
        init_success = False

        # Tentativa 1: Inicialização direta com credenciais e path (60s timeout para VPS)
        if path:
            try:
                init_success = mt5.initialize(
                    path=path,
                    login=login_int,
                    password=password or "",
                    server=server,
                    timeout=60000
                )
            except Exception as e:
                logger.debug(f"Tentativa 1 falhou: {e}")

        # Tentativa 2: Conectar ao terminal que já está aberto/em execução
        if not init_success:
            logger.info("Tentando conectar diretamente ao terminal MT5 em execução...")
            try:
                init_success = mt5.initialize(timeout=60000)
            except Exception as e:
                logger.debug(f"Tentativa 2 falhou: {e}")

        # Tentativa 3: Inicialização com flag portable
        if not init_success and path:
            logger.info("Tentando inicialização com modo portable...")
            try:
                init_success = mt5.initialize(path=path, portable=True, timeout=60000)
            except Exception as e:
                logger.debug(f"Tentativa 3 falhou: {e}")

        if not init_success:
            logger.error(f"mt5.initialize() falhou em todas as tentativas: {mt5.last_error()}")
            return False

        # Se conectou ao terminal, garantir login na conta correta
        if login and server:
            current_info = mt5.account_info()
            if current_info is None or str(current_info.login) != str(login):
                logger.info(f"Efetuando login no MT5 ({login} @ {server})...")
                login_success = mt5.login(login=login_int, password=password or "", server=server)
                if not login_success:
                    logger.error(f"mt5.login() falhou para {login} @ {server}: {mt5.last_error()}")
                    return False

        self.connected_account = account_id
        logger.success(f"Conexão MT5 ativa com conta {account_id} ({login}@{server})")
        return True

    def disconnect(self):
        """Desconecta a sessão MT5 atual"""
        if MT5_AVAILABLE:
            mt5.shutdown()
        self.connected_account = None

    def fetch_account_info(self, account_id: int, login: str, server: str) -> Optional[AccountInfo]:
        """Obtém dados de saldo, patrimônio e margem da conta"""
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

    def fetch_positions(self, account_id: int) -> SyncPositionsPayload:
        """Obtém todas as posições abertas no momento"""
        positions_list: List[PositionData] = []
        if not MT5_AVAILABLE:
            return SyncPositionsPayload(accountId=account_id, positions=positions_list)

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

        return SyncPositionsPayload(accountId=account_id, positions=positions_list)

    def fetch_orders(self, account_id: int) -> SyncOrdersPayload:
        """Obtém ordens pendentes ativas"""
        orders_list: List[OrderData] = []
        if not MT5_AVAILABLE:
            return SyncOrdersPayload(accountId=account_id, orders=orders_list)

        orders = mt5.orders_get()
        if orders is not None:
            for ord in orders:
                orders_list.append(OrderData(
                    ticket=ord.ticket,
                    symbol=ord.symbol,
                    type=str(ord.type),
                    state=str(ord.state),
                    volumeInitial=ord.volume_initial,
                    volumeCurrent=ord.volume_current,
                    priceOpen=ord.price_open,
                    sl=ord.sl,
                    tp=ord.tp,
                    timeSetup=datetime.datetime.fromtimestamp(ord.time_setup, tz=datetime.timezone.utc),
                    magic=ord.magic,
                    comment=ord.comment,
                ))

        return SyncOrdersPayload(accountId=account_id, orders=orders_list)

    def fetch_incremental_deals(
        self,
        account_id: int,
        last_deal_ticket: int = 0,
        from_date: Optional[datetime.datetime] = None
    ) -> SyncTradesPayload:
        """
        Coleta negócios (deals) de forma estritamente incremental.
        Filtra apenas registros com ticket > last_deal_ticket.
        """
        trades_list: List[DealData] = []
        max_ticket = last_deal_ticket

        if not MT5_AVAILABLE:
            return SyncTradesPayload(accountId=account_id, lastDealTicket=max_ticket, trades=[])

        # Se não fornecido from_date, busca a partir de 2000 ou 30 dias atrás
        start_time = from_date or datetime.datetime(2000, 1, 1, tzinfo=datetime.timezone.utc)
        end_time = datetime.datetime.now(tz=datetime.timezone.utc) + datetime.timedelta(hours=1)

        deals = mt5.history_deals_get(start_time, end_time)
        if deals is not None:
            for d in deals:
                if d.ticket > last_deal_ticket:
                    # Mapeia tipos
                    entry_type = "DEAL_ENTRY_IN" if d.entry == 0 else ("DEAL_ENTRY_OUT" if d.entry == 1 else "DEAL_ENTRY_INOUT")
                    deal_type = "DEAL_TYPE_BUY" if d.type == 0 else ("DEAL_TYPE_SELL" if d.type == 1 else "DEAL_TYPE_BALANCE")

                    deal_obj = DealData(
                        ticket=d.ticket,
                        orderTicket=d.order,
                        positionId=d.position_id,
                        symbol=d.symbol or "",
                        type=deal_type,
                        entry=entry_type,
                        volume=d.volume,
                        price=d.price,
                        profit=d.profit,
                        commission=d.commission,
                        swap=d.swap,
                        magic=d.magic,
                        comment=d.comment,
                        time=datetime.datetime.fromtimestamp(d.time, tz=datetime.timezone.utc),
                    )
                    trades_list.append(deal_obj)
                    if d.ticket > max_ticket:
                        max_ticket = d.ticket

        return SyncTradesPayload(
            accountId=account_id,
            lastDealTicket=max_ticket,
            trades=trades_list
        )
