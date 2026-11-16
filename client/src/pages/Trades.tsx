import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
    MoreHorizontal, Download, RefreshCw, ChevronLeft, ChevronRight, Plus, FileSpreadsheet, Globe, Printer
} from 'lucide-react';
import api from '../api';
import { useAccount } from '../context/AccountContext';
import { useLocale } from '../context/LocaleContext';
import { exportTradingDocument, DocumentFormat } from '../utils/documentExporter';
import { formatTradeDateTime, formatTradeTime, getUserTimeZone, getUserUtcOffsetLabel } from '../utils/timezone';
import { TableRowsSkeleton } from '../components/ui/Skeleton';
import {
    BehaviorMlBadge,
    extractTradeBehaviorFlags,
    TradeBehaviorFeedbackInfo,
    TradeBehaviorMlInfo,
} from '../components/trades/BehaviorMlBadge';
import { BehaviorReviewQueue } from '../components/trades/BehaviorReviewQueue';

interface Trade {
    id: number | string;
    ticket?: number | string;
    openTime?: string;
    closeTime: string;
    symbol: string;
    type: string;
    volume: number;
    rawProfit?: number;
    profit: number;
    netProfit?: number;
    openPrice: number;
    closePrice: number;
    sl?: number;
    tp?: number;
    commission: number;
    swap: number;
    session?: string;
    status?: string;
    accountName?: string;
    behavioralMl?: TradeBehaviorMlInfo | null;
    behavioralFeedback?: TradeBehaviorFeedbackInfo | null;
}

interface PaginatedTradesResponse {
    items: Trade[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    summaryNet: number;
    availableSymbols: string[];
}

function mapRawTradeRow(t: any): Trade {
    const profit = Number(t.profit) || 0;
    const commission = Number(t.commission) || 0;
    const swap = Number(t.swap) || 0;
    const { behavioralMl, behavioralFeedback } = extractTradeBehaviorFlags(t);
    return {
        id: t.id,
        ticket: t.ticket,
        openTime: t.openTime || t.closeTime,
        closeTime: t.closeTime,
        symbol: t.symbol ? String(t.symbol).replace(/m$/, '') : '',
        type: t.type,
        volume: Number(t.volume) || 0,
        rawProfit: profit,
        profit,
        netProfit: t.netPnl !== undefined && t.netPnl !== null ? Number(t.netPnl) : profit + commission + swap,
        openPrice: Number(t.openPrice) || 0,
        closePrice: Number(t.closePrice) || 0,
        sl: Number(t.sl || 0),
        tp: Number(t.tp || 0),
        commission,
        swap,
        session: t.session || '-',
        status: t.status || 'Closed',
        accountName: t.accountName || t.account?.name || undefined,
        behavioralMl,
        behavioralFeedback,
    };
}

export const Trades = () => {
    const navigate = useNavigate();
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const { selectedAccountId, selectedAccount, isConsolidated } = useAccount();

    // Filters
    const [ticketFilter, setTicketFilter] = useState('');
    const [debouncedTicket, setDebouncedTicket] = useState('');
    const [symbolFilter, setSymbolFilter] = useState('ALL');
    const [typeFilter, setTypeFilter] = useState('ALL');
    const [statusFilter, setStatusFilter] = useState('ALL');
    const [mlFilter, setMlFilter] = useState<'ALL' | 'FLAGGED' | 'HIGH_CRITICAL' | 'CLEAN'>('ALL');
    const [dateRange, setDateRange] = useState({ start: '', end: '' });
    const [sortOption, setSortOption] = useState('date-desc');
    const [isExporting, setIsExporting] = useState(false);

    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 15;
    const userTz = useMemo(() => getUserTimeZone(), []);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setDebouncedTicket(ticketFilter.trim());
        }, 250);
        return () => window.clearTimeout(timer);
    }, [ticketFilter]);

    useEffect(() => {
        setCurrentPage(1);
    }, [selectedAccountId]);

    const queryParams = useMemo(() => {
        const params: Record<string, any> = {
            paginated: 'true',
            page: currentPage,
            limit: itemsPerPage,
            sort: sortOption,
            tz: userTz,
        };
        if (selectedAccountId) params.accountId = selectedAccountId;
        if (debouncedTicket) params.ticket = debouncedTicket;
        if (symbolFilter !== 'ALL') params.symbol = symbolFilter;
        if (typeFilter !== 'ALL') params.type = typeFilter;
        if (statusFilter !== 'ALL') params.status = statusFilter;
        if (mlFilter !== 'ALL') params.mlFilter = mlFilter;
        if (dateRange.start) params.startDate = dateRange.start;
        if (dateRange.end) params.endDate = dateRange.end;
        return params;
    }, [
        currentPage,
        itemsPerPage,
        sortOption,
        userTz,
        selectedAccountId,
        debouncedTicket,
        symbolFilter,
        typeFilter,
        statusFilter,
        mlFilter,
        dateRange.start,
        dateRange.end,
    ]);

    const { data, isLoading, isFetching, refetch } = useQuery<PaginatedTradesResponse>({
        queryKey: ['trades', 'paginated', queryParams],
        queryFn: async () => {
            const res = await api.get('/dashboard/trades', { params: queryParams });
            const payload = res.data;
            if (payload && Array.isArray(payload.items)) {
                return {
                    items: payload.items.map(mapRawTradeRow),
                    total: Number(payload.total) || 0,
                    page: Number(payload.page) || 1,
                    limit: Number(payload.limit) || itemsPerPage,
                    totalPages: Number(payload.totalPages) || 0,
                    summaryNet: Number(payload.summaryNet) || 0,
                    availableSymbols: Array.isArray(payload.availableSymbols) ? payload.availableSymbols : [],
                };
            }
            const arr = Array.isArray(payload) ? payload.map(mapRawTradeRow) : [];
            const syms = Array.from(new Set(arr.map((t) => t.symbol).filter(Boolean))).sort();
            const net = arr.reduce((acc, t) => acc + (t.netProfit ?? t.profit), 0);
            return {
                items: arr.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage),
                total: arr.length,
                page: currentPage,
                limit: itemsPerPage,
                totalPages: Math.ceil(arr.length / itemsPerPage),
                summaryNet: net,
                availableSymbols: syms,
            };
        },
        placeholderData: keepPreviousData,
        staleTime: 30_000,
    });

    const paginatedTrades = data?.items ?? [];
    const totalFilteredCount = data?.total ?? 0;
    const totalPages = data?.totalPages ?? 0;
    const summaryNet = data?.summaryNet ?? 0;
    const availableSymbols = data?.availableSymbols ?? [];

    const handlePageChange = (page: number) => {
        if (page >= 1 && page <= totalPages) {
            setCurrentPage(page);
        }
    };

    const handleExportDocument = async (format: DocumentFormat) => {
        if (isExporting || totalFilteredCount === 0) return;
        setIsExporting(true);
        try {
            const exportParams = {
                ...queryParams,
                page: 1,
                limit: 5000,
            };
            const res = await api.get('/dashboard/trades', { params: exportParams });
            const rawItems = Array.isArray(res.data?.items)
                ? res.data.items
                : Array.isArray(res.data)
                  ? res.data
                  : [];
            const exportRows: Trade[] = rawItems.map(mapRawTradeRow);

            const totalTrades = exportRows.length;
            const wins = exportRows.filter((t) => t.profit > 0).length;
            const losses = exportRows.filter((t) => t.profit < 0).length;
            const grossProfit = exportRows.filter((t) => t.profit > 0).reduce((acc, t) => acc + t.profit, 0);
            const grossLoss = Math.abs(exportRows.filter((t) => t.profit < 0).reduce((acc, t) => acc + t.profit, 0));
            const netProfit = exportRows.reduce((acc, t) => acc + (t.netProfit ?? t.profit), 0);
            const totalVolume = exportRows.reduce((acc, t) => acc + t.volume, 0);
            const totalCommission = exportRows.reduce((acc, t) => acc + t.commission, 0);
            const totalSwap = exportRows.reduce((acc, t) => acc + t.swap, 0);
            const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
            const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : grossProfit > 0 ? '∞' : '0.00';

            const periodLabel =
                dateRange.start && dateRange.end
                    ? isEn ? `${dateRange.start} to ${dateRange.end}` : `${dateRange.start} a ${dateRange.end}`
                    : dateRange.start
                        ? isEn ? `From ${dateRange.start}` : `A partir de ${dateRange.start}`
                        : dateRange.end
                            ? isEn ? `Until ${dateRange.end}` : `Até ${dateRange.end}`
                            : isEn ? 'All Filtered History' : 'Todo o Histórico Filtrado';

            exportTradingDocument(format, {
                accountName: selectedAccount ? selectedAccount.name : (isEn ? 'Consolidated Portfolio' : 'Portfólio Consolidado'),
                accountType: selectedAccount?.type || 'DEMO / LIVE',
                broker: selectedAccount?.broker || 'MetaTrader 5',
                currency: selectedAccount?.currency || 'USD',
                periodLabel,
                kpis: {
                    netProfit,
                    grossProfit,
                    grossLoss,
                    winRate,
                    totalTrades,
                    wins,
                    losses,
                    profitFactor,
                    totalVolume: totalVolume.toFixed(2),
                    totalCommission,
                    totalSwap,
                },
                trades: exportRows.map((t) => ({
                    ...t,
                    profit: t.rawProfit ?? t.profit,
                    netPnl: t.netProfit ?? t.profit,
                })),
            });
        } catch (err) {
            console.error('Failed to export trades document:', err);
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <div className="space-y-3 animate-in fade-in duration-300">
            <BehaviorReviewQueue accountId={isConsolidated ? 'all' : selectedAccountId} isEn={isEn} />

            {/* Top Summary & Actions Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 text-xs">
                    <span className="text-fg-muted font-medium">
                        <strong className="text-fg font-semibold tabular-nums">{totalFilteredCount}</strong> {isEn ? 'executions' : 'operações'}
                    </span>
                    <span className="text-fg-subtle">·</span>
                    <span className="text-fg-muted">
                        {isEn ? 'Filtered Net P&L:' : 'Resultado filtrado:'}{' '}
                        <strong className={`font-mono font-semibold tabular-nums ${summaryNet >= 0 ? 'text-accent-fg' : 'text-danger-fg'}`}>
                            {summaryNet >= 0 ? '+' : ''}${summaryNet.toFixed(2)}
                        </strong>
                    </span>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                    <div className="flex items-center rounded-lg border border-line bg-surface p-0.5 gap-0.5">
                        <button
                            onClick={() => void handleExportDocument('csv')}
                            disabled={isLoading || isExporting || totalFilteredCount === 0}
                            className="h-7 px-2.5 rounded-md text-[11px] font-semibold text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
                            title={isEn ? 'Export structured CSV' : 'Exportar CSV estruturado'}
                        >
                            <Download size={12} /> CSV
                        </button>
                        <button
                            onClick={() => void handleExportDocument('excel')}
                            disabled={isLoading || isExporting || totalFilteredCount === 0}
                            className="h-7 px-2.5 rounded-md text-[11px] font-semibold text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
                            title={isEn ? 'Export Excel spreadsheet (.xls)' : 'Exportar planilha Excel (.xls)'}
                        >
                            <FileSpreadsheet size={12} /> Excel
                        </button>
                        <button
                            onClick={() => void handleExportDocument('html')}
                            disabled={isLoading || isExporting || totalFilteredCount === 0}
                            className="h-7 px-2.5 rounded-md text-[11px] font-semibold text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
                            title={isEn ? 'Export full HTML report' : 'Exportar relatório HTML completo'}
                        >
                            <Globe size={12} /> HTML
                        </button>
                        <button
                            onClick={() => void handleExportDocument('pdf')}
                            disabled={isLoading || isExporting || totalFilteredCount === 0}
                            className="h-7 px-2.5 rounded-md text-[11px] font-semibold text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
                            title={isEn ? 'Generate Executive PDF' : 'Gerar PDF Executivo'}
                        >
                            <Printer size={12} /> PDF
                        </button>
                    </div>

                    <button
                        onClick={() => void refetch()}
                        className="h-8 w-8 flex items-center justify-center bg-surface text-fg-muted rounded-lg hover:text-fg hover:bg-surface-2 transition-colors border border-line cursor-pointer"
                        title={isEn ? 'Refresh ledger' : 'Atualizar lista'}
                    >
                        <RefreshCw size={13} className={isFetching ? 'animate-spin text-accent-fg' : ''} />
                    </button>

                    <button
                        onClick={() => navigate('/add-trades')}
                        className="h-8 px-3 bg-surface hover:bg-surface-2 text-fg border border-line rounded-lg transition-colors font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
                    >
                        <Plus size={14} className="text-accent-fg" />
                        <span>{isEn ? 'Add Trades' : 'Adicionar Trades'}</span>
                    </button>
                </div>
            </div>

            {/* Compact Filters Bar */}
            <div className="bg-surface border border-line p-3 rounded-xl flex flex-col lg:flex-row gap-2.5 items-stretch lg:items-center justify-between">
                <div className="flex flex-wrap gap-2 items-center">
                    <input
                        type="number"
                        placeholder="Ticket ID..."
                        value={ticketFilter}
                        onChange={(e) => { setTicketFilter(e.target.value); setCurrentPage(1); }}
                        className="h-8 bg-canvas-subtle border border-line rounded-lg px-2.5 text-xs text-fg focus:border-accent/50 outline-none w-28 placeholder:text-fg-subtle font-mono"
                    />

                    <select
                        value={symbolFilter}
                        onChange={(e) => { setSymbolFilter(e.target.value); setCurrentPage(1); }}
                        className="h-8 bg-canvas-subtle border border-line rounded-lg px-2.5 text-xs text-fg focus:border-accent/50 outline-none cursor-pointer"
                    >
                        <option value="ALL">{isEn ? 'All Symbols' : 'Todos os Símbolos'}</option>
                        {availableSymbols.map((sym) => (
                            <option key={sym} value={sym}>{sym}</option>
                        ))}
                    </select>

                    <div className="h-8 flex items-center gap-1.5 bg-canvas-subtle border border-line rounded-lg px-2">
                        <input
                            type="date"
                            className="bg-transparent text-[11px] text-fg-muted focus:text-fg outline-none"
                            value={dateRange.start}
                            onChange={(e) => { setDateRange({ ...dateRange, start: e.target.value }); setCurrentPage(1); }}
                        />
                        <span className="text-fg-subtle text-xs">—</span>
                        <input
                            type="date"
                            className="bg-transparent text-[11px] text-fg-muted focus:text-fg outline-none"
                            value={dateRange.end}
                            onChange={(e) => { setDateRange({ ...dateRange, end: e.target.value }); setCurrentPage(1); }}
                        />
                    </div>
                </div>

                <div className="flex flex-wrap gap-2 items-center justify-end">
                    <select
                        value={typeFilter}
                        onChange={(e) => { setTypeFilter(e.target.value); setCurrentPage(1); }}
                        className="h-8 bg-canvas-subtle border border-line rounded-lg px-2.5 text-xs text-fg focus:border-accent/50 outline-none cursor-pointer"
                    >
                        <option value="ALL">{isEn ? 'All Sides' : 'Todos os Tipos'}</option>
                        <option value="BUY">{isEn ? 'Long (Buy)' : 'Compra (Buy)'}</option>
                        <option value="SELL">{isEn ? 'Short (Sell)' : 'Venda (Sell)'}</option>
                    </select>

                    <select
                        value={statusFilter}
                        onChange={(e) => { setStatusFilter(e.target.value); setCurrentPage(1); }}
                        className="h-8 bg-canvas-subtle border border-line rounded-lg px-2.5 text-xs text-fg focus:border-accent/50 outline-none cursor-pointer"
                    >
                        <option value="ALL">{isEn ? 'All Statuses' : 'Todos os Status'}</option>
                        <option value="Open">{isEn ? 'Open' : 'Aberta'}</option>
                        <option value="Closed">{isEn ? 'Closed' : 'Fechada'}</option>
                    </select>

                    <select
                        value={mlFilter}
                        onChange={(e) => { setMlFilter(e.target.value as any); setCurrentPage(1); }}
                        className="h-8 bg-canvas-subtle border border-line rounded-lg px-2.5 text-xs text-fg focus:border-accent/50 outline-none cursor-pointer"
                    >
                        <option value="ALL">{isEn ? 'ML: All Trades' : 'IA: Todos'}</option>
                        <option value="FLAGGED">{isEn ? 'ML: Behavioral Alerts' : 'IA: Com Alertas'}</option>
                        <option value="HIGH_CRITICAL">{isEn ? 'ML: High / Critical' : 'IA: Alto / Crítico'}</option>
                        <option value="CLEAN">{isEn ? 'ML: Disciplined' : 'IA: Disciplinado'}</option>
                    </select>

                    <select
                        value={sortOption}
                        onChange={(e) => { setSortOption(e.target.value); setCurrentPage(1); }}
                        className="h-8 bg-canvas-subtle border border-line rounded-lg px-2.5 text-xs text-fg font-medium focus:border-accent/50 outline-none cursor-pointer"
                    >
                        <option value="date-desc">{isEn ? 'Time (Newest)' : 'Data (Mais recente)'}</option>
                        <option value="date-asc">{isEn ? 'Time (Oldest)' : 'Data (Mais antiga)'}</option>
                        <option value="profit-desc">{isEn ? 'Net P&L (Highest)' : 'Lucro (Maior)'}</option>
                        <option value="profit-asc">{isEn ? 'Net P&L (Lowest)' : 'Lucro (Menor)'}</option>
                        <option value="volume-desc">{isEn ? 'Size (Largest)' : 'Volume (Maior)'}</option>
                        <option value="volume-asc">{isEn ? 'Size (Smallest)' : 'Volume (Menor)'}</option>
                    </select>
                </div>
            </div>

            {/* Trades Table */}
            <div className="bg-surface border border-line rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                        <thead className="bg-canvas-subtle border-b border-line-subtle text-[10px] text-fg-subtle uppercase tracking-wider font-semibold">
                            <tr>
                                {isConsolidated && <th className="px-3.5 py-2.5 whitespace-nowrap">{isEn ? 'Account' : 'Conta'}</th>}
                                <th className="px-3.5 py-2.5 whitespace-nowrap">Ticket</th>
                                <th className="px-3.5 py-2.5 whitespace-nowrap">
                                    {isEn ? 'Time' : 'Horário'} <span className="text-[9px] font-mono text-fg-subtle/80">({getUserUtcOffsetLabel()})</span>
                                </th>
                                <th className="px-3.5 py-2.5 whitespace-nowrap">{isEn ? 'Symbol' : 'Símbolo'}</th>
                                <th className="px-3.5 py-2.5 whitespace-nowrap">{isEn ? 'Side' : 'Tipo'}</th>
                                <th className="px-3.5 py-2.5 whitespace-nowrap">{isEn ? 'Size' : 'Volume'}</th>
                                <th className="px-3.5 py-2.5 whitespace-nowrap text-right">{isEn ? 'Entry Price' : 'Preço Ent.'}</th>
                                <th className="px-3.5 py-2.5 whitespace-nowrap text-right">{isEn ? 'Exit Price' : 'Preço Saída'}</th>
                                <th className="px-3.5 py-2.5 whitespace-nowrap text-right">{isEn ? 'Comm / Swap' : 'Comiss/Swap'}</th>
                                <th className="px-3.5 py-2.5 whitespace-nowrap text-center">{isEn ? 'Outcome' : 'Resultado'}</th>
                                <th className="px-3.5 py-2.5 whitespace-nowrap text-center">{isEn ? 'ML Behavior' : 'Comportamento IA'}</th>
                                <th className="px-3.5 py-2.5 whitespace-nowrap text-right">{isEn ? 'Net P&L' : 'PnL Líquido'}</th>
                                <th className="px-3.5 py-2.5 whitespace-nowrap text-center">{isEn ? 'Actions' : 'Ações'}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-line-subtle">
                            {isLoading ? (
                                <TableRowsSkeleton columns={isConsolidated ? 13 : 12} rows={10} />
                            ) : paginatedTrades.length === 0 ? (
                                <tr>
                                    <td colSpan={isConsolidated ? 13 : 12} className="p-10 text-center">
                                        <div className="flex flex-col items-center justify-center gap-2.5">
                                            <p className="text-fg-muted text-xs">{isEn ? 'No executions match the selected filters.' : 'Nenhum trade encontrado com os filtros selecionados.'}</p>
                                            <button
                                                onClick={() => navigate('/add-trades')}
                                                className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/10 hover:bg-accent/20 text-accent-fg border border-accent/25 rounded-lg transition-colors text-xs font-semibold cursor-pointer"
                                            >
                                                <Plus size={13} /> {isEn ? 'Import / Add Trades' : 'Importar / Adicionar Trades'}
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                paginatedTrades.map((trade) => {
                                    const isOpenPos = (trade.status || '').toUpperCase() === 'OPEN';
                                    return (
                                        <tr
                                            key={`${trade.status || 'CLOSED'}-${trade.id}-${trade.ticket}`}
                                            onClick={() => {
                                                if (!isOpenPos && trade.id) {
                                                    navigate(`/trades/${trade.id}`);
                                                }
                                            }}
                                            className="hover:bg-surface-2/50 transition-colors group cursor-pointer"
                                        >
                                            {isConsolidated && (
                                                <td className="px-3.5 py-2.5 whitespace-nowrap">
                                                    <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-surface-2 text-fg-muted border border-line-subtle">
                                                        {trade.accountName || (isEn ? 'Primary' : 'Principal')}
                                                    </span>
                                                </td>
                                            )}
                                            <td className="px-3.5 py-2.5 text-fg-subtle font-mono tabular-nums">#{trade.ticket}</td>
                                            <td className="px-3.5 py-2.5 text-fg-muted whitespace-nowrap tabular-nums">
                                                <div>{formatTradeDateTime(trade.openTime || trade.closeTime)}</div>
                                                {!isOpenPos && trade.openTime && trade.closeTime && trade.closeTime !== trade.openTime && (
                                                    <div className="text-[10px] text-fg-subtle">
                                                        {isEn ? 'Exit:' : 'Fecho:'} {formatTradeTime(trade.closeTime, { includeSeconds: true })}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-3.5 py-2.5 font-bold text-fg">{trade.symbol}</td>
                                            <td className="px-3.5 py-2.5">
                                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                                                    trade.type === 'BUY'
                                                        ? 'bg-accent/10 text-accent-fg border-accent/20'
                                                        : 'bg-danger/10 text-danger-fg border-danger/20'
                                                }`}>
                                                    {trade.type}
                                                </span>
                                            </td>
                                            <td className="px-3.5 py-2.5 text-fg-muted font-mono tabular-nums">{trade.volume.toFixed(2)}</td>
                                            <td className="px-3.5 py-2.5 text-right font-mono tabular-nums text-fg-muted">{trade.openPrice}</td>
                                            <td className="px-3.5 py-2.5 text-right font-mono tabular-nums text-fg-muted">{trade.closePrice || '-'}</td>
                                            <td className="px-3.5 py-2.5 text-right font-mono tabular-nums text-fg-subtle">
                                                {(trade.commission + trade.swap).toFixed(2)}
                                            </td>
                                            <td className="px-3.5 py-2.5 text-center">
                                                {isOpenPos ? (
                                                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-surface-2 text-fg border border-line">{isEn ? 'OPEN' : 'ABERTA'}</span>
                                                ) : trade.profit > 0 ? (
                                                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-accent/10 text-accent-fg">WIN</span>
                                                ) : trade.profit < 0 ? (
                                                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-danger/10 text-danger-fg">LOSS</span>
                                                ) : (
                                                    <span className="text-fg-subtle">—</span>
                                                )}
                                            </td>
                                            <td className="px-3.5 py-2.5 text-center">
                                                {isOpenPos ? (
                                                    <span className="text-[10px] text-fg-subtle">—</span>
                                                ) : (
                                                    <BehaviorMlBadge
                                                        ml={trade.behavioralMl}
                                                        feedback={trade.behavioralFeedback}
                                                        isEn={isEn}
                                                        compact
                                                        hideWhenClean={false}
                                                    />
                                                )}
                                            </td>
                                            <td className={`px-3.5 py-2.5 text-right font-semibold font-mono tabular-nums ${trade.profit >= 0 ? 'text-accent-fg' : 'text-danger-fg'}`}>
                                                <div>{trade.profit >= 0 ? '+' : ''}{trade.profit.toFixed(2)}</div>
                                                {trade.netProfit !== undefined && Math.abs(trade.netProfit - trade.profit) > 0.005 && (
                                                    <div className="text-[10px] font-normal text-fg-subtle">
                                                        {isEn ? 'Net:' : 'Líq:'} {trade.netProfit >= 0 ? '+' : ''}{trade.netProfit.toFixed(2)}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-3.5 py-2.5 text-center">
                                                <button className="p-1 hover:bg-surface-2 text-fg-subtle hover:text-fg rounded-md transition-colors cursor-pointer">
                                                    <MoreHorizontal size={14} />
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                <div className="px-3.5 py-2.5 border-t border-line-subtle flex justify-between items-center bg-canvas-subtle/40">
                    <span className="text-[11px] text-fg-muted tabular-nums">
                        {isEn ? 'Showing' : 'Mostrando'} {totalFilteredCount === 0 ? 0 : Math.min((currentPage - 1) * itemsPerPage + 1, totalFilteredCount)}–{Math.min(currentPage * itemsPerPage, totalFilteredCount)} {isEn ? 'of' : 'de'} {totalFilteredCount} {isEn ? 'executions' : 'trades'}
                    </span>
                    <div className="flex gap-1.5">
                        <button
                            onClick={() => handlePageChange(currentPage - 1)}
                            disabled={currentPage === 1}
                            className="h-7 w-7 flex items-center justify-center rounded-md bg-surface border border-line text-fg-muted hover:text-fg hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                        >
                            <ChevronLeft size={14} />
                        </button>
                        <button
                            onClick={() => handlePageChange(currentPage + 1)}
                            disabled={currentPage >= totalPages || totalPages === 0}
                            className="h-7 w-7 flex items-center justify-center rounded-md bg-surface border border-line text-fg-muted hover:text-fg hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                        >
                            <ChevronRight size={14} />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
