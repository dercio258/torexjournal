import { useEffect, useState, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
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
    Cloud,
    Layers,
    BookOpen,
    Download,
    Image as ImageIcon,
    Maximize2,
    Columns,
    X,
    ShieldAlert,
    ThumbsUp,
    ThumbsDown,
} from 'lucide-react';
import html2canvas from 'html2canvas';
import api from '../api';
import { updateTradeMetaOfflineAware } from '../services/offlineMutations';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { useLocale } from '../context/LocaleContext';
import { TradeChart } from '../components/charts/TradeChart';
import { TradeDetailsSkeleton } from '../components/ui/Skeleton';
import { TradeReplaySetupModal } from '../components/backtesting/TradeReplaySetupModal';
import { BacktestReplaySession, BacktestStrategy } from '../services/backtestWorkspaceStore';
import {
    DAILY_PSYCH_DIMENSIONS,
    DailyNotePayload,
    getPsychToneClass,
    parseJournalImages,
    stripHtmlPreview,
    TRADE_PSYCH_QUESTIONS,
    TradeNotePayload,
} from '../components/journal/types';
import {
    BehaviorMlBadge,
    formatBehaviorPatternLabel,
    TradeBehaviorFeedbackInfo,
    TradeBehaviorMlInfo,
} from '../components/trades/BehaviorMlBadge';
import { DocumentFormat, exportTradingDocument } from '../utils/documentExporter';
import { formatTradeDateTime, getUserUtcOffsetLabel, parseTradeTimestamp } from '../utils/timezone';
import { sanitizeRichHtml } from '../utils/sanitizeHtml';

interface TradeDetail {
    trade: {
        id: string | number;
        ticket: string | number;
        symbol: string;
        type: string;
        volume: number;
        openPrice: number;
        closePrice: number;
        sl?: number;
        tp?: number;
        openTime: string;
        closeTime: string;
        profit: number;
        commission: number;
        swap: number;
        comment: string;
        accountId?: string;
        currency?: string;
        status?: string;
        setup?: string;
        mood?: string;
        rating?: number;
        lesson?: string;
        mfe?: number | null;
        mae?: number | null;
        marketBias?: string | null;
        journalNotes?: string;
        annotationSource?: 'trade' | 'daily' | 'none';
        qualityFlags?: {
            behavioralMl?: TradeBehaviorMlInfo | null;
            behavioralFeedback?: TradeBehaviorFeedbackInfo | null;
            [key: string]: any;
        } | null;
    };
    tradeNote?: TradeNotePayload | null;
    dailyNote?: DailyNotePayload | null;
    annotationSource?: 'trade' | 'daily' | 'none';
    imageSource?: 'trade' | 'daily' | 'none';
    effectiveScreenshots?: string[];
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
    } | null;
    mentalLog?: {
        sleepQuality?: number;
        caffeine?: number;
        mood: number;
        stress: number;
        focus: number;
        energy: number;
        notes: string;
        overallScore?: number;
    } | null;
}

const getEmoji = (key: string, val: number) => {
    if (key === 'mood' || key === 'Humor') return val >= 7 ? '😄' : val >= 4 ? '😐' : '😠';
    if (key === 'stress' || key === 'Estresse') return val <= 3 ? '😌' : val <= 6 ? '😬' : '🤯';
    if (key === 'focus' || key === 'Foco') return val >= 7 ? '🎯' : val >= 4 ? '👀' : '😵';
    if (key === 'energy' || key === 'Energia') return val >= 7 ? '⚡' : val >= 4 ? '🔋' : '🪫';
    return '📊';
};

const getScoreInsight = (score: number, isEn: boolean) => {
    if (score >= 90) {
        return isEn
            ? 'Peak Execution Mindset! You were locked into the flow.'
            : 'Desempenho de Elite! Você estava no fluxo.';
    }
    if (score >= 75) {
        return isEn
            ? 'Optimal cognitive state for live execution.'
            : 'Ótimo estado mental para operar.';
    }
    if (score >= 50) {
        return isEn
            ? 'Stable mindset, stay alert for execution drift or distractions.'
            : 'Estado mental estável, mas cuidado com distrações.';
    }
    return isEn
        ? 'Caution: Suboptimal mental state. Consider stepping away from the desk.'
        : 'Cuidado: Estado mental subótimo. Considere descansar.';
};

export const TradeDetails = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const { user } = useAuth();
    const { accounts, selectedAccount } = useAccount();
    const [data, setData] = useState<TradeDetail | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isPrinting, setIsPrinting] = useState(false);
    const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);

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
    const [hasCachedMarketData, setHasCachedMarketData] = useState(false);
    const [isReplayModalOpen, setIsReplayModalOpen] = useState(false);
    const [savedBacktestInfo, setSavedBacktestInfo] = useState<{
        session: BacktestReplaySession;
        strategy: BacktestStrategy;
    } | null>(null);

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

    // Lightbox state for ANTES / DEPOIS / Extras attached screenshots
    const [lightboxState, setLightboxState] = useState<{
        mode: 'single' | 'compare';
        url?: string;
        label?: string;
    } | null>(null);
    const [showExportMenu, setShowExportMenu] = useState(false);

    const printRef = useRef<HTMLDivElement>(null);

    const loadTradeDetails = async () => {
        try {
            const res = await api.get(`/dashboard/trades/${id}`);
            if (res.data) {
                const tradeData = res.data.trade || res.data;
                if (tradeData && (tradeData.id || tradeData.symbol)) {
                    setData({
                        trade: tradeData,
                        tradeNote: res.data.tradeNote || null,
                        dailyNote: res.data.dailyNote || null,
                        annotationSource: res.data.annotationSource || tradeData.annotationSource || 'none',
                        imageSource: res.data.imageSource || 'none',
                        effectiveScreenshots: Array.isArray(res.data.effectiveScreenshots)
                            ? res.data.effectiveScreenshots
                            : [],
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

    useEffect(() => {
        if (id) void loadTradeDetails();
    }, [id]);

    useEffect(() => {
        const onSynced = () => {
            if (id) void loadTradeDetails();
        };
        window.addEventListener('torex:offline-sync-completed', onSynced);
        return () => window.removeEventListener('torex:offline-sync-completed', onSynced);
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
            label: isEn
                ? `Synced History (${matchedAcc?.name || 'Primary Account'})`
                : `Histórico Sincronizado (${matchedAcc?.name || 'Conta Principal'})`,
            connected: true,
            loginOrAccount: matchedAcc?.id,
        });
    }, [data?.trade, accounts, selectedAccount, isEn]);

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

    const handleOpenReplayModal = () => {
        setIsReplayModalOpen(true);
    };

    const handleSavedToBacktest = ({
        session,
        strategy,
        openedReplay,
    }: {
        session: BacktestReplaySession;
        strategy: BacktestStrategy;
        openedReplay: boolean;
    }) => {
        setIsReplayModalOpen(false);
        setData((prev) =>
            prev
                ? {
                      ...prev,
                      trade: { ...prev.trade, setup: prev.trade.setup || strategy.name },
                  }
                : null
        );
        setSavedBacktestInfo({ session, strategy });

        if (openedReplay) {
            navigate(`/backtesting/replay/${session.id}`);
        }
    };

    const handleUpdateTrade = async () => {
        if (!id) return;
        try {
            setIsSaving(true);
            const res = await updateTradeMetaOfflineAware(id, editForm);
            if (res.offlineQueued) {
                setData((prev) =>
                    prev
                        ? {
                              ...prev,
                              trade: { ...prev.trade, ...editForm },
                          }
                        : null
                );
            } else {
                await loadTradeDetails();
            }
            setIsEditing(false);
        } catch (err) {
            console.error('Failed to update trade', err);
        } finally {
            setIsSaving(false);
        }
    };

    const handleBehaviorFeedback = async (verdict: 'CONFIRM' | 'FALSE_POSITIVE') => {
        if (!data?.trade?.id || isSubmittingFeedback) return;
        const ml = data.trade.qualityFlags?.behavioralMl;
        const correctedFlags = verdict === 'CONFIRM' ? (Array.isArray(ml?.activeFlags) ? ml!.activeFlags : []) : [];
        try {
            setIsSubmittingFeedback(true);
            const res = await api.post(`/mt5/trades/${data.trade.id}/behavior-feedback`, {
                verdict,
                correctedFlags,
            });
            const savedFeedback: TradeBehaviorFeedbackInfo = res.data?.behavioralFeedback || {
                verdict,
                correctedFlags,
                updatedAt: new Date().toISOString(),
            };
            setData((prev) =>
                prev
                    ? {
                          ...prev,
                          trade: {
                              ...prev.trade,
                              qualityFlags: {
                                  ...(prev.trade.qualityFlags || {}),
                                  behavioralFeedback: savedFeedback,
                              },
                          },
                      }
                    : null,
            );
            void queryClient.invalidateQueries({ queryKey: ['trades'] });
        } catch (err) {
            console.error('Failed to submit behavioral ML feedback', err);
        } finally {
            setIsSubmittingFeedback(false);
        }
    };

    const handleExportSingleTrade = (format: DocumentFormat) => {
        if (!data?.trade) return;
        const tr = data.trade;
        const matchedAcc =
            accounts.find((a) => String(a.id) === String(tr.accountId)) ||
            selectedAccount ||
            accounts[0];

        const tradeText = stripHtmlPreview(data.tradeNote?.content).trim();
        const dailyText = stripHtmlPreview(data.dailyNote?.content).trim();
        const hasOwn = Boolean(
            tradeText || data.tradeNote?.lessons || data.tradeNote?.mistakes || tr.lesson
        );

        const sentimentParts: string[] = [];
        if (data.tradeNote?.psychCheck?.feeling || tr.mood) {
            sentimentParts.push(`${isEn ? 'Mindset' : 'Sentimento'}: ${data.tradeNote?.psychCheck?.feeling || tr.mood}`);
        }
        if (data.tradeNote?.psychCheck?.followingPlan) {
            sentimentParts.push(`${isEn ? 'Plan' : 'Plano'}: ${data.tradeNote.psychCheck.followingPlan}`);
        }
        if (data.tradeNote?.psychCheck?.entryDriver) {
            sentimentParts.push(`${isEn ? 'Trigger' : 'Gatilho'}: ${data.tradeNote.psychCheck.entryDriver}`);
        }
        if (!sentimentParts.length && data.dailyNote?.mood) {
            sentimentParts.push(`${isEn ? 'Daily Mindset' : 'Humor do Dia'}: ${data.dailyNote.mood}`);
        }
        if (data.dailyNote?.psychCheck?.focus) {
            sentimentParts.push(`${isEn ? 'Focus' : 'Foco'}: ${data.dailyNote.psychCheck.focus}`);
        }

        exportTradingDocument(format, {
            accountName: matchedAcc?.name || (isEn ? 'Primary Account' : 'Conta Principal'),
            accountType: matchedAcc?.type || 'TRADING',
            broker: matchedAcc?.broker || 'MetaTrader 5',
            currency: matchedAcc?.currency || tr.currency || 'USD',
            periodLabel: isEn ? `Execution #${tr.ticket || tr.id} (${tr.symbol})` : `Operação #${tr.ticket || tr.id} (${tr.symbol})`,
            trades: [
                {
                    ...tr,
                    accountName: matchedAcc?.name || (isEn ? 'Account' : 'Conta'),
                    setup:
                        tr.setup ||
                        data.tradeNote?.setup ||
                        data.dailyNote?.title ||
                        data.technicalJournal?.strategyUsed ||
                        '',
                    marketBias:
                        tr.marketBias ||
                        data.dailyNote?.marketBias ||
                        data.technicalJournal?.marketTrend ||
                        '',
                    sentimentSummary: sentimentParts.join(' | ') || tr.mood || '',
                    annotationSource:
                        data.annotationSource ||
                        (hasOwn ? 'trade' : dailyText ? 'daily' : 'none'),
                    journalNotes: hasOwn
                        ? tradeText || tr.lesson || ''
                        : dailyText || data.technicalJournal?.notes || '',
                },
            ],
        });
        setShowExportMenu(false);
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

    const parsedScreenshots = useMemo(() => {
        const rawList =
            data?.effectiveScreenshots && data.effectiveScreenshots.length > 0
                ? data.effectiveScreenshots
                : data?.tradeNote?.screenshots && data.tradeNote.screenshots.length > 0
                ? data.tradeNote.screenshots
                : data?.tradeNote?.screenshotUrl
                ? [data.tradeNote.screenshotUrl]
                : data?.dailyNote?.images || [];
        return parseJournalImages(rawList);
    }, [data]);

    if (isLoading) {
        return <TradeDetailsSkeleton />;
    }

    if (!data || !data.trade) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-fg-muted">
                <AlertTriangle size={36} className="mb-3 text-warning" />
                <h2 className="text-base font-bold text-fg">{isEn ? 'Execution not found' : 'Trade não encontrado'}</h2>
                <button
                    onClick={() => navigate('/trades')}
                    className="mt-3 h-8 px-3.5 bg-surface border border-line rounded-lg text-xs font-semibold hover:bg-surface-2 cursor-pointer"
                >
                    {isEn ? 'Back to Ledger' : 'Voltar para Lista'}
                </button>
            </div>
        );
    }

    const { trade, tradeNote, dailyNote, annotationSource, imageSource, technicalJournal, mentalLog } = data;
    const netProfit = Number(trade.profit || 0) + Number(trade.commission || 0) + Number(trade.swap || 0);
    const grossProfit = Number(trade.profit || 0);
    const isWin = netProfit >= 0;
    const isBuy = String(trade.type).toUpperCase() === 'BUY';
    const openTimeMs = parseTradeTimestamp(trade.openTime)?.getTime() ?? 0;
    const closeTimeMs = parseTradeTimestamp(trade.closeTime)?.getTime() ?? 0;
    const duration = closeTimeMs && openTimeMs ? Math.max(0, closeTimeMs - openTimeMs) : 0;
    const totalDurSecs = Math.floor(duration / 1000);
    const durHours = Math.floor(totalDurSecs / 3600);
    const durMins = Math.floor((totalDurSecs % 3600) / 60);
    const durSecs = totalDurSecs % 60;
    const durationStr =
        duration > 0
            ? `${String(durHours).padStart(2, '0')}:${String(durMins).padStart(2, '0')}:${String(durSecs).padStart(2, '0')}`
            : '--:--:--';

    const hasAnyAttachedImages = Boolean(
        parsedScreenshots.before || parsedScreenshots.after || parsedScreenshots.extras.length > 0
    );
    const tradeRichHtml = tradeNote?.content?.trim() || '';
    const tradePlainText = stripHtmlPreview(tradeRichHtml).trim();
    const dailyRichHtml = dailyNote?.content?.trim() || '';
    const dailyPlainText = stripHtmlPreview(dailyRichHtml).trim();

    const tradePsychChips = TRADE_PSYCH_QUESTIONS.flatMap((q) => {
        const val = tradeNote?.psychCheck?.[q.key];
        if (!val) return [];
        const opt = q.options.find((o) => o.value === val);
        return [
            {
                key: q.key,
                label: isEn ? q.shortQuestionEn || q.shortQuestion : q.shortQuestion,
                value: isEn ? opt?.labelEn || val : val,
                emoji: opt?.emoji || '•',
                toneClass: opt ? getPsychToneClass(opt.tone) : 'bg-surface-2 text-fg border-line',
            },
        ];
    });

    const dailyPsychChips = DAILY_PSYCH_DIMENSIONS.flatMap((dim) => {
        const val = dailyNote?.psychCheck?.[dim.key];
        if (!val) return [];
        const opt = dim.options.find((o) => o.value === val);
        return [
            {
                key: dim.key,
                label: isEn ? dim.shortLabelEn || dim.shortLabel : dim.shortLabel,
                value: isEn ? opt?.labelEn || val : val,
                emoji: opt?.emoji || dim.defaultEmoji,
                toneClass: opt ? getPsychToneClass(opt.tone) : 'bg-surface-2 text-fg border-line',
            },
        ];
    });

    const normalizedOverallScore =
        mentalLog?.overallScore !== undefined && mentalLog?.overallScore !== null
            ? mentalLog.overallScore <= 10
                ? Math.round(mentalLog.overallScore * 10)
                : Math.round(mentalLog.overallScore)
            : null;

    const behaviorMl = trade.qualityFlags?.behavioralMl || null;
    const behaviorFeedback = trade.qualityFlags?.behavioralFeedback || null;

    const hasTechnicalContent = Boolean(
        technicalJournal ||
            tradePlainText ||
            dailyPlainText ||
            trade.setup ||
            trade.lesson ||
            dailyNote?.marketBias
    );
    const hasMentalContent = Boolean(
        behaviorMl ||
            mentalLog ||
            tradePsychChips.length > 0 ||
            dailyPsychChips.length > 0 ||
            trade.mood ||
            dailyNote?.mood
    );

    return (
        <div className="w-full space-y-3 pb-8 animate-in fade-in duration-300">
            {/* Header Actions (Not Printed) */}
            <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                    onClick={() => navigate('/trades')}
                    className="h-8 px-3 bg-surface hover:bg-surface-2 border border-line text-fg-muted hover:text-fg rounded-lg transition-colors flex items-center gap-1.5 text-xs font-semibold cursor-pointer"
                >
                    <ArrowLeft size={14} />
                    <span>{isEn ? 'Back' : 'Voltar'}</span>
                </button>
                <div className="flex flex-wrap items-center gap-1.5">
                    <button
                        type="button"
                        onClick={handleOpenReplayModal}
                        className="h-8 px-3 bg-accent hover:bg-accent-hover text-accent-on rounded-lg transition-colors flex items-center gap-1.5 font-bold text-xs cursor-pointer"
                    >
                        <Play size={13} fill="currentColor" />
                        <span>{isEn ? 'Launch Replay' : 'Fazer Replay'}</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => navigate('/journal')}
                        className="h-8 px-3 bg-surface hover:bg-surface-2 border border-line text-fg rounded-lg transition-colors flex items-center gap-1.5 font-semibold text-xs cursor-pointer"
                    >
                        <BookOpen size={14} className="text-data-1" />
                        <span className="hidden sm:inline">{isEn ? 'Open in Journal' : 'Abrir no Diário'}</span>
                    </button>

                    <div className="relative">
                        <button
                            type="button"
                            onClick={() => setShowExportMenu((v) => !v)}
                            className="h-8 px-3 bg-surface hover:bg-surface-2 border border-line text-fg rounded-lg transition-colors flex items-center gap-1.5 font-semibold text-xs cursor-pointer"
                        >
                            <Download size={14} className="text-accent-fg" />
                            <span>{isEn ? 'Export' : 'Exportar'}</span>
                        </button>
                        {showExportMenu && (
                            <div className="absolute right-0 mt-1.5 w-44 bg-surface border border-line rounded-xl shadow-lg p-1.5 z-30 space-y-0.5">
                                {(
                                    [
                                        { fmt: 'pdf', label: isEn ? 'PDF Report' : 'Relatório PDF' },
                                        { fmt: 'excel', label: isEn ? 'Excel Sheet (.xls)' : 'Planilha Excel (.xls)' },
                                        { fmt: 'csv', label: isEn ? 'CSV Export' : 'Arquivo CSV' },
                                        { fmt: 'html', label: isEn ? 'HTML Report' : 'Documento HTML' },
                                    ] as { fmt: DocumentFormat; label: string }[]
                                ).map(({ fmt, label }) => (
                                    <button
                                        key={fmt}
                                        type="button"
                                        onClick={() => handleExportSingleTrade(fmt)}
                                        className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium text-fg hover:bg-surface-2 transition-colors cursor-pointer"
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <button
                        onClick={() => setIsPublishModalOpen(true)}
                        className="h-8 px-3 bg-surface hover:bg-surface-2 border border-line text-fg rounded-lg transition-colors flex items-center gap-1.5 font-semibold text-xs cursor-pointer"
                    >
                        <Globe size={14} className="text-accent-fg" />
                        <span className="hidden sm:inline">{isEn ? 'Publish' : 'Publicar'}</span>
                    </button>
                    <button
                        onClick={handleShare}
                        disabled={isPrinting}
                        className="h-8 px-3 bg-surface hover:bg-surface-2 border border-line text-fg rounded-lg transition-colors flex items-center gap-1.5 font-semibold text-xs disabled:opacity-50 cursor-pointer"
                    >
                        <Share2 size={14} />
                        <span>{isPrinting ? (isEn ? 'Generating...' : 'Gerando...') : (isEn ? 'Share' : 'Compartilhar')}</span>
                    </button>

                    <button
                        onClick={() => setIsEditing(!isEditing)}
                        className={`h-8 px-3 rounded-lg transition-colors flex items-center gap-1.5 font-semibold text-xs cursor-pointer border ${
                            isEditing
                                ? 'bg-danger/15 border-danger/30 text-danger-fg'
                                : 'bg-surface hover:bg-surface-2 border-line text-fg'
                        }`}
                    >
                        <Edit3 size={14} />
                        <span>{isEditing ? (isEn ? 'Cancel' : 'Cancelar') : (isEn ? 'Edit' : 'Editar')}</span>
                    </button>
                </div>
            </div>

            {savedBacktestInfo && (
                <div className="flex flex-col gap-2.5 rounded-xl border border-accent/30 bg-accent/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between animate-in fade-in">
                    <div className="flex items-start gap-2.5 text-xs">
                        <Layers size={16} className="mt-0.5 shrink-0 text-accent-fg" />
                        <div>
                            <p className="font-bold text-fg">
                                {isEn ? 'Replay session saved under' : 'Sessão salva no Backtest em'}{' '}
                                <span className="text-accent-fg">{savedBacktestInfo.strategy.name}</span>
                            </p>
                            <p className="text-[11px] text-fg-muted">
                                {savedBacktestInfo.session.name} · {savedBacktestInfo.session.primarySymbol} ·{' '}
                                {savedBacktestInfo.session.timeframe}
                            </p>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={() => navigate(`/backtesting/sessions/${savedBacktestInfo.session.id}`)}
                            className="h-7 rounded-lg border border-line bg-surface px-3 text-xs font-semibold text-fg hover:bg-surface-2 transition-colors cursor-pointer"
                        >
                            {isEn ? 'Open Session' : 'Ver no Backtest'}
                        </button>
                        <button
                            type="button"
                            onClick={() => navigate(`/backtesting/replay/${savedBacktestInfo.session.id}`)}
                            className="h-7 inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-bold text-accent-on hover:bg-accent-hover transition-colors cursor-pointer"
                        >
                            <Play size={11} fill="currentColor" />
                            {isEn ? 'Start Replay' : 'Iniciar Replay'}
                        </button>
                    </div>
                </div>
            )}

            {/* Printable Container */}
            <div ref={printRef} className="space-y-3 bg-canvas rounded-xl relative">
                {/* Watermark Logo */}
                <div
                    className={`absolute top-4 right-5 z-10 ${
                        isPrinting || isPublishing ? 'opacity-100' : 'opacity-0'
                    } pointer-events-none flex flex-col items-end transition-opacity duration-300`}
                >
                    <div className="flex items-center gap-2.5 mb-1.5">
                        <img
                            src="https://pub-354475384fd04c1e8c075e14e17ed14d.r2.dev/produtos/originals/1790957899791_0521d2dc46a60392_touro_design_1.jpeg"
                            alt="Torex Journal Logo"
                            className="h-8 w-8 rounded-lg object-contain"
                        />
                        <div className="text-xl font-black text-fg tracking-tight uppercase leading-none">
                            Torex<span className="text-accent-fg">Journal</span>
                        </div>
                    </div>
                    <div className="bg-surface px-2.5 py-1 rounded-md border border-accent/30 text-fg font-semibold tracking-wider text-[10px] uppercase flex items-center gap-1.5">
                        <CheckCircle size={12} className="text-accent-fg" />
                        <span className="text-accent-fg font-bold">{isEn ? 'Verified' : 'Verificado'}</span>
                        <span className="opacity-40">|</span>
                        <span className="text-fg-muted">@{user?.username || user?.name || 'user'}</span>
                    </div>
                </div>

                {/* Header Banner */}
                <div className="bg-surface border border-line rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div>
                        <div className="flex flex-wrap items-center gap-2">
                            <h1 className="text-lg font-bold text-fg tracking-tight">
                                {trade.symbol}{' '}
                                <span className="text-fg-subtle text-sm font-mono font-medium">
                                    #{trade.ticket || (typeof trade.id === 'string' ? trade.id.split('-')[0] : trade.id)}
                                </span>
                            </h1>
                            <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                                    isWin ? 'bg-accent text-accent-on' : 'bg-danger text-white'
                                }`}
                            >
                                {isWin ? 'WIN' : 'LOSS'}
                            </span>
                            <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${
                                    isBuy
                                        ? 'bg-accent/10 text-accent-fg border-accent/20'
                                        : 'bg-danger/10 text-danger-fg border-danger/20'
                                }`}
                            >
                                {trade.type}
                            </span>
                        </div>
                        <p className="text-fg-muted text-xs flex flex-wrap items-center gap-1.5 mt-1 tabular-nums">
                            <Calendar size={12} className="text-fg-subtle" />
                            <span>{isEn ? 'Entry:' : 'Abertura:'} {formatTradeDateTime(trade.openTime)}</span>
                            {trade.closeTime && (
                                <>
                                    <span className="text-fg-subtle">→</span>
                                    <span>{isEn ? 'Exit:' : 'Fecho:'} {formatTradeDateTime(trade.closeTime)}</span>
                                </>
                            )}
                            <span className="px-1.5 py-0.5 rounded bg-surface-2 border border-line-subtle text-[10px] font-mono text-fg-subtle">
                                {getUserUtcOffsetLabel()}
                            </span>
                        </p>
                    </div>

                    <div
                        className={`px-4 py-2 rounded-xl font-bold font-mono tabular-nums text-xl flex items-center gap-2 border ${
                            isWin
                                ? 'bg-accent/5 text-accent-fg border-accent/20'
                                : 'bg-danger/5 text-danger-fg border-danger/20'
                        }`}
                    >
                        {isWin ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
                        {netProfit >= 0 ? '+' : ''}
                        ${netProfit.toFixed(2)}
                    </div>
                </div>

                {/* Main Stats Grid */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="bg-surface border border-line p-3.5 rounded-xl flex flex-col justify-between min-h-[76px]">
                        <span className="text-[10px] text-fg-subtle uppercase font-semibold tracking-wider">{isEn ? 'Size / Lots' : 'Lote / Volume'}</span>
                        <span className="text-lg font-mono tabular-nums text-fg font-bold">{Number(trade.volume).toFixed(2)}</span>
                    </div>
                    <div className="bg-surface border border-line p-3.5 rounded-xl flex flex-col justify-between min-h-[76px]">
                        <span className="text-[10px] text-fg-subtle uppercase font-semibold tracking-wider">{isEn ? 'Entry Price' : 'Preço Entrada'}</span>
                        <span className="text-lg font-mono tabular-nums text-fg font-bold">{Number(trade.openPrice)}</span>
                    </div>
                    <div className="bg-surface border border-line p-3.5 rounded-xl flex flex-col justify-between min-h-[76px]">
                        <span className="text-[10px] text-fg-subtle uppercase font-semibold tracking-wider">{isEn ? 'Hold Duration' : 'Duração'}</span>
                        <span className="text-lg font-mono tabular-nums text-fg font-bold flex items-center gap-1.5">
                            <Clock size={15} className="text-fg-subtle" /> {durationStr}
                        </span>
                    </div>
                    <div className="bg-surface border border-line p-3.5 rounded-xl flex flex-col justify-between min-h-[76px]">
                        <span className="text-[10px] text-fg-subtle uppercase font-semibold tracking-wider">{isEn ? 'Gross P&L' : 'Resultado Bruto'}</span>
                        <span
                            className={`text-lg font-mono tabular-nums font-bold ${
                                grossProfit >= 0 ? 'text-accent-fg' : 'text-danger-fg'
                            }`}
                        >
                            {grossProfit >= 0 ? '+' : ''}${grossProfit.toFixed(2)}
                        </span>
                    </div>
                </div>

                {isEditing && (
                    <div className="bg-surface border border-accent/30 rounded-xl p-4 sm:p-5 animate-in fade-in">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-fg mb-3 flex items-center gap-1.5">
                            <Zap size={14} className="text-accent-fg" /> {isEn ? 'Edit Execution Metadata' : 'Editar Metadados do Trade'}
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
                            <div>
                                <label className="text-[10px] uppercase font-semibold text-fg-subtle mb-1 block">{isEn ? 'Setup Tag' : 'Setup'}</label>
                                <input
                                    className="w-full h-8 bg-canvas-subtle border border-line rounded-lg text-xs px-2.5 text-fg outline-none focus:border-accent/50 transition-colors"
                                    value={editForm.setup}
                                    onChange={(e) => setEditForm({ ...editForm, setup: e.target.value })}
                                    placeholder={isEn ? 'e.g. H1 Liquidity Sweep' : 'Ex: Breakout H1'}
                                />
                            </div>
                            <div>
                                <label className="text-[10px] uppercase font-semibold text-fg-subtle mb-1 block">{isEn ? 'Mindset' : 'Humor'}</label>
                                <select
                                    className="w-full h-8 bg-canvas-subtle border border-line rounded-lg text-xs px-2.5 text-fg outline-none focus:border-accent/50 transition-colors"
                                    value={editForm.mood}
                                    onChange={(e) => setEditForm({ ...editForm, mood: e.target.value })}
                                >
                                    <option value="">{isEn ? 'Select...' : 'Selecione...'}</option>
                                    <option value="Focado">{isEn ? 'Focused' : 'Focado'}</option>
                                    <option value="Ansioso">{isEn ? 'Anxious' : 'Ansioso'}</option>
                                    <option value="Calmo">{isEn ? 'Calm' : 'Calmo'}</option>
                                    <option value="Impulsivo">{isEn ? 'Impulsive' : 'Impulsivo'}</option>
                                    <option value="Confiante">{isEn ? 'Confident' : 'Confiante'}</option>
                                </select>
                            </div>
                            <div>
                                <label className="text-[10px] uppercase font-semibold text-fg-subtle mb-1 block">
                                    {isEn ? 'Execution Rating' : 'Avaliação'}
                                </label>
                                <div className="flex gap-1">
                                    {[1, 2, 3, 4, 5].map((n) => (
                                        <button
                                            key={n}
                                            onClick={() => setEditForm({ ...editForm, rating: n })}
                                            className={`flex-1 h-8 rounded-lg border flex items-center justify-center font-bold text-xs transition-colors cursor-pointer ${
                                                editForm.rating >= n
                                                    ? 'bg-accent border-accent text-accent-on'
                                                    : 'bg-canvas-subtle border-line text-fg-muted hover:text-fg'
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
                                    className="w-full h-8 bg-accent hover:bg-accent-hover text-accent-on font-bold text-xs rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                                >
                                    {isSaving ? <Clock className="animate-spin" size={13} /> : <Save size={13} />}
                                    {isEn ? 'Save' : 'Salvar'}
                                </button>
                            </div>
                        </div>
                        <div>
                            <label className="text-[10px] uppercase font-semibold text-fg-subtle mb-1 block">
                                {isEn ? 'Key Takeaways' : 'Lições Aprendidas'}
                            </label>
                            <textarea
                                className="w-full bg-canvas-subtle border border-line rounded-lg text-xs p-2.5 text-fg outline-none h-20 resize-none focus:border-accent/50 transition-colors"
                                value={editForm.lesson}
                                onChange={(e) => setEditForm({ ...editForm, lesson: e.target.value })}
                                placeholder={isEn ? 'What did this execution teach you?' : 'O que você aprendeu com este trade?'}
                            />
                        </div>
                    </div>
                )}

                {/* Trade Replay Chart — Rendered ONLY if exact historical batch exists in local IndexedDB cache */}
                <div
                    className={
                        hasCachedMarketData
                            ? 'bg-surface border border-line p-4 sm:p-5 rounded-xl space-y-3'
                            : 'hidden'
                    }
                >
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                        <div className="space-y-0.5">
                            <div className="flex flex-wrap items-center gap-2">
                                <h3 className="text-sm font-bold text-fg flex items-center gap-1.5">
                                    <Activity size={15} className="text-accent-fg" /> {isEn ? 'Execution Replay' : 'Replay do Trade'}
                                </h3>
                                <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-accent/10 text-accent-fg border border-accent/20 flex items-center gap-1">
                                    <Cloud size={11} />
                                    {syncSourceInfo.label}
                                </span>
                            </div>
                            <p className="text-[11px] text-fg-muted">
                                {isEn ? 'Exact historical OHLCV loaded from the synced local cache batch.' : 'Dados históricos exatos carregados do lote sincronizado em cache local.'}
                            </p>
                        </div>

                        <button
                            type="button"
                            onClick={handleOpenReplayModal}
                            className="h-8 px-3 rounded-lg bg-accent hover:bg-accent-hover text-accent-on text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
                        >
                            <Play size={12} fill="currentColor" />
                            <span>{isEn ? 'Replay This Execution →' : 'Fazer Replay deste Trade →'}</span>
                        </button>
                    </div>

                    <TradeChart
                        symbol={trade.symbol}
                        openTime={trade.openTime}
                        closeTime={trade.closeTime}
                        openPrice={Number(trade.openPrice)}
                        closePrice={Number(trade.closePrice)}
                        type={trade.type}
                        profit={netProfit}
                        onAvailabilityChange={setHasCachedMarketData}
                    />
                </div>

                {/* Vitrine Centralizada de Imagens Anexadas (ANTES / DEPOIS + Extras) */}
                {hasAnyAttachedImages && (
                    <div className="bg-surface border border-line rounded-xl p-4 sm:p-5 space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                                <h3 className="text-sm font-bold text-fg flex items-center gap-2">
                                    <ImageIcon size={15} className="text-data-1" />
                                    {isEn ? 'Attached Charts · BEFORE / AFTER' : 'Capturas Anexadas · ANTES / DEPOIS'}
                                </h3>
                                <span
                                    className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border ${
                                        imageSource === 'daily'
                                            ? 'bg-accent/10 text-accent-fg border-accent/25'
                                            : 'bg-data-1/10 text-data-1 border-data-1/25'
                                    }`}
                                >
                                    {imageSource === 'daily'
                                        ? (isEn ? 'Inherited from Daily Log' : 'Herdado do Diário do Dia')
                                        : (isEn ? 'Execution Screenshots' : 'Capturas da Operação')}
                                </span>
                            </div>

                            {parsedScreenshots.before && parsedScreenshots.after && (
                                <button
                                    type="button"
                                    onClick={() => setLightboxState({ mode: 'compare' })}
                                    className="h-7 px-2.5 rounded-lg bg-surface-2 hover:bg-surface-3 border border-line text-fg text-[11px] font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                                >
                                    <Columns size={13} className="text-accent-fg" />
                                    {isEn ? 'Compare Side by Side' : 'Comparar Lado a Lado'}
                                </button>
                            )}
                        </div>

                        {(parsedScreenshots.before || parsedScreenshots.after) && (
                            <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-4 items-center justify-items-center">
                                {parsedScreenshots.before && (
                                    <div className="w-full rounded-xl border-2 border-data-1/40 bg-canvas-subtle p-2.5 shadow-sm flex flex-col items-center">
                                        <div className="w-full flex items-center justify-between mb-2 px-1">
                                            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-data-1/15 text-data-1 border border-data-1/30">
                                                {isEn ? 'BEFORE · Entry / Setup' : 'ANTES · Entrada / Setup'}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    setLightboxState({
                                                        mode: 'single',
                                                        url: parsedScreenshots.before!,
                                                        label: isEn ? 'BEFORE · Entry / Setup' : 'ANTES · Entrada / Setup',
                                                    })
                                                }
                                                className="p-1 rounded-md text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors cursor-pointer"
                                                title={isEn ? 'Expand BEFORE chart' : 'Ampliar imagem ANTES'}
                                            >
                                                <Maximize2 size={13} />
                                            </button>
                                        </div>
                                        <div
                                            onClick={() =>
                                                setLightboxState({
                                                    mode: 'single',
                                                    url: parsedScreenshots.before!,
                                                    label: isEn ? 'BEFORE · Entry / Setup' : 'ANTES · Entrada / Setup',
                                                })
                                            }
                                            className="w-full h-64 sm:h-72 xl:h-80 rounded-lg bg-canvas border border-line-subtle overflow-hidden flex items-center justify-center cursor-zoom-in"
                                        >
                                            <img
                                                src={parsedScreenshots.before}
                                                alt={isEn ? 'BEFORE chart' : 'Gráfico ANTES'}
                                                className="max-h-full max-w-full object-contain mx-auto"
                                            />
                                        </div>
                                    </div>
                                )}

                                {parsedScreenshots.after && (
                                    <div className="w-full rounded-xl border-2 border-accent/40 bg-canvas-subtle p-2.5 shadow-sm flex flex-col items-center">
                                        <div className="w-full flex items-center justify-between mb-2 px-1">
                                            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-accent/15 text-accent-fg border border-accent/30">
                                                {isEn ? 'AFTER · Exit / Outcome' : 'DEPOIS · Saída / Resultado'}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    setLightboxState({
                                                        mode: 'single',
                                                        url: parsedScreenshots.after!,
                                                        label: isEn ? 'AFTER · Exit / Outcome' : 'DEPOIS · Saída / Resultado',
                                                    })
                                                }
                                                className="p-1 rounded-md text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors cursor-pointer"
                                                title={isEn ? 'Expand AFTER chart' : 'Ampliar imagem DEPOIS'}
                                            >
                                                <Maximize2 size={13} />
                                            </button>
                                        </div>
                                        <div
                                            onClick={() =>
                                                setLightboxState({
                                                    mode: 'single',
                                                    url: parsedScreenshots.after!,
                                                    label: isEn ? 'AFTER · Exit / Outcome' : 'DEPOIS · Saída / Resultado',
                                                })
                                            }
                                            className="w-full h-64 sm:h-72 xl:h-80 rounded-lg bg-canvas border border-line-subtle overflow-hidden flex items-center justify-center cursor-zoom-in"
                                        >
                                            <img
                                                src={parsedScreenshots.after}
                                                alt={isEn ? 'AFTER chart' : 'Gráfico DEPOIS'}
                                                className="max-h-full max-w-full object-contain mx-auto"
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {parsedScreenshots.extras.length > 0 && (
                            <div className="pt-2 border-t border-line-subtle">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-fg-subtle block text-center mb-2.5">
                                    {isEn ? `Additional Captures (${parsedScreenshots.extras.length})` : `Capturas Extras (${parsedScreenshots.extras.length})`}
                                </span>
                                <div className="flex flex-wrap items-center justify-center gap-3">
                                    {parsedScreenshots.extras.map((extraUrl, idx) => (
                                        <div
                                            key={`${extraUrl}-${idx}`}
                                            onClick={() =>
                                                setLightboxState({
                                                    mode: 'single',
                                                    url: extraUrl,
                                                    label: `Extra #${idx + 1}`,
                                                })
                                            }
                                            className="w-56 sm:w-64 h-40 rounded-xl border border-line bg-canvas-subtle p-1.5 flex items-center justify-center overflow-hidden cursor-zoom-in hover:border-line-strong transition-colors"
                                        >
                                            <img
                                                src={extraUrl}
                                                alt={`Extra ${idx + 1}`}
                                                className="max-h-full max-w-full object-contain mx-auto rounded-lg"
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Context Sections */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {/* Technical Journal Context */}
                    <div className="bg-surface border border-line rounded-xl p-4 sm:p-5 h-full flex flex-col">
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                            <div className="flex flex-wrap items-center gap-2">
                                <h3 className="text-sm font-bold text-fg flex items-center gap-2">
                                    <Target size={15} className="text-accent-fg" /> {isEn ? 'Technical Breakdown' : 'Análise Técnica'}
                                </h3>
                                {annotationSource === 'trade' && (
                                    <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-data-1/10 text-data-1 border border-data-1/25">
                                        {isEn ? 'Execution Note' : 'Nota da Operação'}
                                    </span>
                                )}
                                {annotationSource === 'daily' && (
                                    <span
                                        className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-accent/10 text-accent-fg border border-accent/25"
                                        title={isEn ? 'This execution had no individual note; daily journal context for this session date is displayed here.' : 'Esta operação não tinha anotação individual; os dados e anotações do Diário desta data foram espalhados aqui.'}
                                    >
                                        {isEn ? 'Daily Log Applied' : 'Diário do Dia Aplicado'}
                                    </span>
                                )}
                            </div>

                            {Boolean(trade.rating || technicalJournal?.rating) && (
                                <div className="px-2 py-0.5 rounded-md bg-surface-2 border border-line text-fg-muted text-[11px] font-semibold tabular-nums">
                                    {isEn ? 'Rating:' : 'Avaliação:'}{' '}
                                    {trade.rating
                                        ? `${trade.rating}/5 ★`
                                        : `${technicalJournal?.rating}/10`}
                                </div>
                            )}
                        </div>

                        {hasTechnicalContent ? (
                            <div className="space-y-4 flex-1">
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                    {[
                                        {
                                            label: isEn ? 'Market Bias' : 'Tendência / Viés',
                                            val:
                                                trade.marketBias ||
                                                dailyNote?.marketBias ||
                                                technicalJournal?.marketTrend,
                                        },
                                        {
                                            label: 'Setup',
                                            val:
                                                trade.setup ||
                                                tradeNote?.setup ||
                                                technicalJournal?.strategyUsed,
                                        },
                                        {
                                            label: isEn ? 'MFE (Max Fav.)' : 'MFE (Máx Fav.)',
                                            val:
                                                trade.mfe !== null && trade.mfe !== undefined
                                                    ? `+$${Number(trade.mfe).toFixed(2)}`
                                                    : undefined,
                                        },
                                        {
                                            label: isEn ? 'MAE (Max Adv.)' : 'MAE (Máx Adv.)',
                                            val:
                                                trade.mae !== null && trade.mae !== undefined
                                                    ? `-$${Math.abs(Number(trade.mae)).toFixed(2)}`
                                                    : undefined,
                                        },
                                        {
                                            label: isEn ? 'Entry Trigger' : 'Gatilho / Entrada',
                                            val:
                                                tradeNote?.psychCheck?.entryDriver ||
                                                technicalJournal?.entryPrecision,
                                        },
                                        {
                                            label: isEn ? 'Plan Adherence' : 'Aderência Plano',
                                            val:
                                                tradeNote?.psychCheck?.followingPlan
                                                    ? `${isEn ? 'Plan' : 'Plano'}: ${tradeNote.psychCheck.followingPlan}`
                                                    : technicalJournal?.setupQuality,
                                        },
                                        {
                                            label: isEn ? 'Risk Comfort' : 'Conforto Risco',
                                            val:
                                                tradeNote?.psychCheck?.riskComfort ||
                                                technicalJournal?.riskManagement,
                                        },
                                        {
                                            label: isEn ? 'Volatility' : 'Volatilidade',
                                            val:
                                                technicalJournal?.volatility ||
                                                technicalJournal?.tradeExit,
                                        },
                                    ].map((item) => (
                                        <div
                                            key={item.label}
                                            className="p-2.5 bg-canvas-subtle rounded-lg border border-line-subtle"
                                        >
                                            <span className="text-[10px] text-fg-subtle uppercase font-semibold block mb-0.5">
                                                {item.label}
                                            </span>
                                            <span className="font-semibold text-fg text-xs">
                                                {item.val || '—'}
                                            </span>
                                        </div>
                                    ))}
                                </div>

                                <div className="space-y-2.5">
                                    {(trade.setup || technicalJournal?.strategyUsed) && (
                                        <div className="p-3 bg-canvas-subtle rounded-lg border border-line-subtle">
                                            <span className="text-[10px] text-accent-fg font-bold uppercase mb-1 flex items-center gap-1.5">
                                                <Zap size={12} /> {isEn ? 'Playbook / Setup' : 'Estratégia / Setup'}
                                            </span>
                                            <p className="text-fg text-xs leading-relaxed">
                                                {trade.setup ||
                                                    technicalJournal?.strategyUsed ||
                                                    (isEn ? 'Unspecified' : 'Não especificado')}
                                            </p>
                                        </div>
                                    )}

                                    {/* Anotação Rica do Trade (quando existente) */}
                                    {tradePlainText && (
                                        <div className="p-3.5 bg-canvas-subtle border border-data-1/25 rounded-xl">
                                            <span className="text-[10px] text-data-1 font-bold uppercase mb-1.5 flex items-center gap-1.5">
                                                <BookOpen size={12} /> {isEn ? 'Execution Notes' : 'Anotações da Operação'}
                                            </span>
                                            <div
                                                className="text-fg text-xs leading-relaxed space-y-2 [&_img]:block [&_img]:mx-auto [&_img]:my-2.5 [&_img]:max-h-[360px] [&_img]:object-contain [&_img]:rounded-lg [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4"
                                                dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(tradeRichHtml) }}
                                            />
                                        </div>
                                    )}

                                    {/* Espalhamento Automático da Anotação Diária quando o trade não tem nota própria (ou contexto complementar) */}
                                    {dailyPlainText && (
                                        <div
                                            className={`p-3.5 bg-canvas-subtle rounded-xl border ${
                                                !tradePlainText
                                                    ? 'border-accent/30'
                                                    : 'border-line-subtle'
                                            }`}
                                        >
                                            <span className="text-[10px] text-accent-fg font-bold uppercase mb-1.5 flex items-center gap-1.5">
                                                <Calendar size={12} />
                                                {!tradePlainText
                                                    ? `${isEn ? 'Applied Daily Notes' : 'Anotações Diárias Aplicadas'}${
                                                          dailyNote?.title
                                                              ? ` · ${dailyNote.title}`
                                                              : ''
                                                      }`
                                                    : `${isEn ? 'Session Daily Context' : 'Contexto do Diário do Dia'}${
                                                          dailyNote?.title
                                                              ? ` · ${dailyNote.title}`
                                                              : ''
                                                      }`}
                                            </span>
                                            <div
                                                className="text-fg text-xs leading-relaxed space-y-2 [&_img]:block [&_img]:mx-auto [&_img]:my-2.5 [&_img]:max-h-[360px] [&_img]:object-contain [&_img]:rounded-lg [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4"
                                                dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(dailyRichHtml) }}
                                            />
                                        </div>
                                    )}

                                    {technicalJournal?.mistakes && (
                                        <div className="p-3 bg-danger/5 border border-danger/15 rounded-lg">
                                            <span className="text-[10px] text-danger-fg font-bold uppercase mb-1 flex items-center gap-1.5">
                                                <AlertTriangle size={12} /> {isEn ? 'Mistakes' : 'Erros'}
                                            </span>
                                            <p className="text-fg text-xs whitespace-pre-line">
                                                {technicalJournal.mistakes}
                                            </p>
                                        </div>
                                    )}

                                    {technicalJournal?.rulesBroken && (
                                        <div className="p-3 bg-danger/5 border border-danger/15 rounded-lg">
                                            <span className="text-[10px] text-danger-fg font-bold uppercase mb-1 flex items-center gap-1.5">
                                                <AlertTriangle size={12} /> {isEn ? 'Rules Violated' : 'Regras Quebradas'}
                                            </span>
                                            <p className="text-fg text-xs whitespace-pre-line">
                                                {technicalJournal.rulesBroken}
                                            </p>
                                        </div>
                                    )}

                                    {(technicalJournal?.lessons || trade.lesson) &&
                                        (technicalJournal?.lessons || trade.lesson) !==
                                            tradePlainText &&
                                        (technicalJournal?.lessons || trade.lesson) !==
                                            dailyPlainText && (
                                            <div className="p-3 bg-accent/5 border border-accent/15 rounded-lg">
                                                <span className="text-[10px] text-accent-fg font-bold uppercase mb-1 flex items-center gap-1.5">
                                                    <Award size={12} /> {isEn ? 'Key Lessons' : 'Lições'}
                                                </span>
                                                <p className="text-fg text-xs whitespace-pre-line">
                                                    {technicalJournal?.lessons || trade.lesson}
                                                </p>
                                            </div>
                                        )}

                                    {technicalJournal?.actionPlan && (
                                        <div className="p-3 bg-canvas-subtle border border-line-subtle rounded-lg">
                                            <span className="text-[10px] text-fg font-bold uppercase mb-1 flex items-center gap-1.5">
                                                <Target size={12} className="text-accent-fg" /> {isEn ? 'Action Plan' : 'Plano de Ação'}
                                            </span>
                                            <p className="text-fg text-xs whitespace-pre-line">
                                                {technicalJournal.actionPlan}
                                            </p>
                                        </div>
                                    )}

                                    {technicalJournal?.notes &&
                                        !tradePlainText &&
                                        !dailyPlainText && (
                                            <div className="p-3 bg-canvas-subtle border border-line-subtle rounded-lg">
                                                <span className="text-[10px] text-fg-subtle font-bold uppercase mb-1 block">
                                                    {isEn ? 'Technical Notes' : 'Notas Técnicas'}
                                                </span>
                                                <p className="text-fg-muted text-xs whitespace-pre-line">
                                                    {technicalJournal.notes}
                                                </p>
                                            </div>
                                        )}
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center flex-1 text-fg-subtle border border-dashed border-line rounded-xl p-8 text-xs text-center gap-2">
                                <Calendar size={24} className="opacity-50" />
                                <p>{isEn ? 'No technical journal entry recorded for this session date.' : 'Nenhum diário técnico encontrado para esta data.'}</p>
                                <button
                                    type="button"
                                    onClick={() => navigate('/journal')}
                                    className="mt-1 px-3 py-1.5 rounded-lg bg-surface-2 hover:bg-surface-3 border border-line text-fg font-semibold text-[11px] cursor-pointer transition-colors"
                                >
                                    {isEn ? 'Log Journal Entry →' : 'Registrar Anotação no Diário →'}
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Mental Context */}
                    <div className="bg-surface border border-line rounded-xl p-4 sm:p-5 h-full flex flex-col">
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                            <div className="flex flex-wrap items-center gap-2">
                                <h3 className="text-sm font-bold text-fg flex items-center gap-2">
                                    <Brain size={15} className="text-data-radar" /> {isEn ? 'Mindset & Psychology' : 'Gestão Emocional'}
                                </h3>
                                {tradePsychChips.length > 0 ? (
                                    <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-data-1/10 text-data-1 border border-data-1/25">
                                        {isEn ? 'Execution Mindset' : 'Sentimento do Trade'}
                                    </span>
                                ) : dailyPsychChips.length > 0 || dailyNote?.mood || mentalLog ? (
                                    <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-accent/10 text-accent-fg border border-accent/25">
                                        {isEn ? 'Session Mindset' : 'Estado Emocional do Dia'}
                                    </span>
                                ) : null}
                            </div>

                            {normalizedOverallScore !== null && (
                                <div className="px-2 py-0.5 rounded-md bg-surface-2 border border-line text-fg-muted text-[11px] font-semibold tabular-nums">
                                    {isEn ? 'Daily Score' : 'Score Diário'}: {normalizedOverallScore}/100
                                </div>
                            )}
                        </div>

                        {hasMentalContent ? (
                            <div className="space-y-4 flex-1">
                                {/* Diagnóstico Comportamental IA (PyTorch + LightGBM) */}
                                {behaviorMl && (
                                    <div className="p-3.5 bg-canvas-subtle rounded-xl border border-line space-y-3">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <span className="text-[10px] font-bold uppercase tracking-wider text-fg flex items-center gap-1.5">
                                                <ShieldAlert size={13} className="text-accent-fg" />
                                                {isEn ? 'Behavioral AI Diagnosis (PyTorch + LightGBM)' : 'Diagnóstico Comportamental IA (PyTorch + LightGBM)'}
                                            </span>
                                            <BehaviorMlBadge
                                                ml={behaviorMl}
                                                feedback={behaviorFeedback}
                                                isEn={isEn}
                                                compact={false}
                                                hideWhenClean={false}
                                            />
                                        </div>

                                        <div className="space-y-1">
                                            <div className="flex items-center justify-between text-[11px]">
                                                <span className="text-fg-muted">
                                                    {isEn ? 'Causal Anomaly Score' : 'Score de Anomalia Causal'}
                                                </span>
                                                <span className="font-mono font-bold tabular-nums text-fg">
                                                    {Math.round(Number(behaviorMl.anomalyScore) || 0)}/100
                                                </span>
                                            </div>
                                            <div className="w-full h-1.5 bg-surface-2 rounded-full overflow-hidden">
                                                <div
                                                    className={`h-full transition-all ${
                                                        Number(behaviorMl.anomalyScore) >= 85
                                                            ? 'bg-danger'
                                                            : Number(behaviorMl.anomalyScore) >= 65
                                                              ? 'bg-warning'
                                                              : 'bg-accent'
                                                    }`}
                                                    style={{
                                                        width: `${Math.min(100, Math.max(2, Math.round(Number(behaviorMl.anomalyScore) || 0)))}%`,
                                                    }}
                                                />
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-3 gap-2 text-[10px]">
                                            <div className="p-2 rounded-lg bg-surface border border-line-subtle">
                                                <span className="text-fg-subtle uppercase block">{isEn ? 'Session' : 'Sessão'}</span>
                                                <strong className="text-fg truncate block">{behaviorMl.effectiveSession || '—'}</strong>
                                            </div>
                                            <div className="p-2 rounded-lg bg-surface border border-line-subtle">
                                                <span className="text-fg-subtle uppercase block">{isEn ? 'Strategy' : 'Estratégia'}</span>
                                                <strong className="text-fg truncate block">{behaviorMl.effectiveStrategy || '—'}</strong>
                                            </div>
                                            <div className="p-2 rounded-lg bg-surface border border-line-subtle">
                                                <span className="text-fg-subtle uppercase block">{isEn ? 'Mode' : 'Modo'}</span>
                                                <strong className="text-fg truncate block">{behaviorMl.executionMode || '—'}</strong>
                                            </div>
                                        </div>

                                        {Array.isArray(behaviorMl.activeFlags) && behaviorMl.activeFlags.length > 0 && (
                                            <div className="flex flex-wrap gap-1.5">
                                                {behaviorMl.activeFlags.map((flag) => {
                                                    const prob = behaviorMl.probabilities?.[flag];
                                                    const pct = prob !== undefined ? `${Math.round(prob * 100)}%` : '';
                                                    return (
                                                        <span
                                                            key={flag}
                                                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-warning/10 text-warning border border-warning/25"
                                                        >
                                                            <span>{formatBehaviorPatternLabel(flag, isEn, false)}</span>
                                                            {pct && <span className="font-mono opacity-80">{pct}</span>}
                                                        </span>
                                                    );
                                                })}
                                            </div>
                                        )}

                                        {Array.isArray(behaviorMl.reasons) && behaviorMl.reasons.length > 0 && (
                                            <ul className="space-y-1 text-[11px] text-fg-muted list-disc pl-4">
                                                {behaviorMl.reasons.map((r, idx) => (
                                                    <li key={idx}>{r}</li>
                                                ))}
                                            </ul>
                                        )}

                                        <div className="pt-2 border-t border-line-subtle flex flex-wrap items-center justify-between gap-2">
                                            <span className="text-[10px] text-fg-subtle">
                                                {behaviorFeedback
                                                    ? behaviorFeedback.verdict === 'CONFIRM'
                                                        ? isEn
                                                            ? 'Feedback saved: Pattern confirmed (5x training weight).'
                                                            : 'Feedback salvo: Padrão confirmado (peso 5x no retreino).'
                                                        : isEn
                                                          ? 'Feedback saved: Marked as False Positive.'
                                                          : 'Feedback salvo: Marcado como Falso Positivo.'
                                                    : isEn
                                                      ? 'Did this diagnosis match your execution reality?'
                                                      : 'Este diagnóstico refletiu a realidade da operação?'}
                                            </span>
                                            <div className="flex items-center gap-1.5">
                                                <button
                                                    type="button"
                                                    disabled={isSubmittingFeedback}
                                                    onClick={() => void handleBehaviorFeedback('CONFIRM')}
                                                    className={`h-7 px-2.5 rounded-md text-[11px] font-semibold border transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50 ${
                                                        behaviorFeedback?.verdict === 'CONFIRM'
                                                            ? 'bg-accent text-accent-on border-accent'
                                                            : 'bg-surface hover:bg-surface-2 text-fg border-line'
                                                    }`}
                                                >
                                                    <ThumbsUp size={11} />
                                                    <span>{isEn ? 'Confirm Pattern' : 'Confirmar Padrão'}</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={isSubmittingFeedback}
                                                    onClick={() => void handleBehaviorFeedback('FALSE_POSITIVE')}
                                                    className={`h-7 px-2.5 rounded-md text-[11px] font-semibold border transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50 ${
                                                        behaviorFeedback?.verdict === 'FALSE_POSITIVE'
                                                            ? 'bg-danger/15 text-danger-fg border-danger/30'
                                                            : 'bg-surface hover:bg-surface-2 text-fg-muted hover:text-fg border-line'
                                                    }`}
                                                >
                                                    <ThumbsDown size={11} />
                                                    <span>{isEn ? 'False Positive' : 'Falso Positivo'}</span>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Check-in Psicológico Específico da Operação */}
                                {(tradePsychChips.length > 0 || trade.mood) && (
                                    <div className="p-3 bg-canvas-subtle rounded-xl border border-line-subtle space-y-2">
                                        <span className="text-[10px] text-fg-subtle font-bold uppercase block">
                                            {isEn ? 'Execution State' : 'Sentimento na Execução da Operação'}
                                        </span>
                                        <div className="flex flex-wrap gap-1.5">
                                            {tradePsychChips.length > 0 ? (
                                                tradePsychChips.map((chip) => (
                                                    <span
                                                        key={chip.key}
                                                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs ${chip.toneClass}`}
                                                    >
                                                        <span>{chip.emoji}</span>
                                                        <span className="opacity-75 text-[10px]">
                                                            {chip.label}
                                                        </span>
                                                        <strong>{chip.value}</strong>
                                                    </span>
                                                ))
                                            ) : (
                                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-accent/30 bg-accent/10 text-accent-fg text-xs font-semibold">
                                                    {isEn ? 'Mental State' : 'Estado Emocional'}: {trade.mood}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* Check-in Psicológico Diário (Espalhado do Diário do Dia) */}
                                {(dailyPsychChips.length > 0 || dailyNote?.mood) && (
                                    <div className="p-3 bg-canvas-subtle rounded-xl border border-line-subtle space-y-2">
                                        <span className="text-[10px] text-fg-subtle font-bold uppercase block">
                                            {isEn ? 'Daily Psych Check-in' : 'Check-in Emocional do Dia'}
                                        </span>
                                        <div className="flex flex-wrap gap-1.5">
                                            {dailyPsychChips.length > 0 ? (
                                                dailyPsychChips.map((chip) => (
                                                    <span
                                                        key={chip.key}
                                                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border text-[11px] ${chip.toneClass}`}
                                                    >
                                                        <span>{chip.emoji}</span>
                                                        <span className="opacity-75 text-[10px]">
                                                            {chip.label}:
                                                        </span>
                                                        <strong>{chip.value}</strong>
                                                    </span>
                                                ))
                                            ) : (
                                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-line bg-surface-2 text-fg text-xs font-medium">
                                                    {isEn ? 'Daily Mood' : 'Humor do Dia'}: {dailyNote?.mood}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {mentalLog && (
                                    <>
                                        <div className="grid grid-cols-2 gap-2.5">
                                            {[
                                                { key: 'mood', label: isEn ? 'Mood' : 'Humor', val: mentalLog.mood, color: 'text-warning' },
                                                { key: 'stress', label: isEn ? 'Stress' : 'Estresse', val: mentalLog.stress, color: 'text-danger-fg' },
                                                { key: 'focus', label: isEn ? 'Focus' : 'Foco', val: mentalLog.focus, color: 'text-fg' },
                                                { key: 'energy', label: isEn ? 'Energy' : 'Energia', val: mentalLog.energy, color: 'text-accent-fg' },
                                            ].map((stat, i) => (
                                                <div
                                                    key={i}
                                                    className="flex flex-col items-center justify-center p-3.5 bg-canvas-subtle rounded-xl border border-line-subtle relative overflow-hidden"
                                                >
                                                    <div className="text-2xl mb-1">{getEmoji(stat.key, stat.val)}</div>
                                                    <span className={`text-lg font-bold tabular-nums ${stat.color}`}>
                                                        {Math.round(stat.val * 10)}%
                                                    </span>
                                                    <span className="text-[10px] uppercase text-fg-subtle font-semibold mt-0.5">
                                                        {stat.label}
                                                    </span>

                                                    <div className="absolute bottom-0 left-0 w-full h-0.5 bg-surface-2">
                                                        <div
                                                            className={`h-full ${
                                                                stat.key === 'stress' ? 'bg-danger' : 'bg-accent'
                                                            }`}
                                                            style={{ width: `${Math.min(100, Math.round(stat.val * 10))}%` }}
                                                        />
                                                    </div>
                                                </div>
                                            ))}
                                        </div>

                                        {normalizedOverallScore !== null && (
                                            <div className="p-3 bg-canvas-subtle border border-line-subtle rounded-lg flex items-start gap-2.5">
                                                <Activity className="text-accent-fg shrink-0 mt-0.5" size={15} />
                                                <div>
                                                    <span className="text-[10px] text-fg-subtle font-bold uppercase block mb-0.5">
                                                        {isEn ? 'Performance Insight' : 'Análise de Performance'}
                                                    </span>
                                                    <p className="text-fg text-xs font-medium">
                                                        {getScoreInsight(normalizedOverallScore, isEn)}
                                                    </p>
                                                </div>
                                            </div>
                                        )}

                                        {mentalLog.notes && (
                                            <div className="p-3 bg-canvas-subtle rounded-lg border border-line-subtle">
                                                <span className="text-[10px] text-fg-subtle block mb-1 font-bold uppercase">
                                                    {isEn ? 'Mindset Journal' : 'Diário Emocional'}
                                                </span>
                                                <p className="text-fg-muted text-xs italic whitespace-pre-line">
                                                    "{mentalLog.notes}"
                                                </p>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center flex-1 text-fg-subtle border border-dashed border-line rounded-xl p-8 text-xs text-center gap-2">
                                <Brain size={24} className="opacity-50" />
                                <p>{isEn ? 'No psychology log recorded for this session date.' : 'Nenhum registro emocional encontrado para esta data.'}</p>
                                <button
                                    type="button"
                                    onClick={() => navigate('/journal')}
                                    className="mt-1 px-3 py-1.5 rounded-lg bg-surface-2 hover:bg-surface-3 border border-line text-fg font-semibold text-[11px] cursor-pointer transition-colors"
                                >
                                    {isEn ? 'Log Mindset Check-in →' : 'Registrar Sentimento no Diário →'}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Lightbox de Zoom / Comparação ANTES vs DEPOIS */}
            {lightboxState && (
                <div
                    onClick={() => setLightboxState(null)}
                    className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        className="relative w-full max-w-6xl bg-surface border border-line rounded-2xl p-4 sm:p-5 space-y-3"
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-bold uppercase tracking-wider text-fg">
                                {lightboxState.mode === 'compare'
                                    ? (isEn ? 'Side-by-Side Comparison · BEFORE vs AFTER' : 'Comparação Lado a Lado · ANTES vs DEPOIS')
                                    : lightboxState.label || (isEn ? 'Expanded Chart' : 'Captura Ampliada')}
                            </span>
                            <button
                                type="button"
                                onClick={() => setLightboxState(null)}
                                className="p-1.5 rounded-lg bg-surface-2 hover:bg-surface-3 text-fg cursor-pointer"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        {lightboxState.mode === 'compare' ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center justify-items-center">
                                {parsedScreenshots.before && (
                                    <div className="w-full space-y-1.5 text-center">
                                        <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-data-1/15 text-data-1 border border-data-1/30">
                                            {isEn ? 'BEFORE' : 'ANTES'}
                                        </span>
                                        <div className="w-full h-[65vh] bg-canvas rounded-xl border border-line flex items-center justify-center p-2">
                                            <img
                                                src={parsedScreenshots.before}
                                                alt={isEn ? 'BEFORE' : 'ANTES'}
                                                className="max-h-full max-w-full object-contain mx-auto"
                                            />
                                        </div>
                                    </div>
                                )}
                                {parsedScreenshots.after && (
                                    <div className="w-full space-y-1.5 text-center">
                                        <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-accent/15 text-accent-fg border border-accent/30">
                                            {isEn ? 'AFTER' : 'DEPOIS'}
                                        </span>
                                        <div className="w-full h-[65vh] bg-canvas rounded-xl border border-line flex items-center justify-center p-2">
                                            <img
                                                src={parsedScreenshots.after}
                                                alt={isEn ? 'AFTER' : 'DEPOIS'}
                                                className="max-h-full max-w-full object-contain mx-auto"
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="w-full h-[75vh] bg-canvas rounded-xl border border-line flex items-center justify-center p-2">
                                <img
                                    src={lightboxState.url}
                                    alt={lightboxState.label || 'Screenshot'}
                                    className="max-h-full max-w-full object-contain mx-auto"
                                />
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Replay & Backtest Strategy Setup Modal */}
            <TradeReplaySetupModal
                isOpen={isReplayModalOpen}
                onClose={() => setIsReplayModalOpen(false)}
                trade={trade}
                technicalNotes={technicalJournal?.lessons || technicalJournal?.notes}
                technicalStrategyUsed={technicalJournal?.strategyUsed}
                syncSourceLabel={syncSourceInfo.label}
                accountCurrency={
                    accounts.find((a) => String(a.id) === String(trade.accountId))?.currency ||
                    selectedAccount?.currency
                }
                accountInitialBalance={
                    accounts.find((a) => String(a.id) === String(trade.accountId))?.initialBalance ||
                    selectedAccount?.initialBalance
                }
                hasCachedMarketData={hasCachedMarketData}
                onSavedToBacktest={handleSavedToBacktest}
            />

            {/* Publish Modal */}
            {isPublishModalOpen && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                    <div className="bg-surface border border-line rounded-xl p-5 w-full max-w-md animate-in zoom-in-95">
                        <h2 className="text-base font-bold text-fg mb-3">{isEn ? 'Publish to Network' : 'Publicar no Network'}</h2>
                        <label className="block text-xs text-fg-muted mb-1.5">{isEn ? 'Add a caption' : 'Adicione uma legenda'}</label>
                        <textarea
                            value={publishCaption}
                            onChange={(e) => setPublishCaption(e.target.value)}
                            className="w-full bg-canvas-subtle border border-line rounded-lg p-2.5 text-xs text-fg placeholder-fg-subtle focus:border-accent/50 focus:outline-none resize-none h-24 mb-4"
                            placeholder={isEn ? 'Describe your setup, execution thesis, and takeaways...' : 'Descreva seu trade, o que achou da sua execução...'}
                        />
                        <div className="mb-4">
                            <label className="block text-xs text-fg-muted mb-1.5 font-semibold">{isEn ? 'Visibility' : 'Privacidade'}</label>
                            <div className="flex bg-canvas-subtle border border-line rounded-lg overflow-hidden p-0.5">
                                <button
                                    onClick={() => setPublishVisibility('public')}
                                    className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                                        publishVisibility === 'public'
                                            ? 'bg-accent text-accent-on'
                                            : 'text-fg-muted hover:text-fg'
                                    }`}
                                >
                                    {isEn ? 'Public (Desk Feed)' : 'Público (Comunidade)'}
                                </button>
                                <button
                                    onClick={() => setPublishVisibility('private')}
                                    className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                                        publishVisibility === 'private'
                                            ? 'bg-surface-2 text-fg'
                                            : 'text-fg-muted hover:text-fg'
                                    }`}
                                >
                                    {isEn ? 'Only Me (Private)' : 'Apenas Eu (Privado)'}
                                </button>
                            </div>
                        </div>

                        <div className="flex gap-2 justify-end">
                            <button
                                onClick={() => setIsPublishModalOpen(false)}
                                className="h-8 px-3.5 bg-surface-2 text-fg rounded-lg hover:bg-surface-3 text-xs font-semibold cursor-pointer"
                            >
                                {isEn ? 'Cancel' : 'Cancelar'}
                            </button>
                            <button
                                onClick={handlePublishToNetwork}
                                disabled={isPublishing}
                                className="h-8 px-4 bg-accent text-accent-on rounded-lg hover:bg-accent-hover text-xs font-bold flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                            >
                                {isPublishing ? (isEn ? 'Publishing...' : 'Publicando...') : (isEn ? 'Publish Now' : 'Publicar Agora')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
