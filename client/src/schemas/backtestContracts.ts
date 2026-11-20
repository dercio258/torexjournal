import { z } from 'zod';
import { KLineData } from 'klinecharts';
import { ReplayOrder } from '../components/kline-replay/types';
export type { ReplayOrder };

// ============================================================================
// 1. CORE ZOD SCHEMAS FOR MARKET EXECUTION, ORDERS, CANDLES & SNAPSHOTS
// ============================================================================

export const OrderSideSchema = z.enum(['BUY', 'SELL']);
export const OrderTypeSchema = z.enum(['MARKET', 'LIMIT', 'STOP']);
export const OrderStatusSchema = z.enum(['PENDING', 'OPEN', 'WIN', 'LOSS', 'CANCELLED', 'CLOSED']);
export const ExitReasonSchema = z.enum(['TP', 'SL', 'MANUAL']);

export const OrderPsychCheckSchema = z
    .object({
        feeling: z.string().max(240).nullable().optional(),
        followingPlan: z.string().max(240).nullable().optional(),
        entryDriver: z.string().max(240).nullable().optional(),
        riskComfort: z.string().max(240).nullable().optional(),
    })
    .passthrough();

export const ReplayOrderSchema = z
    .object({
        id: z.string().min(1),
        symbol: z.string().min(1),
        side: OrderSideSchema,
        orderType: OrderTypeSchema.catch('MARKET'),
        entryPrice: z.number().finite().nonnegative(),
        stopLoss: z.number().finite().nonnegative().catch(0),
        initialStopLoss: z.number().finite().nonnegative().optional(),
        takeProfit: z.number().finite().nonnegative().catch(0),
        lots: z.number().finite().positive().catch(0.01),
        riskAmount: z.number().finite().nonnegative().catch(0),
        rrRatio: z.number().finite().nonnegative().catch(1),
        spread: z.number().finite().nonnegative().optional(),
        commission: z.number().finite().nonnegative().optional(),
        parentOrderId: z.string().max(96).optional(),
        isPartialClose: z.boolean().optional(),
        status: OrderStatusSchema.catch('CLOSED'),
        exitPrice: z.number().finite().optional(),
        exitReason: ExitReasonSchema.optional(),
        pnl: z.number().finite().catch(0),
        rMultiple: z.number().finite().optional(),
        mfe: z.preprocess(
            (v) => (v === null ? null : v === undefined ? undefined : Math.abs(Number(v)) || 0),
            z.number().finite().nonnegative().nullable().optional()
        ),
        mae: z.preprocess(
            (v) => (v === null ? null : v === undefined ? undefined : Math.abs(Number(v)) || 0),
            z.number().finite().nonnegative().nullable().optional()
        ),
        openedAt: z.number().finite(),
        filledAt: z.number().finite().optional(),
        closedAt: z.number().finite().optional(),
        cancelledAt: z.number().finite().optional(),
        manualCloseAt: z.number().finite().optional(),
        manualClosePrice: z.number().finite().optional(),
        slModifiedAt: z.number().finite().optional(),
        isImportedTrade: z.boolean().optional(),
        historicalExitPrice: z.number().finite().optional(),
        historicalClosedAt: z.number().finite().optional(),
        historicalPnl: z.number().finite().optional(),
        historicalExitReason: ExitReasonSchema.optional(),
        journalContent: z.string().max(64000).optional(),
        journalImages: z.array(z.string()).max(25).optional(),
        setup: z.string().max(120).nullable().optional(),
        rating: z.number().min(0).max(5).optional(),
        psychCheck: z.preprocess(
            (v) => {
                if (v === null || v === undefined || v === '') return undefined;
                if (typeof v === 'string') return { feeling: v.trim().slice(0, 240) };
                return v;
            },
            OrderPsychCheckSchema.optional()
        ),
        journalEmotion: z.string().optional(),
        journalSetup: z.string().optional(),
        journalExecution: z.string().optional(),
        journalLesson: z.string().optional(),
        journalRating: z.number().min(0).max(5).optional(),
        journalNotes: z.string().optional(),
    })
    .passthrough();

export const TicketDefaultsSchema = z.object({
    orderSide: OrderSideSchema.catch('BUY'),
    orderType: OrderTypeSchema.catch('MARKET'),
    riskPercent: z.number().finite().min(0.05).max(50).catch(1.0),
    slDistancePct: z.number().finite().min(0.01).max(25).catch(0.3),
    rrTarget: z.number().finite().min(0.1).max(50).catch(2.0),
    spread: z.number().finite().min(0).max(10000).catch(0),
    commission: z.number().finite().min(0).max(10000).catch(0),
});

export const CandleBarSchema = z.object({
    timestamp: z.number().finite().positive(),
    open: z.number().finite().positive(),
    high: z.number().finite().positive(),
    low: z.number().finite().positive(),
    close: z.number().finite().positive(),
    volume: z.number().finite().nonnegative().default(0),
});

export const OrderIntentInputSchema = z.object({
    symbol: z.string().min(1, 'Ativo inválido'),
    side: OrderSideSchema,
    orderType: OrderTypeSchema,
    bid: z.number().finite().positive('Sem cotação ativa no gráfico'),
    requestedPrice: z.number().finite().positive('Preço de entrada deve ser maior que zero').nullable().optional(),
    balance: z.number().finite().positive('Saldo da conta deve ser positivo'),
    riskPercent: z.number().finite().min(0.05, 'Risco mínimo é 0.05%').max(50, 'Risco máximo permitido por operação é 50%'),
    slDistancePct: z.number().finite().min(0.01, 'Distância de Stop mínima é 0.01%').max(25, 'Distância de Stop máxima é 25%'),
    rrTarget: z.number().finite().min(0.1, 'R:R mínimo é 0.1').max(50, 'R:R máximo é 50'),
    spread: z.number().finite().min(0, 'Spread não pode ser negativo').default(0),
    commission: z.number().finite().min(0, 'Comissão não pode ser negativa').default(0),
    decimals: z.number().int().min(0).max(8).default(2),
});

export type OrderIntentInput = z.input<typeof OrderIntentInputSchema>;

// ============================================================================
// 2. INSTRUMENT CONTRACT SPECIFICATION & REALISTIC LOT SIZING
// ============================================================================

export interface InstrumentContractSpec {
    assetClass: 'FOREX' | 'METAL' | 'INDEX' | 'CRYPTO' | 'STOCK';
    contractSize: number;
    unitLabel: string;
    pipSize: number;
}

export function getInstrumentContractSpec(rawSymbol: string, referencePrice: number): InstrumentContractSpec {
    const clean = (rawSymbol || 'XAUUSD').replace(/^.*:/, '').toUpperCase();

    if (clean.includes('XAU') || clean.includes('GOLD')) {
        return { assetClass: 'METAL', contractSize: 100, unitLabel: '100 oz/lote', pipSize: 0.1 };
    }
    if (clean.includes('XAG') || clean.includes('SILVER')) {
        return { assetClass: 'METAL', contractSize: 5000, unitLabel: '5.000 oz/lote', pipSize: 0.01 };
    }
    if (clean.includes('BTC') || clean.includes('ETH') || clean.includes('SOL') || clean.includes('BNB') || clean.includes('XRP')) {
        return {
            assetClass: 'CRYPTO',
            contractSize: 1,
            unitLabel: '1 unid/lote',
            pipSize: referencePrice >= 100 ? 1 : 0.01,
        };
    }
    if (
        clean.includes('NAS') ||
        clean.includes('US100') ||
        clean.includes('US30') ||
        clean.includes('SPX') ||
        clean.includes('US500') ||
        clean.includes('GER40') ||
        clean.includes('DAX') ||
        clean.includes('HK50') ||
        clean.includes('UK100')
    ) {
        return { assetClass: 'INDEX', contractSize: 1, unitLabel: '1 cfd/lote', pipSize: 1 };
    }
    if (/^[A-Z]{6}$/.test(clean)) {
        const isJpy = clean.endsWith('JPY');
        return {
            assetClass: 'FOREX',
            contractSize: 100_000,
            unitLabel: '100k/lote',
            pipSize: isJpy ? 0.01 : 0.0001,
        };
    }
    return {
        assetClass: 'STOCK',
        contractSize: 1,
        unitLabel: '1 ação/lote',
        pipSize: 0.01,
    };
}

/**
 * Calculates realistic broker lot sizing (`0.01` to `500.00` lots) from `$Risk` and `|Entry - SL|`.
 */
export function roundHalfUp(val: number, decimals = 2): number {
    if (!Number.isFinite(val)) return 0;
    const factor = Math.pow(10, Math.max(0, Math.floor(decimals)));
    const sign = val < 0 ? -1 : 1;
    return (sign * Math.round((Math.abs(val) + 1e-11) * factor)) / factor;
}

export function roundMoney(val: number): number {
    return roundHalfUp(val, 2);
}

function fxUsdDivisor(cleanSymbol: string, spec: InstrumentContractSpec, entryPrice: number): number {
    if (spec.assetClass === 'FOREX' && !cleanSymbol.endsWith('USD') && entryPrice > 0) {
        if (cleanSymbol.startsWith('USD')) return entryPrice;
        if (cleanSymbol.endsWith('JPY')) return Math.max(entryPrice, 80);
    }
    return 1;
}

export function calculateInstrumentLots(
    symbol: string,
    entryPrice: number,
    slDistancePrice: number,
    riskAmountUsd: number
): { lots: number; spec: InstrumentContractSpec; pipsAtRisk: number } {
    const spec = getInstrumentContractSpec(symbol, entryPrice);
    const safeSlDist = Math.max(Math.abs(slDistancePrice), 1e-7);
    const pipsAtRisk = roundHalfUp(safeSlDist / Math.max(spec.pipSize, 1e-7), 1);

    if (!Number.isFinite(riskAmountUsd) || riskAmountUsd <= 0 || entryPrice <= 0) {
        return { lots: 0.01, spec, pipsAtRisk };
    }

    const clean = (symbol || '').replace(/^.*:/, '').toUpperCase();
    const divisor = fxUsdDivisor(clean, spec, entryPrice);
    const dollarRiskPerStandardLot = (safeSlDist * spec.contractSize) / divisor;

    const rawLots = dollarRiskPerStandardLot > 0 ? riskAmountUsd / dollarRiskPerStandardLot : 0.01;
    const clampedLots = Math.min(500, Math.max(0.01, roundHalfUp(rawLots, 2)));

    return { lots: clampedLots, spec, pipsAtRisk };
}

export function calculateLotBasedPnl(
    symbol: string,
    side: 'BUY' | 'SELL' | string,
    entryPrice: number,
    exitPrice: number,
    lots: number,
    commission = 0
): number {
    if (!Number.isFinite(lots) || lots <= 0 || !Number.isFinite(entryPrice) || entryPrice <= 0) {
        return roundMoney(-Math.abs(commission || 0));
    }
    const spec = getInstrumentContractSpec(symbol, entryPrice);
    const clean = (symbol || '').replace(/^.*:/, '').toUpperCase();
    const divisor = fxUsdDivisor(clean, spec, entryPrice);
    const s = String(side).toUpperCase();
    const delta = s === 'BUY' ? exitPrice - entryPrice : entryPrice - exitPrice;
    const grossUsd = (delta * lots * spec.contractSize) / divisor;
    return roundMoney(grossUsd - Math.max(0, commission || 0));
}

export function isCrossedImmediateOrder(
    side: 'BUY' | 'SELL' | string,
    orderType: 'MARKET' | 'LIMIT' | 'STOP' | string,
    requestedPrice: number,
    bid: number,
    spread = 0
): boolean {
    const otype = String(orderType).toUpperCase();
    if (otype === 'MARKET') return true;
    const s = String(side).toUpperCase();
    const ask = bid + Math.max(0, spread || 0);
    if (otype === 'LIMIT') {
        return (s === 'BUY' && requestedPrice >= ask) || (s === 'SELL' && requestedPrice <= bid);
    }
    if (otype === 'STOP') {
        return (s === 'BUY' && requestedPrice <= ask) || (s === 'SELL' && requestedPrice >= bid);
    }
    return false;
}

// ============================================================================
// 3. LIVE MARKET EXECUTION PREVIEW & VALIDATION
// ============================================================================

export interface MarketExecutionPreview {
    valid: boolean;
    validationError: string | null;
    executionHint: string | null;
    immediateFillExpected: boolean;
    bid: number;
    ask: number;
    spreadPrice: number;
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    slDistancePrice: number;
    tpDistancePrice: number;
    pipsAtRisk: number;
    lots: number;
    unitLabel: string;
    riskAmount: number;
    grossRewardAtTp: number;
    netRewardAtTp: number;
    netLossAtSl: number;
    effectiveRr: number;
}

export function buildMarketExecutionPreview(rawInput: OrderIntentInput): MarketExecutionPreview {
    const parsed = OrderIntentInputSchema.safeParse(rawInput);
    const decimals = rawInput.decimals ?? 2;
    const round = (v: number) => roundHalfUp(v, decimals);

    const safeBid = Number.isFinite(rawInput.bid) && rawInput.bid > 0 ? rawInput.bid : 0;
    const safeSpread = Math.max(0, Number(rawInput.spread) || 0);
    const safeAsk = round(safeBid + safeSpread);

    if (!parsed.success) {
        const firstIssue = parsed.error.issues[0]?.message || 'Parâmetros de ordem inválidos';
        return {
            valid: false,
            validationError: firstIssue,
            executionHint: null,
            immediateFillExpected: false,
            bid: round(safeBid),
            ask: safeAsk,
            spreadPrice: safeSpread,
            entryPrice: round(safeBid),
            stopLoss: 0,
            takeProfit: 0,
            slDistancePrice: 0,
            tpDistancePrice: 0,
            pipsAtRisk: 0,
            lots: 0.01,
            unitLabel: 'lote',
            riskAmount: 0,
            grossRewardAtTp: 0,
            netRewardAtTp: 0,
            netLossAtSl: 0,
            effectiveRr: 0,
        };
    }

    const d = parsed.data;
    const marketFillPrice = d.side === 'BUY' ? safeAsk : round(d.bid);
    const rawRequested = d.requestedPrice && d.requestedPrice > 0 ? round(d.requestedPrice) : marketFillPrice;
    const immediateFillExpected = isCrossedImmediateOrder(d.side, d.orderType, rawRequested, d.bid, safeSpread);
    const entryPrice = immediateFillExpected ? marketFillPrice : rawRequested;

    const slDistancePrice = Math.max(entryPrice * (d.slDistancePct / 100), Math.pow(10, -decimals));
    const tpDistancePrice = slDistancePrice * d.rrTarget;
    const stopLoss = round(d.side === 'BUY' ? entryPrice - slDistancePrice : entryPrice + slDistancePrice);
    const takeProfit = round(d.side === 'BUY' ? entryPrice + tpDistancePrice : entryPrice - tpDistancePrice);

    const riskAmount = roundMoney((d.balance * d.riskPercent) / 100);
    const { lots, spec, pipsAtRisk } = calculateInstrumentLots(d.symbol, entryPrice, slDistancePrice, riskAmount);

    const grossRewardAtTp = calculateLotBasedPnl(d.symbol, d.side, entryPrice, takeProfit, lots, 0);
    const netRewardAtTp = roundMoney(grossRewardAtTp - d.commission);
    const slLossAbs = Math.abs(calculateLotBasedPnl(d.symbol, d.side, entryPrice, stopLoss, lots, 0));
    const netLossAtSl = roundMoney(slLossAbs + d.commission);
    const effectiveRr = netLossAtSl > 0 ? roundHalfUp(netRewardAtTp / netLossAtSl, 2) : d.rrTarget;

    let executionHint: string | null = null;
    let validationError: string | null = null;

    if (stopLoss <= 0 || takeProfit <= 0) {
        validationError = 'Níveis de Stop Loss ou Take Profit resultaram em preço inválido (<= 0).';
    } else if (d.orderType === 'LIMIT') {
        if (immediateFillExpected) {
            const cond =
                d.side === 'BUY'
                    ? `BUY LIMIT ≥ ASK (${safeAsk.toFixed(decimals)})`
                    : `SELL LIMIT ≤ BID (${round(d.bid).toFixed(decimals)})`;
            executionHint = `${cond}: preencherá imediatamente a mercado (${entryPrice.toFixed(decimals)}).`;
        } else {
            executionHint =
                d.side === 'BUY'
                    ? `Aguardará recuo do ASK até ≤ ${entryPrice.toFixed(decimals)}`
                    : `Aguardará alta do BID até ≥ ${entryPrice.toFixed(decimals)}`;
        }
    } else if (d.orderType === 'STOP') {
        if (immediateFillExpected) {
            const cond =
                d.side === 'BUY'
                    ? `BUY STOP ≤ ASK (${safeAsk.toFixed(decimals)})`
                    : `SELL STOP ≥ BID (${round(d.bid).toFixed(decimals)})`;
            executionHint = `${cond}: gatilho já rompido, preencherá imediatamente (${entryPrice.toFixed(decimals)}).`;
        } else {
            executionHint =
                d.side === 'BUY'
                    ? `Rompimento: ativará quando ASK subir até ≥ ${entryPrice.toFixed(decimals)}`
                    : `Rompimento: ativará quando BID cair até ≤ ${entryPrice.toFixed(decimals)}`;
        }
    } else {
        executionHint =
            d.side === 'BUY'
                ? `Execução imediata na cotação ASK (${safeAsk.toFixed(decimals)})`
                : `Execução imediata na cotação BID (${round(d.bid).toFixed(decimals)})`;
    }

    return {
        valid: validationError === null,
        validationError,
        executionHint,
        immediateFillExpected,
        bid: round(d.bid),
        ask: safeAsk,
        spreadPrice: safeSpread,
        entryPrice,
        stopLoss,
        takeProfit,
        slDistancePrice: round(slDistancePrice),
        tpDistancePrice: round(tpDistancePrice),
        pipsAtRisk,
        lots,
        unitLabel: spec.unitLabel,
        riskAmount,
        grossRewardAtTp,
        netRewardAtTp,
        netLossAtSl,
        effectiveRr,
    };
}

// ============================================================================
// 4. O(1) DETERMINISTIC SIGNATURES & SANITIZERS FOR ZUSTAND + IDB + REDIS
// ============================================================================

/**
 * Produces a compact structural signature of all orders in O(N) without JSON.stringify overhead.
 * Ensures Zustand `recordMove` ALWAYS detects fills (`PENDING -> OPEN`), exits (`OPEN -> WIN/LOSS`),
 * SL/TP drags, Break-Even, and Partial Closes even when `orders.length` does not change.
 */
export function computeOrdersSignature(orders: ReplayOrder[] | undefined | null): string {
    if (!Array.isArray(orders) || orders.length === 0) return 'empty';
    let out = `${orders.length}#`;
    for (let i = 0; i < orders.length; i++) {
        const o = orders[i];
        if (!o) continue;
        out += `${o.id}:${o.status}:${o.orderType}:${o.entryPrice}:${o.stopLoss}:${o.takeProfit}:${o.lots}:${o.pnl}:${o.filledAt ?? ''}:${o.closedAt ?? ''}:${o.rating ?? ''}:${o.setup ?? ''}:${o.psychCheck?.followingPlan ?? ''}:${o.psychCheck?.feeling ?? ''}:${o.journalContent ?? ''}|`;
    }
    return out;
}

export function sanitizeValidatedOrders(rawOrders: unknown): ReplayOrder[] {
    if (!Array.isArray(rawOrders)) return [];
    const valid: ReplayOrder[] = [];
    for (const item of rawOrders) {
        const res = ReplayOrderSchema.safeParse(item);
        if (res.success) {
            valid.push(res.data as ReplayOrder);
        } else if (item && typeof item === 'object' && typeof (item as any).id === 'string') {
            valid.push(item as ReplayOrder);
        }
    }
    return valid;
}

export function sanitizeValidCandles(rawCandles: unknown): KLineData[] {
    if (!Array.isArray(rawCandles)) return [];
    const valid: KLineData[] = [];
    for (const c of rawCandles) {
        const res = CandleBarSchema.safeParse(c);
        if (res.success && res.data.high >= res.data.low) {
            valid.push(res.data);
        }
    }
    return valid;
}
