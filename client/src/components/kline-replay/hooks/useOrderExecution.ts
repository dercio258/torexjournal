import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chart, KLineData, LineType } from 'klinecharts';
import { SymbolInfo, Period } from '@klinecharts/pro';
import { CustomKLineDatafeed, FeedStats, periodToMs } from '../../../services/klineDatafeed';
import { ReplayOrder } from '../types';
import { createOrder, recomputeOrders, computeStats } from '../engine';
import {
    buildMarketExecutionPreview,
    calculateInstrumentLots,
    calculateLotBasedPnl,
    isCrossedImmediateOrder,
} from '../../../schemas/backtestContracts';
import { QuantMathEngine } from '../indicators/quantMathEngine';
import { TicketDefaultsState } from '../../../services/backtestSessionSnapshot';
import { RightDrawerMode } from '../layers/RightSidePanelLayer';
import { ChartLegendOverlayRef } from '../layers/ChartLegendOverlayLayer';
import { OverlayPointCoord } from '../layers/DrawingStyleToolbarLayer';
import { useChartTheme } from '../../../hooks/useChartTheme';
import {
    applyOrderQuickTagPatch,
    applyPreviewEntryDrag,
    applyPreviewSlDrag,
    applyPreviewTpDrag,
    OrderQuickTagPatch,
} from '../orderPreviewMath';
import { estimateBarIntervalMs, resolveOverlayPointsAgainstCandles } from './drawingOverlayUtils';

export interface UseOrderExecutionParams {
    chartRef: React.MutableRefObject<Chart | null>;
    auxChartRefs: React.MutableRefObject<(Chart | null)[]>;
    auxOrderOverlayIdsRef: React.MutableRefObject<[string[], string[], string[]]>;
    datafeedRef: React.MutableRefObject<CustomKLineDatafeed | null>;
    legendOverlayRef: React.MutableRefObject<ChartLegendOverlayRef | null>;
    isHydratingCanvasRef: React.MutableRefObject<boolean>;
    isRestoringSnapshotRef: React.MutableRefObject<boolean>;
    canvasHydratedCount: number;
    auxDataSyncTick?: number;
    currentSymbol: SymbolInfo;
    currentPeriod: Period;
    latestBar: KLineData | null;
    setLatestBar: React.Dispatch<React.SetStateAction<KLineData | null>>;
    auxPaneCount: number;
    auxPeriods: [Period, Period, Period];
    syncEnabled: boolean;
    rightDrawer: RightDrawerMode;
    setRightDrawer: React.Dispatch<React.SetStateAction<RightDrawerMode>>;
    ct: ReturnType<typeof useChartTheme>;
    isEn: boolean;
    initialBalance: number;
    initialOrders: ReplayOrder[];
    initialOrderSide: 'BUY' | 'SELL';
    initialOrderType: 'MARKET' | 'LIMIT' | 'STOP';
    initialRiskPercent: number;
    initialSlDistancePct: number;
    initialRrTarget: number;
    initialSpread: number;
    initialCommission: number;
}

export function useOrderExecution({
    chartRef,
    auxChartRefs,
    auxOrderOverlayIdsRef,
    datafeedRef,
    legendOverlayRef,
    isHydratingCanvasRef,
    isRestoringSnapshotRef,
    canvasHydratedCount,
    auxDataSyncTick = 0,
    currentSymbol,
    currentPeriod,
    latestBar,
    setLatestBar,
    auxPaneCount,
    auxPeriods,
    syncEnabled,
    rightDrawer,
    setRightDrawer,
    ct,
    isEn,
    initialBalance,
    initialOrders,
    initialOrderSide,
    initialOrderType,
    initialRiskPercent,
    initialSlDistancePct,
    initialRrTarget,
    initialSpread,
    initialCommission,
}: UseOrderExecutionParams) {
    const orderOverlayIdsRef = useRef<string[]>([]);
    const lastCutoffRef = useRef<{ key: string; ts: number; canonicalTs?: number } | null>(null);

    const [orderSide, setOrderSide] = useState<'BUY' | 'SELL'>(initialOrderSide);
    const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT' | 'STOP'>(initialOrderType);
    const [limitEntryPrice, setLimitEntryPrice] = useState<string>('');
    const [riskPercent, setRiskPercent] = useState<number>(initialRiskPercent);
    const [slDistancePct, setSlDistancePct] = useState<number>(initialSlDistancePct);
    const [rrTarget, setRrTarget] = useState<number>(initialRrTarget);
    const [spread, setSpread] = useState<number>(initialSpread);
    const [commission, setCommission] = useState<number>(initialCommission);
    const [showChartOrderPreview, setShowChartOrderPreview] = useState<boolean>(true);

    const [orders, setOrders] = useState<ReplayOrder[]>(initialOrders);
    const [quickTagOrderId, setQuickTagOrderId] = useState<string | null>(null);
    const prevOrderStatusMapRef = useRef<Map<string, ReplayOrder['status']>>(new Map());

    const stats = useMemo(() => computeStats(orders, initialBalance), [orders, initialBalance]);
    const quantMetrics = useMemo(() => QuantMathEngine.analyzeSession(orders, initialBalance), [orders, initialBalance]);
    const openPositions = useMemo(() => orders.filter((o) => o.status === 'OPEN'), [orders]);
    const floatingPnl = useMemo(
        () => Number(openPositions.reduce((s, o) => s + o.pnl, 0).toFixed(2)),
        [openPositions]
    );
    const simBalance = stats.realizedBalance;
    const netProfit = Number((stats.netProfit + floatingPnl).toFixed(2));

    // Detect OPEN -> WIN | LOSS transitions and new partial close legs during live replay to open quick-tagging
    useEffect(() => {
        const nextMap = new Map<string, ReplayOrder['status']>();
        for (const o of orders) {
            nextMap.set(o.id, o.status);
        }

        if (isHydratingCanvasRef.current || isRestoringSnapshotRef.current) {
            prevOrderStatusMapRef.current = nextMap;
            return;
        }

        const prevMap = prevOrderStatusMapRef.current;
        const newlyClosed = orders.find((o) => {
            const prevStatus = prevMap.get(o.id);
            const isClosed = o.status === 'WIN' || o.status === 'LOSS';
            if (!isClosed) return false;
            if (prevStatus === 'OPEN') return true;
            if (prevStatus === undefined && Boolean(o.isPartialClose)) return true;
            return false;
        });

        prevOrderStatusMapRef.current = nextMap;
        if (newlyClosed) {
            setQuickTagOrderId(newlyClosed.id);
        }
    }, [orders, canvasHydratedCount, isHydratingCanvasRef, isRestoringSnapshotRef]);

    const quickTagOrder = useMemo(
        () => (quickTagOrderId ? orders.find((o) => o.id === quickTagOrderId) || null : null),
        [quickTagOrderId, orders]
    );

    const handleOpenQuickTagForOrder = useCallback((trade: ReplayOrder) => {
        setQuickTagOrderId(trade.id);
    }, []);

    const handleDismissQuickTag = useCallback(() => {
        setQuickTagOrderId(null);
    }, []);

    const handleUpdateOrderQuickTag = useCallback((orderId: string, patch: OrderQuickTagPatch) => {
        setOrders((prev) => prev.map((o) => (o.id === orderId ? applyOrderQuickTagPatch(o, patch) : o)));
        setQuickTagOrderId(null);
    }, []);

    const recomputeOrdersAtCutoff = useCallback(
        (symbolTicker: string, periodText: string, cutoffTs: number, rewind: boolean) => {
            const df = datafeedRef.current;
            if (!df) return;
            lastCutoffRef.current = {
                key: `${symbolTicker}:${periodText}`,
                ts: cutoffTs,
                canonicalTs: df.getReplayTimestamp() ?? cutoffTs,
            };
            const candles = df.isReplayActive() ? df.getVisibleReplayCandles() : df.getFullHistory();
            setOrders((cur) =>
                cur.length === 0
                    ? cur
                    : recomputeOrders(cur, {
                          symbol: symbolTicker,
                          candles,
                          uptoTs: cutoffTs,
                          rewind,
                      })
            );
        },
        [datafeedRef]
    );

    const onFeedCandle = useCallback(
        (candle: KLineData, feedStats: FeedStats) => {
            setLatestBar(candle);
            legendOverlayRef.current?.updateLegend(candle, null, null);
            const df = datafeedRef.current;
            if (!df || !feedStats.ticker) return;

            const key = `${feedStats.ticker}:${feedStats.periodText}`;
            const prev = lastCutoffRef.current;
            const canonicalTs = feedStats.canonicalTimestamp ?? candle.timestamp;
            const isPureTfSwitch =
                Boolean(prev) &&
                prev!.key !== key &&
                prev!.key.startsWith(`${feedStats.ticker}:`) &&
                prev!.canonicalTs !== undefined &&
                canonicalTs === prev!.canonicalTs;

            const rewind = !!prev && prev.key === key && candle.timestamp < prev.ts;
            const prevUptoTs = !rewind && prev && prev.key === key ? prev.ts : undefined;
            lastCutoffRef.current = { key, ts: candle.timestamp, canonicalTs };

            if (isPureTfSwitch) {
                return;
            }

            setOrders((cur) => {
                if (cur.length === 0) return cur;
                if (!rewind && !cur.some((o) => o.status === 'OPEN' || o.status === 'PENDING')) return cur;
                const candles = df.isReplayActive() ? df.getVisibleReplayCandles() : df.getFullHistory();
                return recomputeOrders(cur, {
                    symbol: feedStats.ticker,
                    candles,
                    uptoTs: candle.timestamp,
                    rewind,
                    prevUptoTs,
                });
            });
        },
        [datafeedRef, legendOverlayRef, setLatestBar]
    );

    const handleQuickLimitOrderAtPrice = useCallback(
        (priceStr: string) => {
            setOrderType('LIMIT');
            setLimitEntryPrice(priceStr);
            setRightDrawer('trade');
        },
        [setRightDrawer]
    );

    const handleSendPositionToOrderTicket = useCallback(
        (side: 'BUY' | 'SELL', entry: number, tp: number, sl: number) => {
            const dec = currentSymbol.pricePrecision ?? (entry < 10 ? 5 : 2);
            setOrderSide(side);
            setOrderType('LIMIT');
            setLimitEntryPrice(entry.toFixed(dec));
            if (entry > 0) {
                const slDistPct = Math.max(0.01, Number(((Math.abs(entry - sl) / entry) * 100).toFixed(3)));
                const riskAbs = Math.max(0.000001, Math.abs(entry - sl));
                const rewardAbs = Math.abs(tp - entry);
                const rr = Math.max(0.2, Number((rewardAbs / riskAbs).toFixed(2)));
                setSlDistancePct(slDistPct);
                setRrTarget(rr);
            }
            setRightDrawer('trade');
        },
        [currentSymbol.pricePrecision, setRightDrawer]
    );

    const executeOrderWithSide = useCallback(
        (forcedSide?: 'BUY' | 'SELL') => {
            if (!latestBar) return;
            const side = forcedSide || orderSide;
            const bid = latestBar.close;
            const safeSpread = Math.max(0, spread || 0);
            const price = orderType === 'MARKET' ? bid : parseFloat(limitEntryPrice) || bid;
            const decimals = currentSymbol.pricePrecision ?? (price < 10 ? 5 : 2);
            const realized = computeStats(orders, initialBalance).realizedBalance;
            const riskAmount = Number(((realized * riskPercent) / 100).toFixed(2));
            const isImmediate =
                orderType === 'MARKET' || isCrossedImmediateOrder(side, orderType, price, bid, safeSpread);
            const effectiveEntry = isImmediate ? (side === 'BUY' ? bid + safeSpread : bid) : price;
            const slDistancePrice = effectiveEntry * (slDistancePct / 100);
            const { lots: computedLots } = calculateInstrumentLots(
                currentSymbol.ticker,
                effectiveEntry,
                slDistancePrice,
                riskAmount
            );

            const order = createOrder(
                {
                    symbol: currentSymbol.ticker,
                    side,
                    orderType,
                    price,
                    referenceBid: bid,
                    slDistance: slDistancePrice,
                    rrRatio: rrTarget,
                    riskAmount,
                    lots: computedLots,
                    spread: safeSpread,
                    commission: Math.max(0, commission || 0),
                    openedAt: latestBar.timestamp,
                    decimals,
                },
                `#${Math.floor(100000 + Math.random() * 900000)}`
            );

            setOrders((prev) => [order, ...prev]);
        },
        [
            latestBar,
            orderType,
            limitEntryPrice,
            currentSymbol,
            orders,
            initialBalance,
            riskPercent,
            slDistancePct,
            rrTarget,
            orderSide,
            spread,
            commission,
        ]
    );

    const handleExecuteOrder = useCallback(() => {
        executeOrderWithSide();
    }, [executeOrderWithSide]);

    const handleMoveOrderToBreakEven = useCallback(
        (id: string) => {
            const df = datafeedRef.current;
            const bar = df?.getReplayState().currentCandle;
            const uptoTs = bar?.timestamp ?? latestBar?.timestamp ?? Date.now();
            const ticker = df?.getContext().ticker || currentSymbol.ticker;

            setOrders((prev) => {
                const mapped = prev.map((o) => {
                    if (o.id !== id || o.status !== 'OPEN') return o;
                    return {
                        ...o,
                        stopLoss: o.entryPrice,
                        initialStopLoss: o.initialStopLoss ?? o.stopLoss,
                        slModifiedAt: uptoTs,
                    };
                });
                return df
                    ? recomputeOrders(mapped, {
                          symbol: ticker,
                          candles: df.getFullHistory(),
                          uptoTs,
                          rewind: false,
                      })
                    : mapped;
            });
        },
        [datafeedRef, latestBar?.timestamp, currentSymbol.ticker]
    );

    const handlePartialCloseOrder = useCallback(
        (id: string) => {
            const df = datafeedRef.current;
            const bar = df?.getReplayState().currentCandle || latestBar;
            if (!bar) return;
            const ticker = df?.getContext().ticker || currentSymbol.ticker;
            const dec = currentSymbol.pricePrecision ?? 2;

            setOrders((prev) => {
                const nextList: ReplayOrder[] = [];
                for (const o of prev) {
                    if (o.id !== id || o.status !== 'OPEN') {
                        nextList.push(o);
                        continue;
                    }
                    const halfRisk = Number((o.riskAmount * 0.5).toFixed(2));
                    const remRisk = Number((o.riskAmount - halfRisk).toFixed(2));
                    const halfLots = Math.max(0.01, Number((o.lots * 0.5).toFixed(2)));
                    const remLots = Math.max(0.01, Number((o.lots - halfLots).toFixed(2)));
                    const halfComm = Number(((o.commission || 0) * 0.5).toFixed(2));
                    const remComm = Number(((o.commission || 0) - halfComm).toFixed(2));

                    const rawMark = o.symbol === ticker ? bar.close : o.exitPrice ?? bar.close;
                    const exitPrice = Number((o.side === 'BUY' ? rawMark : rawMark + (o.spread || 0)).toFixed(dec));
                    const baseSl = o.initialStopLoss ?? o.stopLoss;
                    const dist = Math.max(Math.abs(o.entryPrice - baseSl), 1e-6);
                    const rMult = Number(
                        ((o.side === 'BUY' ? exitPrice - o.entryPrice : o.entryPrice - exitPrice) / dist).toFixed(2)
                    );
                    const realizedHalfPnl = calculateLotBasedPnl(
                        o.symbol,
                        o.side,
                        o.entryPrice,
                        exitPrice,
                        halfLots,
                        halfComm
                    );

                    const partialLeg: ReplayOrder = {
                        ...o,
                        id: `${o.id}-P`,
                        parentOrderId: o.id,
                        isPartialClose: true,
                        lots: halfLots,
                        riskAmount: halfRisk,
                        commission: halfComm,
                        status: realizedHalfPnl >= 0 ? 'WIN' : 'LOSS',
                        exitPrice,
                        exitReason: 'MANUAL',
                        pnl: realizedHalfPnl,
                        rMultiple: rMult,
                        closedAt: bar.timestamp,
                    };

                    const remainingOpen: ReplayOrder = {
                        ...o,
                        lots: remLots,
                        riskAmount: remRisk,
                        commission: remComm,
                        pnl: Number((o.pnl * 0.5).toFixed(2)),
                    };

                    nextList.push(remainingOpen, partialLeg);
                }

                return df
                    ? recomputeOrders(nextList, {
                          symbol: ticker,
                          candles: df.getFullHistory(),
                          uptoTs: bar.timestamp,
                          rewind: false,
                      })
                    : nextList;
            });
        },
        [datafeedRef, latestBar, currentSymbol.ticker, currentSymbol.pricePrecision]
    );

    const handleCloseOrCancelOrder = useCallback(
        (id: string) => {
            const df = datafeedRef.current;
            const bar = df?.getReplayState().currentCandle;
            if (!df || !bar) return;
            const { ticker } = df.getContext();

            setOrders((prev) =>
                recomputeOrders(
                    prev.map((o) => {
                        if (o.id !== id) return o;
                        if (o.status === 'PENDING') return { ...o, cancelledAt: bar.timestamp };
                        if (o.status !== 'OPEN') return o;
                        if (o.symbol !== ticker) {
                            return { ...o, status: o.pnl >= 0 ? 'WIN' : 'LOSS', exitReason: 'MANUAL', closedAt: bar.timestamp };
                        }
                        return { ...o, manualCloseAt: bar.timestamp, manualClosePrice: bar.close };
                    }),
                    { symbol: ticker, candles: df.getFullHistory(), uptoTs: bar.timestamp, rewind: false }
                )
            );
        },
        [datafeedRef]
    );

    const ordersExecutionSignature = useMemo(
        () =>
            orders
                .filter((o) => o.symbol.toUpperCase() === currentSymbol.ticker.toUpperCase())
                .map(
                    (o) =>
                        `${o.id}:${o.status}:${o.entryPrice}:${o.stopLoss}:${o.takeProfit}:${o.filledAt ?? o.openedAt}:${o.closedAt ?? ''}:${o.exitPrice ?? ''}:${o.pnl}:${o.rMultiple ?? ''}`
                )
                .join('|'),
        [orders, currentSymbol.ticker]
    );

    // Render Ask spread line, draggable Order Preview (Entry/SL/TP), active/pending order lines & trade execution markers
    useEffect(() => {
        const chart = chartRef.current;
        if (!chart) return;

        orderOverlayIdsRef.current.forEach((id) => {
            try {
                chart.removeOverlay(id);
            } catch (_) {}
        });
        orderOverlayIdsRef.current = [];

        for (let i = 0; i < 3; i++) {
            const auxChart = auxChartRefs.current[i];
            const prevAuxIds = auxOrderOverlayIdsRef.current[i];
            if (auxChart && prevAuxIds.length > 0) {
                prevAuxIds.forEach((id) => {
                    try {
                        auxChart.removeOverlay(id);
                    } catch (_) {}
                });
            }
            auxOrderOverlayIdsRef.current[i] = [];
        }

        const dec = currentSymbol.pricePrecision ?? 2;
        const roundPrice = (v: number) => Number(v.toFixed(dec));
        const symbolUpper = currentSymbol.ticker.toUpperCase();
        const symbolOrders = orders.filter((o) => o.symbol.toUpperCase() === symbolUpper);

        // 0) Live ASK Spread Line (`bid + spread`) + Interactive Draggable Draft Order Preview Lines
        if (latestBar && Number.isFinite(latestBar.close) && latestBar.close > 0) {
            if (spread > 0) {
                const askPrice = roundPrice(latestBar.close + spread);
                if (askPrice > 0) {
                    const askLineId = chart.createOverlay({
                        name: 'priceLine',
                        points: [{ value: askPrice }],
                        lock: true,
                        styles: {
                            line: {
                                color: '#38bdf8',
                                size: 1,
                                style: LineType.Dashed,
                                dashedValue: [2, 3],
                            },
                        },
                    } as any);
                    if (typeof askLineId === 'string') orderOverlayIdsRef.current.push(askLineId);
                }
            }

            if (rightDrawer === 'trade' && showChartOrderPreview) {
                const parsedLimit = parseFloat(limitEntryPrice);
                const draft = buildMarketExecutionPreview({
                    symbol: currentSymbol.ticker,
                    side: orderSide,
                    orderType,
                    bid: latestBar.close,
                    requestedPrice: Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined,
                    balance: simBalance,
                    riskPercent,
                    slDistancePct,
                    rrTarget,
                    spread,
                    commission,
                    decimals: dec,
                });

                if (draft.valid && draft.entryPrice > 0) {
                    const draftEntryId = chart.createOverlay({
                        name: 'replayOrderPreviewLine',
                        points: [{ value: draft.entryPrice }],
                        lock: false,
                        extendData: {
                            role: 'ENTRY',
                            label: isEn ? 'ENTRY' : 'ENTRADA',
                            sublabel: `${draft.lots.toFixed(2)}L`,
                            color: orderSide === 'BUY' ? '#0ea5e9' : '#f43f5e',
                            decimals: dec,
                            price: draft.entryPrice,
                        },
                        onPressedMoveEnd: (event: any) => {
                            const ovId = event?.overlay?.id;
                            const nextVal = event?.overlay?.points?.[0]?.value;
                            if (typeof nextVal !== 'number' || !Number.isFinite(nextVal) || nextVal <= 0) {
                                if (ovId) chart.overrideOverlay({ id: ovId, points: [{ value: draft.entryPrice }] });
                                return false;
                            }
                            const res = applyPreviewEntryDrag({
                                nextEntryPrice: roundPrice(nextVal),
                                orderType,
                                orderSide,
                                referencePrice: latestBar.close,
                                slDistancePct,
                                rrTarget,
                            });
                            if (res.valid && res.limitEntryPrice && res.orderType) {
                                setOrderType(res.orderType);
                                setLimitEntryPrice(res.limitEntryPrice.toFixed(dec));
                                return true;
                            }
                            if (ovId) chart.overrideOverlay({ id: ovId, points: [{ value: draft.entryPrice }] });
                            return false;
                        },
                    } as any);
                    if (typeof draftEntryId === 'string') orderOverlayIdsRef.current.push(draftEntryId);

                    if (draft.stopLoss > 0) {
                        const draftSlId = chart.createOverlay({
                            name: 'replayOrderPreviewLine',
                            points: [{ value: draft.stopLoss }],
                            lock: false,
                            extendData: {
                                role: 'SL',
                                label: 'SL',
                                sublabel: `-$${draft.netLossAtSl.toFixed(0)}`,
                                color: '#ef4444',
                                decimals: dec,
                                price: draft.stopLoss,
                            },
                            onPressedMoveEnd: (event: any) => {
                                const ovId = event?.overlay?.id;
                                const nextVal = event?.overlay?.points?.[0]?.value;
                                if (typeof nextVal !== 'number' || !Number.isFinite(nextVal) || nextVal <= 0) {
                                    if (ovId) chart.overrideOverlay({ id: ovId, points: [{ value: draft.stopLoss }] });
                                    return false;
                                }
                                const res = applyPreviewSlDrag({
                                    nextSlPrice: roundPrice(nextVal),
                                    entryPrice: draft.entryPrice,
                                    orderSide,
                                });
                                if (res.valid && res.slDistancePct !== undefined) {
                                    setSlDistancePct(res.slDistancePct);
                                    return true;
                                }
                                if (ovId) chart.overrideOverlay({ id: ovId, points: [{ value: draft.stopLoss }] });
                                return false;
                            },
                        } as any);
                        if (typeof draftSlId === 'string') orderOverlayIdsRef.current.push(draftSlId);
                    }

                    if (draft.takeProfit > 0) {
                        const draftTpId = chart.createOverlay({
                            name: 'replayOrderPreviewLine',
                            points: [{ value: draft.takeProfit }],
                            lock: false,
                            extendData: {
                                role: 'TP',
                                label: 'TP',
                                sublabel: `+$${draft.netRewardAtTp.toFixed(0)} (${draft.effectiveRr}R)`,
                                color: '#10b981',
                                decimals: dec,
                                price: draft.takeProfit,
                            },
                            onPressedMoveEnd: (event: any) => {
                                const ovId = event?.overlay?.id;
                                const nextVal = event?.overlay?.points?.[0]?.value;
                                if (typeof nextVal !== 'number' || !Number.isFinite(nextVal) || nextVal <= 0) {
                                    if (ovId) chart.overrideOverlay({ id: ovId, points: [{ value: draft.takeProfit }] });
                                    return false;
                                }
                                const res = applyPreviewTpDrag({
                                    nextTpPrice: roundPrice(nextVal),
                                    entryPrice: draft.entryPrice,
                                    stopLoss: draft.stopLoss,
                                    orderSide,
                                });
                                if (res.valid && res.rrTarget !== undefined) {
                                    setRrTarget(res.rrTarget);
                                    return true;
                                }
                                if (ovId) chart.overrideOverlay({ id: ovId, points: [{ value: draft.takeProfit }] });
                                return false;
                            },
                        } as any);
                        if (typeof draftTpId === 'string') orderOverlayIdsRef.current.push(draftTpId);
                    }
                }
            }
        }

        // 1) Interactive horizontal price lines for currently OPEN or PENDING orders
        const activeOrPending = symbolOrders.filter((o) => o.status === 'OPEN' || o.status === 'PENDING');

        activeOrPending.forEach((ord) => {
            if (ord.entryPrice > 0) {
                const entryId = chart.createOverlay({
                    name: 'priceLine',
                    points: [{ value: ord.entryPrice }],
                    lock: ord.status !== 'PENDING',
                    styles: {
                        line: {
                            color: ct.label,
                            size: 1.5,
                            style: LineType.Solid,
                        },
                    },
                    onPressedMoveEnd: (event: any) => {
                        if (ord.status !== 'PENDING') return false;
                        const nextVal = event?.overlay?.points?.[0]?.value;
                        if (typeof nextVal !== 'number' || !Number.isFinite(nextVal) || nextVal <= 0) return false;
                        const nextEntry = roundPrice(nextVal);
                        const delta = nextEntry - ord.entryPrice;
                        const df = datafeedRef.current;
                        const uptoTs = df?.getReplayState().currentCandle?.timestamp ?? Date.now();
                        setOrders((prev) => {
                            const mapped = prev.map((o) =>
                                o.id === ord.id && o.status === 'PENDING'
                                    ? {
                                          ...o,
                                          entryPrice: nextEntry,
                                          stopLoss: o.stopLoss > 0 ? roundPrice(o.stopLoss + delta) : 0,
                                          initialStopLoss:
                                              (o.initialStopLoss ?? o.stopLoss) > 0
                                                  ? roundPrice((o.initialStopLoss ?? o.stopLoss) + delta)
                                                  : 0,
                                          takeProfit: o.takeProfit > 0 ? roundPrice(o.takeProfit + delta) : 0,
                                      }
                                    : o
                            );
                            return df
                                ? recomputeOrders(mapped, {
                                      symbol: currentSymbol.ticker,
                                      candles: df.getFullHistory(),
                                      uptoTs,
                                      rewind: false,
                                  })
                                : mapped;
                        });
                        return true;
                    },
                } as any);
                if (typeof entryId === 'string') orderOverlayIdsRef.current.push(entryId);
            }

            if (ord.stopLoss > 0) {
                const slId = chart.createOverlay({
                    name: 'priceLine',
                    points: [{ value: ord.stopLoss }],
                    lock: false,
                    styles: {
                        line: {
                            color: ct.neg,
                            size: 1.25,
                            style: LineType.Dashed,
                            dashedValue: [4, 4],
                        },
                    },
                    onPressedMoveEnd: (event: any) => {
                        const nextVal = event?.overlay?.points?.[0]?.value;
                        if (typeof nextVal !== 'number' || !Number.isFinite(nextVal) || nextVal <= 0) return false;
                        const nextSl = roundPrice(nextVal);
                        const df = datafeedRef.current;
                        const uptoTs = df?.getReplayState().currentCandle?.timestamp ?? Date.now();
                        setOrders((prev) => {
                            const mapped = prev.map((o) =>
                                o.id === ord.id
                                    ? {
                                          ...o,
                                          stopLoss: nextSl,
                                          initialStopLoss: o.initialStopLoss ?? o.stopLoss,
                                          slModifiedAt: uptoTs,
                                      }
                                    : o
                            );
                            return df
                                ? recomputeOrders(mapped, {
                                      symbol: currentSymbol.ticker,
                                      candles: df.getFullHistory(),
                                      uptoTs,
                                      rewind: false,
                                  })
                                : mapped;
                        });
                        return true;
                    },
                } as any);
                if (typeof slId === 'string') orderOverlayIdsRef.current.push(slId);
            }

            if (ord.takeProfit > 0) {
                const tpId = chart.createOverlay({
                    name: 'priceLine',
                    points: [{ value: ord.takeProfit }],
                    lock: false,
                    styles: {
                        line: {
                            color: ct.pos,
                            size: 1.25,
                            style: LineType.Dashed,
                            dashedValue: [4, 4],
                        },
                    },
                    onPressedMoveEnd: (event: any) => {
                        const nextVal = event?.overlay?.points?.[0]?.value;
                        if (typeof nextVal !== 'number' || !Number.isFinite(nextVal) || nextVal <= 0) return false;
                        const nextTp = roundPrice(nextVal);
                        const df = datafeedRef.current;
                        const uptoTs = df?.getReplayState().currentCandle?.timestamp ?? Date.now();
                        setOrders((prev) => {
                            const mapped = prev.map((o) => {
                                if (o.id !== ord.id) return o;
                                const baseRisk = Math.max(
                                    Math.abs(o.entryPrice - (o.initialStopLoss || o.stopLoss || o.entryPrice * 0.995)),
                                    1e-6
                                );
                                const nextRr = Number((Math.abs(nextTp - o.entryPrice) / baseRisk).toFixed(2));
                                return {
                                    ...o,
                                    takeProfit: nextTp,
                                    rrRatio: nextRr > 0 ? nextRr : o.rrRatio,
                                };
                            });
                            return df
                                ? recomputeOrders(mapped, {
                                      symbol: currentSymbol.ticker,
                                      candles: df.getFullHistory(),
                                      uptoTs,
                                      rewind: false,
                                  })
                                : mapped;
                        });
                        return true;
                    },
                } as any);
                if (typeof tpId === 'string') orderOverlayIdsRef.current.push(tpId);
            }
        });

        // 2) Render permanent Entry & Exit candle markers + dashed execution path for OPEN, WIN, and LOSS orders
        const mountExecutionMarkersOnChart = (targetChart: Chart, outIds: string[], paneStepMs: number) => {
            const chartCandles = targetChart.getDataList() || [];
            if (chartCandles.length === 0) return;

            const lastChartBar = chartCandles[chartCandles.length - 1];
            const barSpanMs = estimateBarIntervalMs(chartCandles, paneStepMs);

            const executedOrders = symbolOrders.filter(
                (o) =>
                    (o.status === 'OPEN' || o.status === 'WIN' || o.status === 'LOSS') &&
                    (o.filledAt ?? o.openedAt) < lastChartBar.timestamp + barSpanMs
            );

            executedOrders.forEach((ord) => {
                const entryTs = ord.filledAt ?? ord.openedAt;
                const rawPts: OverlayPointCoord[] = [{ timestamp: entryTs, value: ord.entryPrice }];

                if ((ord.status === 'WIN' || ord.status === 'LOSS') && ord.closedAt !== undefined) {
                    rawPts.push({
                        timestamp: ord.closedAt,
                        value: ord.exitPrice ?? ord.entryPrice,
                    });
                } else if (ord.status === 'OPEN') {
                    const liveMark = ord.side === 'BUY' ? lastChartBar.close : lastChartBar.close + (ord.spread || 0);
                    if (lastChartBar.timestamp >= entryTs || Math.abs(liveMark - ord.entryPrice) > 0) {
                        rawPts.push({
                            timestamp: lastChartBar.timestamp,
                            value: liveMark,
                        });
                    }
                }

                const snappedPts = resolveOverlayPointsAgainstCandles(rawPts, chartCandles, {
                    stepMs: barSpanMs,
                    forChartMount: true,
                }).map((pt) => {
                    if (typeof pt.dataIndex === 'number' && pt.dataIndex >= 0 && pt.dataIndex < chartCandles.length) {
                        return {
                            ...pt,
                            timestamp: chartCandles[pt.dataIndex].timestamp,
                        };
                    }
                    return pt;
                });

                const execId = targetChart.createOverlay({
                    name: 'replayTradeExecution',
                    points: snappedPts as any,
                    lock: true,
                    extendData: {
                        side: ord.side,
                        status: ord.status,
                        entryPrice: ord.entryPrice,
                        exitPrice: ord.exitPrice,
                        exitReason: ord.exitReason,
                        pnl: ord.pnl,
                        rMultiple: ord.rMultiple,
                        decimals: dec,
                        isImportedTrade: ord.isImportedTrade,
                    },
                } as any);
                if (typeof execId === 'string') {
                    outIds.push(execId);
                }
            });
        };

        mountExecutionMarkersOnChart(chart, orderOverlayIdsRef.current, periodToMs(currentPeriod));

        if (syncEnabled && auxPaneCount > 0) {
            for (let i = 0; i < auxPaneCount; i++) {
                const auxChart = auxChartRefs.current[i];
                if (auxChart) {
                    const auxPer = auxPeriods[i] || currentPeriod;
                    mountExecutionMarkersOnChart(auxChart, auxOrderOverlayIdsRef.current[i], periodToMs(auxPer));
                }
            }
        }
    }, [
        chartRef,
        auxChartRefs,
        auxOrderOverlayIdsRef,
        datafeedRef,
        ordersExecutionSignature,
        currentSymbol.ticker,
        currentSymbol.pricePrecision,
        currentPeriod,
        ct,
        canvasHydratedCount,
        auxDataSyncTick,
        latestBar?.timestamp,
        latestBar?.close,
        auxPaneCount,
        auxPeriods,
        syncEnabled,
        spread,
        rightDrawer,
        showChartOrderPreview,
        orderSide,
        orderType,
        limitEntryPrice,
        slDistancePct,
        rrTarget,
        riskPercent,
        commission,
        simBalance,
        isEn,
    ]);

    const currentTicketDefaultsState = useMemo<TicketDefaultsState>(
        () => ({
            orderSide,
            orderType,
            riskPercent,
            slDistancePct,
            rrTarget,
            spread,
            commission,
        }),
        [orderSide, orderType, riskPercent, slDistancePct, rrTarget, spread, commission]
    );

    return {
        orders,
        setOrders,
        orderSide,
        setOrderSide,
        orderType,
        setOrderType,
        limitEntryPrice,
        setLimitEntryPrice,
        riskPercent,
        setRiskPercent,
        slDistancePct,
        setSlDistancePct,
        rrTarget,
        setRrTarget,
        spread,
        setSpread,
        commission,
        setCommission,
        showChartOrderPreview,
        setShowChartOrderPreview,
        quickTagOrder,
        handleOpenQuickTagForOrder,
        handleDismissQuickTag,
        handleUpdateOrderQuickTag,
        orderOverlayIdsRef,
        lastCutoffRef,
        recomputeOrdersAtCutoff,
        onFeedCandle,
        executeOrderWithSide,
        handleExecuteOrder,
        handleQuickLimitOrderAtPrice,
        handleSendPositionToOrderTicket,
        handleMoveOrderToBreakEven,
        handlePartialCloseOrder,
        handleCloseOrCancelOrder,
        stats,
        quantMetrics,
        openPositions,
        floatingPnl,
        simBalance,
        netProfit,
        currentTicketDefaultsState,
    };
}
