import { useState, useEffect, useMemo } from 'react';
import {
    MoreHorizontal, Download, RefreshCw, ChevronLeft, ChevronRight
} from 'lucide-react';
import api from '../api';

interface Trade {
    id: number;
    ticket?: number;
    closeTime: string;
    symbol: string;
    type: string;
    volume: number;
    profit: number;
    openPrice: number;
    closePrice: number;
    commission: number;
    swap: number;
    session?: string;
    status?: string;
}

import { useNavigate } from 'react-router-dom';

export const Trades = () => {
    const navigate = useNavigate();
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
            const res = await api.get('/dashboard/trades');
            if (Array.isArray(res.data)) {
                const mappedTrades = res.data.map((t: any) => ({
                    id: t.id,
                    ticket: t.ticket,
                    closeTime: t.closeTime,
                    symbol: t.symbol.replace(/m$/, ''),
                    type: t.type,
                    volume: Number(t.volume),
                    profit: Number(t.profit) + Number(t.commission) + Number(t.swap),
                    openPrice: Number(t.openPrice),
                    closePrice: Number(t.closePrice),
                    commission: Number(t.commission),
                    swap: Number(t.swap),
                    session: t.session || '-',
                    status: t.status || 'Closed'
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
    }, []);

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
            if (statusFilter !== 'ALL' && (trade.status || 'Closed') !== statusFilter) return false;

            // Date Range
            if (dateRange.start) {
                const tradeDate = new Date(trade.closeTime);
                const startDate = new Date(dateRange.start);
                startDate.setHours(0, 0, 0, 0);
                if (tradeDate < startDate) return false;
            }
            if (dateRange.end) {
                const tradeDate = new Date(trade.closeTime);
                const endDate = new Date(dateRange.end);
                endDate.setHours(23, 59, 59, 999);
                if (tradeDate > endDate) return false;
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

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-white mb-2">Trades</h1>
                    <p className="text-slate-400">Gerencie e analise seu histórico de operações</p>
                </div>
                <div className="flex gap-3">
                    <button onClick={fetchTrades} className="p-2 bg-slate-800 text-slate-300 rounded-xl hover:text-white hover:bg-slate-700 transition-all border border-slate-700">
                        <RefreshCw size={20} className={isLoading ? 'animate-spin' : ''} />
                    </button>
                    <button className="flex items-center gap-2 px-4 py-2 bg-indigo-600/10 text-indigo-400 rounded-xl hover:bg-indigo-600/20 transition-all border border-indigo-600/20 font-bold">
                        <Download size={18} /> Exportar CSV
                    </button>
                </div>
            </div>

            {/* Filters Bar */}
            <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800 p-4 rounded-2xl flex flex-col gap-4">

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
                                className="bg-slate-950 border border-slate-700 rounded-xl px-4 py-2 text-slate-200 focus:ring-2 focus:ring-emerald-500/50 outline-none w-32 placeholder:text-slate-600"
                            />
                        </div>

                        {/* Symbol Selector */}
                        <select
                            value={symbolFilter}
                            onChange={(e) => setSymbolFilter(e.target.value)}
                            className="bg-slate-950 border border-slate-700 rounded-xl px-4 py-2 text-slate-300 focus:ring-2 focus:ring-emerald-500/50 outline-none cursor-pointer"
                        >
                            <option value="ALL">Todos os Símbolos</option>
                            {availableSymbols.map(sym => (
                                <option key={sym} value={sym}>{sym}</option>
                            ))}
                        </select>

                        {/* Date Inputs */}
                        <div className="flex items-center gap-2 bg-slate-950 border border-slate-700 rounded-xl p-1">
                            <input
                                type="date"
                                className="bg-transparent text-xs text-slate-400 focus:text-slate-200 outline-none p-1.5"
                                value={dateRange.start}
                                onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
                            />
                            <span className="text-slate-600">-</span>
                            <input
                                type="date"
                                className="bg-transparent text-xs text-slate-400 focus:text-slate-200 outline-none p-1.5"
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
                            className="bg-slate-950 border border-slate-700 rounded-xl px-4 py-2 text-slate-300 focus:ring-2 focus:ring-emerald-500/50 outline-none cursor-pointer text-xs"
                        >
                            <option value="ALL">Todos os Tipos</option>
                            <option value="BUY">Compra (Buy)</option>
                            <option value="SELL">Venda (Sell)</option>
                        </select>

                        {/* Status Filter */}
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            className="bg-slate-950 border border-slate-700 rounded-xl px-4 py-2 text-slate-300 focus:ring-2 focus:ring-emerald-500/50 outline-none cursor-pointer text-xs"
                        >
                            <option value="ALL">Todos os Status</option>
                            <option value="Open">Open</option>
                            <option value="Closed">Closed</option>
                        </select>

                        {/* Sort Selector */}
                        <div className="border-l border-slate-700 pl-3 ml-1">
                            <select
                                value={sortOption}
                                onChange={(e) => setSortOption(e.target.value)}
                                className="bg-slate-950 border border-slate-700 rounded-xl px-4 py-2 text-indigo-400 font-bold focus:ring-2 focus:ring-indigo-500/50 outline-none cursor-pointer text-xs"
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
            <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-slate-950/50 text-xs text-slate-500 uppercase tracking-wider font-semibold">
                            <tr>
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
                        <tbody className="divide-y divide-slate-800/50 text-sm">
                            {isLoading ? (
                                <tr>
                                    <td colSpan={11} className="p-8 text-center text-slate-500">
                                        Carregando trades...
                                    </td>
                                </tr>
                            ) : paginatedTrades.length === 0 ? (
                                <tr>
                                    <td colSpan={11} className="p-8 text-center text-slate-500">
                                        Nenhum trade encontrado com os filtros selecionados.
                                    </td>
                                </tr>
                            ) : (
                                paginatedTrades.map((trade) => (
                                    <tr
                                        key={trade.id}
                                        onClick={() => navigate(`/trades/${trade.id}`)}
                                        className="hover:bg-slate-800/30 transition-colors group cursor-pointer"
                                    >
                                        <td className="p-4 text-slate-500 font-mono text-xs">#{trade.ticket}</td>
                                        <td className="p-4 text-slate-400 whitespace-nowrap text-xs">
                                            {new Date(trade.closeTime).toLocaleString('pt-BR')}
                                        </td>
                                        <td className="p-4 font-bold text-slate-200">{trade.symbol}</td>
                                        <td className="p-4">
                                            <span className={`px-2 py-1 rounded text-[10px] font-bold border ${trade.type === 'BUY' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
                                                {trade.type}
                                            </span>
                                        </td>
                                        <td className="p-4 text-slate-400 font-mono">{trade.volume.toFixed(2)}</td>
                                        <td className="p-4 text-right font-mono text-slate-400">{trade.openPrice}</td>
                                        <td className="p-4 text-right font-mono text-slate-400">{trade.closePrice || '-'}</td>
                                        <td className="p-4 text-right font-mono text-slate-500 text-xs">
                                            {(trade.commission + trade.swap).toFixed(2)}
                                        </td>
                                        <td className="p-4 text-center">
                                            {trade.profit > 0 ? (
                                                <span className="px-2 py-1 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400">WIN</span>
                                            ) : trade.profit < 0 ? (
                                                <span className="px-2 py-1 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-400">LOSS</span>
                                            ) : (
                                                <span className="text-slate-500">-</span>
                                            )}
                                        </td>
                                        <td className={`p-4 text-right font-bold font-mono ${trade.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                            {trade.profit >= 0 ? '+' : ''}{trade.profit.toFixed(2)}
                                        </td>
                                        <td className="p-4 text-center">
                                            <button className="p-1.5 hover:bg-slate-700 text-slate-400 rounded-lg transition-colors">
                                                <MoreHorizontal size={16} />
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                <div className="p-4 border-t border-slate-800 flex justify-between items-center">
                    <span className="text-xs text-slate-500">
                        Mostrando {Math.min((currentPage - 1) * itemsPerPage + 1, filteredTrades.length)} - {Math.min(currentPage * itemsPerPage, filteredTrades.length)} de {filteredTrades.length} trades
                    </span>
                    <div className="flex gap-2">
                        <button
                            onClick={() => handlePageChange(currentPage - 1)}
                            disabled={currentPage === 1}
                            className="p-2 rounded-lg bg-slate-800 text-slate-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <ChevronLeft size={16} />
                        </button>
                        <button
                            onClick={() => handlePageChange(currentPage + 1)}
                            disabled={currentPage === totalPages}
                            className="p-2 rounded-lg bg-slate-800 text-slate-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <ChevronRight size={16} />
                        </button>
                    </div>
                </div>
            </div>
        </div >
    );
};
