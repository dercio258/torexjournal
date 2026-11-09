import { useState, useEffect, useMemo, useRef } from 'react';
import { 
    Calendar, Download, Printer, Briefcase, TrendingUp, 
    TrendingDown, Percent, Activity, ShieldAlert,
    ChevronLeft, ChevronRight, Search, FileSpreadsheet, FileCode
} from 'lucide-react';
import { useAccount } from '../context/AccountContext';
import { Button } from '../components/ui/Button';
import { OperationalBreakdown, toSessionRows, toSymbolRows, toWeekdayRows } from '../components/dashboard/OperationalBreakdown';
import { TradingCalendarView } from '../components/reports/TradingCalendarView';
import { exportTradingDocument, DocumentFormat, TOREX_LOGO_URL } from '../utils/documentExporter';
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
    Filler
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

export const Reports = () => {
    const ct = useChartTheme();
    const { selectedAccountId, selectedAccount, accounts, isConsolidated, selectAccount } = useAccount();
    const printRef = useRef<HTMLDivElement>(null);

    const [loading, setLoading] = useState(true);
    const [period, setPeriod] = useState<'all' | 'today' | '7d' | '30d' | 'this_month' | 'custom'>('30d');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [symbolFilter, setSymbolFilter] = useState('ALL');
    const [typeFilter, setTypeFilter] = useState('ALL');
    const [reportData, setReportData] = useState<any>(null);
    const [executionChartMode, setExecutionChartMode] = useState<'executions' | 'cumulative'>('executions');

    // Trade ledger search and pagination
    const [searchTerm, setSearchTerm] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const pageSize = 15;

    // Calculate dates based on period filter
    useEffect(() => {
        const now = new Date();
        const todayStr = now.toISOString().split('T')[0];

        if (period === 'today') {
            setStartDate(todayStr);
            setEndDate(todayStr);
        } else if (period === '7d') {
            const past = new Date();
            past.setDate(now.getDate() - 7);
            setStartDate(past.toISOString().split('T')[0]);
            setEndDate(todayStr);
        } else if (period === '30d') {
            const past = new Date();
            past.setDate(now.getDate() - 30);
            setStartDate(past.toISOString().split('T')[0]);
            setEndDate(todayStr);
        } else if (period === 'this_month') {
            const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
            setStartDate(firstDay.toISOString().split('T')[0]);
            setEndDate(todayStr);
        } else if (period === 'all') {
            setStartDate('');
            setEndDate('');
        }
    }, [period]);

    // Fetch report data whenever filters or active account change
    useEffect(() => {
        fetchReport();
    }, [selectedAccountId, startDate, endDate, symbolFilter, typeFilter]);

    const fetchReport = async () => {
        try {
            setLoading(true);
            const params: any = {};
            if (selectedAccountId && selectedAccountId !== 'all') {
                params.accountId = selectedAccountId;
            }
            if (startDate) params.startDate = `${startDate}T00:00:00.000Z`;
            if (endDate) params.endDate = `${endDate}T23:59:59.999Z`;
            if (symbolFilter !== 'ALL') params.symbol = symbolFilter;
            if (typeFilter !== 'ALL') params.type = typeFilter;

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

    const handleExportDocument = (format: DocumentFormat) => {
        if (!reportData || !reportData.trades || reportData.trades.length === 0) return;

        const periodLabel =
            startDate && endDate
                ? `${new Date(startDate + 'T12:00:00').toLocaleDateString('pt-BR')} — ${new Date(endDate + 'T12:00:00').toLocaleDateString('pt-BR')}`
                : 'Todo o Histórico';

        exportTradingDocument(format, {
            accountName:
                reportData?.accountInfo?.name ||
                (isConsolidated ? 'Todas as Contas (Consolidado)' : selectedAccount?.name || 'Conta Trading'),
            accountType: reportData?.accountInfo?.type || selectedAccount?.type || 'TRADING',
            broker: reportData?.accountInfo?.broker || selectedAccount?.broker || 'MetaTrader 5',
            currency: reportData?.accountInfo?.currency || selectedAccount?.currency || 'USD',
            periodLabel,
            kpis: reportData?.kpis,
            trades: reportData.trades,
        });
    };

    // Filter trades for the ledger
    const filteredTrades = useMemo(() => {
        if (!reportData?.trades) return [];
        if (!searchTerm) return reportData.trades;
        const term = searchTerm.toLowerCase();
        return reportData.trades.filter((t: any) => 
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

    // Available symbols from report data
    const availableSymbols = useMemo(() => {
        if (!reportData?.bySymbol) return [];
        return reportData.bySymbol.map((s: any) => s.symbol);
    }, [reportData?.bySymbol]);

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
                    label: 'Resultado ($)',
                    data: reportData.equityCurve.map((pt: any) => pt.pnl),
                    backgroundColor: reportData.equityCurve.map((pt: any) => (pt.pnl >= 0 ? ct.pos : ct.neg)),
                    borderWidth: 0,
                    borderRadius: 4,
                    borderSkipped: 'start' as const,
                    maxBarThickness: 24
                }
            ]
        };
    }, [reportData?.equityCurve, ct]);

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
                    label: 'Lucro Acumulado ($)',
                    data: reportData.equityCurve.map((pt: any) => pt.cumulativePnL),
                    borderColor: ct.pos,
                    backgroundColor: ct.posWash,
                    borderWidth: 2,
                    fill: true,
                    pointRadius: reportData.equityCurve.length > 50 ? 0 : 2.5,
                    pointHoverRadius: 4,
                    pointBackgroundColor: ct.pos,
                    pointBorderColor: ct.background,
                    tension: 0.25
                }
            ]
        };
    }, [reportData?.equityCurve, ct]);

    // Operational Radar Metrics (Symbol & Session)
    const breakdown = useMemo(
        () => ({
            symbols: toSymbolRows(reportData?.bySymbol),
            sessions: toSessionRows(reportData?.bySession),
            weekdays: toWeekdayRows(reportData?.byDayOfWeek),
        }),
        [reportData?.bySymbol, reportData?.bySession, reportData?.byDayOfWeek]
    );

    // Configuração com Linha de Zero Destacada (Losses abaixo de zero)
    const zeroBaselineChartOptions = useMemo(() => ({
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                display: false
            },
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
                        return `${isWin ? 'Lucro: +' : 'Loss: -'}$${Math.abs(val).toFixed(2)}`;
                    }
                }
            }
        },
        scales: {
            x: {
                grid: {
                    display: false
                },
                ticks: {
                    color: ct.tick,
                    font: { size: 10 },
                    maxRotation: 0,
                    autoSkip: true,
                    maxTicksLimit: 12
                }
            },
            y: {
                grid: {
                    color: (context: any) => {
                        if (context.tick?.value === 0) {
                            return ct.label; // Linha do zero destacada
                        }
                        return ct.grid;
                    },
                    lineWidth: (context: any) => {
                        if (context.tick?.value === 0) return 2;
                        return 1;
                    }
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
                    }
                }
            }
        }
    }), [ct]);



    const kpis = reportData?.kpis;
    const accountInfo = reportData?.accountInfo;

    return (
        <div className="space-y-6 max-w-[1600px] mx-auto pb-12 print:p-0">
            {/* Top Bar / Toolbar */}
            <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-slate-200 dark:border-slate-800/80 pb-4 print:hidden">
                {/* Account Selector Toolbar */}
                <div className="flex items-center gap-2 bg-white dark:bg-slate-900/70 border border-line p-1.5 rounded-xl shadow-xs dark:shadow-lg">
                    <div className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-fg-muted ">
                        <Briefcase size={14} className="text-indigo-600 dark:text-indigo-400" />
                        <span>Conta:</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => selectAccount('all')}
                            className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
 isConsolidated
 ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/30'
 : 'text-fg-muted hover:text-fg hover:bg-slate-100 dark:hover:bg-slate-800/60'
 }`}
                        >
                            Todas
                        </button>
                        {accounts.map((acc) => (
                            <button
                                key={acc.id}
                                onClick={() => selectAccount(acc.id)}
                                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
 selectedAccountId === acc.id
 ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/30'
 : 'text-fg-muted hover:text-fg hover:bg-slate-100 dark:hover:bg-slate-800/60'
 }`}
                            >
                                <span>{acc.name}</span>
                                <span className={`text-[9px] px-1 py-0.2 rounded font-mono uppercase ${
                                    String(acc.type).toUpperCase() === 'LIVE' ? 'bg-rose-500/20 text-rose-600 dark:text-rose-300' : 'bg-blue-500/20 text-blue-600 dark:text-blue-300'
                                }`}>
                                    {acc.type}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Action Buttons — Multi-Format Document Export (CSV, Excel, HTML, PDF) */}
                <div className="flex flex-wrap items-center gap-2">
                    <Button
                        onClick={() => handleExportDocument('csv')}
                        variant="secondary"
                        icon={<Download size={14} />}
                        className="bg-surface-2 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 font-semibold text-xs py-2 px-3"
                        disabled={!reportData?.trades?.length}
                    >
                        CSV
                    </Button>
                    <Button
                        onClick={() => handleExportDocument('excel')}
                        variant="secondary"
                        icon={<FileSpreadsheet size={14} />}
                        className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 font-semibold text-xs py-2 px-3"
                        disabled={!reportData?.trades?.length}
                    >
                        Excel (.xls)
                    </Button>
                    <Button
                        onClick={() => handleExportDocument('html')}
                        variant="secondary"
                        icon={<FileCode size={14} />}
                        className="bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30 font-semibold text-xs py-2 px-3"
                        disabled={!reportData?.trades?.length}
                    >
                        HTML
                    </Button>
                    <Button
                        onClick={() => handleExportDocument('pdf')}
                        variant="gradient"
                        icon={<Printer size={14} />}
                        className="font-semibold shadow-md shadow-emerald-500/10 text-xs py-2 px-3"
                        disabled={!reportData?.trades?.length}
                    >
                        PDF Executivo
                    </Button>
                </div>
            </header>

            {/* Filter Bar */}
            <div className="bg-white dark:bg-slate-900/60 backdrop-blur-xl border border-line rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4 shadow-xs dark:shadow-none print:hidden">
                {/* Period Pills */}
                <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-semibold uppercase text-fg-subtle dark:text-slate-400 mr-2 flex items-center gap-1.5">
                        <Calendar size={13} /> Período:
                    </span>
                    {(['today', '7d', '30d', 'this_month', 'all', 'custom'] as const).map((p) => (
                        <button
                            key={p}
                            onClick={() => setPeriod(p)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
 period === p
 ? 'bg-emerald-500 text-slate-950 font-bold shadow-sm shadow-emerald-500/30'
 : 'bg-slate-100 dark:bg-slate-800/80 text-fg-muted hover:text-fg hover:bg-slate-200 dark:hover:bg-slate-700/80 border border-slate-200 dark:border-slate-700/50'
 }`}
                        >
                            {p === 'today' && 'Hoje'}
                            {p === '7d' && '7 Dias'}
                            {p === '30d' && '30 Dias'}
                            {p === 'this_month' && 'Este Mês'}
                            {p === 'all' && 'Todo Histórico'}
                            {p === 'custom' && 'Personalizado'}
                        </button>
                    ))}
                </div>

                {/* Custom Dates & Filters */}
                <div className="flex flex-wrap items-center gap-3">
                    {period === 'custom' && (
                        <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-lg border border-slate-200 dark:border-slate-700">
                            <input
                                type="date"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                                className="bg-transparent text-xs text-fg px-2 py-1 focus:outline-none"
                            />
                            <span className="text-fg-subtle text-xs">até</span>
                            <input
                                type="date"
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                                className="bg-transparent text-xs text-fg px-2 py-1 focus:outline-none"
                            />
                        </div>
                    )}

                    {/* Symbol Filter */}
                    <div className="flex items-center gap-1.5">
                        <span className="text-xs text-fg-subtle dark:text-slate-400 font-medium">Par:</span>
                        <select
                            value={symbolFilter}
                            onChange={(e) => setSymbolFilter(e.target.value)}
                            className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-fg text-xs font-semibold rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        >
                            <option value="ALL">Todos os Pares</option>
                            {availableSymbols.map((sym: string) => (
                                <option key={sym} value={sym}>{sym}</option>
                            ))}
                        </select>
                    </div>

                    {/* Type Filter */}
                    <div className="flex items-center gap-1.5">
                        <span className="text-xs text-fg-subtle dark:text-slate-400 font-medium">Ordem:</span>
                        <select
                            value={typeFilter}
                            onChange={(e) => setTypeFilter(e.target.value)}
                            className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-fg text-xs font-semibold rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        >
                            <option value="ALL">BUY & SELL</option>
                            <option value="BUY">BUY Apenas</option>
                            <option value="SELL">SELL Apenas</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* Printable Header - Visible in Print or Screen */}
            <div ref={printRef} className="bg-surface border border-line rounded-2xl p-6 relative overflow-hidden shadow-sm dark:shadow-xl text-fg ">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-line pb-5 mb-6">
                    <div className="flex items-center gap-3.5">
                        <img
                            src={TOREX_LOGO_URL}
                            alt="Torex Journal Logo"
                            className="w-12 h-12 rounded-xl object-cover border border-emerald-500/30 shadow-lg shadow-emerald-500/10 shrink-0"
                        />
                        <div>
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] font-extrabold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
                                    TOREX JOURNAL • AUDITORIA OFICIAL
                                </span>
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                                <h2 className="text-xl font-bold text-fg tracking-tight">
                                    {accountInfo?.name || (isConsolidated ? 'Todas as Contas (Consolidado)' : (selectedAccount?.name || 'Conta Trading'))}
                                </h2>
                                {accountInfo?.type && (
                                    <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider ${
                                        String(accountInfo.type).toUpperCase() === 'LIVE' ? 'bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/30' : 'bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/30'
                                    }`}>
                                        {accountInfo.type}
                                    </span>
                                )}
                            </div>
                            <p className="text-xs text-fg-subtle dark:text-slate-400 mt-0.5">
                                Corretora: <span className="text-slate-700 dark:text-slate-200 font-medium">{accountInfo?.broker || 'N/A'}</span> • Moeda: <span className="text-emerald-600 dark:text-emerald-400 font-mono font-bold">{accountInfo?.currency || 'USD'}</span>
                            </p>
                        </div>
                    </div>

                    <div className="text-right">
                        <p className="text-xs text-fg-muted dark:text-slate-500 uppercase tracking-wider font-semibold">Período Selecionado</p>
                        <p className="text-sm font-bold text-fg ">
                            {startDate && endDate 
                                ? `${new Date(startDate + 'T12:00:00').toLocaleDateString('pt-BR')} — ${new Date(endDate + 'T12:00:00').toLocaleDateString('pt-BR')}`
                                : 'Todo o Histórico'}
                        </p>
                        <p className="text-[11px] text-fg-muted mt-0.5">
                            Emitido em: {new Date().toLocaleDateString('pt-BR')} às {new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                    </div>
                </div>

                {/* Primary KPIs 4-Card Grid */}
                {loading ? (
                    <div className="py-20 text-center text-fg-muted dark:text-slate-500">Carregando demonstrativo executivo...</div>
                ) : !kpis || kpis.totalTrades === 0 ? (
                    <div className="py-16 text-center space-y-3">
                        <ShieldAlert size={40} className="mx-auto text-fg-muted dark:text-slate-600" />
                        <h3 className="text-lg font-bold text-fg-muted ">Nenhuma operação encontrada</h3>
                        <p className="text-fg-subtle text-sm max-w-md mx-auto">
                            Não existem trades fechados para os filtros e conta selecionados. Tente alterar o período ou a conta de trading ativa.
                        </p>
                    </div>
                ) : (
                    <>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                            {/* Net Profit */}
                            <div className="bg-slate-50 dark:bg-slate-800/40 p-5 rounded-xl border border-slate-200 dark:border-slate-800/80 shadow-xs dark:shadow-none">
                                <div className="flex justify-between items-start mb-2">
                                    <span className="text-xs text-fg-subtle dark:text-slate-400 uppercase font-semibold tracking-wider">Lucro Líquido</span>
                                    <div className={`p-1.5 rounded-lg ${kpis.netProfit >= 0 ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'}`}>
                                        {kpis.netProfit >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                                    </div>
                                </div>
                                <div className={`text-2xl font-black ${kpis.netProfit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                    {kpis.netProfit >= 0 ? '+' : ''}${kpis.netProfit.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                </div>
                                <div className="flex justify-between text-[11px] text-fg-subtle dark:text-slate-400 mt-2 pt-2 border-t border-slate-200 dark:border-slate-800/60">
                                    <span>Ganhos: <strong className="text-emerald-600 dark:text-emerald-400">${kpis.grossProfit.toFixed(2)}</strong></span>
                                    <span>Perdas: <strong className="text-rose-600 dark:text-rose-400">${kpis.grossLoss.toFixed(2)}</strong></span>
                                </div>
                            </div>

                            {/* Win Rate */}
                            <div className="bg-slate-50 dark:bg-slate-800/40 p-5 rounded-xl border border-slate-200 dark:border-slate-800/80 shadow-xs dark:shadow-none">
                                <div className="flex justify-between items-start mb-2">
                                    <span className="text-xs text-fg-subtle dark:text-slate-400 uppercase font-semibold tracking-wider">Taxa de Acerto</span>
                                    <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
                                        <Percent size={16} />
                                    </div>
                                </div>
                                <div className="text-2xl font-black text-fg ">
                                    {kpis.winRate}%
                                </div>
                                <div className="flex justify-between text-[11px] text-fg-subtle dark:text-slate-400 mt-2 pt-2 border-t border-slate-200 dark:border-slate-800/60">
                                    <span>Total: <strong className="text-slate-700 dark:text-slate-200">{kpis.totalTrades}</strong></span>
                                    <span>W: <strong className="text-emerald-600 dark:text-emerald-400">{kpis.wins}</strong> / L: <strong className="text-rose-600 dark:text-rose-400">{kpis.losses}</strong></span>
                                </div>
                            </div>

                            {/* Profit Factor */}
                            <div className="bg-slate-50 dark:bg-slate-800/40 p-5 rounded-xl border border-slate-200 dark:border-slate-800/80 shadow-xs dark:shadow-none">
                                <div className="flex justify-between items-start mb-2">
                                    <span className="text-xs text-fg-subtle dark:text-slate-400 uppercase font-semibold tracking-wider">Fator de Lucro</span>
                                    <div className="p-1.5 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400">
                                        <Activity size={16} />
                                    </div>
                                </div>
                                <div className="text-2xl font-black text-fg ">
                                    {kpis.profitFactor}
                                </div>
                                <div className="flex justify-between text-[11px] text-fg-subtle dark:text-slate-400 mt-2 pt-2 border-t border-slate-200 dark:border-slate-800/60">
                                    <span>R:R Médio: <strong className="text-indigo-600 dark:text-indigo-300">1:{kpis.riskRewardRatio}</strong></span>
                                    <span>Expectativa: <strong className={kpis.expectancy >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>${kpis.expectancy}</strong></span>
                                </div>
                            </div>

                            {/* Max Drawdown */}
                            <div className="bg-slate-50 dark:bg-slate-800/40 p-5 rounded-xl border border-slate-200 dark:border-slate-800/80 shadow-xs dark:shadow-none">
                                <div className="flex justify-between items-start mb-2">
                                    <span className="text-xs text-fg-subtle dark:text-slate-400 uppercase font-semibold tracking-wider">Drawdown Máximo</span>
                                    <div className="p-1.5 rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400">
                                        <ShieldAlert size={16} />
                                    </div>
                                </div>
                                <div className="text-2xl font-black text-rose-600 dark:text-rose-400">
                                    -${kpis.maxDrawdown.toFixed(2)}
                                </div>
                                <div className="flex justify-between text-[11px] text-fg-subtle dark:text-slate-400 mt-2 pt-2 border-t border-slate-200 dark:border-slate-800/60">
                                    <span>Rebaixamento: <strong className="text-rose-600 dark:text-rose-300">{kpis.maxDrawdownPercent}%</strong></span>
                                    <span>ROI: <strong className={kpis.roi >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>{kpis.roi}%</strong></span>
                                </div>
                            </div>
                        </div>

                        {/* Secondary Metrics Ribbon */}
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-8 bg-slate-100/70 dark:bg-slate-950/40 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800/60 text-xs">
                            <div>
                                <span className="text-fg-subtle block">Maior Ganho</span>
                                <span className="font-bold text-emerald-600 dark:text-emerald-400">+${kpis.largestWin.toFixed(2)}</span>
                            </div>
                            <div>
                                <span className="text-fg-subtle block">Maior Perda</span>
                                <span className="font-bold text-rose-600 dark:text-rose-400">-${Math.abs(kpis.largestLoss).toFixed(2)}</span>
                            </div>
                            <div>
                                <span className="text-fg-subtle block">Média de Ganho</span>
                                <span className="font-bold text-emerald-600 dark:text-emerald-300">+${kpis.averageWin.toFixed(2)}</span>
                            </div>
                            <div>
                                <span className="text-fg-subtle block">Média de Perda</span>
                                <span className="font-bold text-rose-600 dark:text-rose-300">-${Math.abs(kpis.averageLoss).toFixed(2)}</span>
                            </div>
                            <div>
                                <span className="text-fg-subtle block">Volume Negociado</span>
                                <span className="font-bold text-fg ">{kpis.totalVolume} lotes</span>
                            </div>
                                <div>
                                    <span className="text-fg-subtle block">Comissões & Swaps</span>
                                    <span className="font-bold text-fg-muted ">-${(kpis.totalCommission + kpis.totalSwap).toFixed(2)}</span>
                                </div>
                            </div>

                            {/* Row: Gráfico por Operação & Calendário Operacional Inline */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8 items-stretch">
                                {/* 1. Resultado por Operação / Curva de Lucro Acumulado */}
                                <div className="bg-slate-50 dark:bg-[#111319] p-4 sm:p-5 rounded-xl border border-line flex flex-col justify-between shadow-xs dark:shadow-none h-full min-w-0">
                                    <div className="flex flex-wrap justify-between items-center gap-2 mb-3">
                                        <div>
                                            <h3 className="text-sm font-bold text-fg flex items-center gap-2">
                                                <TrendingUp size={16} className="text-emerald-500 dark:text-emerald-400" />
                                                {executionChartMode === 'executions' ? 'Resultado por Operação' : 'Curva de Lucro Acumulado'}
                                            </h3>
                                            <p className="text-[11px] text-fg-subtle">
                                                {executionChartMode === 'executions'
                                                    ? 'Operações com loss destacadas abaixo da linha de zero ($0)'
                                                    : 'Evolução acumulada do capital ao longo das operações'}
                                            </p>
                                        </div>

                                        <div className="flex items-center gap-1 bg-slate-200/80 dark:bg-[#08090C] border border-slate-300 dark:border-white/[0.06] p-1 rounded-lg">
                                            <button
                                                onClick={() => setExecutionChartMode('executions')}
                                                className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-all cursor-pointer ${
 executionChartMode === 'executions'
 ? 'bg-emerald-500 text-slate-950 font-bold shadow-sm'
 : 'text-fg-muted hover:text-fg '
 }`}
                                            >
                                                Por Operação
                                            </button>
                                            <button
                                                onClick={() => setExecutionChartMode('cumulative')}
                                                className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-all cursor-pointer ${
 executionChartMode === 'cumulative'
 ? 'bg-emerald-500 text-slate-950 font-bold shadow-sm'
 : 'text-fg-muted hover:text-fg '
 }`}
                                            >
                                                Acumulado
                                            </button>
                                        </div>
                                    </div>

                                    <div className="h-64 sm:h-72 lg:h-[300px] w-full relative my-auto">
                                        {executionChartMode === 'cumulative' ? (
                                            cumulativeLineData ? (
                                                <Line data={cumulativeLineData} options={zeroBaselineChartOptions as any} />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-fg-muted dark:text-slate-600 text-xs">
                                                    Sem dados suficientes para gerar o gráfico
                                                </div>
                                            )
                                        ) : (
                                            executionsBarData ? (
                                                <Bar data={executionsBarData} options={zeroBaselineChartOptions as any} />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-fg-muted dark:text-slate-600 text-xs">
                                                    Sem dados suficientes para gerar o gráfico
                                                </div>
                                            )
                                        )}
                                    </div>

                                    <div className="flex justify-between text-[10px] text-fg-subtle mt-2 border-t border-line pt-2 font-mono">
                                        <span className="flex items-center gap-1.5">
                                            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Lucros (&gt; $0)
                                        </span>
                                        <span className="flex items-center gap-1.5">
                                            <span className="w-2 h-2 rounded-full bg-rose-500 inline-block" /> Perdas / Loss (&lt; $0)
                                        </span>
                                        <span>{reportData.equityCurve?.length || 0} execuções registradas</span>
                                    </div>
                                </div>

                                {/* 2. Calendário Operacional de Resultados */}
                                <div className="h-full min-w-0 flex flex-col">
                                    <TradingCalendarView
                                        trades={reportData.trades}
                                        dailyPnL={reportData.dailyPnL}
                                    />
                                </div>
                            </div>

                        {/* Radar de Performance Operacional (Ativos, Sessões, Dias) */}
                        <div className="mb-8 space-y-2.5">
                            <div className="flex items-center justify-between">
                                <h3 className="text-xs font-bold uppercase tracking-wider text-fg flex items-center gap-1.5 font-mono">
                                    <Activity size={14} className="text-emerald-500 dark:text-emerald-400" />
                                    Detalhamento Operacional
                                </h3>
                                <span className="text-[10px] text-fg-subtle dark:text-[#6B7280] font-mono">
                                    Ativos, Sessões e Dias da Semana
                                </span>
                            </div>

                            <OperationalBreakdown {...breakdown} />
                        </div>

                        {/* Trade Ledger Table */}
                        <div className="bg-slate-50 dark:bg-slate-950/40 rounded-xl border border-slate-200 dark:border-slate-800/80 overflow-hidden shadow-xs dark:shadow-none">
                            <div className="p-4 border-b border-line flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
                                <div>
                                    <h3 className="text-sm font-bold text-fg ">Livro de Ordens (Trade Ledger)</h3>
                                    <p className="text-xs text-fg-subtle">Listagem de todas as ordens fechadas computadas neste relatório.</p>
                                </div>

                                <div className="relative w-full md:w-64">
                                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted dark:text-slate-500" />
                                    <input
                                        type="text"
                                        placeholder="Buscar ticket, par, tipo..."
                                        value={searchTerm}
                                        onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                                        className="w-full bg-surface border border-slate-200 dark:border-slate-700 text-xs rounded-lg pl-8 pr-3 py-1.5 text-fg placeholder:text-fg-muted dark:placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
                                    />
                                </div>
                            </div>

                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-xs border-collapse">
                                    <thead className="bg-slate-100 dark:bg-slate-900/80 text-fg-muted font-semibold border-b border-line uppercase tracking-wider text-[11px]">
                                        <tr>
                                            <th className="p-3">Ticket</th>
                                            {isConsolidated && <th className="p-3">Conta</th>}
                                            <th className="p-3">Ativo</th>
                                            <th className="p-3">Tipo</th>
                                            <th className="p-3">Lote</th>
                                            <th className="p-3">Abertura</th>
                                            <th className="p-3">Fechamento</th>
                                            <th className="p-3 text-right">Resultado</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800/50">
                                        {paginatedTrades.map((t: any) => (
                                            <tr key={t.id} className="hover:bg-slate-100/70 dark:hover:bg-slate-900/40 transition-colors">
                                                <td className="p-3 font-mono text-fg-muted font-medium">#{t.ticket}</td>
                                                {isConsolidated && (
                                                    <td className="p-3">
                                                        <span className="font-semibold text-fg-muted ">{t.accountName}</span>
                                                    </td>
                                                )}
                                                <td className="p-3 font-bold text-fg ">{t.symbol}</td>
                                                <td className="p-3">
                                                    <span className={`px-2 py-0.5 rounded font-bold text-[10px] ${
                                                        t.type === 'BUY' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20'
                                                    }`}>
                                                        {t.type}
                                                    </span>
                                                </td>
                                                <td className="p-3 text-fg-muted font-mono">{t.volume}</td>
                                                <td className="p-3 text-fg-subtle dark:text-slate-400">
                                                    {t.openTime ? new Date(t.openTime).toLocaleDateString('pt-BR') : '-'}
                                                </td>
                                                <td className="p-3 text-fg-subtle dark:text-slate-400">
                                                    {t.closeTime ? new Date(t.closeTime).toLocaleDateString('pt-BR') : '-'}
                                                </td>
                                                <td className={`p-3 text-right font-bold font-mono ${t.netPnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                                    {t.netPnl >= 0 ? '+' : ''}${t.netPnl.toFixed(2)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {/* Pagination */}
                            {totalPages > 1 && (
                                <div className="p-3.5 border-t border-line flex items-center justify-between text-xs text-fg-muted bg-slate-100/50 dark:bg-slate-900/20">
                                    <span>Página {currentPage} de {totalPages} ({filteredTrades.length} ordens)</span>
                                    <div className="flex items-center gap-1">
                                        <button
                                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                            disabled={currentPage === 1}
                                            className="p-1 rounded bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 disabled:opacity-40 cursor-pointer"
                                        >
                                            <ChevronLeft size={16} />
                                        </button>
                                        <button
                                            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                            disabled={currentPage === totalPages}
                                            className="p-1 rounded bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 disabled:opacity-40 cursor-pointer"
                                        >
                                            <ChevronRight size={16} />
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};
