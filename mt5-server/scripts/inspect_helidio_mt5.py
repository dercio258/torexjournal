#!/usr/bin/env python3
"""
Script de Inspeção e Reconciliação Direta no MT5 (Windows VPS)
Alvo padrão: Conta MT5 #419096791 (GoatFunded-Server2 — helidiobusiness@gmail.com)
Uso:
  python scripts/inspect_helidio_mt5.py [login_mt5]
"""

import os
import sys
import datetime
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

for venv_candidate in (
    BASE_DIR / ".venv" / "Scripts" / "python.exe",
    BASE_DIR / "venv" / "Scripts" / "python.exe",
    BASE_DIR.parent / ".venv" / "Scripts" / "python.exe",
):
    if venv_candidate.exists() and Path(sys.executable).resolve() != venv_candidate.resolve():
        os.execv(str(venv_candidate), [str(venv_candidate), *sys.argv])

import MetaTrader5 as mt5
from core.account_manager import AccountManager
from core.process_manager import ProcessManager
from core.sync_engine import SyncEngine
from api_client.client import BackendClient
from config.settings import settings


def main():
    target_login = sys.argv[1].strip() if len(sys.argv) > 1 else "419096791"
    account_id = int(target_login)

    print("=" * 90)
    print(f"🔍 AUDITORIA DIRETA NO TERMINAL MT5 — CONTA #{target_login}")
    print("=" * 90)

    acc_mgr = AccountManager()
    acc = acc_mgr.get_account(account_id)
    if not acc:
        print(f"⚠️ Conta {target_login} não encontrada no cofre local ({acc_mgr.storage_file}).")
        sys.exit(1)

    print(f"🏦 Conta localizada no cofre: Login={acc.login} | Servidor={acc.server}")

    proc_mgr = ProcessManager()
    sync_eng = SyncEngine()
    api_client = BackendClient()

    isolated_path = proc_mgr.get_or_prepare_isolated_terminal_exe(
        account_id,
        login=acc.login,
        server=acc.server,
        password=acc.password,
    )

    if not sync_eng.ensure_connected(account_id, acc.login, acc.server, acc.password, isolated_path):
        print(f"❌ Falha ao conectar no MT5 para {acc.login}@{acc.server}: {sync_eng.last_connect_error}")
        sys.exit(1)

    info = mt5.account_info()
    print(
        f"✅ Conectado no MT5: Titular={getattr(info, 'name', '')} | "
        f"Saldo=${getattr(info, 'balance', 0):.2f} | Equity=${getattr(info, 'equity', 0):.2f}"
    )

    now_utc = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=1)
    deals = mt5.history_deals_get(datetime.datetime(2020, 1, 1), now_utc.replace(tzinfo=None)) or []

    print(f"\n📜 DEALS BRUTOS NO MT5 ({len(deals)} registros):")
    print("-" * 90)
    for idx, d in enumerate(deals, 1):
        dt_str = datetime.datetime.fromtimestamp(int(d.time), tz=datetime.timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        fee_val = float(getattr(d, "fee", 0.0) or 0.0)
        print(
            f"  {idx:02d}. DealTicket={d.ticket} | PositionID={d.position_id} | Order={d.order} | "
            f"Symbol={d.symbol or 'BALANCE'} | Type={d.type} | Entry={d.entry} | Vol={d.volume:.2f} | "
            f"Price={d.price} | Profit=${d.profit:.2f} | Comm=${d.commission:.2f} | Fee=${fee_val:.2f} | "
            f"Swap=${d.swap:.2f} | Horário MT5={dt_str} | Comment='{d.comment}'"
        )

    trades_payload = sync_eng.fetch_incremental_deals(
        account_id=account_id,
        login=acc.login,
        server=acc.server,
        last_deal_ticket=0,
        last_deal_time=None,
    )

    print(f"\n📦 TRADES RECONSTRUÍDOS PARA O TOREX ({len(trades_payload.trades)} operações):")
    print("-" * 90)
    for idx, tr in enumerate(trades_payload.trades, 1):
        net_pnl = float(tr.profit) + float(tr.commission) + float(tr.swap)
        open_str = tr.openTime.strftime("%Y-%m-%d %H:%M:%S") if tr.openTime else "N/A"
        close_str = tr.time.strftime("%Y-%m-%d %H:%M:%S") if tr.time else "N/A"
        print(
            f"  #{idx:02d} Ticket(PosID)={tr.positionId} (Deal={tr.ticket}) | {tr.symbol} | {tr.type} | Vol={tr.volume:.2f}\n"
            f"      Preços  : Open={tr.openPrice} -> Close={tr.price}\n"
            f"      Lucros  : Bruto(Profit)=${tr.profit:.2f} | Comm=${tr.commission:.2f} | Swap=${tr.swap:.2f} | Líquido(NetPnL)=${net_pnl:.2f}\n"
            f"      Horários: Abertura={open_str} | Fechamento={close_str}"
        )

    if trades_payload.trades:
        print("\n🚀 Enviando reconciliação completa para o Backend TorexJournal...")
        api_client.register_worker(max_accounts=settings.max_accounts_per_instance)
        ok = api_client.sync_trades(trades_payload)
        if ok:
            print("✅ Reconciliação enviada com sucesso! Os lucros e horários no banco foram atualizados.")
        else:
            print("❌ Falha ao enviar reconciliação ao backend.")

    print("=" * 90)


if __name__ == "__main__":
    main()
