#!/usr/bin/env python3
"""
Script de Diagnóstico e Importação Direta de Extrato Completo no MT5 Server (Windows VPS)
Uso:
  python scripts/direct_import_account.py 6371945 " SUA_SENHA " "Deriv-Demo"

O que este script faz:
1. Conecta e autentica diretamente na conta MT5 informada (usando terminal isolado ou ativo).
2. Exibe o extrato completo do MT5 no terminal:
   - Resumo financeiro (Saldo, Equity, Margem, Lucro Flutuante)
   - Todas as Posições Abertas (mt5.positions_get) com o Ticket de Posição
   - Todos os Deals do Histórico (mt5.history_deals_get desde 2020) mostrando:
     * Deal Ticket (d.ticket) vs Position Ticket (d.position_id)
     * Entrada (DEAL_ENTRY_IN) vs Saída/Fecho (DEAL_ENTRY_OUT)
3. Envia imediatamente para o Backend Torex:
   - POST /sync/accounts (Saldo e Equity)
   - POST /sync/positions (Todas as posições abertas atuais)
   - POST /sync/trades (TODOS os trades fechados desde o início, ignorando watermark anterior)
4. Atualiza a credencial e o checkpoint no cofre local (accounts_pool.json).
"""

import os
import sys
import datetime
import subprocess
from pathlib import Path

# Garante que a raiz do mt5-server esteja no PYTHONPATH
ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

# Auto-detecta o ambiente virtual (.venv / venv) na VPS Windows caso o usuário chame 'python' global
try:
    import loguru  # noqa: F401
except ImportError:
    for venv_dir in (".venv", "venv", "env"):
        candidate = ROOT_DIR / venv_dir / "Scripts" / "python.exe"
        if candidate.exists() and Path(sys.executable).resolve() != candidate.resolve():
            print(f"[INFO] Redirecionando execução para o ambiente virtual: {candidate}")
            res = subprocess.run([str(candidate)] + sys.argv)
            sys.exit(res.returncode)

from loguru import logger
from config.settings import settings
from core.account_manager import AccountManager
from core.process_manager import MT5ProcessManager
from core.sync_engine import SyncEngine, MT5_AVAILABLE, mt5
from api_client.client import BackendApiClient


def main():
    login_arg = sys.argv[1].strip() if len(sys.argv) >= 2 else "6371945"
    password_arg = sys.argv[2].strip() if len(sys.argv) >= 3 else None
    server_arg = sys.argv[3].strip() if len(sys.argv) >= 4 else "Deriv-Demo"

    account_id = int(login_arg) if login_arg.isdigit() else 6371945

    acc_manager = AccountManager()
    proc_manager = MT5ProcessManager()
    sync_engine = SyncEngine()
    api_client = BackendApiClient()

    existing_acc = acc_manager.get_account(account_id)
    password = password_arg or (existing_acc.password if existing_acc else None)
    server = sync_engine._normalize_broker_server(server_arg or (existing_acc.server if existing_acc else "Deriv-Demo"))

    print("\n" + "=" * 90)
    print(f"🚀 IMPORTAÇÃO DIRETA DE EXTRATO MT5 -> TOREX JOURNAL")
    print(f"   Conta (Login): {login_arg} | Servidor: {server} | AccountID: {account_id}")
    print(f"   Backend URL  : {settings.backend_url}")
    print("=" * 90 + "\n")

    if not MT5_AVAILABLE:
        logger.error("Biblioteca MetaTrader5 não encontrada neste ambiente Python. Execute na VPS Windows!")
        sys.exit(1)

    isolated_path = proc_manager.get_or_prepare_isolated_terminal_exe(account_id)
    logger.info(f"Conectando ao terminal MT5 para conta {login_arg}@{server} (Executável: {isolated_path})...")

    connected = sync_engine.connect_account(
        account_id=account_id,
        login=login_arg,
        server=server,
        password=password,
        path=isolated_path,
    )

    if not connected:
        logger.error(f"❌ Falha ao conectar/autenticar conta {login_arg}@{server}: {sync_engine.last_connect_error}")
        sys.exit(1)

    # Salva/atualiza a conta e senha no cofre local para o Worker continuar sincronizando
    acc_manager.add_or_update_account(
        account_id=account_id,
        login=login_arg,
        server=server,
        password=password,
    )

    # 1. Extrair e enviar métricas da conta
    acc_info = sync_engine.fetch_account_info(account_id, login_arg, server)
    if acc_info:
        print(f"💰 DADOS DA CONTA NO MT5:")
        print(f"   Titular : {acc_info.name} ({acc_info.company})")
        print(f"   Saldo   : ${acc_info.balance:.2f} {acc_info.currency}")
        print(f"   Equity  : ${acc_info.equity:.2f} {acc_info.currency}")
        print(f"   Profit  : ${acc_info.profit:.2f} | Ping: {acc_info.pingMs}ms\n")
        ok_acc = api_client.sync_account(acc_info)
        print(f"   -> Envio POST /sync/accounts: {'✅ SUCESSO' if ok_acc else '❌ FALHOU'}\n")

    # 2. Extrair e listar todas as Posições Abertas no MT5
    pos_payload = sync_engine.fetch_positions(account_id, login=login_arg)
    open_positions = pos_payload.positions or []
    print(f"🟢 POSIÇÕES EM ABERTO NO MT5 AGORA ({len(open_positions)}):")
    for idx, p in enumerate(open_positions, 1):
        print(
            f"   {idx:02d}. Position Ticket: {str(p.ticket):<12} | {p.symbol:<10} | {p.type:<18} | "
            f"Vol: {p.volume:<6.2f} | Open: {p.priceOpen:<10.5f} | Atual: {p.priceCurrent:<10.5f} | "
            f"Profit: ${p.profit:>8.2f} | Data: {p.time}"
        )
    ok_pos = api_client.sync_positions(pos_payload)
    print(f"   -> Envio POST /sync/positions ({len(open_positions)} abertas): {'✅ SUCESSO' if ok_pos else '❌ FALHOU'}\n")

    # 3. Inspecionar todos os Deals brutos no histórico do MT5 para transparência total dos Tickets
    now_utc = datetime.datetime.now(datetime.timezone.utc)
    start_all = datetime.datetime(2020, 1, 1)
    end_all = (now_utc + datetime.timedelta(days=1)).replace(tzinfo=None)
    raw_deals = mt5.history_deals_get(start_all, end_all) or []

    entry_names = {0: "IN (Abertura)", 1: "OUT (Fecho)", 2: "INOUT", 3: "OUT_BY"}
    type_names = {0: "BUY", 1: "SELL", 2: "BALANCE (Depósito/Saque)", 3: "CREDIT"}

    print(f"📜 HISTÓRICO BRUTO DE DEALS NO MT5 ({len(raw_deals)} eventos totais):")
    in_count = 0
    out_count = 0
    for idx, d in enumerate(raw_deals, 1):
        if d.entry == 0 and d.type in (0, 1):
            in_count += 1
        elif d.entry in (1, 2, 3) and d.type in (0, 1):
            out_count += 1
        dt_str = datetime.datetime.fromtimestamp(d.time, tz=datetime.timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        print(
            f"   {idx:02d}. Deal Ticket: {str(d.ticket):<12} | Position ID (Ticket MT5): {str(d.position_id):<12} | "
            f"Entry: {entry_names.get(d.entry, str(d.entry)):<14} | Tipo: {type_names.get(d.type, str(d.type)):<8} | "
            f"Ativo: {str(d.symbol or '-'):<10} | Vol: {d.volume:<6.2f} | Preço: {d.price:<10.5f} | "
            f"Profit: ${d.profit:>8.2f} | Data: {dt_str}"
        )
    print(f"   Resumo de Eventos: {in_count} aberturas (DEAL_ENTRY_IN) | {out_count} fechos (DEAL_ENTRY_OUT)\n")

    # 4. Extrair todos os Trades Fechados pareados (last_deal_ticket=0 para forçar histórico completo)
    deals_payload = sync_engine.fetch_incremental_deals(
        account_id=account_id,
        login=login_arg,
        server=server,
        last_deal_ticket=0,
        last_deal_time=None,
    )
    closed_trades = deals_payload.trades or []
    print(f"🔵 OPERAÇÕES FECHADAS PRONTAS PARA IMPORTAÇÃO ({len(closed_trades)}):")
    for idx, t in enumerate(closed_trades, 1):
        print(
            f"   {idx:02d}. Position Ticket (MT5): {str(t.positionId):<12} (Deal Out ID: {str(t.ticket):<12}) | "
            f"{t.symbol:<10} | {t.type:<14} | Vol: {t.volume:<6.2f} | "
            f"Open: {t.openPrice or 0.0:<10.5f} -> Close: {t.price:<10.5f} | "
            f"Profit: ${t.profit:>8.2f} | Fecho: {t.time}"
        )

    if closed_trades:
        ok_trades = api_client.sync_trades(deals_payload)
        print(f"\n   -> Envio POST /sync/trades ({len(closed_trades)} trades fechados): {'✅ SUCESSO' if ok_trades else '❌ FALHOU'}")
        if ok_trades:
            latest_time = max((t.time for t in closed_trades if t.time), default=None)
            acc_manager.update_checkpoint(account_id, deals_payload.lastDealTicket, last_deal_time=latest_time)
            print(f"   -> Checkpoint atualizado para lastDealTicket={deals_payload.lastDealTicket}")
    else:
        print("\n   -> Nenhuma operação fechada retornada pelo MT5.")

    print("\n" + "=" * 90)
    print(f"✅ RESUMO FINAL DA CONTA {login_arg} ({server}):")
    print(f"   • Posições Abertas sincronizadas : {len(open_positions)}")
    print(f"   • Trades Fechados sincronizados  : {len(closed_trades)}")
    print(f"   • Total de Operações no Torex    : {len(open_positions) + len(closed_trades)}")
    print("=" * 90 + "\n")


if __name__ == "__main__":
    main()
