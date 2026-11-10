import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    ArrowLeft,
    Clock,
    Calendar,
    Brain,
    AlertTriangle,
    TrendingUp,
    TrendingDown,
    Target,
    Zap,
    Activity,
    Award,
    Share2,
    Globe,
    CheckCircle,
    Edit3,
    Save,
    Play,
    RefreshCw,
    Cloud,
    Layers,
} from 'lucide-react';
import html2canvas from 'html2canvas';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { TradeChart } from '../components/charts/TradeChart';
import {
    loadBacktestSessions,
    saveBacktestSessions,
    loadBacktestStrategies,
    BacktestReplaySession,
} from '../services/backtestWorkspaceStore';
import { ReplayOrder } from '../components/kline-replay/types';

interface TradeDetail {
    trade: {
        id: string | number;
        ticket: string | number;
        symbol: string;
        type: string;
        volume: number;
        openPrice: number;
        closePrice: number;
        openTime: string;
        closeTime: string;
        profit: number;
        commission: number;
        swap: number;
        comment: string;
        accountId?: string;
        status?: string;
        setup?: string;
        mood?: string;
        rating?: number;
        lesson?: string;
    };
    technicalJournal?: {
        marketTrend: string;
        volatility: string;
        strategyUsed: string;
        mistakes: string;
        lessons: string;
        rating: number;
        notes: string;
        entryPrecision?: string;
        riskManagement?: string;
        tradeExit?: string;
        emotionalState?: string;
        setupQuality?: string;
        executionSpeed?: string;
        marketContext?: string;
        preMarketPrep?: string;
        rulesBroken?: string;
        actionPlan?: string;
    };
    mentalLog?: {
        mood: number;
        stress: number;
        focus: number;
        energy: number;
        notes: string;
        overallScore?: number;
    };
}

const getEmoji = (label: string, val: number) => {
    if (label === 'Humor') return val >= 7 ? '😄' : val >= 4 ? '😐' : '😠';
    if (label === 'Estresse') return val <= 3 ? '😌' : val <= 6 ? '😬' : '🤯';
    if (label === 'Foco') return val >= 7 ? '🎯' : val >= 4 ? '👀' : '😵';
    if (label === 'Energia') return val >= 7 ? '⚡' : val >= 4 ? '🔋' : '🪫';
    return '📊';
};

const getScoreInsight = (score: number) => {
    if (score >= 90) return 'Desempenho de Elite! Você estava no fluxo.';
    if (score >= 75) return 'Ótimo estado mental para operar.';
    if (score >= 50) return 'Estado mental estável, mas cuidado com distrações.';
    return 'Cuidado: Estado mental subótimo. Considere descansar.';
};

function normalizeReplaySymbol(raw: string): string {
    const clean = (raw || 'XAUUSD').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (clean.startsWith('XAUUSD')) return 'XAUUSD';
    if (clean.startsWith('EURUSD')) return 'EURUSD';
    if (clean.startsWith('GBPUSD')) return 'GBPUSD';
    if (clean.startsWith('USDJPY')) return 'USDJPY';
    if (clean.startsWith('AUDUSD')) return 'AUDUSD';
    if (clean.startsWith('NZDUSD')) return 'NZDUSD';
    if (clean.startsWith('BTCUSD')) return 'BTCUSD';
    if (clean.startsWith('ETHUSD')) return 'ETHUSD';
    if (clean.startsWith('NAS100') || clean.startsWith('US100') || clean.startsWith('USTEC')) return 'NAS100';
    if (clean.startsWith('US30') || clean.startsWith('DJ30')) return 'US30';
    return clean || 'XAUUSD';
}

function mapTradeToReplayOrder(t: any): ReplayOrder {
    const isBuy = String(t.type).toUpperCase().includes('BUY');
    const entry = Number(t.openPrice) || 100;
    const exit = Number(t.closePrice) || entry;
    const pnl = Number(t.profit || 0) + Number(t.commission || 0) + Number(t.swap || 0);
    const diff = Math.max(Math.abs(exit - entry), entry * 0.002);
    const sl = isBuy ? entry - diff : entry + diff;
    const tp = isBuy ? entry + diff * 2 : entry - diff * 2;
    const openTs = new Date(t.openTime).getTime() || Date.now() - 3600_000;
    const closeTs = new Date(t.closeTime || t.openTime).getTime() || openTs + 900_000;

    return {
        id: `mt5_${t.id || t.ticket || Math.random().toString(36).slice(2, 8)}`,
        symbol: normalizeReplaySymbol(t.symbol),
        side: isBuy ? 'BUY' : 'SELL',
        orderType: 'MARKET',
        entryPrice: entry,
        stopLoss: Number(sl.toFixed(5)),
        takeProfit: Number(tp.toFixed(5)),
        lots: Number(t.volume) || 1,
        riskAmount: Math.max(10, Math.abs(pnl) || 100),
        rrRatio: 2,
        status: pnl >= 0 ? 'WIN' : 'LOSS',
        openedAt: openTs,
        closedAt: closeTs,
        exitPrice: exit,
        exitReason: pnl >= 0 ? 'TP' : 'SL',
        pnl: Number(pnl.toFixed(2)),
        rMultiple: Number((pnl / Math.max(10, Math.abs(pnl) || 100)).toFixed(2)),
    };
}

export const TradeDetails = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const { user } = useAuth();
    const { accounts, selectedAccount } = useAccount();
    const [data, setData] = useState<TradeDetail | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isPrinting, setIsPrinting] = useState(false);

    // Sync & Replay Session States
    const [syncSourceInfo, setSyncSourceInfo] = useState<{
        method: 'MT5_CLOUD' | 'DERIV_API' | 'FILE_IMPORT';
        label: string;
        connected: boolean;
        loginOrAccount?: string;
    }>({
        method: 'MT5_CLOUD',
        label: 'MT5 Cloud Sync',
        connected: true,
    });
    const [isSyncingBroker, setIsSyncingBroker] = useState(false);
    const [syncFeedback, setSyncFeedback] = useState<string | null>(null);
    const [isGroupingSession, setIsGroupingSession] = useState(false);

    // Network Publish State
    const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);
    const [publishCaption, setPublishCaption] = useState('');
    const [publishVisibility, setPublishVisibility] = useState('public');
    const [isPublishing, setIsPublishing] = useState(false);

    // Edit Mode State
    const [isEditing, setIsEditing] = useState(false);
    const [editForm, setEditForm] = useState({
        setup: '',
        mood: '',
        rating: 0,
        lesson: '',
    });
    const [isSaving, setIsSaving] = useState(false);

    const printRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const fetchDetails = async () => {
            try {
                const res = await api.get(`/dashboard/trades/${id}`);
                if (res.data) {
                    const tradeData = res.data.trade || res.data;
                    if (tradeData && (tradeData.id || tradeData.symbol)) {
                        setData({
                            trade: tradeData,
                            technicalJournal: res.data.technicalJournal || null,
                            mentalLog: res.data.mentalLog || null,
                        });
                    } else {
                        setData(null);
                    }
                } else {
                    setData(null);
                }
            } catch (err) {
                console.error('Failed to fetch trade details', err);
                setData(null);
            } finally {
                setIsLoading(false);
            }
        };

        if (id) fetchDetails();
    }, [id]);

    // Inspect Account Import / Sync Type (MT5 Cloud vs Deriv vs Manual Import)
    useEffect(() => {
        if (!data?.trade) return;
        const matchedAcc =
            accounts.find((a) => String(a.id) === String(data.trade.accountId)) || selectedAccount || accounts[0];
        const brokerName = (matchedAcc?.broker || matchedAcc?.name || '').toLowerCase();

        if (brokerName.includes('deriv')) {
            setSyncSourceInfo({
                method: 'DERIV_API',
                label: `Deriv Sync (${matchedAcc?.name || 'Deriv'})`,
                connected: Boolean(matchedAcc?.isConnected),
                loginOrAccount: matchedAcc?.mt5Id || matchedAcc?.id,
            });
            return;
        }

        if (matchedAcc?.mt5Id) {
            setSyncSourceInfo({
                method: 'MT5_CLOUD',
                label: `MT5 Sync · #${matchedAcc.mt5Id} (${matchedAcc.broker || 'MetaTrader 5'})`,
                connected: Boolean(matchedAcc.isConnected),
                loginOrAccount: matchedAcc.mt5Id,
            });
            return;
        }

        setSyncSourceInfo({
            method: 'FILE_IMPORT',
            label: `Histórico Sincronizado (${matchedAcc?.name || 'Conta Principal'})`,
            connected: true,
            loginOrAccount: matchedAcc?.id,
        });
    }, [data?.trade, accounts, selectedAccount]);

    useEffect(() => {
        if (data?.trade) {
            setEditForm({
                setup: data.trade.setup || '',
                mood: data.trade.mood || '',
                rating: data.trade.rating || 0,
                lesson: data.trade.lesson || '',
            });
        }
    }, [data]);

    // Trigger MT5 Cloud Sync or Deriv Sync directly from the Trade Replay panel
    const handleTriggerBrokerSync = async () => {
        if (!data?.trade) return;
        setIsSyncingBroker(true);
        setSyncFeedback(null);
        try {
            if (syncSourceInfo.method === 'DERIV_API') {
                await api.post('/integrations/deriv/sync');
                setSyncFeedback('Sincronização Deriv solicitada com sucesso! Dados atualizados.');
            } else {
                const res = await api.post('/mt5/cloud/sync', {
                    login: syncSourceInfo.loginOrAccount,
                    accountId: data.trade.accountId || selectedAccount?.id,
                });
                setSyncFeedback(res.data?.message || 'Sincronização MT5 Cloud iniciada com sucesso!');
            }
        } catch (err: any) {
            setSyncFeedback(
                err?.response?.data?.message ||
                    'Sincronização local aplicada. Você já pode abrir este trade no Terminal de Replay.'
            );
        } finally {
            setIsSyncingBroker(false);
        }
    };

    // Create / Mount `/backtesting/replay/:sessionId` for this specific Trade
    const handleOpenSingleTradeReplaySession = () => {
        if (!data?.trade) return;
        const t = data.trade;
        const deterministicSessionId =
            typeof t.id === 'string' && t.id.length >= 16
                ? t.id
                : `trade-replay-${String(t.ticket || t.id).replace(/[^a-zA-Z0-9-]/g, '')}`;

        const strategies = loadBacktestStrategies();
        const strat = strategies[0];
        const normSymbol = normalizeReplaySymbol(t.symbol);
        const openDate = new Date(t.openTime || Date.now());
        const closeDate = new Date(t.closeTime || openDate.getTime() + 3600_000);
        const fromDate = new Date(openDate.getTime() - 86400_000 * 3).toISOString().slice(0, 10);
        const toDate = new Date(closeDate.getTime() + 86400_000 * 2).toISOString().slice(0, 10);

        const replayOrder = mapTradeToReplayOrder(t);
        const netPnl = replayOrder.pnl;
        const startCap = selectedAccount?.initialBalance || strat.startingCapital || 100000;

        const sessionObj: BacktestReplaySession = {
            id: deterministicSessionId,
            name: `Replay Trade #${t.ticket || String(t.id).slice(0, 6)} · ${t.symbol}`,
            strategyId: strat.id,
            strategyName: t.setup || strat.name,
            status: 'ACTIVE',
            primarySymbol: normSymbol,
            pairs: Array.from(new Set([normSymbol, 'XAUUSD', 'EURUSD', 'GBPUSD'])),
            timeframe: '15m',
            secondaryTimeframe: '1h',
            fromDate,
            toDate,
            keepEndFollowingToday: false,
            randomStartDate: false,
            startingCapital: startCap,
            riskPerTrade: strat.riskPerTrade || 1.0,
            rrTarget: strat.rrTarget || 2.0,
            fundedMode: {
                enabled: false,
                profitTargetPct: 10,
                maxDailyLossPct: 5,
                maxTotalLossPct: 10,
            },
            currentBalance: Number((startCap + netPnl).toFixed(2)),
            netPnl,
            closedTradesCount: 1,
            winsCount: netPnl >= 0 ? 1 : 0,
            lossesCount: netPnl < 0 ? 1 : 0,
            winRate: netPnl >= 0 ? 100 : 0,
            profitFactor: netPnl >= 0 ? 2.5 : 0,
            expectancy: netPnl,
            avgR: replayOrder.rMultiple ?? 1.5,
            maxDrawdown: netPnl < 0 ? Math.abs(netPnl) : 0,
            maxDrawdownPct: netPnl < 0 ? Number(((Math.abs(netPnl) / startCap) * 100).toFixed(2)) : 0,
            timeInvestedSeconds: 60,
            orders: [replayOrder],
            journalNotes:
                t.lesson ||
                data.technicalJournal?.notes ||
                `Replay importado do Trade #${t.ticket || t.id} (${syncSourceInfo.label})`,
            replayTimestamp: openDate.getTime(),
            spread: 0,
            commission: Number(t.commission || 0),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        const existingSessions = loadBacktestSessions().filter((s) => s.id !== deterministicSessionId);
        saveBacktestSessions([sessionObj, ...existingSessions]);
        navigate(`/backtesting/replay/${deterministicSessionId}`);
    };

    // Group trades from the same sync day/week into a multi-trade Replay Session
    const handleGroupSyncedTradesIntoSession = async () => {
        if (!data?.trade) return;
        setIsGroupingSession(true);
        try {
            const t = data.trade;
            const tradeDateStr = new Date(t.openTime).toISOString().slice(0, 10);
            const res = await api.get('/dashboard/trades', {
                params: {
                    accountId: t.accountId || (selectedAccount?.id !== 'all' ? selectedAccount?.id : undefined),
                    limit: 100,
                },
            });
            const allTrades: any[] = Array.isArray(res.data?.trades)
                ? res.data.trades
                : Array.isArray(res.data)
                  ? res.data
                  : [t];

            // Group trades within +/- 3 days of this trade (same week/sync batch)
            const targetMs = new Date(t.openTime).getTime();
            const windowTrades = allTrades.filter((item) => {
                const ms = new Date(item.openTime).getTime();
                return Math.abs(ms - targetMs) <= 86400_000 * 3;
            });
            const batch = windowTrades.length > 0 ? windowTrades : [t];

            const mappedOrders = batch.map(mapTradeToReplayOrder);
            const uniquePairs = Array.from(new Set(mappedOrders.map((o) => o.symbol)));
            const strategies = loadBacktestStrategies();
            const strat = strategies[0];
            const startCap = selectedAccount?.initialBalance || strat.startingCapital || 100000;
            const totalPnl = Number(mappedOrders.reduce((acc, o) => acc + o.pnl, 0).toFixed(2));
            const wins = mappedOrders.filter((o) => o.pnl >= 0).length;
            const losses = mappedOrders.length - wins;
            const groupSessionId = `sync-batch-${tradeDateStr}-${uniquePairs[0]?.toLowerCase() || 'fx'}`;

            const timestamps = batch.map((item) => new Date(item.openTime).getTime()).filter(Number.isFinite);
            const minTs = timestamps.length ? Math.min(...timestamps) : targetMs;
            const maxTs = timestamps.length ? Math.max(...timestamps) : targetMs;

            const groupedSession: BacktestReplaySession = {
                id: groupSessionId,
                name: `Sessão Sincronizada ${tradeDateStr} (${batch.length} trades · ${uniquePairs.join(', ')})`,
                strategyId: strat.id,
                strategyName: strat.name,
                status: 'ACTIVE',
                primarySymbol: normalizeReplaySymbol(t.symbol),
                pairs: uniquePairs.length > 0 ? uniquePairs : ['XAUUSD'],
                timeframe: '15m',
                secondaryTimeframe: '1h',
                fromDate: new Date(minTs - 86400_000 * 2).toISOString().slice(0, 10),
                toDate: new Date(maxTs + 86400_000 * 2).toISOString().slice(0, 10),
                keepEndFollowingToday: false,
                randomStartDate: false,
                startingCapital: startCap,
                riskPerTrade: strat.riskPerTrade || 1.0,
                rrTarget: strat.rrTarget || 2.0,
                fundedMode: {
                    enabled: false,
                    profitTargetPct: 10,
                    maxDailyLossPct: 5,
                    maxTotalLossPct: 10,
                },
                currentBalance: Number((startCap + totalPnl).toFixed(2)),
                netPnl: totalPnl,
                closedTradesCount: mappedOrders.length,
                winsCount: wins,
                lossesCount: losses,
                winRate: Number(((wins / mappedOrders.length) * 100).toFixed(1)),
                profitFactor: losses > 0 ? 1.8 : 2.5,
                expectancy: Number((totalPnl / mappedOrders.length).toFixed(2)),
                avgR: 1.5,
                maxDrawdown: 0,
                maxDrawdownPct: 0,
                timeInvestedSeconds: 120,
                orders: mappedOrders,
                journalNotes: `Sessão agrupada automaticamente a partir de ${batch.length} trades sincronizados (${syncSourceInfo.label}).`,
                replayTimestamp: minTs,
                spread: 0,
                commission: 0,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };

            const existing = loadBacktestSessions().filter((s) => s.id !== groupSessionId);
            saveBacktestSessions([groupedSession, ...existing]);
            navigate(`/backtesting/replay/${groupSessionId}`);
        } catch (_) {
            handleOpenSingleTradeReplaySession();
        } finally {
            setIsGroupingSession(false);
        }
    };

    const handleUpdateTrade = async () => {
        try {
            setIsSaving(true);
            await api.patch(`/dashboard/trades/${id}`, editForm);

            setData((prev) =>
                prev
                    ? {
                          ...prev,
                          trade: { ...prev.trade, ...editForm },
                      }
                    : null
            );

            setIsEditing(false);
        } catch (err) {
            console.error('Failed to update trade', err);
        } finally {
            setIsSaving(false);
        }
    };

    const handleShare = async () => {
        if (!printRef.current || !data?.trade) return;
        try {
            setIsPrinting(true);
            await new Promise((resolve) => setTimeout(resolve, 100));

            const canvas = await html2canvas(printRef.current, {
                background: getComputedStyle(document.body).backgroundColor,
                logging: false,
                useCORS: true,
            });

            canvas.toBlob(async (blob) => {
                if (!blob) return;

                const file = new File([blob], `trade-${data.trade.ticket || data.trade.id}.png`, {
                    type: 'image/png',
                });

                if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
                    try {
                        await navigator.share({
                            title: `Trade #${data.trade.ticket} - ${data.trade.symbol}`,
                            files: [file],
                        });
                    } catch (shareErr) {
                        downloadFallback(canvas.toDataURL('image/png'));
                    }
                } else {
                    downloadFallback(canvas.toDataURL('image/png'));
                }
            }, 'image/png');
        } catch (err) {
            console.error('Failed to generate image', err);
        } finally {
            setIsPrinting(false);
        }
    };

    const handlePublishToNetwork = async () => {
        if (!printRef.current || !data?.trade) return;
        try {
            setIsPublishing(true);
            await new Promise((resolve) => setTimeout(resolve, 100));

            const canvas = await html2canvas(printRef.current, {
                background: getComputedStyle(document.body).backgroundColor,
                logging: false,
                useCORS: true,
            });

            canvas.toBlob(async (blob) => {
                if (!blob) throw new Error('Failed to generate image blob');

                const formData = new FormData();
                formData.append('file', blob, `trade-${data.trade.ticket}.png`);

                const uploadRes = await api.post('/network/upload', formData, {
                    headers: { 'Content-Type': 'multipart/form-data' },
                });

                const netProfit =
                    Number(data.trade.profit) + Number(data.trade.commission) + Number(data.trade.swap);

                await api.post('/network/post', {
                    content: publishCaption,
                    type: 'image',
                    tradeData: {
                        imageUrl: uploadRes.data.imageUrl,
                        ticket: data.trade.ticket,
                        symbol: data.trade.symbol,
                        profit: netProfit,
                        isWin: netProfit >= 0,
                    },
                    visibility: publishVisibility,
                });

                setIsPublishModalOpen(false);
                setPublishCaption('');
                setPublishVisibility('public');
                navigate('/network');
            }, 'image/png');
        } catch (err) {
            console.error('Failed to publish', err);
        } finally {
            setIsPublishing(false);
        }
    };

    const downloadFallback = (dataUrl: string) => {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `trade-${data?.trade?.ticket || 'detail'}.png`;
        a.click();
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500"></div>
            </div>
        );
    }

    if (!data || !data.trade) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-fg-muted">
                <AlertTriangle size={48} className="mb-4 text-yellow-500" />
                <h2 className="text-xl font-bold text-fg">Trade não encontrado</h2>
                <button
                    onClick={() => navigate('/trades')}
                    className="mt-4 px-4 py-2 bg-surface-2 rounded-lg hover:bg-surface-3"
                >
                    Voltar para Lista
                </button>
            </div>
        );
    }

    const { trade, technicalJournal, mentalLog } = data;
    const netProfit = Number(trade.profit || 0) + Number(trade.commission || 0) + Number(trade.swap || 0);
    const grossProfit = Number(trade.profit || 0);
    const isWin = netProfit >= 0;
    const isBuy = String(trade.type).toUpperCase() === 'BUY';
    const openTimeMs = trade.openTime ? new Date(trade.openTime).getTime() : 0;
    const closeTimeMs = trade.closeTime ? new Date(trade.closeTime).getTime() : 0;
    const duration = closeTimeMs && openTimeMs ? Math.max(0, closeTimeMs - openTimeMs) : 0;
    const durationStr = duration > 0 ? new Date(duration).toISOString().substr(11, 8) : '--:--:--';

    return (
        <div className="p-6 max-w-7xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header Actions (Not Printed) */}
            <div className="flex items-center justify-between mb-4">
                <button
                    onClick={() => navigate('/trades')}
                    className="p-2 bg-surface-2/50 hover:bg-surface-2 text-fg-muted hover:text-fg rounded-xl transition-all flex items-center gap-2 cursor-pointer"
                >
                    <ArrowLeft size={18} />
                    <span className="text-sm font-bold hidden sm:inline">Voltar</span>
                </button>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleOpenSingleTradeReplaySession}
                        className="p-2 px-4 bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-lg shadow-emerald-500/20 rounded-xl transition-all flex items-center gap-2 font-black text-sm cursor-pointer"
                    >
                        <Play size={16} fill="currentColor" />
                        <span>Abrir no Terminal de Replay</span>
                    </button>
                    <button
                        onClick={() => setIsPublishModalOpen(true)}
                        className="p-2 px-4 bg-surface-2 hover:bg-surface-3 border border-line text-fg rounded-xl transition-all flex items-center gap-2 font-bold text-sm cursor-pointer"
                    >
                        <Globe size={18} className="text-emerald-500" />
                        <span className="hidden sm:inline">Publicar</span>
                    </button>
                    <button
                        onClick={handleShare}
                        disabled={isPrinting}
                        className="p-2 px-4 bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 rounded-xl transition-all flex items-center gap-2 font-bold text-sm disabled:opacity-50 cursor-pointer"
                    >
                        <Share2 size={18} />
                        {isPrinting ? 'Gerando...' : 'Compartilhar'}
                    </button>

                    <button
                        onClick={() => setIsEditing(!isEditing)}
                        className={`p-2 px-4 rounded-xl transition-all flex items-center gap-2 font-bold text-sm cursor-pointer ${
                            isEditing
                                ? 'bg-rose-600 hover:bg-rose-500 text-white'
                                : 'bg-surface-3 hover:bg-slate-600 text-fg'
                        }`}
                    >
                        <Edit3 size={18} />
                        {isEditing ? 'Cancelar' : 'Editar'}
                    </button>
                </div>
            </div>

            {/* Printable Container */}
            <div ref={printRef} className="space-y-6 bg-canvas p-1 sm:p-4 rounded-3xl relative">
                {/* Watermark Logo */}
                <div
                    className={`absolute top-6 right-8 z-10 ${
                        isPrinting || isPublishing ? 'opacity-100' : 'opacity-0'
                    } pointer-events-none flex flex-col items-end transition-opacity duration-300`}
                >
                    <div className="flex items-center gap-3 mb-2 drop-shadow-2xl">
                        <img
                            src="https://pub-354475384fd04c1e8c075e14e17ed14d.r2.dev/produtos/originals/1790957899791_0521d2dc46a60392_touro_design_1.jpeg"
                            alt="Torex Journal Logo"
                            className="h-10 w-10 object-contain drop-shadow-lg"
                        />
                        <div className="text-3xl font-black text-fg tracking-tighter uppercase leading-none">
                            Torex<span className="text-blue-500">Journal</span>
                        </div>
                    </div>
                    <div className="bg-surface/95 px-3 py-1.5 rounded-lg border border-blue-500/40 text-fg/80 font-bold tracking-wider text-[11px] uppercase shadow-2xl flex items-center gap-2">
                        <CheckCircle size={14} className="text-blue-500" />
                        <span className="text-blue-400 font-black">Verificado</span>
                        <span className="opacity-50">|</span>
                        <span className="text-blue-100">@{user?.username || user?.name || 'user'}</span>
                    </div>
                </div>

                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <div>
                            <div className="flex items-center gap-3">
                                <h1 className="text-2xl font-bold text-fg">
                                    {trade.symbol}{' '}
                                    <span className="text-fg-subtle text-lg font-mono">
                                        #{trade.ticket || (typeof trade.id === 'string' ? trade.id.split('-')[0] : trade.id)}
                                    </span>
                                </h1>
                                <span
                                    className={`px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider ${
                                        isWin ? 'bg-emerald-500 text-slate-950' : 'bg-rose-500 text-white'
                                    }`}
                                >
                                    {isWin ? 'WIN' : 'LOSS'}
                                </span>
                                <span
                                    className={`px-3 py-1 rounded-full text-xs font-bold uppercase border ${
                                        isBuy
                                            ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                                            : 'bg-rose-500/10 text-danger-fg border-rose-500/20'
                                    }`}
                                >
                                    {trade.type}
                                </span>
                            </div>
                            <p className="text-fg-muted text-sm flex items-center gap-2 mt-1">
                                <Calendar size={12} />
                                {new Date(trade.openTime).toLocaleString('pt-BR', { timeZone: 'UTC' })}
                            </p>
                        </div>
                    </div>

                    <div
                        className={`px-6 py-3 rounded-2xl font-bold text-3xl flex items-center gap-3 border ${
                            isWin
                                ? 'bg-emerald-500/5 text-accent-fg border-emerald-500/20'
                                : 'bg-rose-500/5 text-danger-fg border-rose-500/20'
                        }`}
                    >
                        {isWin ? <TrendingUp size={32} /> : <TrendingDown size={32} />}
                        {netProfit >= 0 ? '+' : ''}
                        {netProfit.toFixed(2)}
                    </div>
                </div>

                {/* Main Stats Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="bg-surface/40 backdrop-blur-xl border border-line p-4 rounded-2xl flex flex-col gap-1">
                        <span className="text-xs text-fg-subtle uppercase font-bold tracking-wider">Lote / Volume</span>
                        <div className="flex items-end gap-2">
                            <span className="text-2xl font-mono text-fg font-bold">{Number(trade.volume).toFixed(2)}</span>
                        </div>
                    </div>
                    <div className="bg-surface/40 backdrop-blur-xl border border-line p-4 rounded-2xl flex flex-col gap-1">
                        <span className="text-xs text-fg-subtle uppercase font-bold tracking-wider">Preço Entrada</span>
                        <span className="text-2xl font-mono text-fg">{Number(trade.openPrice)}</span>
                    </div>
                    <div className="bg-surface/40 backdrop-blur-xl border border-line p-4 rounded-2xl flex flex-col gap-1">
                        <span className="text-xs text-fg-subtle uppercase font-bold tracking-wider">Duração</span>
                        <span className="text-2xl font-mono text-fg flex items-center gap-2">
                            <Clock size={20} className="text-fg-subtle" /> {durationStr}
                        </span>
                    </div>
                    <div className="bg-surface/40 backdrop-blur-xl border border-line p-4 rounded-2xl flex flex-col gap-1">
                        <span className="text-xs text-fg-subtle uppercase font-bold tracking-wider">Resultado Bruto</span>
                        <span
                            className={`text-2xl font-mono font-bold ${
                                grossProfit >= 0 ? 'text-accent-fg' : 'text-danger-fg'
                            }`}
                        >
                            {grossProfit >= 0 ? '+' : ''}
                            {grossProfit.toFixed(2)}
                        </span>
                    </div>
                </div>

                {isEditing && (
                    <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-2xl p-6 animate-in zoom-in-95">
                        <h3 className="text-fg font-bold mb-4 flex items-center gap-2">
                            <Zap className="text-indigo-400" /> Editar Metadados do Trade
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                            <div>
                                <label className="text-[10px] uppercase font-bold text-fg-subtle mb-1 block">Setup</label>
                                <input
                                    className="w-full bg-surface border-line rounded-lg text-sm p-2 text-fg outline-none focus:border-indigo-500 transition-colors"
                                    value={editForm.setup}
                                    onChange={(e) => setEditForm({ ...editForm, setup: e.target.value })}
                                    placeholder="Ex: Breakout H1"
                                />
                            </div>
                            <div>
                                <label className="text-[10px] uppercase font-bold text-fg-subtle mb-1 block">Humor</label>
                                <select
                                    className="w-full bg-surface border-line rounded-lg text-sm p-2 text-fg outline-none focus:border-indigo-500 transition-colors"
                                    value={editForm.mood}
                                    onChange={(e) => setEditForm({ ...editForm, mood: e.target.value })}
                                >
                                    <option value="">Selecione...</option>
                                    <option value="Focado">Focado</option>
                                    <option value="Ansioso">Ansioso</option>
                                    <option value="Calmo">Calmo</option>
                                    <option value="Impulsivo">Impulsivo</option>
                                    <option value="Confiante">Confiante</option>
                                </select>
                            </div>
                            <div>
                                <label className="text-[10px] uppercase font-bold text-fg-subtle mb-1 block">
                                    Avaliação
                                </label>
                                <div className="flex gap-1">
                                    {[1, 2, 3, 4, 5].map((n) => (
                                        <button
                                            key={n}
                                            onClick={() => setEditForm({ ...editForm, rating: n })}
                                            className={`flex-1 h-9 rounded border flex items-center justify-center font-bold text-xs transition-all ${
                                                editForm.rating >= n
                                                    ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-500/20'
                                                    : 'bg-surface border-line text-slate-600 hover:border-slate-500'
                                            }`}
                                        >
                                            {n}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="flex items-end">
                                <button
                                    onClick={handleUpdateTrade}
                                    disabled={isSaving}
                                    className="w-full h-9 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg transition-all flex items-center justify-center gap-2"
                                >
                                    {isSaving ? <Clock className="animate-spin" size={14} /> : <Save size={14} />}
                                    Salvar
                                </button>
                            </div>
                        </div>
                        <div>
                            <label className="text-[10px] uppercase font-bold text-fg-subtle mb-1 block">
                                Lições Aprendidas
                            </label>
                            <textarea
                                className="w-full bg-surface border-line rounded-lg text-sm p-3 text-fg outline-none h-20 resize-none focus:border-indigo-500 transition-colors"
                                value={editForm.lesson}
                                onChange={(e) => setEditForm({ ...editForm, lesson: e.target.value })}
                                placeholder="O que você aprendeu com este trade?"
                            />
                        </div>
                    </div>
                )}

                {/* Trade Replay Chart + MT5 Sync & Session Builder */}
                <div className="bg-surface/40 backdrop-blur-xl border border-line p-6 rounded-2xl space-y-4">
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                        <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2.5">
                                <h3 className="text-lg font-bold text-fg flex items-center gap-2">
                                    <Activity className="text-emerald-500" /> Replay do Trade
                                </h3>
                                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/25 flex items-center gap-1.5">
                                    <Cloud size={12} />
                                    {syncSourceInfo.label}
                                </span>
                            </div>
                            <p className="text-xs text-fg-muted">
                                Visualize a execução na janela do trade ou monte uma sessão completa em{' '}
                                <code className="text-emerald-500 font-mono">/backtesting/replay/:sessionId</code> para avançar vela a vela.
                            </p>
                        </div>

                        {/* Action Buttons: Sync Broker, Group Batch into Session, Open Single Trade Replay */}
                        <div className="flex flex-wrap items-center gap-2">
                            <button
                                type="button"
                                onClick={handleTriggerBrokerSync}
                                disabled={isSyncingBroker}
                                className="px-3 py-2 rounded-xl bg-surface-2 hover:bg-surface-3 border border-line text-xs font-bold text-fg flex items-center gap-1.5 cursor-pointer transition-colors"
                                title="Consultar e sincronizar dados da conta MT5 / Deriv"
                            >
                                <RefreshCw size={13} className={isSyncingBroker ? 'animate-spin text-emerald-500' : 'text-emerald-500'} />
                                <span>{isSyncingBroker ? 'Sincronizando...' : 'Sincronizar MT5 / Feed'}</span>
                            </button>

                            <button
                                type="button"
                                onClick={handleGroupSyncedTradesIntoSession}
                                disabled={isGroupingSession}
                                className="px-3.5 py-2 rounded-xl bg-surface-2 hover:bg-surface-3 border border-emerald-500/30 text-xs font-bold text-emerald-500 flex items-center gap-1.5 cursor-pointer transition-colors"
                                title="Agrupa todos os trades sincronizados desta semana/lote em uma sessão de Replay"
                            >
                                <Layers size={13} />
                                <span>
                                    {isGroupingSession
                                        ? 'Agrupando...'
                                        : 'Agrupar Sincronização em Sessão'}
                                </span>
                            </button>

                            <button
                                type="button"
                                onClick={handleOpenSingleTradeReplaySession}
                                className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-black flex items-center gap-1.5 cursor-pointer transition-all shadow-sm"
                            >
                                <Play size={13} fill="currentColor" />
                                <span>Fazer Replay deste Trade →</span>
                            </button>
                        </div>
                    </div>

                    {syncFeedback && (
                        <div className="px-3.5 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-xs text-emerald-400 font-medium flex items-center justify-between">
                            <span>{syncFeedback}</span>
                            <button
                                type="button"
                                onClick={() => setSyncFeedback(null)}
                                className="text-[11px] opacity-70 hover:opacity-100 cursor-pointer"
                            >
                                Fechar
                            </button>
                        </div>
                    )}

                    <TradeChart
                        symbol={trade.symbol}
                        openTime={trade.openTime}
                        closeTime={trade.closeTime}
                        openPrice={Number(trade.openPrice)}
                        closePrice={Number(trade.closePrice)}
                        type={trade.type}
                        profit={netProfit}
                    />
                </div>

                {/* Context Sections */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Technical Journal Context */}
                    <div className="bg-surface/40 backdrop-blur-xl border border-line rounded-2xl p-6 h-full flex flex-col">
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-lg font-bold text-fg flex items-center gap-2">
                                <Target className="text-blue-500" /> Análise Técnica
                            </h3>
                            {technicalJournal?.rating && (
                                <div className="px-3 py-1 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-bold">
                                    Avaliação: {technicalJournal.rating}/10
                                </div>
                            )}
                        </div>

                        {technicalJournal ? (
                            <div className="space-y-6 flex-1">
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                    <div className="p-3 bg-canvas/50 rounded-xl border border-line">
                                        <span className="text-[10px] text-fg-subtle uppercase font-bold block mb-1">
                                            Tendência
                                        </span>
                                        <span className="font-bold text-fg text-sm">
                                            {technicalJournal.marketTrend || '-'}
                                        </span>
                                    </div>
                                    <div className="p-3 bg-canvas/50 rounded-xl border border-line">
                                        <span className="text-[10px] text-fg-subtle uppercase font-bold block mb-1">
                                            Volatilidade
                                        </span>
                                        <span className="font-bold text-fg text-sm">
                                            {technicalJournal.volatility || '-'}
                                        </span>
                                    </div>
                                    <div className="p-3 bg-canvas/50 rounded-xl border border-line">
                                        <span className="text-[10px] text-fg-subtle uppercase font-bold block mb-1">
                                            Entrada
                                        </span>
                                        <span className="font-bold text-fg text-sm">
                                            {technicalJournal.entryPrecision || '-'}
                                        </span>
                                    </div>
                                    <div className="p-3 bg-canvas/50 rounded-xl border border-line">
                                        <span className="text-[10px] text-fg-subtle uppercase font-bold block mb-1">
                                            Saída
                                        </span>
                                        <span className="font-bold text-fg text-sm">
                                            {technicalJournal.tradeExit || '-'}
                                        </span>
                                    </div>
                                    <div className="p-3 bg-canvas/50 rounded-xl border border-line">
                                        <span className="text-[10px] text-fg-subtle uppercase font-bold block mb-1">
                                            Setup
                                        </span>
                                        <span className="font-bold text-fg text-sm">
                                            {technicalJournal.setupQuality || '-'}
                                        </span>
                                    </div>
                                    <div className="p-3 bg-canvas/50 rounded-xl border border-line">
                                        <span className="text-[10px] text-fg-subtle uppercase font-bold block mb-1">
                                            Execução
                                        </span>
                                        <span className="font-bold text-fg text-sm">
                                            {technicalJournal.executionSpeed || '-'}
                                        </span>
                                    </div>
                                    <div className="p-3 bg-canvas/50 rounded-xl border border-line">
                                        <span className="text-[10px] text-fg-subtle uppercase font-bold block mb-1">
                                            Contexto
                                        </span>
                                        <span className="font-bold text-fg text-sm">
                                            {technicalJournal.marketContext || '-'}
                                        </span>
                                    </div>
                                    <div className="p-3 bg-canvas/50 rounded-xl border border-line">
                                        <span className="text-[10px] text-fg-subtle uppercase font-bold block mb-1">
                                            Risco
                                        </span>
                                        <span className="font-bold text-fg text-sm">
                                            {technicalJournal.riskManagement || '-'}
                                        </span>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <div className="p-4 bg-canvas/30 rounded-xl border border-line">
                                        <span className="text-xs text-indigo-400 font-bold uppercase mb-2 block flex items-center gap-2">
                                            <Zap size={14} /> Estratégia
                                        </span>
                                        <p className="text-fg/80 text-sm leading-relaxed">
                                            {technicalJournal.strategyUsed || 'Não especificado'}
                                        </p>
                                    </div>

                                    {technicalJournal.mistakes && (
                                        <div className="p-4 bg-rose-500/5 border border-rose-500/10 rounded-xl">
                                            <span className="text-xs text-danger-fg font-bold uppercase mb-2 block flex items-center gap-2">
                                                <AlertTriangle size={14} /> Erros
                                            </span>
                                            <p className="text-fg/80 text-sm whitespace-pre-line">
                                                {technicalJournal.mistakes}
                                            </p>
                                        </div>
                                    )}

                                    {technicalJournal.rulesBroken && (
                                        <div className="p-4 bg-rose-500/5 border border-rose-500/10 rounded-xl">
                                            <span className="text-xs text-rose-500 font-bold uppercase mb-2 block flex items-center gap-2">
                                                <AlertTriangle size={14} /> Regras Quebradas
                                            </span>
                                            <p className="text-fg/80 text-sm whitespace-pre-line">
                                                {technicalJournal.rulesBroken}
                                            </p>
                                        </div>
                                    )}

                                    {technicalJournal.lessons && (
                                        <div className="p-4 bg-emerald-500/5 border border-emerald-500/10 rounded-xl">
                                            <span className="text-xs text-accent-fg font-bold uppercase mb-2 block flex items-center gap-2">
                                                <Award size={14} /> Lições
                                            </span>
                                            <p className="text-fg/80 text-sm whitespace-pre-line">
                                                {technicalJournal.lessons}
                                            </p>
                                        </div>
                                    )}

                                    {technicalJournal.actionPlan && (
                                        <div className="p-4 bg-blue-500/5 border border-blue-500/10 rounded-xl">
                                            <span className="text-xs text-blue-400 font-bold uppercase mb-2 block flex items-center gap-2">
                                                <Target size={14} /> Plano de Ação
                                            </span>
                                            <p className="text-fg/80 text-sm whitespace-pre-line">
                                                {technicalJournal.actionPlan}
                                            </p>
                                        </div>
                                    )}

                                    {technicalJournal.notes && (
                                        <div className="p-4 bg-canvas/30 border border-line rounded-xl">
                                            <span className="text-xs text-fg-subtle font-bold uppercase mb-2 block">
                                                Notas Adicionais
                                            </span>
                                            <p className="text-fg-muted text-sm italic">"{technicalJournal.notes}"</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full text-fg-subtle border-2 border-dashed border-line rounded-xl p-8">
                                <Calendar size={32} className="mb-2 opacity-50" />
                                <p>Nenhum diário técnico encontrado para esta data.</p>
                            </div>
                        )}
                    </div>

                    {/* Mental Context */}
                    <div className="bg-surface/40 backdrop-blur-xl border border-line rounded-2xl p-6 h-full flex flex-col">
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-lg font-bold text-fg flex items-center gap-2">
                                <Brain className="text-purple-500" /> Gestão Emocional
                            </h3>
                            {mentalLog?.overallScore && (
                                <div className="px-3 py-1 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-400 text-xs font-bold">
                                    Score Diário: {mentalLog.overallScore}/100
                                </div>
                            )}
                        </div>

                        {mentalLog ? (
                            <div className="space-y-6 flex-1">
                                <div className="grid grid-cols-2 gap-4">
                                    {[
                                        { label: 'Humor', val: mentalLog.mood, color: 'text-yellow-400' },
                                        { label: 'Estresse', val: mentalLog.stress, color: 'text-danger-fg' },
                                        { label: 'Foco', val: mentalLog.focus, color: 'text-blue-400' },
                                        { label: 'Energia', val: mentalLog.energy, color: 'text-accent-fg' },
                                    ].map((stat, i) => (
                                        <div
                                            key={i}
                                            className="flex flex-col items-center justify-center p-4 bg-canvas/50 rounded-xl border border-line relative overflow-hidden group"
                                        >
                                            <div className="text-4xl mb-2 filter grayscale group-hover:grayscale-0 transition-all duration-300 transform group-hover:scale-110">
                                                {getEmoji(stat.label, stat.val)}
                                            </div>
                                            <span className={`text-2xl font-black ${stat.color}`}>{stat.val * 10}%</span>
                                            <span className="text-[10px] uppercase text-fg-subtle font-bold mt-1">
                                                {stat.label}
                                            </span>

                                            <div className="absolute bottom-0 left-0 w-full h-1 bg-surface-2">
                                                <div
                                                    className={`h-full opacity-50 ${
                                                        stat.label === 'Estresse' ? 'bg-rose-500' : 'bg-emerald-500'
                                                    }`}
                                                    style={{ width: `${stat.val * 10}%` }}
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {mentalLog.overallScore && (
                                    <div className="p-4 bg-purple-500/5 border border-purple-500/10 rounded-xl flex items-start gap-3">
                                        <Activity className="text-purple-400 shrink-0 mt-0.5" size={18} />
                                        <div>
                                            <span className="text-xs text-purple-400 font-bold uppercase block mb-1">
                                                Análise de Performance
                                            </span>
                                            <p className="text-fg text-sm font-medium">
                                                {getScoreInsight(mentalLog.overallScore)}
                                            </p>
                                        </div>
                                    </div>
                                )}

                                {mentalLog.notes && (
                                    <div className="p-4 bg-canvas/30 rounded-xl border border-line">
                                        <span className="text-xs text-fg-subtle block mb-2 font-bold uppercase">
                                            Diário Emocional
                                        </span>
                                        <p className="text-fg/80 text-sm italic">"{mentalLog.notes}"</p>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full text-fg-subtle border-2 border-dashed border-line rounded-xl p-8">
                                <Brain size={32} className="mb-2 opacity-50" />
                                <p>Nenhum registro emocional encontrado para esta data.</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Publish Modal */}
            {isPublishModalOpen && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                    <div className="bg-surface border border-line rounded-3xl p-6 w-full max-w-md animate-in zoom-in-95">
                        <h2 className="text-xl font-bold text-fg mb-4">Publicar no Network</h2>
                        <label className="block text-sm text-fg-muted mb-2">Adicione uma legenda</label>
                        <textarea
                            value={publishCaption}
                            onChange={(e) => setPublishCaption(e.target.value)}
                            className="w-full bg-canvas border border-line rounded-xl p-3 text-fg placeholder-fg-subtle focus:ring-2 focus:ring-emerald-500 focus:outline-none resize-none h-24 mb-6"
                            placeholder="Descreva seu trade, o que achou da sua execução..."
                        />
                        <div className="mb-6">
                            <label className="block text-sm text-fg-muted mb-2 font-bold">Privacidade</label>
                            <div className="flex bg-canvas border border-line rounded-xl overflow-hidden p-1">
                                <button
                                    onClick={() => setPublishVisibility('public')}
                                    className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${
                                        publishVisibility === 'public'
                                            ? 'bg-indigo-600 text-white shadow-md'
                                            : 'text-fg-muted hover:text-fg hover:bg-surface'
                                    }`}
                                >
                                    Público (Comunidade)
                                </button>
                                <button
                                    onClick={() => setPublishVisibility('private')}
                                    className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${
                                        publishVisibility === 'private'
                                            ? 'bg-surface-2 text-fg shadow-md'
                                            : 'text-fg-muted hover:text-fg hover:bg-surface'
                                    }`}
                                >
                                    Apenas Eu (Privado)
                                </button>
                            </div>
                        </div>

                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => setIsPublishModalOpen(false)}
                                className="px-4 py-2 bg-surface-2 text-fg/80 rounded-xl hover:bg-surface-3 font-bold"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handlePublishToNetwork}
                                disabled={isPublishing}
                                className="px-6 py-2 bg-emerald-600 text-white rounded-xl hover:bg-emerald-500 font-bold flex items-center gap-2 disabled:opacity-50"
                            >
                                {isPublishing ? 'Publicando...' : 'Publicar Agora'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
