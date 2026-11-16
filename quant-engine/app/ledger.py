from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Optional

from .contracts import (
    CandleBar,
    ExitReason,
    InstrumentContractSpec,
    MarketExecutionPreview,
    OrderIntentInput,
    OrderSide,
    OrderStatus,
    OrderType,
    ReplayOrderModel,
    ReplayStatsModel,
)

CENTS = Decimal("0.01")


def _d(val: float | int | str | Decimal) -> Decimal:
    return Decimal(str(val))


def round_decimal(val: float | Decimal, decimals: int = 2) -> float:
    quant = Decimal("1") if decimals <= 0 else Decimal(f"1e-{decimals}")
    return float(_d(val).quantize(quant, rounding=ROUND_HALF_UP))


def round_money(val: float | Decimal) -> float:
    return float(_d(val).quantize(CENTS, rounding=ROUND_HALF_UP))


def get_instrument_contract_spec(raw_symbol: str, reference_price: float = 0.0) -> InstrumentContractSpec:
    clean = (raw_symbol or "XAUUSD").split(":")[-1].upper()
    if "XAU" in clean or "GOLD" in clean:
        return InstrumentContractSpec(assetClass="METAL", contractSize=100, unitLabel="100 oz/lote", pipSize=0.1)
    if "XAG" in clean or "SILVER" in clean:
        return InstrumentContractSpec(assetClass="METAL", contractSize=5000, unitLabel="5.000 oz/lote", pipSize=0.01)
    if any(k in clean for k in ("BTC", "ETH", "SOL", "BNB", "XRP")):
        return InstrumentContractSpec(
            assetClass="CRYPTO",
            contractSize=1,
            unitLabel="1 unid/lote",
            pipSize=1.0 if reference_price >= 100 else 0.01,
        )
    if any(k in clean for k in ("NAS", "US100", "US30", "SPX", "US500", "GER40", "DAX", "HK50", "UK100")):
        return InstrumentContractSpec(assetClass="INDEX", contractSize=1, unitLabel="1 cfd/lote", pipSize=1.0)
    if len(clean) == 6 and clean.isalpha():
        is_jpy = clean.endswith("JPY")
        return InstrumentContractSpec(
            assetClass="FOREX",
            contractSize=100_000,
            unitLabel="100k/lote",
            pipSize=0.01 if is_jpy else 0.0001,
        )
    return InstrumentContractSpec(assetClass="STOCK", contractSize=1, unitLabel="1 ação/lote", pipSize=0.01)


def _fx_usd_divisor(clean_symbol: str, spec: InstrumentContractSpec, entry_price: float) -> Decimal:
    if spec.assetClass == "FOREX" and not clean_symbol.endswith("USD") and entry_price > 0:
        if clean_symbol.startswith("USD"):
            return _d(entry_price)
        if clean_symbol.endswith("JPY"):
            return _d(max(entry_price, 80.0))
    return Decimal("1")


def calculate_instrument_lots(
    symbol: str,
    entry_price: float,
    sl_distance_price: float,
    risk_amount_usd: float,
) -> tuple[float, InstrumentContractSpec, float]:
    spec = get_instrument_contract_spec(symbol, entry_price)
    safe_sl = max(abs(sl_distance_price), 1e-7)
    pips_at_risk = float(
        (_d(safe_sl) / _d(max(spec.pipSize, 1e-7))).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
    )
    if risk_amount_usd <= 0 or entry_price <= 0:
        return 0.01, spec, pips_at_risk

    clean = (symbol or "").split(":")[-1].upper()
    divisor = _fx_usd_divisor(clean, spec, entry_price)
    dollar_risk_per_lot = (_d(safe_sl) * _d(spec.contractSize)) / divisor
    raw_lots = _d(risk_amount_usd) / dollar_risk_per_lot if dollar_risk_per_lot > 0 else Decimal("0.01")
    clamped = min(Decimal("500.00"), max(Decimal("0.01"), raw_lots.quantize(CENTS, rounding=ROUND_HALF_UP)))
    return float(clamped), spec, pips_at_risk


def calculate_lot_based_pnl(
    symbol: str,
    side: str | OrderSide,
    entry_price: float,
    exit_price: float,
    lots: float,
    commission: float = 0.0,
) -> float:
    """Exact USD P&L from broker lots, contract size, entry/exit delta and commission."""
    if lots <= 0 or entry_price <= 0:
        return round_money(-abs(commission))
    side_str = side.value if isinstance(side, OrderSide) else str(side).upper()
    spec = get_instrument_contract_spec(symbol, entry_price)
    clean = (symbol or "").split(":")[-1].upper()
    divisor = _fx_usd_divisor(clean, spec, entry_price)

    delta = _d(exit_price) - _d(entry_price) if side_str == "BUY" else _d(entry_price) - _d(exit_price)
    gross_usd = (delta * _d(lots) * _d(spec.contractSize)) / divisor
    net_usd = gross_usd - _d(max(0.0, commission or 0.0))
    return round_money(net_usd)


def is_crossed_immediate_order(
    side: OrderSide | str,
    order_type: OrderType | str,
    requested_price: float,
    bid: float,
    spread: float = 0.0,
) -> bool:
    otype = order_type.value if isinstance(order_type, OrderType) else str(order_type).upper()
    if otype == "MARKET":
        return True
    s_side = side.value if isinstance(side, OrderSide) else str(side).upper()
    ask = float(_d(bid) + _d(max(0.0, spread)))
    if otype == "LIMIT":
        return (s_side == "BUY" and requested_price >= ask) or (s_side == "SELL" and requested_price <= bid)
    if otype == "STOP":
        return (s_side == "BUY" and requested_price <= ask) or (s_side == "SELL" and requested_price >= bid)
    return False


def preview_market_execution(inp: OrderIntentInput) -> MarketExecutionPreview:
    decimals = inp.decimals
    safe_bid = round_decimal(inp.bid, decimals)
    safe_spread = max(0.0, float(inp.spread or 0.0))
    safe_ask = round_decimal(_d(inp.bid) + _d(safe_spread), decimals)
    market_fill = safe_ask if inp.side == OrderSide.BUY else safe_bid
    raw_req = round_decimal(inp.requestedPrice, decimals) if inp.requestedPrice and inp.requestedPrice > 0 else market_fill

    immediate = is_crossed_immediate_order(inp.side, inp.orderType, raw_req, inp.bid, safe_spread)
    entry_price = market_fill if immediate else raw_req

    min_tick = 10.0 ** (-decimals)
    sl_dist = max(float(_d(entry_price) * _d(inp.slDistancePct) / Decimal("100")), min_tick)
    tp_dist = float(_d(sl_dist) * _d(inp.rrTarget))

    stop_loss = round_decimal(
        _d(entry_price) - _d(sl_dist) if inp.side == OrderSide.BUY else _d(entry_price) + _d(sl_dist),
        decimals,
    )
    take_profit = round_decimal(
        _d(entry_price) + _d(tp_dist) if inp.side == OrderSide.BUY else _d(entry_price) - _d(tp_dist),
        decimals,
    )

    risk_amount = round_money((_d(inp.balance) * _d(inp.riskPercent)) / Decimal("100"))
    lots, spec, pips_at_risk = calculate_instrument_lots(inp.symbol, entry_price, sl_dist, risk_amount)

    gross_reward = calculate_lot_based_pnl(inp.symbol, inp.side, entry_price, take_profit, lots, 0.0)
    net_reward = round_money(_d(gross_reward) - _d(inp.commission))
    sl_loss_abs = abs(calculate_lot_based_pnl(inp.symbol, inp.side, entry_price, stop_loss, lots, 0.0))
    net_loss = round_money(_d(sl_loss_abs) + _d(inp.commission))
    effective_rr = float((_d(net_reward) / _d(net_loss)).quantize(CENTS, rounding=ROUND_HALF_UP)) if net_loss > 0 else inp.rrTarget

    validation_error: Optional[str] = None
    hint: Optional[str] = None
    if stop_loss <= 0 or take_profit <= 0:
        validation_error = "Níveis de Stop Loss ou Take Profit resultaram em preço inválido (<= 0)."
    elif inp.orderType == OrderType.LIMIT:
        if immediate:
            side_cond = f"BUY LIMIT ≥ ASK ({safe_ask:.{decimals}f})" if inp.side == OrderSide.BUY else f"SELL LIMIT ≤ BID ({safe_bid:.{decimals}f})"
            hint = f"{side_cond}: preencherá imediatamente a mercado ({entry_price:.{decimals}f})."
        else:
            hint = (
                f"Aguardará recuo do ASK até ≤ {entry_price:.{decimals}f}"
                if inp.side == OrderSide.BUY
                else f"Aguardará alta do BID até ≥ {entry_price:.{decimals}f}"
            )
    elif inp.orderType == OrderType.STOP:
        if immediate:
            side_cond = f"BUY STOP ≤ ASK ({safe_ask:.{decimals}f})" if inp.side == OrderSide.BUY else f"SELL STOP ≥ BID ({safe_bid:.{decimals}f})"
            hint = f"{side_cond}: gatilho já rompido, preencherá imediatamente ({entry_price:.{decimals}f})."
        else:
            hint = (
                f"Rompimento: ativará quando ASK subir até ≥ {entry_price:.{decimals}f}"
                if inp.side == OrderSide.BUY
                else f"Rompimento: ativará quando BID cair até ≤ {entry_price:.{decimals}f}"
            )
    else:
        hint = (
            f"Execução imediata na cotação ASK ({safe_ask:.{decimals}f})"
            if inp.side == OrderSide.BUY
            else f"Execução imediata na cotação BID ({safe_bid:.{decimals}f})"
        )

    return MarketExecutionPreview(
        valid=validation_error is None,
        validationError=validation_error,
        executionHint=hint,
        immediateFillExpected=immediate,
        bid=safe_bid,
        ask=safe_ask,
        spreadPrice=safe_spread,
        entryPrice=entry_price,
        stopLoss=stop_loss,
        takeProfit=take_profit,
        slDistancePrice=round_decimal(sl_dist, decimals),
        tpDistancePrice=round_decimal(tp_dist, decimals),
        pipsAtRisk=pips_at_risk,
        lots=lots,
        unitLabel=spec.unitLabel,
        riskAmount=risk_amount,
        grossRewardAtTp=gross_reward,
        netRewardAtTp=net_reward,
        netLossAtSl=net_loss,
        effectiveRr=effective_rr,
    )


def _r_of(o: dict[str, Any], exit_price: float) -> float:
    base_sl = o.get("initialStopLoss") if o.get("initialStopLoss") is not None else o.get("stopLoss", 0.0)
    entry = float(o["entryPrice"])
    raw_dist = abs(entry - float(base_sl)) if base_sl and float(base_sl) > 0 else max(entry * 0.005, 1e-6)
    dist = max(raw_dist, 1e-6)
    diff = exit_price - entry if o["side"] == "BUY" else entry - exit_price
    return diff / dist


def _pnl_of(o: dict[str, Any], exit_price: float) -> float:
    lots = float(o.get("lots") or 0.0)
    comm = float(o.get("commission") or 0.0)
    if lots > 0:
        return calculate_lot_based_pnl(
            symbol=str(o.get("symbol") or "XAUUSD"),
            side=str(o.get("side") or "BUY"),
            entry_price=float(o["entryPrice"]),
            exit_price=exit_price,
            lots=lots,
            commission=comm,
        )
    risk_amt = float(o.get("riskAmount") or 0.0)
    return round_money(risk_amt * _r_of(o, exit_price) - comm)


def create_order_from_intent(
    *,
    order_id: str,
    symbol: str,
    side: OrderSide | str,
    order_type: OrderType | str,
    price: float,
    sl_distance: float,
    rr_ratio: float,
    risk_amount: float,
    lots: float,
    opened_at: float,
    decimals: int = 2,
    spread: float = 0.0,
    commission: float = 0.0,
    reference_bid: Optional[float] = None,
) -> dict[str, Any]:
    s_side = side.value if isinstance(side, OrderSide) else str(side).upper()
    s_type = order_type.value if isinstance(order_type, OrderType) else str(order_type).upper()
    safe_spread = max(0.0, float(spread or 0.0))

    if s_type == "MARKET":
        fill_now = True
        raw_entry = price + safe_spread if s_side == "BUY" else price
    elif reference_bid is not None and is_crossed_immediate_order(s_side, s_type, price, reference_bid, safe_spread):
        fill_now = True
        raw_entry = reference_bid + safe_spread if s_side == "BUY" else reference_bid
    else:
        fill_now = False
        raw_entry = price

    entry = round_decimal(raw_entry, decimals)
    direction = 1 if s_side == "BUY" else -1
    sl_price = round_decimal(entry - direction * sl_distance, decimals) if sl_distance > 0 else 0.0
    tp_price = round_decimal(entry + direction * sl_distance * rr_ratio, decimals) if sl_distance > 0 and rr_ratio > 0 else 0.0

    order: dict[str, Any] = {
        "id": order_id,
        "symbol": symbol,
        "side": s_side,
        "orderType": s_type,
        "entryPrice": entry,
        "stopLoss": sl_price,
        "initialStopLoss": sl_price,
        "takeProfit": tp_price,
        "lots": lots,
        "riskAmount": round_money(risk_amount),
        "rrRatio": rr_ratio,
        "spread": safe_spread,
        "commission": round_money(commission),
        "status": "OPEN" if fill_now else "PENDING",
        "pnl": 0.0,
        "rMultiple": 0.0,
        "mfe": 0.0,
        "mae": 0.0,
        "openedAt": opened_at,
    }
    if fill_now:
        order["filledAt"] = opened_at
        bid_ref = reference_bid if reference_bid is not None else price
        mark_exit = bid_ref if s_side == "BUY" else bid_ref + safe_spread
        order["pnl"] = _pnl_of(order, mark_exit)
        order["rMultiple"] = round_money(_r_of(order, mark_exit))
    return order


def _update_excursions(o: dict[str, Any], c: CandleBar) -> tuple[float, float]:
    s = float(o.get("spread") or 0.0)
    fav_price = c.high if o["side"] == "BUY" else c.low + s
    adv_price = c.low if o["side"] == "BUY" else c.high + s

    lots = float(o.get("lots") or 0.0)
    if lots > 0:
        fav_pnl = calculate_lot_based_pnl(o["symbol"], o["side"], o["entryPrice"], fav_price, lots, 0.0)
        adv_pnl = calculate_lot_based_pnl(o["symbol"], o["side"], o["entryPrice"], adv_price, lots, 0.0)
        fav_usd = max(0.0, fav_pnl)
        adv_usd = max(0.0, -adv_pnl)
    else:
        risk_amt = float(o.get("riskAmount") or 0.0)
        fav_usd = max(0.0, risk_amt * max(0.0, _r_of(o, fav_price)))
        adv_usd = max(0.0, risk_amt * max(0.0, -_r_of(o, adv_price)))

    return (
        round_money(max(float(o.get("mfe") or 0.0), fav_usd)),
        round_money(max(abs(float(o.get("mae") or 0.0)), adv_usd)),
    )


def _close_order(o: dict[str, Any], exit_price: float, closed_at: float, reason: str) -> dict[str, Any]:
    pnl = _pnl_of(o, exit_price)
    closed = dict(o)
    closed["status"] = "WIN" if pnl >= 0 else "LOSS"
    closed["exitPrice"] = exit_price
    closed["exitReason"] = reason
    closed["pnl"] = pnl
    closed["rMultiple"] = round_money(_r_of(o, exit_price))
    closed["closedAt"] = closed_at
    return closed


def step_order(o: dict[str, Any], c: CandleBar) -> dict[str, Any]:
    if o.get("status") in ("CLOSED", "WIN", "LOSS", "CANCELLED"):
        return o
    s = float(o.get("spread") or 0.0)
    cur = dict(o)
    just_filled = False

    if cur.get("status") == "PENDING":
        lo = c.low + s if cur["side"] == "BUY" else c.low
        hi = c.high + s if cur["side"] == "BUY" else c.high
        open_q = c.open + s if cur["side"] == "BUY" else c.open
        entry = float(cur["entryPrice"])
        if cur.get("orderType") == "STOP":
            triggered = (hi >= entry or open_q >= entry) if cur["side"] == "BUY" else (lo <= entry or open_q <= entry)
        else:
            triggered = (lo <= entry or open_q <= entry) if cur["side"] == "BUY" else (hi >= entry or open_q >= entry)
        if triggered:
            cur["status"] = "OPEN"
            cur["filledAt"] = c.timestamp
            just_filled = True
        else:
            return cur

    mfe, mae = _update_excursions(cur, c)
    cur["mfe"] = mfe
    cur["mae"] = mae
    sl = float(cur.get("stopLoss") or 0.0)
    tp = float(cur.get("takeProfit") or 0.0)

    if cur["side"] == "BUY":
        if not just_filled and sl > 0 and c.open <= sl:
            return _close_order(cur, c.open, c.timestamp, "SL")
        if sl > 0 and c.low <= sl:
            return _close_order(cur, sl, c.timestamp, "SL")
        if tp > 0 and c.high >= tp:
            return _close_order(cur, tp, c.timestamp, "TP")
        cur["pnl"] = _pnl_of(cur, c.close)
        cur["rMultiple"] = round_money(_r_of(cur, c.close))
        return cur

    if not just_filled and sl > 0 and c.open + s >= sl:
        return _close_order(cur, c.open + s, c.timestamp, "SL")
    if sl > 0 and c.high + s >= sl:
        return _close_order(cur, sl, c.timestamp, "SL")
    if tp > 0 and c.low + s <= tp:
        return _close_order(cur, tp, c.timestamp, "TP")
    mark = c.close + s
    cur["pnl"] = _pnl_of(cur, mark)
    cur["rMultiple"] = round_money(_r_of(cur, mark))
    return cur


def simulate_orders(
    orders: list[dict[str, Any]],
    *,
    bars: Optional[list[CandleBar]] = None,
    symbol: Optional[str] = None,
    upto_ts: Optional[int] = None,
    rewind: bool = False,
) -> list[dict[str, Any]]:
    """Reconciles replay orders with P0-1 immutability for finalized orders on !rewind."""
    normalized: list[dict[str, Any]] = []
    for raw in orders:
        model = ReplayOrderModel.model_validate(raw)
        ord_dict = model.model_dump(mode="json", exclude_none=True)
        ord_dict["mae"] = abs(float(ord_dict.get("mae") or 0.0))
        ord_dict["mfe"] = abs(float(ord_dict.get("mfe") or 0.0))
        normalized.append(ord_dict)

    if not bars:
        return normalized

    sorted_bars = sorted(bars, key=lambda b: b.timestamp)
    cutoff = upto_ts if upto_ts is not None else sorted_bars[-1].timestamp
    target_symbol = (symbol or "").upper()
    out: list[dict[str, Any]] = []

    for o in normalized:
        if o.get("isPartialClose"):
            if rewind and o.get("closedAt") is not None and float(o["closedAt"]) > cutoff:
                continue
            out.append(o)
            continue

        if target_symbol and str(o.get("symbol", "")).upper() != target_symbol:
            out.append(o)
            continue

        # P0-1 CRITICAL: Non-rewind reloads/ticks NEVER mutate finalized trades!
        if not rewind and o.get("status") in ("WIN", "LOSS", "CANCELLED", "CLOSED"):
            out.append(o)
            continue

        opened_at = float(o["openedAt"])
        if opened_at > cutoff:
            if rewind:
                continue
            out.append(o)
            continue

        if o.get("status") == "PENDING" and o.get("cancelledAt") is not None and float(o["cancelledAt"]) <= cutoff:
            cur = dict(o)
            cur["status"] = "CANCELLED"
            out.append(cur)
            continue

        immediately_filled = o.get("orderType") == "MARKET" or (o.get("filledAt") == opened_at)
        orig_stop = o.get("initialStopLoss") if o.get("initialStopLoss") is not None else o.get("stopLoss", 0.0)
        sl_mod_at = o.get("slModifiedAt")
        manual_at = o.get("manualCloseAt")
        manual_price = o.get("manualClosePrice")
        cancelled_at = o.get("cancelledAt")
        eff_stop = float(o.get("stopLoss") or 0.0)

        if rewind and sl_mod_at is not None and float(sl_mod_at) > cutoff:
            sl_mod_at = None
            eff_stop = float(orig_stop or 0.0)
        if rewind and manual_at is not None and float(manual_at) > cutoff:
            manual_at = None
            manual_price = None
        if rewind and cancelled_at is not None and float(cancelled_at) > cutoff:
            cancelled_at = None

        cur = dict(o)
        cur["status"] = "OPEN" if immediately_filled else "PENDING"
        cur["pnl"] = 0.0
        cur["rMultiple"] = 0.0
        cur["mfe"] = 0.0
        cur["mae"] = 0.0
        cur["stopLoss"] = eff_stop
        cur["initialStopLoss"] = orig_stop
        if immediately_filled:
            cur["filledAt"] = opened_at
        else:
            cur.pop("filledAt", None)
        cur.pop("exitPrice", None)
        cur.pop("exitReason", None)
        cur.pop("closedAt", None)

        for c in sorted_bars:
            if c.timestamp <= opened_at:
                continue
            if c.timestamp > cutoff:
                break
            if cancelled_at is not None and c.timestamp > float(cancelled_at):
                break
            if manual_at is not None and c.timestamp > float(manual_at):
                break
            bar_stop = float(orig_stop or 0.0) if sl_mod_at is not None and c.timestamp <= float(sl_mod_at) else eff_stop
            cur["stopLoss"] = bar_stop
            cur = step_order(cur, c)
            if cur.get("status") in ("WIN", "LOSS"):
                break

        if cur.get("status") in ("OPEN", "PENDING"):
            cur["stopLoss"] = eff_stop

        if cur.get("status") == "PENDING" and cancelled_at is not None and float(cancelled_at) <= cutoff:
            cur["status"] = "CANCELLED"
            cur["cancelledAt"] = cancelled_at
        elif cur.get("status") == "OPEN" and manual_at is not None and manual_price is not None and float(manual_at) <= cutoff:
            exit_px = float(manual_price) if cur["side"] == "BUY" else float(manual_price) + float(cur.get("spread") or 0.0)
            cur = _close_order(cur, exit_px, float(manual_at), "MANUAL")

        out.append(cur)

    return out


def compute_replay_stats(orders: list[dict[str, Any]], initial_balance: float = 100000.0) -> ReplayStatsModel:
    closed = sorted(
        [o for o in orders if o.get("status") in ("WIN", "LOSS")],
        key=lambda x: float(x.get("closedAt") or x.get("openedAt") or 0.0),
    )
    wins = [o for o in closed if float(o.get("pnl") or 0.0) > 0]
    losses = [o for o in closed if float(o.get("pnl") or 0.0) < 0]

    gross_profit = sum((_d(o.get("pnl") or 0.0) for o in wins), Decimal("0"))
    gross_loss = sum((abs(_d(o.get("pnl") or 0.0)) for o in losses), Decimal("0"))
    net_profit = gross_profit - gross_loss

    equity = _d(initial_balance)
    peak = _d(initial_balance)
    max_dd = Decimal("0")
    max_dd_pct = Decimal("0")
    for o in closed:
        equity += _d(o.get("pnl") or 0.0)
        if equity > peak:
            peak = equity
        dd = peak - equity
        if dd > max_dd:
            max_dd = dd
            max_dd_pct = (dd / peak) * Decimal("100") if peak > 0 else Decimal("0")

    n = len(closed)
    pf = float((gross_profit / gross_loss).quantize(CENTS, rounding=ROUND_HALF_UP)) if gross_loss > 0 else None
    avg_r = float((sum((_d(o.get("rMultiple") or 0.0) for o in closed), Decimal("0")) / _d(n)).quantize(CENTS, rounding=ROUND_HALF_UP)) if n else 0.0

    return ReplayStatsModel(
        trades=n,
        wins=len(wins),
        losses=len(losses),
        winRate=float(((_d(len(wins)) / _d(n)) * Decimal("100")).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)) if n else 0.0,
        grossProfit=round_money(gross_profit),
        grossLoss=round_money(gross_loss),
        profitFactor=pf,
        netProfit=round_money(net_profit),
        expectancy=round_money(net_profit / _d(n)) if n else 0.0,
        avgR=avg_r,
        maxDrawdown=round_money(max_dd),
        maxDrawdownPct=round_money(max_dd_pct),
        realizedBalance=round_money(_d(initial_balance) + net_profit),
    )
