import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Download,
    Printer,
    TrendingUp,
    TrendingDown,
    Percent,
    Activity,
    ShieldAlert,
    ChevronLeft,
    ChevronRight,
    Search,
    FileSpreadsheet,
    FileCode,
    RotateCcw,
    Share2,
    Sparkles,
    Mail,
    Lock,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { useLocale } from '../context/LocaleContext';
import { useDashboardFilters } from '../context/DashboardFilterContext';
import {
    OperationalBreakdown,
    toSessionRows,
    toSymbolRows,
    toWeekdayRows,
} from '../components/dashboard/OperationalBreakdown';
import { TradingCalendarView } from '../components/reports/TradingCalendarView';
import { ShareablePerformanceCard } from '../components/reports/ShareablePerformanceCard';
import { exportTradingDocument, DocumentFormat, TOREX_LOGO_URL } from '../utils/documentExporter';
import { formatTradeDate, formatTradeTime, getLocalWeekdayIndex, toLocalDateKey } from '../utils/timezone';
import { ReportsBodySkeleton } from '../components/ui/Skeleton';
import api from '../api';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    BarElement,
    ArcElement,
    Title,
    Tooltip as ChartTooltip,
    Legend as ChartLegend,
    Filler,
} from 'chart.js';
import { Bar, Line } from 'react-chartjs-2';
import { useChartTheme } from '../hooks/useChartTheme';

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    BarElement,
    ArcElement,
    Title,
    ChartTooltip,
    ChartLegend,
    Filler
);

const WEEKDAY_NAMES = [
    'Domingo',
    'Segunda-feira',
    'Terça-feira',
    'Quarta-feira',
    'Quinta-feira',
    'Sexta-feira',
    'Sábado',
];

function resolveSessionBucket(tag?: string | null): 'asia' | 'london' | 'overlap' | 'ny' | 'other' {
    const t = (tag || '').toLowerCase();
    const london = /london|londres/.test(t);
    const ny = /new york|nova iorque|\bny\b/.test(t);
    if (london && ny) return 'overlap';
    if (london) return 'london';
    if (ny) return 'ny';
    if (/sydney|tokyo|t[oó]quio|asia|ásia|asian/.test(t)) return 'asia';
    return 'other';
}

export const Reports = () => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const ct = useChartTheme();
    const { selectedAccountId, selectedAccount, isConsolidated } = useAccount();
    const normalizedTier = String(user?.tier || 'BASIC').toUpperCase();
    const {
        dateRange,
        queryDates,
        filters,
        hasActiveFilters,
        activeFilterCount,
        resetFilters,
        setAvailableSymbols,
    } = useDashboardFilters();
    const printRef = useRef<HTMLDivElement>(null);

    const [loading, setLoading] = useState(true);
    const [rawReportData, setReportData] = useState<any>(null);
    const [executionChartMode, setExecutionChartMode] = useState<'executions' | 'cumulative'>('executions');
    const [showShareModal, setShowShareModal] = useState(false);
    const [sendingEmailReport, setSendingEmailReport] = useState(false);
    const [emailReportFeedback, setEmailReportFeedback] = useState<{
        type: 'success' | 'error';
        text: string;
    } | null>(null);

    // Trade ledger search and pagination
    const [searchTerm, setSearchTerm] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const pageSize = 15;

    // Fetch report data whenever active account or global Header date range changes
    useEffect(() => {
        fetchReport();
    }, [selectedAccountId, dateRange.preset, queryDates.start, queryDates.end]);

    // Reset ledger pagination when operational filters change
    useEffect(() => {
        setCurrentPage(1);
    }, [filters]);

    const fetchReport = async () => {
        try {
            setLoading(true);
            const params: Record<string, string> = {};
            if (selectedAccountId && selectedAccountId !== 'all') {
                params.accountId = selectedAccountId;
            }
            if (dateRange.preset !== 'all') {
                params.startDate = queryDates.start;
                params.endDate = queryDates.end;
            }

            const res = await api.get('/dashboard/report', { params });
            if (res.data) {
                setReportData(res.data);
                setCurrentPage(1);
            }
        } catch (error) {
            console.error('Falha ao carregar relatório:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSendEmailReport = async () => {
        if (normalizedTier !== 'PRO' && normalizedTier !== 'PREMIUM') {
            navigate('/dashboard?plans=1');
            return;
        }
        const frequency = normalizedTier === 'PREMIUM' ? 'WEEKLY' : 'MONTHLY';
        setSendingEmailReport(true);
        setEmailReportFeedback(null);
        try {
            await api.post('/dashboard/report/email', {
                frequency,
                ...(selectedAccountId && selectedAccountId !== 'all'
                    ? { accountId: selectedAccountId }
                    : {}),
            });
            setEmailReportFeedback({
                type: 'success',
                text:
                    frequency === 'WEEKLY'
                        ? isEn
                            ? 'Weekly operational report sent to your email.'
                            : 'Relatório operacional semanal enviado para o seu e-mail.'
                        : isEn
                          ? 'Monthly operational report sent to your email.'
                          : 'Relatório operacional mensal enviado para o seu e-mail.',
            });
        } catch (err: any) {
            setEmailReportFeedback({
                type: 'error',
                text:
                    err?.response?.data?.message ||
                    (isEn
                        ? 'Unable to dispatch email report right now.'
                        : 'Não foi possível enviar o relatório por e-mail agora.'),
            });
        } finally {
            setSendingEmailReport(false);
            window.setTimeout(() => setEmailReportFeedback(null), 5000);
        }
    };

    // Populate Header availableSymbols from all trades in the selected date window
    useEffect(() => {
        if (!rawReportData) return;
        if (Array.isArray(rawReportData.availableSymbols) && rawReportData.availableSymbols.length > 0) {
            setAvailableSymbols(rawReportData.availableSymbols);
            return;
        }
        if (Array.isArray(rawReportData.trades)) {
            const syms = Array.from(
                new Set<string>(
                    rawReportData.trades
                        .map((t: any) => String(t.symbol || '').trim())
                        .filter((s: string) => Boolean(s) && s !== 'Unknown')
                )
            ).sort((a, b) => a.localeCompare(b));
            setAvailableSymbols(syms);
        }
    }, [rawReportData, setAvailableSymbols]);

    // Derive reactively filtered report data from global Header filters (Direção, Resultado, Sessão, Ativos)
    const reportData = useMemo(() => {
        if (!rawReportData) return null;
        if (!hasActiveFilters) return rawReportData;

        const symbolSet = new Set(filters.symbols.map((s) => s.trim().toUpperCase()).filter(Boolean));
        const sessionSet = new Set(filters.sessions.map((s) => s.toLowerCase()));
        const sideNorm = filters.side;
        const outcomeNorm = filters.outcome;

        // rawReportData.trades is ordered newest-first; reverse to chronological ASC for equity curve
        const chronologicalTrades = [...(rawReportData.trades || [])].reverse().filter((t: any) => {
            if (symbolSet.size > 0) {
                const sym = String(t.symbol || '').trim().toUpperCase();
                if (!symbolSet.has(sym)) return false;
            }
            if (sideNorm === 'BUY' || sideNorm === 'SELL') {
                const rawType = String(t.type || '').toUpperCase();
                const isBuy = rawType.includes('BUY') || rawType.includes('CALL') || rawType === 'LONG';
                const isSell = rawType.includes('SELL') || rawType.includes('PUT') || rawType === 'SHORT';
                if (sideNorm === 'BUY' && !isBuy) return false;
                if (sideNorm === 'SELL' && !isSell) return false;
            }
            if (sessionSet.size > 0) {
                const bucket = resolveSessionBucket(t.session);
                if (!sessionSet.has(bucket as any)) return false;
            }
            if (outcomeNorm === 'WIN' || outcomeNorm === 'LOSS' || outcomeNorm === 'BE') {
                const pnl = Number(t.netPnl) || 0;
                if (outcomeNorm === 'WIN' && !(pnl > 0.001)) return false;
                if (outcomeNorm === 'LOSS' && !(pnl < -0.001)) return false;
                if (outcomeNorm === 'BE' && !(Math.abs(pnl) <= 0.001)) return false;
            }
            return true;
        });

        const startBalance = Number(rawReportData?.kpis?.initialBalance) || 0;
        let runningBalance = startBalance;
        let peakEquity = startBalance;
        let currentEquity = startBalance;
        let maxDrawdown = 0;

        let grossProfit = 0;
        let grossLoss = 0;
        let totalNetProfit = 0;
        let wins = 0;
        let losses = 0;
        let breakevens = 0;
        let totalVolume = 0;
        let totalCommission = 0;
        let totalSwap = 0;
        let largestWin = 0;
        let largestLoss = 0;

        const equityCurve: any[] = [];
        const dailyMap = new Map<string, { date: string; pnl: number; trades: number; wins: number; losses: number }>();
        const symbolMap = new Map<string, { symbol: string; trades: number; wins: number; losses: number; pnl: number; volume: number }>();
        const sessionMap = new Map<string, { session: string; trades: number; wins: number; pnl: number }>();
        const dayOfWeekMap = new Map<string, { day: string; weekday: number; trades: number; wins: number; pnl: number }>();

        for (let i = 1; i <= 5; i++) {
            dayOfWeekMap.set(WEEKDAY_NAMES[i], {
                day: WEEKDAY_NAMES[i],
                weekday: i,
                trades: 0,
                wins: 0,
                pnl: 0,
            });
        }

        for (const t of chronologicalTrades) {
            const netPnl = Number(t.netPnl) || 0;
            const vol = Number(t.volume) || 0;
            const comm = Number(t.commission) || 0;
            const swap = Number(t.swap) || 0;

            totalNetProfit += netPnl;
            totalVolume += vol;
            totalCommission += comm;
            totalSwap += swap;

            if (netPnl > 0) {
                wins++;
                grossProfit += netPnl;
                if (netPnl > largestWin) largestWin = netPnl;
            } else if (netPnl < 0) {
                losses++;
                grossLoss += Math.abs(netPnl);
                if (netPnl < largestLoss) largestLoss = netPnl;
            } else {
                breakevens++;
            }

            currentEquity += netPnl;
            runningBalance += netPnl;
            if (currentEquity > peakEquity) peakEquity = currentEquity;
            const dd = peakEquity - currentEquity;
            if (dd > maxDrawdown) maxDrawdown = dd;

            const closeDateStr = t.closeTime ? (toLocalDateKey(t.closeTime) || 'N/A') : 'N/A';
            const closeTimeStr = t.closeTime
                ? formatTradeTime(t.closeTime, { includeSeconds: false, fallback: '' })
                : '';

            equityCurve.push({
                date: closeDateStr,
                time: closeTimeStr,
                ticket: t.ticket || t.id,
                pnl: Number(netPnl.toFixed(2)),
                cumulativePnL: Number(totalNetProfit.toFixed(2)),
                balance: Number(runningBalance.toFixed(2)),
            });

            if (closeDateStr !== 'N/A') {
                const dayItem = dailyMap.get(closeDateStr) || {
                    date: closeDateStr,
                    pnl: 0,
                    trades: 0,
                    wins: 0,
                    losses: 0,
                };
                dayItem.pnl += netPnl;
                dayItem.trades += 1;
                if (netPnl > 0) dayItem.wins += 1;
                else if (netPnl < 0) dayItem.losses += 1;
                dailyMap.set(closeDateStr, dayItem);
            }

            const sym = t.symbol || 'OTHER';
            const symItem = symbolMap.get(sym) || {
                symbol: sym,
                trades: 0,
                wins: 0,
                losses: 0,
                pnl: 0,
                volume: 0,
            };
            symItem.trades += 1;
            symItem.volume += vol;
            symItem.pnl += netPnl;
            if (netPnl > 0) symItem.wins += 1;
            else if (netPnl < 0) symItem.losses += 1;
            symbolMap.set(sym, symItem);

            const sess = t.session || 'General';
            const sessItem = sessionMap.get(sess) || { session: sess, trades: 0, wins: 0, pnl: 0 };
            sessItem.trades += 1;
            sessItem.pnl += netPnl;
            if (netPnl > 0) sessItem.wins += 1;
            sessionMap.set(sess, sessItem);

            if (t.closeTime) {
                const dayIndex = getLocalWeekdayIndex(t.closeTime);
                const dayName = WEEKDAY_NAMES[dayIndex];
                if (!dayOfWeekMap.has(dayName)) {
                    dayOfWeekMap.set(dayName, {
                        day: dayName,
                        weekday: dayIndex,
                        trades: 0,
                        wins: 0,
                        pnl: 0,
                    });
                }
                const dItem = dayOfWeekMap.get(dayName)!;
                dItem.trades += 1;
                dItem.pnl += netPnl;
                if (netPnl > 0) dItem.wins += 1;
            }
        }

        const totalTrades = chronologicalTrades.length;
        const winRate = totalTrades > 0 ? Number(((wins / totalTrades) * 100).toFixed(1)) : 0;
        const profitFactor =
            grossLoss === 0 ? (grossProfit > 0 ? 99.99 : 0) : Number((grossProfit / grossLoss).toFixed(2));
        const averageWin = wins > 0 ? Number((grossProfit / wins).toFixed(2)) : 0;
        const averageLoss = losses > 0 ? Number((grossLoss / losses).toFixed(2)) : 0;
        const riskRewardRatio = averageLoss > 0 ? Number((averageWin / averageLoss).toFixed(2)) : 0;
        const expectancy = totalTrades > 0 ? Number((totalNetProfit / totalTrades).toFixed(2)) : 0;
        const maxDrawdownPercent = peakEquity > 0 ? Number(((maxDrawdown / peakEquity) * 100).toFixed(1)) : 0;

        return {
            ...rawReportData,
            kpis: {
                totalTrades,
                wins,
                losses,
                breakevens,
                winRate,
                netProfit: Number(totalNetProfit.toFixed(2)),
                grossProfit: Number(grossProfit.toFixed(2)),
                grossLoss: Number(grossLoss.toFixed(2)),
                profitFactor,
                averageWin,
                averageLoss,
                riskRewardRatio,
                expectancy,
                maxDrawdown: Number(maxDrawdown.toFixed(2)),
                maxDrawdownPercent,
                largestWin: Number(largestWin.toFixed(2)),
                largestLoss: Number(largestLoss.toFixed(2)),
                totalVolume: Number(totalVolume.toFixed(2)),
                totalCommission: Number(totalCommission.toFixed(2)),
                totalSwap: Number(totalSwap.toFixed(2)),
                initialBalance: startBalance,
                currentBalance: Number(runningBalance.toFixed(2)),
                roi: startBalance > 0 ? Number(((totalNetProfit / startBalance) * 100).toFixed(2)) : 0,
            },
            equityCurve,
            dailyPnL: Array.from(dailyMap.values())
                .map((d) => ({
                    ...d,
                    pnl: Number(d.pnl.toFixed(2)),
                    winRate: d.trades > 0 ? Number(((d.wins / d.trades) * 100).toFixed(1)) : 0,
                }))
                .sort((a, b) => a.date.localeCompare(b.date)),
            bySymbol: Array.from(symbolMap.values())
                .map((s) => ({
                    ...s,
                    pnl: Number(s.pnl.toFixed(2)),
                    volume: Number(s.volume.toFixed(2)),
                    winRate: s.trades > 0 ? Number(((s.wins / s.trades) * 100).toFixed(1)) : 0,
                }))
                .sort((a, b) => b.pnl - a.pnl),
            bySession: Array.from(sessionMap.values()).map((s) => ({
                ...s,
                pnl: Number(s.pnl.toFixed(2)),
                winRate: s.trades > 0 ? Number(((s.wins / s.trades) * 100).toFixed(1)) : 0,
            })),
            byDayOfWeek: Array.from(dayOfWeekMap.values())
                .map((d) => ({
                    ...d,
                    pnl: Number(d.pnl.toFixed(2)),
                    winRate: d.trades > 0 ? Number(((d.wins / d.trades) * 100).toFixed(1)) : 0,
                }))
                .sort((a, b) => ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7)),
            trades: [...chronologicalTrades].reverse(),
        };
    }, [rawReportData, hasActiveFilters, filters]);

    const periodDisplayLabel = useMemo(() => {
        if (dateRange.preset === 'all') return isEn ? 'All-Time History' : 'Todo o Histórico';
        const fmt = isEn ? 'en-US' : 'pt-BR';
        return `${new Date(queryDates.start).toLocaleDateString(fmt)} — ${new Date(
            queryDates.end
        ).toLocaleDateString(fmt)}`;
    }, [dateRange.preset, queryDates.start, queryDates.end, isEn]);

    const handleExportDocument = (format: DocumentFormat) => {
        if (!reportData || !reportData.trades || reportData.trades.length === 0) return;

        exportTradingDocument(
            format,
            {
                accountName:
                    reportData?.accountInfo?.name ||
                    (isConsolidated
                        ? isEn
                            ? 'All Accounts (Consolidated)'
                            : 'Todas as Contas (Consolidado)'
                        : selectedAccount?.name || (isEn ? 'Trading Account' : 'Conta Trading')),
                accountType: reportData?.accountInfo?.type || selectedAccount?.type || 'TRADING',
                broker: reportData?.accountInfo?.broker || selectedAccount?.broker || 'MetaTrader 5',
                currency: reportData?.accountInfo?.currency || selectedAccount?.currency || 'USD',
                periodLabel: periodDisplayLabel,
                kpis: reportData?.kpis,
                trades: reportData.trades,
            },
            locale
        );
    };

    // Filter trades for the ledger search box
    const filteredTrades = useMemo(() => {
        if (!reportData?.trades) return [];
        if (!searchTerm) return reportData.trades;
        const term = searchTerm.toLowerCase();
        return reportData.trades.filter(
            (t: any) =>
                t.symbol?.toLowerCase().includes(term) ||
                String(t.ticket).includes(term) ||
                t.type?.toLowerCase().includes(term) ||
                t.accountName?.toLowerCase().includes(term)
        );
    }, [reportData?.trades, searchTerm]);

    const paginatedTrades = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        return filteredTrades.slice(start, start + pageSize);
    }, [filteredTrades, currentPage]);

    const totalPages = Math.ceil(filteredTrades.length / pageSize) || 1;

    // Chart.js: Execuções / Operações com loss abaixo de zero (Bar Chart)
    const executionsBarData = useMemo(() => {
        if (!reportData?.equityCurve || reportData.equityCurve.length === 0) return null;

        const labels = reportData.equityCurve.map((pt: any, idx: number) => {
            return pt.time ? `${pt.time}` : `#${idx + 1}`;
        });

        return {
            labels,
            datasets: [
                {
                    label: isEn ? 'Net P&L ($)' : 'Resultado ($)',
                    data: reportData.equityCurve.map((pt: any) => pt.pnl),
                    backgroundColor: reportData.equityCurve.map((pt: any) =>
                        pt.pnl >= 0 ? ct.pos : ct.neg
                    ),
                    borderWidth: 0,
                    borderRadius: 4,
                    borderSkipped: 'start' as const,
                    maxBarThickness: 24,
                },
            ],
        };
    }, [reportData?.equityCurve, ct, isEn]);

    // Chart.js: Curva de Lucro Acumulado (Line Chart)
    const cumulativeLineData = useMemo(() => {
        if (!reportData?.equityCurve || reportData.equityCurve.length === 0) return null;

        const labels = reportData.equityCurve.map((pt: any, idx: number) => {
            return pt.time ? `${pt.time}` : `#${idx + 1}`;
        });

        return {
            labels,
            datasets: [
                {
                    label: isEn ? 'Cumulative Equity ($)' : 'Lucro Acumulado ($)',
                    data: reportData.equityCurve.map((pt: any) => pt.cumulativePnL),
                    borderColor: ct.pos,
                    backgroundColor: ct.posWash,
                    borderWidth: 2,
                    fill: true,
                    pointRadius: reportData.equityCurve.length > 50 ? 0 : 2.5,
                    pointHoverRadius: 4,
                    pointBackgroundColor: ct.pos,
                    pointBorderColor: ct.background,
                    tension: 0.25,
                },
            ],
        };
    }, [reportData?.equityCurve, ct, isEn]);

    // Operational Breakdown Metrics (Symbol, Session, Weekday)
    const breakdown = useMemo(
        () => ({
            symbols: toSymbolRows(reportData?.bySymbol),
            sessions: toSessionRows(reportData?.bySession, locale),
            weekdays: toWeekdayRows(reportData?.byDayOfWeek, locale),
        }),
        [reportData?.bySymbol, reportData?.bySession, reportData?.byDayOfWeek, locale]
    );

    const zeroBaselineChartOptions = useMemo(
        () => ({
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: ct.tooltipBg,
                    titleColor: ct.tooltipTitle,
                    bodyColor: ct.tooltipBody,
                    borderColor: ct.tooltipBorder,
                    borderWidth: 1,
                    padding: 10,
                    displayColors: false,
                    callbacks: {
                        label: (context: any) => {
                            const val = Number(context.raw);
                            const isWin = val >= 0;
                            if (isEn) {
                                return `${isWin ? 'Gain: +' : 'Loss: -'}$${Math.abs(val).toFixed(2)}`;
                            }
                            return `${isWin ? 'Lucro: +' : 'Loss: -'}$${Math.abs(val).toFixed(2)}`;
                        },
                    },
                },
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        color: ct.tick,
                        font: { size: 10 },
                        maxRotation: 0,
                        autoSkip: true,
                        maxTicksLimit: 12,
                    },
                },
                y: {
                    grid: {
                        color: (context: any) => {
                            if (context.tick?.value === 0) return ct.label;
                            return ct.grid;
                        },
                        lineWidth: (context: any) => {
                            if (context.tick?.value === 0) return 1.5;
                            return 1;
                        },
                    },
                    ticks: {
                        color: (context: any) => {
                            if (context.tick?.value === 0) return ct.tooltipTitle;
                            return ct.tick;
                        },
                        font: { size: 10 },
                        callback: (val: any) => {
                            const num = Number(val);
                            if (num === 0) return '$0';
                            return num > 0 ? `+$${num}` : `-$${Math.abs(num)}`;
                        },
                    },
                },
            },
        }),
        [ct]
    );

    const kpis = reportData?.kpis;
    const accountInfo = reportData?.accountInfo;

    return (
        <div className="w-full space-y-3 pb-10 print:p-0">
            {/* Printable Report Body */}
            <div
                ref={printRef}
                className="bg-surface border border-line rounded-xl p-4 sm:p-5 relative overflow-hidden text-fg space-y-4"
            >
                <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-3 border-b border-line-subtle pb-4">
                    <div className="flex items-center gap-3 min-w-0">
                        <img
                            src={TOREX_LOGO_URL}
                            alt="Torex Journal Logo"
                            className="w-10 h-10 rounded-lg object-cover border border-accent/25 shrink-0"
                        />
                        <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[10px] font-bold uppercase tracking-widest text-accent-fg">
                                    {isEn ? 'TOREX JOURNAL · OFFICIAL STATEMENT' : 'TOREX JOURNAL · AUDITORIA OFICIAL'}
                                </span>
                                {hasActiveFilters && (
                                    <button
                                        type="button"
                                        onClick={resetFilters}
                                        className="print:hidden inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-accent/10 hover:bg-accent/20 border border-accent/25 text-[10px] font-semibold text-accent-fg transition-colors cursor-pointer"
                                        title={isEn ? 'Clear active header filters' : 'Limpar filtros ativos do Header'}
                                    >
                                        <span>
                                            {activeFilterCount}{' '}
                                            {isEn
                                                ? activeFilterCount === 1
                                                    ? 'active filter'
                                                    : 'active filters'
                                                : activeFilterCount === 1
                                                ? 'filtro ativo'
                                                : 'filtros ativos'}
                                        </span>
                                        <RotateCcw size={10} />
                                    </button>
                                )}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                                <h2 className="text-base font-bold text-fg tracking-tight truncate">
                                    {accountInfo?.name ||
                                        (isConsolidated
                                            ? isEn
                                                ? 'All Accounts (Consolidated)'
                                                : 'Todas as Contas (Consolidado)'
                                            : selectedAccount?.name || (isEn ? 'Trading Account' : 'Conta Trading'))}
                                </h2>
                                {accountInfo?.type && (
                                    <span
                                        className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wider border shrink-0 ${
                                            String(accountInfo.type).toUpperCase() === 'LIVE'
                                                ? 'bg-danger/10 text-danger-fg border-danger/25'
                                                : 'bg-accent/10 text-accent-fg border-accent/25'
                                        }`}
                                    >
                                        {accountInfo.type}
                                    </span>
                                )}
                            </div>
                            <p className="text-[11px] text-fg-muted mt-0.5">
                                {isEn ? 'Broker:' : 'Corretora:'}{' '}
                                <span className="text-fg font-medium">{accountInfo?.broker || 'N/A'}</span> ·
                                {isEn ? ' Currency:' : ' Moeda:'}{' '}
                                <span className="text-accent-fg font-mono font-semibold">
                                    {accountInfo?.currency || 'USD'}
                                </span>
                            </p>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between lg:justify-end gap-3 w-full lg:w-auto">
                        <div className="lg:text-right">
                            <p className="text-[10px] text-fg-subtle uppercase tracking-wider font-semibold">
                                {isEn ? 'Reporting Period' : 'Período Selecionado'}
                            </p>
                            <p className="text-xs font-bold text-fg tabular-nums mt-0.5">
                                {periodDisplayLabel}
                            </p>
                            <p className="text-[10px] text-fg-subtle mt-0.5 tabular-nums">
                                {isEn ? (
                                    <>
                                        Issued {new Date().toLocaleDateString('en-US')} at{' '}
                                        {new Date().toLocaleTimeString('en-US', {
                                            hour: '2-digit',
                                            minute: '2-digit',
                                        })}
                                    </>
                                ) : (
                                    <>
                                        Emitido em {new Date().toLocaleDateString('pt-BR')} às{' '}
                                        {new Date().toLocaleTimeString('pt-BR', {
                                            hour: '2-digit',
                                            minute: '2-digit',
                                        })}
                                    </>
                                )}
                            </p>
                        </div>

                        {/* Compact Export Group inside Report Header (hidden on print) */}
                        <div className="flex flex-wrap items-center gap-1.5 print:hidden">
                            <div className="flex items-center rounded-lg border border-line bg-canvas-subtle p-0.5 gap-0.5">
                                <button
                                    type="button"
                                    onClick={() => handleExportDocument('csv')}
                                    disabled={!reportData?.trades?.length}
                                    className="h-7 px-2 rounded-md text-[11px] font-semibold text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-40"
                                >
                                    <Download size={11} /> CSV
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleExportDocument('excel')}
                                    disabled={!reportData?.trades?.length}
                                    className="h-7 px-2 rounded-md text-[11px] font-semibold text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-40"
                                >
                                    <FileSpreadsheet size={11} /> Excel
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleExportDocument('html')}
                                    disabled={!reportData?.trades?.length}
                                    className="h-7 px-2 rounded-md text-[11px] font-semibold text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-40"
                                >
                                    <FileCode size={11} /> HTML
                                </button>
                            </div>
                            <button
                                type="button"
                                onClick={() => handleExportDocument('pdf')}
                                disabled={!reportData?.trades?.length}
                                className="h-8 px-2.5 rounded-lg bg-accent hover:opacity-95 text-accent-on font-semibold text-xs flex items-center gap-1.5 transition-opacity cursor-pointer disabled:opacity-40"
                            >
                                <Printer size={12} /> PDF
                            </button>
                            <button
                                type="button"
                                onClick={() => setShowShareModal(true)}
                                disabled={!reportData?.trades?.length}
                                className="h-8 px-2.5 rounded-lg bg-surface hover:bg-surface-2 text-fg border border-line font-semibold text-xs flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-40"
                            >
                                <Share2 size={12} className="text-accent-fg" /> {isEn ? 'Share Card' : 'Partilhar Card'}
                            </button>
                            <button
                                type="button"
                                onClick={() => void handleSendEmailReport()}
                                disabled={sendingEmailReport}
                                title={
                                    normalizedTier === 'PREMIUM'
                                        ? isEn
                                            ? 'Send weekly operational report via email (Premium)'
                                            : 'Enviar relatório operacional semanal por e-mail (Premium)'
                                        : normalizedTier === 'PRO'
                                          ? isEn
                                              ? 'Send monthly operational report via email (Pro)'
                                              : 'Enviar relatório operacional mensal por e-mail (Pro)'
                                          : isEn
                                            ? 'Basic includes website view & download. Upgrade to Pro (Monthly Email) or Premium (Weekly Email).'
                                            : 'No plano Básico pode ver e baixar no site. Upgrade para Pro (Mensal por e-mail) ou Premium (Semanal por e-mail).'
                                }
                                className="h-8 px-2.5 rounded-lg bg-surface hover:bg-surface-2 text-fg border border-line font-semibold text-xs flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-40"
                            >
                                {normalizedTier === 'PREMIUM' ? (
                                    <>
                                        <Mail size={12} className="text-emerald-400" />
                                        <span>
                                            {sendingEmailReport
                                                ? isEn
                                                    ? 'Sending...'
                                                    : 'Enviando...'
                                                : isEn
                                                  ? 'Weekly Email'
                                                  : 'E-mail Semanal'}
                                        </span>
                                    </>
                                ) : normalizedTier === 'PRO' ? (
                                    <>
                                        <Mail size={12} className="text-accent-fg" />
                                        <span>
                                            {sendingEmailReport
                                                ? isEn
                                                    ? 'Sending...'
                                                    : 'Enviando...'
                                                : isEn
                                                  ? 'Monthly Email'
                                                  : 'E-mail Mensal'}
                                        </span>
                                    </>
                                ) : (
                                    <>
                                        <Lock size={12} className="text-amber-400" />
                                        <span>{isEn ? 'Email Report (Pro+)' : 'E-mail (Pro/Premium)'}</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>

                {emailReportFeedback && (
                    <div
                        className={`print:hidden px-3 py-2 rounded-lg text-xs font-medium border ${
                            emailReportFeedback.type === 'success'
                                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                                : 'bg-danger/10 border-danger/30 text-danger-fg'
                        }`}
                    >
                        {emailReportFeedback.text}
                    </div>
                )}

                {/* Primary KPIs 4-Card Grid */}
                {loading ? (
                    <ReportsBodySkeleton />
                ) : !kpis || kpis.totalTrades === 0 ? (
                    <div className="py-14 text-center space-y-2">
                        <ShieldAlert size={32} className="mx-auto text-fg-subtle" />
                        <h3 className="text-sm font-bold text-fg">
                            {isEn ? 'No executions found' : 'Nenhuma operação encontrada'}
                        </h3>
                        <p className="text-fg-muted text-xs max-w-md mx-auto">
                            {isEn
                                ? 'No closed trades match the active account, date range, and filters selected above.'
                                : 'Não existem trades fechados para os filtros, período e conta selecionados no topo.'}
                        </p>
                        {hasActiveFilters && (
                            <button
                                type="button"
                                onClick={resetFilters}
                                className="mt-2 inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-canvas-subtle hover:bg-surface-2 border border-line text-xs font-semibold text-accent-fg transition-colors cursor-pointer"
                            >
                                <RotateCcw size={12} />
                                <span>{isEn ? 'Clear filters' : 'Limpar filtros'}</span>
                            </button>
                        )}
                    </div>
                ) : (
                    <>
                        {Number(kpis.netProfit || 0) > 0 && (
                            <div className="print:hidden flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg bg-accent/10 border border-accent/25 text-xs">
                                <span className="flex items-center gap-1.5 text-fg">
                                    <Sparkles size={13} className="text-accent-fg shrink-0" />
                                    {isEn
                                        ? 'Positive period performance! Share your verified Track Record card and unlock +50 AI credits/day.'
                                        : 'Resultado positivo no período! Partilhe o seu card de Track Record e ganhe +50 créditos IA/dia.'}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => setShowShareModal(true)}
                                    className="px-2.5 py-1 rounded-md bg-accent text-accent-on font-semibold text-[11px] hover:opacity-90 transition-opacity cursor-pointer"
                                >
                                    {isEn ? 'Share Result' : 'Partilhar Resultado'}
                                </button>
                            </div>
                        )}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                            {/* Net Profit */}
                            <div className="bg-canvas-subtle p-3.5 rounded-xl border border-line-subtle">
                                <div className="flex justify-between items-center mb-1.5">
                                    <span className="text-[10px] text-fg-subtle uppercase font-semibold tracking-wider">
                                        {isEn ? 'Net P&L' : 'Lucro Líquido'}
                                    </span>
                                    <div
                                        className={`p-1 rounded-md ${
                                            kpis.netProfit >= 0
                                                ? 'bg-accent/10 text-accent-fg'
                                                : 'bg-danger/10 text-danger-fg'
                                        }`}
                                    >
                                        {kpis.netProfit >= 0 ? (
                                            <TrendingUp size={13} />
                                        ) : (
                                            <TrendingDown size={13} />
                                        )}
                                    </div>
                                </div>
                                <div
                                    className={`text-xl font-bold font-mono tabular-nums ${
                                        kpis.netProfit >= 0 ? 'text-accent-fg' : 'text-danger-fg'
                                    }`}
                                >
                                    {kpis.netProfit >= 0 ? '+' : ''}$
                                    {kpis.netProfit.toLocaleString('en-US', {
                                        minimumFractionDigits: 2,
                                    })}
                                </div>
                                <div className="flex justify-between text-[11px] text-fg-muted mt-2 pt-2 border-t border-line-subtle tabular-nums">
                                    <span>
                                        {isEn ? 'Gross Win:' : 'Ganhos:'}{' '}
                                        <strong className="text-accent-fg">
                                            ${kpis.grossProfit.toFixed(2)}
                                        </strong>
                                    </span>
                                    <span>
                                        {isEn ? 'Gross Loss:' : 'Perdas:'}{' '}
                                        <strong className="text-danger-fg">
                                            ${kpis.grossLoss.toFixed(2)}
                                        </strong>
                                    </span>
                                </div>
                            </div>

                            {/* Win Rate */}
                            <div className="bg-canvas-subtle p-3.5 rounded-xl border border-line-subtle">
                                <div className="flex justify-between items-center mb-1.5">
                                    <span className="text-[10px] text-fg-subtle uppercase font-semibold tracking-wider">
                                        {isEn ? 'Win Rate' : 'Taxa de Acerto'}
                                    </span>
                                    <div className="p-1 rounded-md bg-surface-2 text-fg-muted">
                                        <Percent size={13} />
                                    </div>
                                </div>
                                <div className="text-xl font-bold font-mono tabular-nums text-fg">
                                    {kpis.winRate}%
                                </div>
                                <div className="flex justify-between text-[11px] text-fg-muted mt-2 pt-2 border-t border-line-subtle tabular-nums">
                                    <span>
                                        Total: <strong className="text-fg">{kpis.totalTrades}</strong>
                                    </span>
                                    <span>
                                        W: <strong className="text-accent-fg">{kpis.wins}</strong> / L:{' '}
                                        <strong className="text-danger-fg">{kpis.losses}</strong>
                                    </span>
                                </div>
                            </div>

                            {/* Profit Factor */}
                            <div className="bg-canvas-subtle p-3.5 rounded-xl border border-line-subtle">
                                <div className="flex justify-between items-center mb-1.5">
                                    <span className="text-[10px] text-fg-subtle uppercase font-semibold tracking-wider">
                                        {isEn ? 'Profit Factor' : 'Fator de Lucro'}
                                    </span>
                                    <div className="p-1 rounded-md bg-surface-2 text-fg-muted">
                                        <Activity size={13} />
                                    </div>
                                </div>
                                <div className="text-xl font-bold font-mono tabular-nums text-fg">
                                    {kpis.profitFactor}
                                </div>
                                <div className="flex justify-between text-[11px] text-fg-muted mt-2 pt-2 border-t border-line-subtle tabular-nums">
                                    <span>
                                        {isEn ? 'Avg R:R:' : 'R:R Médio:'}{' '}
                                        <strong className="text-fg">1:{kpis.riskRewardRatio}</strong>
                                    </span>
                                    <span>
                                        {isEn ? 'Expectancy:' : 'Expectativa:'}{' '}
                                        <strong
                                            className={
                                                kpis.expectancy >= 0
                                                    ? 'text-accent-fg'
                                                    : 'text-danger-fg'
                                            }
                                        >
                                            ${kpis.expectancy}
                                        </strong>
                                    </span>
                                </div>
                            </div>

                            {/* Max Drawdown */}
                            <div className="bg-canvas-subtle p-3.5 rounded-xl border border-line-subtle">
                                <div className="flex justify-between items-center mb-1.5">
                                    <span className="text-[10px] text-fg-subtle uppercase font-semibold tracking-wider">
                                        {isEn ? 'Max Drawdown' : 'Drawdown Máximo'}
                                    </span>
                                    <div className="p-1 rounded-md bg-danger/10 text-danger-fg">
                                        <ShieldAlert size={13} />
                                    </div>
                                </div>
                                <div className="text-xl font-bold font-mono tabular-nums text-danger-fg">
                                    -${kpis.maxDrawdown.toFixed(2)}
                                </div>
                                <div className="flex justify-between text-[11px] text-fg-muted mt-2 pt-2 border-t border-line-subtle tabular-nums">
                                    <span>
                                        {isEn ? 'Peak-to-Trough:' : 'Rebaixamento:'}{' '}
                                        <strong className="text-danger-fg">
                                            {kpis.maxDrawdownPercent}%
                                        </strong>
                                    </span>
                                    <span>
                                        ROI:{' '}
                                        <strong
                                            className={
                                                kpis.roi >= 0 ? 'text-accent-fg' : 'text-danger-fg'
                                            }
                                        >
                                            {kpis.roi}%
                                        </strong>
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Secondary Metrics Ribbon */}
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 bg-canvas-subtle p-3 rounded-xl border border-line-subtle text-xs tabular-nums">
                            <div>
                                <span className="text-[10px] uppercase tracking-wider text-fg-subtle block">
                                    {isEn ? 'Largest Win' : 'Maior Ganho'}
                                </span>
                                <span className="font-bold font-mono text-accent-fg">
                                    +${kpis.largestWin.toFixed(2)}
                                </span>
                            </div>
                            <div>
                                <span className="text-[10px] uppercase tracking-wider text-fg-subtle block">
                                    {isEn ? 'Largest Loss' : 'Maior Perda'}
                                </span>
                                <span className="font-bold font-mono text-danger-fg">
                                    -${Math.abs(kpis.largestLoss).toFixed(2)}
                                </span>
                            </div>
                            <div>
                                <span className="text-[10px] uppercase tracking-wider text-fg-subtle block">
                                    {isEn ? 'Average Win' : 'Média de Ganho'}
                                </span>
                                <span className="font-bold font-mono text-accent-fg">
                                    +${kpis.averageWin.toFixed(2)}
                                </span>
                            </div>
                            <div>
                                <span className="text-[10px] uppercase tracking-wider text-fg-subtle block">
                                    {isEn ? 'Average Loss' : 'Média de Perda'}
                                </span>
                                <span className="font-bold font-mono text-danger-fg">
                                    -${Math.abs(kpis.averageLoss).toFixed(2)}
                                </span>
                            </div>
                            <div>
                                <span className="text-[10px] uppercase tracking-wider text-fg-subtle block">
                                    {isEn ? 'Volume Traded' : 'Volume Negociado'}
                                </span>
                                <span className="font-bold font-mono text-fg">
                                    {kpis.totalVolume} {isEn ? 'lots' : 'lotes'}
                                </span>
                            </div>
                            <div>
                                <span className="text-[10px] uppercase tracking-wider text-fg-subtle block">
                                    {isEn ? 'Commissions & Swaps' : 'Comissões & Swaps'}
                                </span>
                                <span className="font-bold font-mono text-fg-muted">
                                    -${(kpis.totalCommission + kpis.totalSwap).toFixed(2)}
                                </span>
                            </div>
                        </div>

                        {/* Row: Gráfico por Operação & Calendário Operacional Inline */}
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-stretch">
                            {/* 1. Resultado por Operação / Curva de Lucro Acumulado */}
                            <div className="lg:col-span-5 bg-canvas-subtle p-3.5 sm:p-4 rounded-xl border border-line-subtle flex flex-col justify-between min-w-0">
                                <div className="flex flex-wrap justify-between items-center gap-2 mb-3">
                                    <div>
                                        <h3 className="text-xs font-bold uppercase tracking-wider text-fg flex items-center gap-1.5">
                                            <TrendingUp size={13} className="text-accent-fg" />
                                            {executionChartMode === 'executions'
                                                ? isEn
                                                    ? 'Per-Trade Outcome'
                                                    : 'Resultado por Operação'
                                                : isEn
                                                ? 'Cumulative Equity Curve'
                                                : 'Curva de Lucro Acumulado'}
                                        </h3>
                                        <p className="text-[11px] text-fg-muted mt-0.5">
                                            {executionChartMode === 'executions'
                                                ? isEn
                                                    ? 'Realized P&L per execution relative to $0'
                                                    : 'Operações com loss abaixo da linha de $0'
                                                : isEn
                                                ? 'Running net equity curve across executions'
                                                : 'Evolução acumulada ao longo das execuções'}
                                        </p>
                                    </div>

                                    <div className="flex items-center gap-0.5 bg-surface border border-line p-0.5 rounded-lg">
                                        <button
                                            type="button"
                                            onClick={() => setExecutionChartMode('executions')}
                                            className={`px-2 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer ${
                                                executionChartMode === 'executions'
                                                    ? 'bg-accent text-accent-on font-bold'
                                                    : 'text-fg-muted hover:text-fg'
                                            }`}
                                        >
                                            {isEn ? 'Per Trade' : 'Por Operação'}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setExecutionChartMode('cumulative')}
                                            className={`px-2 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer ${
                                                executionChartMode === 'cumulative'
                                                    ? 'bg-accent text-accent-on font-bold'
                                                    : 'text-fg-muted hover:text-fg'
                                            }`}
                                        >
                                            {isEn ? 'Cumulative' : 'Acumulado'}
                                        </button>
                                    </div>
                                </div>

                                <div className="h-60 sm:h-64 w-full relative my-auto">
                                    {executionChartMode === 'cumulative' ? (
                                        cumulativeLineData ? (
                                            <Line
                                                data={cumulativeLineData}
                                                options={zeroBaselineChartOptions as any}
                                            />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center text-fg-subtle text-xs">
                                                {isEn ? 'Insufficient data' : 'Sem dados suficientes'}
                                            </div>
                                        )
                                    ) : executionsBarData ? (
                                        <Bar
                                            data={executionsBarData}
                                            options={zeroBaselineChartOptions as any}
                                        />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-fg-subtle text-xs">
                                            {isEn ? 'Insufficient data' : 'Sem dados suficientes'}
                                        </div>
                                    )}
                                </div>

                                <div className="flex justify-between text-[10px] text-fg-subtle mt-2.5 border-t border-line-subtle pt-2 font-mono tabular-nums">
                                    <span className="flex items-center gap-1.5">
                                        <span className="w-1.5 h-1.5 rounded-full bg-data-pos inline-block" />{' '}
                                        {isEn ? 'Winners (> $0)' : 'Lucros (> $0)'}
                                    </span>
                                    <span className="flex items-center gap-1.5">
                                        <span className="w-1.5 h-1.5 rounded-full bg-data-neg inline-block" />{' '}
                                        {isEn ? 'Losers (< $0)' : 'Perdas (< $0)'}
                                    </span>
                                    <span>
                                        {reportData.equityCurve?.length || 0}{' '}
                                        {isEn ? 'executions' : 'execuções'}
                                    </span>
                                </div>
                            </div>

                            {/* 2. Calendário Operacional de Resultados */}
                            <div className="lg:col-span-7 min-w-0 flex flex-col">
                                <TradingCalendarView
                                    trades={reportData.trades}
                                    dailyPnL={reportData.dailyPnL}
                                    locale={locale}
                                />
                            </div>
                        </div>

                        {/* Detalhamento Operacional (Ativos, Sessões, Dias) */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <h3 className="text-xs font-bold uppercase tracking-wider text-fg flex items-center gap-1.5">
                                    <Activity size={13} className="text-accent-fg" />
                                    {isEn ? 'Execution Breakdown' : 'Detalhamento Operacional'}
                                </h3>
                                <span className="text-[10px] text-fg-subtle font-mono">
                                    {isEn
                                        ? 'Symbols · Sessions · Days of Week'
                                        : 'Ativos · Sessões · Dias da Semana'}
                                </span>
                            </div>

                            <OperationalBreakdown {...breakdown} locale={locale} />
                        </div>

                        {/* Trade Ledger Table */}
                        <div className="bg-canvas-subtle rounded-xl border border-line-subtle overflow-hidden">
                            <div className="px-4 py-3 border-b border-line-subtle flex flex-col md:flex-row justify-between items-start md:items-center gap-2.5">
                                <div>
                                    <h3 className="text-xs font-bold uppercase tracking-wider text-fg">
                                        {isEn ? 'Trade Ledger' : 'Livro de Ordens (Trade Ledger)'}
                                    </h3>
                                    <p className="text-[11px] text-fg-muted">
                                        {isEn
                                            ? 'Closed executions audited in this statement'
                                            : 'Ordens fechadas computadas neste demonstrativo'}
                                    </p>
                                </div>

                                <div className="relative w-full md:w-60 print:hidden">
                                    <Search
                                        size={13}
                                        className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle"
                                    />
                                    <input
                                        type="text"
                                        placeholder={isEn ? 'Search ticket, pair, side...' : 'Buscar ticket, par, tipo...'}
                                        value={searchTerm}
                                        onChange={(e) => {
                                            setSearchTerm(e.target.value);
                                            setCurrentPage(1);
                                        }}
                                        className="w-full h-8 bg-surface border border-line text-xs rounded-lg pl-8 pr-2.5 text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent/50"
                                    />
                                </div>
                            </div>

                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-xs border-collapse">
                                    <thead className="bg-surface text-fg-subtle font-semibold border-b border-line-subtle uppercase tracking-wider text-[10px]">
                                        <tr>
                                            <th className="px-3.5 py-2.5">Ticket</th>
                                            {isConsolidated && (
                                                <th className="px-3.5 py-2.5">{isEn ? 'Account' : 'Conta'}</th>
                                            )}
                                            <th className="px-3.5 py-2.5">{isEn ? 'Symbol' : 'Ativo'}</th>
                                            <th className="px-3.5 py-2.5">{isEn ? 'Side' : 'Tipo'}</th>
                                            <th className="px-3.5 py-2.5">{isEn ? 'Size' : 'Lote'}</th>
                                            <th className="px-3.5 py-2.5">{isEn ? 'Entry Time' : 'Abertura'}</th>
                                            <th className="px-3.5 py-2.5">{isEn ? 'Exit Time' : 'Fechamento'}</th>
                                            <th className="px-3.5 py-2.5 text-right">{isEn ? 'Net P&L' : 'Resultado'}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-line-subtle">
                                        {paginatedTrades.map((t: any) => (
                                            <tr
                                                key={t.id}
                                                className="hover:bg-surface/60 transition-colors"
                                            >
                                                <td className="px-3.5 py-2 font-mono tabular-nums text-fg-subtle">
                                                    #{t.ticket}
                                                </td>
                                                {isConsolidated && (
                                                    <td className="px-3.5 py-2">
                                                        <span className="font-medium text-fg-muted">
                                                            {t.accountName}
                                                        </span>
                                                    </td>
                                                )}
                                                <td className="px-3.5 py-2 font-bold text-fg">
                                                    {t.symbol}
                                                </td>
                                                <td className="px-3.5 py-2">
                                                    <span
                                                        className={`px-1.5 py-0.5 rounded font-bold text-[10px] border ${
                                                            t.type === 'BUY'
                                                                ? 'bg-accent/10 text-accent-fg border-accent/20'
                                                                : 'bg-danger/10 text-danger-fg border-danger/20'
                                                        }`}
                                                    >
                                                        {t.type}
                                                    </span>
                                                </td>
                                                <td className="px-3.5 py-2 text-fg-muted font-mono tabular-nums">
                                                    {t.volume}
                                                </td>
                                                <td className="px-3.5 py-2 text-fg-muted tabular-nums whitespace-nowrap">
                                                    {t.openTime
                                                        ? `${formatTradeDate(t.openTime)} ${formatTradeTime(t.openTime)}`
                                                        : '—'}
                                                </td>
                                                <td className="px-3.5 py-2 text-fg-muted tabular-nums whitespace-nowrap">
                                                    {t.closeTime
                                                        ? `${formatTradeDate(t.closeTime)} ${formatTradeTime(t.closeTime)}`
                                                        : '—'}
                                                </td>
                                                <td
                                                    className={`px-3.5 py-2 text-right font-semibold font-mono tabular-nums ${
                                                        t.netPnl >= 0 ? 'text-accent-fg' : 'text-danger-fg'
                                                    }`}
                                                >
                                                    {t.netPnl >= 0 ? '+' : ''}${t.netPnl.toFixed(2)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {/* Pagination */}
                            {totalPages > 1 && (
                                <div className="px-3.5 py-2.5 border-t border-line-subtle flex items-center justify-between text-[11px] text-fg-muted bg-surface/40 print:hidden">
                                    <span className="tabular-nums">
                                        {isEn
                                            ? `Page ${currentPage} of ${totalPages} (${filteredTrades.length} trades)`
                                            : `Página ${currentPage} de ${totalPages} (${filteredTrades.length} ordens)`}
                                    </span>
                                    <div className="flex items-center gap-1.5">
                                        <button
                                            type="button"
                                            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                                            disabled={currentPage === 1}
                                            className="h-7 w-7 flex items-center justify-center rounded-md bg-surface hover:bg-surface-2 text-fg-muted hover:text-fg border border-line disabled:opacity-40 cursor-pointer"
                                        >
                                            <ChevronLeft size={14} />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setCurrentPage((p) => Math.min(totalPages, p + 1))
                                            }
                                            disabled={currentPage === totalPages}
                                            className="h-7 w-7 flex items-center justify-center rounded-md bg-surface hover:bg-surface-2 text-fg-muted hover:text-fg border border-line disabled:opacity-40 cursor-pointer"
                                        >
                                            <ChevronRight size={14} />
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>
            <ShareablePerformanceCard
                isOpen={showShareModal}
                onClose={() => setShowShareModal(false)}
                stats={{
                    periodLabel: periodDisplayLabel,
                    totalTrades: Number(kpis?.totalTrades || 0),
                    winRate: Number(kpis?.winRate || 0).toFixed(1),
                    profitFactor: kpis?.profitFactor ?? '0.00',
                    netProfit: Number(kpis?.netProfit || 0),
                    currency: accountInfo?.currency || selectedAccount?.currency || 'USD',
                    symbolFocus: reportData?.bySymbol?.[0]?.symbol,
                }}
            />
        </div>
    );
};
