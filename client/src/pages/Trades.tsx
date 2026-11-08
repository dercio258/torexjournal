import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    MoreHorizontal, Download, RefreshCw, ChevronLeft, ChevronRight, Plus, FileSpreadsheet, Globe, Printer
} from 'lucide-react';
import api from '../api';
import { useAccount } from '../context/AccountContext';
import { exportTradingDocument, DocumentFormat } from '../utils/documentExporter';

interface Trade {
    id: number;
    ticket?: number;
    openTime?: string;
    closeTime: string;
    symbol: string;
    type: string;
    volume: number;
    rawProfit?: number;
    profit: number;
    openPrice: number;
    closePrice: number;
    sl?: number;
    tp?: number;
    commission: number;
    swap: number;
    session?: string;
    status?: string;
    accountName?: string;
}

export const Trades = () => {
    const navigate = useNavigate();
    const { selectedAccountId, selectedAccount, isConsolidated } = useAccount();
    const [trades, setTrades] = useState<Trade[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Filters
    const [ticketFilter, setTicketFilter] = useState('');
    const [symbolFilter, setSymbolFilter] = useState('ALL');
    const [typeFilter, setTypeFilter] = useState('ALL');
    const [statusFilter, setStatusFilter] = useState('ALL');
    const [dateRange, setDateRange] = useState({ start: '', end: '' });
    const [sortOption, setSortOption] = useState('date-desc');

    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 15;

    const fetchTrades = async () => {
        setIsLoading(true);
        try {
            const params: any = {};
            if (selectedAccountId) {
                params.accountId = selectedAccountId;
            }
            const res = await api.get('/dashboard/trades', { params });
            if (Array.isArray(res.data)) {
                const mappedTrades = res.data.map((t: any) => ({
                    id: t.id,
                    ticket: t.ticket,
                    openTime: t.openTime || t.closeTime,
                    closeTime: t.closeTime,
                    symbol: t.symbol ? t.symbol.replace(/m$/, '') : '',
                    type: t.type,
                    volume: Number(t.volume),
                    rawProfit: Number(t.profit),
                    profit: Number(t.profit) + Number(t.commission) + Number(t.swap),
                    openPrice: Number(t.openPrice),
                    closePrice: Number(t.closePrice),
                    sl: Number(t.sl || 0),
                    tp: Number(t.tp || 0),
                    commission: Number(t.commission),
                    swap: Number(t.swap),
                    session: t.session || '-',
                    status: t.status || 'Closed',
                    accountName: t.accountName || t.account?.name || null
                }));
                setTrades(mappedTrades);
            }
        } catch (err) {
            console.error('Failed to fetch trades', err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchTrades();
    }, [selectedAccountId]);

    // Extract Unique Symbols for Filter
    const availableSymbols = useMemo(() => {
        const syms = new Set(trades.map(t => t.symbol));
        return Array.from(syms).sort();
    }, [trades]);

    // Filter & Sort Logic
    const filteredTrades = useMemo(() => {
        let result = trades.filter(trade => {

            // Ticket Filter
            if (ticketFilter && !trade.ticket?.toString().includes(ticketFilter)) return false;

            // Symbol Filter
            if (symbolFilter !== 'ALL' && trade.symbol !== symbolFilter) return false;

            // Type
            if (typeFilter !== 'ALL' && trade.type !== typeFilter) return false;

            // Status
            if (statusFilter !== 'ALL' && (trade.status || 'CLOSED').toUpperCase() !== statusFilter.toUpperCase()) return false;

            // Date Range (comparação em UTC para preservar a data exata do MT5/Relatório)
            if (dateRange.start) {
                const tradeDateStr = new Date(trade.closeTime).toISOString().split('T')[0];
                if (tradeDateStr < dateRange.start) return false;
            }
            if (dateRange.end) {
                const tradeDateStr = new Date(trade.closeTime).toISOString().split('T')[0];
                if (tradeDateStr > dateRange.end) return false;
            }

            return true;
        });

        // Sorting
        return result.sort((a, b) => {
            switch (sortOption) {
                case 'date-desc': return new Date(b.closeTime).getTime() - new Date(a.closeTime).getTime();
                case 'date-asc': return new Date(a.closeTime).getTime() - new Date(b.closeTime).getTime();
                case 'profit-desc': return b.profit - a.profit;
                case 'profit-asc': return a.profit - b.profit;
                case 'volume-desc': return b.volume - a.volume;
                case 'volume-asc': return a.volume - b.volume;
                default: return 0;
            }
        });
    }, [trades, ticketFilter, symbolFilter, typeFilter, statusFilter, dateRange, sortOption]);

    // Pagination Logic
    const totalPages = Math.ceil(filteredTrades.length / itemsPerPage);
    const paginatedTrades = filteredTrades.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage
    );

    const handlePageChange = (page: number) => {
        if (page >= 1 && page <= totalPages) {
            setCurrentPage(page);
        }
    };

    const handleExportDocument = (format: DocumentFormat) => {
        const totalTrades = filteredTrades.length;
        const wins = filteredTrades.filter(t => t.profit > 0).length;
        const losses = filteredTrades.filter(t => t.profit < 0).length;
        const grossProfit = filteredTrades.filter(t => t.profit > 0).reduce((acc, t) => acc + t.profit, 0);
        const grossLoss = Math.abs(filteredTrades.filter(t => t.profit < 0).reduce((acc, t) => acc + t.profit, 0));
        const netProfit = filteredTrades.reduce((acc, t) => acc + t.profit, 0);
        const totalVolume = filteredTrades.reduce((acc, t) => acc + t.volume, 0);
        const totalCommission = filteredTrades.reduce((acc, t) => acc + t.commission, 0);
        const totalSwap = filteredTrades.reduce((acc, t) => acc + t.swap, 0);
        const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
        const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : grossProfit > 0 ? '∞' : '0.00';

        const periodLabel =
            dateRange.start && dateRange.end
                ? `${dateRange.start} a ${dateRange.end}`
                : dateRange.start
                    ? `A partir de ${dateRange.start}`
                    : dateRange.end
                        ? `Até ${dateRange.end}`
                        : 'Todo o Histórico Filtrado';

        exportTradingDocument(format, {
            accountName: selectedAccount ? selectedAccount.name : 'Portfólio Consolidado',
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
            trades: filteredTrades.map((t) => ({
                ...t,
                profit: t.rawProfit ?? t.profit,
                netPnl: t.profit,
            })),
        });
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            {/* Header Actions Toolbar */}
            <div className="flex flex-wrap items-center justify-end gap-2 pb-1">
                <button
                    onClick={() => navigate('/add-trades')}
                    className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl transition-all shadow-sm font-bold text-xs cursor-pointer active:scale-95"
                >
                    <Plus size={15} /> Adicionar Trades
                </button>
                <button
                    onClick={fetchTrades}
                    className="p-2 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 rounded-xl hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-all border border-slate-200 dark:border-slate-800 cursor-pointer shadow-xs active:scale-95"
                    title="Atualizar lista"
                >
                    <RefreshCw size={15} className={isLoading ? 'animate-spin text-indigo-500 dark:text-indigo-400' : ''} />
                </button>
                <button
                    onClick={() => handleExportDocument('csv')}
                    disabled={isLoading || filteredTrades.length === 0}
                    className="flex items-center gap-1.5 px-3 py-2 bg-indigo-50 dark:bg-indigo-600/10 text-indigo-600 dark:text-indigo-400 rounded-xl hover:bg-indigo-100 dark:hover:bg-indigo-600/20 transition-all border border-indigo-200 dark:border-indigo-600/20 font-bold text-xs cursor-pointer disabled:opacity-50"
                    title="Exportar trades filtrados em CSV estruturado com logo e KPIs"
                >
                    <Download size={15} /> Exportar CSV
                </button>
                <button
                    onClick={() => handleExportDocument('excel')}
                    disabled={isLoading || filteredTrades.length === 0}
                    className="flex items-center gap-1.5 px-3 py-2 bg-emerald-50 dark:bg-emerald-600/10 text-emerald-600 dark:text-emerald-400 rounded-xl hover:bg-emerald-100 dark:hover:bg-emerald-600/20 transition-all border border-emerald-200 dark:border-emerald-600/20 font-bold text-xs cursor-pointer disabled:opacity-50"
                    title="Exportar planilha Excel (.xls) com logotipo TorexJournal"
                >
                    <FileSpreadsheet size={15} /> Excel
                </button>
                <button
                    onClick={() => handleExportDocument('html')}
                    disabled={isLoading || filteredTrades.length === 0}
                    className="flex items-center gap-1.5 px-3 py-2 bg-cyan-50 dark:bg-cyan-600/10 text-cyan-600 dark:text-cyan-400 rounded-xl hover:bg-cyan-100 dark:hover:bg-cyan-600/20 transition-all border border-cyan-200 dark:border-cyan-600/20 font-bold text-xs cursor-pointer disabled:opacity-50"
                    title="Exportar relatório HTML completo com logotipo TorexJournal"
                >
                    <Globe size={15} /> HTML
                </button>
                <button
                    onClick={() => handleExportDocument('pdf')}
                    disabled={isLoading || filteredTrades.length === 0}
                    className="flex items-center gap-1.5 px-3 py-2 bg-amber-50 dark:bg-amber-600/10 text-amber-600 dark:text-amber-400 rounded-xl hover:bg-amber-100 dark:hover:bg-amber-600/20 transition-all border border-amber-200 dark:border-amber-600/20 font-bold text-xs cursor-pointer disabled:opacity-50"
                    title="Gerar PDF Executivo com logotipo TorexJournal"
                >
                    <Printer size={15} /> PDF
                </button>
            </div>


            {/* Filters Bar */}
            <div className="bg-white dark:bg-slate-900/40 backdrop-blur-xl border border-slate-200 dark:border-slate-800 p-4 rounded-2xl flex flex-col gap-4 shadow-sm">

                <div className="flex flex-col lg:flex-row gap-4 items-center justify-between">
                    {/* Left: Input Filters */}
                    <div className="flex flex-wrap gap-3 w-full lg:w-auto items-center">
                        {/* Ticket Input */}
                        <div className="relative">
                            <input
                                type="number"
                                placeholder="Ticket ID..."
                                value={ticketFilter}
                                onChange={(e) => setTicketFilter(e.target.value)}
                                className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-slate-800 dark:text-slate-200 focus:bg-white dark:focus:bg-slate-950 focus:ring-2 focus:ring-emerald-500/50 outline-none w-32 placeholder:text-slate-400 dark:placeholder:text-slate-600"
                            />
                        </div>

                        {/* Symbol Selector */}
                        <select
                            value={symbolFilter}
                            onChange={(e) => setSymbolFilter(e.target.value)}
                            className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-slate-800 dark:text-slate-300 focus:bg-white dark:focus:bg-slate-950 focus:ring-2 focus:ring-emerald-500/50 outline-none cursor-pointer"
                        >
                            <option value="ALL">Todos os Símbolos</option>
                            {availableSymbols.map(sym => (
                                <option key={sym} value={sym}>{sym}</option>
                            ))}
                        </select>

                        {/* Date Inputs */}
                        <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl p-1">
                            <input
                                type="date"
                                className="bg-transparent text-xs text-slate-700 dark:text-slate-400 focus:text-slate-900 dark:focus:text-slate-200 outline-none p-1.5"
                                value={dateRange.start}
                                onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
                            />
                            <span className="text-slate-400 dark:text-slate-600">-</span>
                            <input
                                type="date"
                                className="bg-transparent text-xs text-slate-700 dark:text-slate-400 focus:text-slate-900 dark:focus:text-slate-200 outline-none p-1.5"
                                value={dateRange.end}
                                onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
                            />
                        </div>
                    </div>

                    {/* Right: Dropdowns & Sort */}
                    <div className="flex flex-wrap gap-3 w-full lg:w-auto items-center justify-end">
                        {/* Type Filter */}
                        <select
                            value={typeFilter}
                            onChange={(e) => setTypeFilter(e.target.value)}
                            className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-slate-800 dark:text-slate-300 focus:bg-white dark:focus:bg-slate-950 focus:ring-2 focus:ring-emerald-500/50 outline-none cursor-pointer text-xs"
                        >
                            <option value="ALL">Todos os Tipos</option>
                            <option value="BUY">Compra (Buy)</option>
                            <option value="SELL">Venda (Sell)</option>
                        </select>

                        {/* Status Filter */}
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-slate-800 dark:text-slate-300 focus:bg-white dark:focus:bg-slate-950 focus:ring-2 focus:ring-emerald-500/50 outline-none cursor-pointer text-xs"
                        >
                            <option value="ALL">Todos os Status</option>
                            <option value="Open">Open</option>
                            <option value="Closed">Closed</option>
                        </select>

                        {/* Sort Selector */}
                        <div className="border-l border-slate-200 dark:border-slate-700 pl-3 ml-1">
                            <select
                                value={sortOption}
                                onChange={(e) => setSortOption(e.target.value)}
                                className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-indigo-600 dark:text-indigo-400 font-bold focus:ring-2 focus:ring-indigo-500/50 outline-none cursor-pointer text-xs"
                            >
                                <option value="date-desc">📅 Data (Mais recente)</option>
                                <option value="date-asc">📅 Data (Mais antiga)</option>
                                <option value="profit-desc">💰 Lucro (Maior)</option>
                                <option value="profit-asc">💰 Lucro (Menor)</option>
                                <option value="volume-desc">📊 Volume (Maior)</option>
                                <option value="volume-asc">📊 Volume (Menor)</option>
                            </select>
                        </div>
                    </div>
                </div>
            </div>

            {/* Trades Table */}
            <div className="bg-white dark:bg-slate-900/40 backdrop-blur-xl border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm dark:shadow-xl">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-slate-100/90 dark:bg-slate-950/70 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300 uppercase tracking-wider font-bold">
                            <tr>
                                {isConsolidated && <th className="p-4 whitespace-nowrap">Conta</th>}
                                <th className="p-4 whitespace-nowrap">Ticket</th>
                                <th className="p-4 whitespace-nowrap">Data</th>
                                <th className="p-4 whitespace-nowrap">Símbolo</th>
                                <th className="p-4 whitespace-nowrap">Tipo</th>
                                <th className="p-4 whitespace-nowrap">Volume</th>
                                <th className="p-4 whitespace-nowrap text-right">Preço Ent.</th>
                                <th className="p-4 whitespace-nowrap text-right">Preço Saída</th>
                                <th className="p-4 whitespace-nowrap text-right">Comiss/Swap</th>
                                <th className="p-4 whitespace-nowrap text-center">Resultado</th>
                                <th className="p-4 whitespace-nowrap text-right">PnL Líquido</th>
                                <th className="p-4 whitespace-nowrap text-center">Ações</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-800/50 text-sm">
                            {isLoading ? (
                                <tr>
                                    <td colSpan={isConsolidated ? 12 : 11} className="p-8 text-center text-slate-500">
                                        Carregando trades...
                                    </td>
                                </tr>
                            ) : paginatedTrades.length === 0 ? (
                                <tr>
                                    <td colSpan={isConsolidated ? 12 : 11} className="p-12 text-center">
                                        <div className="flex flex-col items-center justify-center gap-3">
                                            <p className="text-slate-600 dark:text-slate-400 font-medium">Nenhum trade encontrado com os filtros selecionados.</p>
                                            <button
                                                onClick={() => navigate('/add-trades')}
                                                className="flex items-center gap-2 px-4 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 rounded-xl transition-all text-xs font-bold cursor-pointer"
                                            >
                                                <Plus size={14} /> Importar / Adicionar Trades
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
                                        className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors group cursor-pointer"
                                    >
                                        {isConsolidated && (
                                             <td className="p-4 whitespace-nowrap">
                                                 <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
                                                     {trade.accountName || 'Principal'}
                                                 </span>
                                             </td>
                                         )}
                                         <td className="p-4 text-slate-500 dark:text-slate-400 font-mono text-xs">#{trade.ticket}</td>
                                         <td className="p-4 text-slate-600 dark:text-slate-400 whitespace-nowrap text-xs">
                                             {new Date(trade.closeTime || trade.openTime || Date.now()).toLocaleString('pt-BR', { timeZone: 'UTC' })}
                                         </td>
                                         <td className="p-4 font-bold text-slate-900 dark:text-slate-200">{trade.symbol}</td>
                                         <td className="p-4">
                                             <span className={`px-2 py-1 rounded text-[10px] font-bold border ${trade.type === 'BUY' ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20' : 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20'}`}>
                                                 {trade.type}
                                             </span>
                                         </td>
                                         <td className="p-4 text-slate-700 dark:text-slate-400 font-mono">{trade.volume.toFixed(2)}</td>
                                         <td className="p-4 text-right font-mono text-slate-700 dark:text-slate-400">{trade.openPrice}</td>
                                         <td className="p-4 text-right font-mono text-slate-700 dark:text-slate-400">{trade.closePrice || '-'}</td>
                                         <td className="p-4 text-right font-mono text-slate-500 text-xs">
                                             {(trade.commission + trade.swap).toFixed(2)}
                                         </td>
                                         <td className="p-4 text-center">
                                             {isOpenPos ? (
                                                 <span className="px-2 py-1 rounded-full text-[10px] font-bold bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border border-cyan-500/30">ABERTA</span>
                                             ) : trade.profit > 0 ? (
                                                 <span className="px-2 py-1 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">WIN</span>
                                             ) : trade.profit < 0 ? (
                                                 <span className="px-2 py-1 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-600 dark:text-rose-400">LOSS</span>
                                             ) : (
                                                 <span className="text-slate-400">-</span>
                                             )}
                                         </td>
                                         <td className={`p-4 text-right font-bold font-mono ${trade.profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                             <div>{trade.profit >= 0 ? '+' : ''}{trade.profit.toFixed(2)}</div>
                                             {trade.rawProfit !== undefined && Math.abs(trade.profit - trade.rawProfit) > 0.005 && (
                                                 <div className="text-[10px] font-normal text-slate-400 dark:text-slate-500">
                                                     Bruto MT5: {trade.rawProfit >= 0 ? '+' : ''}{trade.rawProfit.toFixed(2)}
                                                 </div>
                                             )}
                                         </td>
                                         <td className="p-4 text-center">
                                             <button className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg transition-colors">
                                                 <MoreHorizontal size={16} />
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
                 <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex justify-between items-center">
                     <span className="text-xs text-slate-600 dark:text-slate-400">
                         Mostrando {Math.min((currentPage - 1) * itemsPerPage + 1, filteredTrades.length)} - {Math.min(currentPage * itemsPerPage, filteredTrades.length)} de {filteredTrades.length} trades
                     </span>
                     <div className="flex gap-2">
                         <button
                             onClick={() => handlePageChange(currentPage - 1)}
                             disabled={currentPage === 1}
                             className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                         >
                             <ChevronLeft size={16} />
                         </button>
                         <button
                             onClick={() => handlePageChange(currentPage + 1)}
                             disabled={currentPage === totalPages}
                             className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                         >
                             <ChevronRight size={16} />
                         </button>
                     </div>
                 </div>
             </div>
         </div>
     );
 };
