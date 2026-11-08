import React from 'react';
import { useAccount } from '../../context/AccountContext';
import { 
    Layers, 
    DollarSign, 
    TrendingUp, 
    ArrowUpRight, 
    ArrowDownRight, 
    Activity, 
    PieChart, 
    AlertCircle,
    ArrowRight
} from 'lucide-react';

interface ConsolidatedDashboardViewProps {
    stats: any;
}

export const ConsolidatedDashboardView: React.FC<ConsolidatedDashboardViewProps> = ({ stats }) => {
    const { selectAccount, openManageModal } = useAccount();

    const formatMoney = (val: number, currency = 'USD') => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: currency || 'USD',
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
        }).format(val || 0);
    };

    const breakdown = stats.accountBreakdown || [];
    const hasMultipleCurrencies = stats.hasMultipleCurrencies;
    const currencies = stats.currencies || ['USD'];

    return (
        <div className="space-y-8 animate-in fade-in duration-300">
            {/* Aviso de Múltiplas Moedas */}
            {hasMultipleCurrencies && (
                <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                        <AlertCircle size={18} className="text-amber-400 flex-shrink-0" />
                        <span>
                            <b>Atenção Contábil:</b> Seu portfólio possui contas em moedas distintas ({currencies.join(', ')}). 
                            Os valores consolidados são segregados por exatidão financeira.
                        </span>
                    </div>
                </div>
            )}

            {/* Banner de Boas-Vindas da Visão Consolidada */}
            <div className="p-6 rounded-3xl bg-gradient-to-r from-surface via-surface-2/60 to-surface border border-indigo-500/25 shadow-xl relative overflow-hidden">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 relative z-10">
                    <div className="flex items-center gap-3.5">
                        <div className="w-12 h-12 rounded-2xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shadow-lg shadow-indigo-500/10">
                            <Layers size={24} />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="text-xl font-bold text-fg">Visão Consolidada</h2>
                                <span className="text-[10px] bg-indigo-500/20 text-indigo-400 px-2 py-0.5 rounded-full border border-indigo-500/30 font-bold">
                                    TODAS AS CONTAS
                                </span>
                            </div>
                            <p className="text-xs text-fg-muted mt-0.5">
                                Performance unificada de {breakdown.length} contas de trading ativas
                            </p>
                        </div>
                    </div>

                    <button
                        onClick={() => openManageModal('accounts')}
                        className="px-4 py-2 rounded-xl bg-surface-2 hover:bg-surface-3 text-xs font-semibold text-fg transition-colors border border-line"
                    >
                        Gerenciar Contas
                    </button>
                </div>
            </div>

            {/* KPI Cards Consolidados */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Total PnL */}
                <div className="p-6 rounded-2xl bg-surface border border-line relative overflow-hidden group hover:border-[rgba(16,185,129,0.3)] transition-all shadow-xl">
                    <div className="flex justify-between items-start mb-4">
                        <div className={`p-3 rounded-xl ${stats.totalPnL >= 0 ? 'bg-emerald-500/10 text-accent-fg' : 'bg-rose-500/10 text-danger-fg'}`}>
                            <DollarSign size={20} />
                        </div>
                        <span className={`text-xs font-bold px-2 py-1 rounded-full flex items-center gap-0.5 ${
                            stats.totalPnL >= 0 ? 'bg-emerald-500/10 text-accent-fg' : 'bg-rose-500/10 text-danger-fg'
                        }`}>
                            {stats.totalPnL >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                            {stats.totalPnL >= 0 ? 'Lucro' : 'Prejuízo'}
                        </span>
                    </div>
                    <span className="text-xs text-fg-muted block mb-1">Lucro Líquido Consolidado</span>
                    <div className={`text-2xl font-bold font-mono ${stats.totalPnL >= 0 ? 'text-accent-fg' : 'text-danger-fg'}`}>
                        {stats.totalPnL >= 0 ? '+' : ''}{formatMoney(stats.totalPnL)}
                    </div>
                </div>

                {/* Win Rate */}
                <div className="p-6 rounded-2xl bg-surface border border-line relative overflow-hidden group hover:border-[rgba(16,185,129,0.3)] transition-all shadow-xl">
                    <div className="flex justify-between items-start mb-4">
                        <div className="p-3 rounded-xl bg-indigo-500/10 text-indigo-400">
                            <PieChart size={20} />
                        </div>
                        <span className="text-xs font-bold px-2 py-1 rounded-full bg-surface-2 text-fg/80 border border-line">
                            {stats.totalTrades} trades
                        </span>
                    </div>
                    <span className="text-xs text-fg-muted block mb-1">Taxa de Acerto Geral</span>
                    <div className="text-2xl font-bold text-fg font-mono">
                        {(stats.winRate || 0).toFixed(1)}%
                    </div>
                </div>

                {/* Total Operações */}
                <div className="p-6 rounded-2xl bg-surface border border-line relative overflow-hidden group hover:border-[rgba(16,185,129,0.3)] transition-all shadow-xl">
                    <div className="flex justify-between items-start mb-4">
                        <div className="p-3 rounded-xl bg-teal-500/10 text-teal-400">
                            <Activity size={20} />
                        </div>
                        <span className="text-xs font-bold px-2 py-1 rounded-full bg-emerald-500/10 text-accent-fg">
                            PF: {(stats.profitFactor || 0).toFixed(2)}
                        </span>
                    </div>
                    <span className="text-xs text-fg-muted block mb-1">Total de Operações</span>
                    <div className="text-2xl font-bold text-fg font-mono">
                        {stats.totalTrades}
                    </div>
                </div>

                {/* Média por Operação */}
                <div className="p-6 rounded-2xl bg-surface border border-line relative overflow-hidden group hover:border-[rgba(16,185,129,0.3)] transition-all shadow-xl">
                    <div className="flex justify-between items-start mb-4">
                        <div className="p-3 rounded-xl bg-amber-500/10 text-amber-400">
                            <TrendingUp size={20} />
                        </div>
                        <span className="text-xs font-bold px-2 py-1 rounded-full bg-surface-2 text-fg/80 font-mono border border-line">
                            {breakdown.length} Contas
                        </span>
                    </div>
                    <span className="text-xs text-fg-muted block mb-1">Média Líquida por Trade</span>
                    <div className={`text-2xl font-bold font-mono ${
                        (stats.totalTrades > 0 ? stats.totalPnL / stats.totalTrades : 0) >= 0 ? 'text-accent-fg' : 'text-danger-fg'
                    }`}>
                        {formatMoney(stats.totalTrades > 0 ? stats.totalPnL / stats.totalTrades : 0)}
                    </div>
                </div>
            </div>

            {/* Tabela de Decomposição por Conta */}
            <div className="p-6 rounded-2xl bg-surface border border-line shadow-xl space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-base font-bold text-fg">Desempenho Individual por Conta</h3>
                        <p className="text-xs text-fg-muted">Detalhamento dos resultados reais de cada conta de trading isolada</p>
                    </div>
                </div>

                <div className="overflow-x-auto rounded-xl border border-line">
                    <table className="w-full text-left text-xs">
                        <thead className="bg-canvas-subtle text-fg-muted border-b border-line text-[10px] uppercase tracking-wider font-semibold">
                            <tr>
                                <th className="p-3.5">Conta</th>
                                <th className="p-3.5">Corretora</th>
                                <th className="p-3.5">Tipo</th>
                                <th className="p-3.5 text-right">Lucro Líquido</th>
                                <th className="p-3.5 text-right">Win Rate</th>
                                <th className="p-3.5 text-right">Trades</th>
                                <th className="p-3.5 text-center">Ação</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                            {breakdown.map((account: any) => {
                                const isPositive = account.pnl >= 0;

                                return (
                                    <tr key={account.id} className="hover:bg-surface-2/50 transition-colors">
                                        <td className="p-3.5 font-bold text-fg flex items-center gap-2">
                                            {account.name}
                                        </td>
                                        <td className="p-3.5 text-fg-muted">
                                            {account.broker}
                                        </td>
                                        <td className="p-3.5">
                                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                                account.type === 'prop_firm' || account.type === 'challenge' || account.type === 'funded'
                                                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                                                    : account.type === 'demo'
                                                    ? 'bg-sky-500/10 text-sky-400 border-sky-500/30'
                                                    : 'bg-emerald-500/10 text-accent-fg border-emerald-500/30'
                                            }`}>
                                                {account.type.toUpperCase()}
                                            </span>
                                        </td>
                                        <td className={`p-3.5 text-right font-mono font-bold ${
                                            isPositive ? 'text-accent-fg' : 'text-danger-fg'
                                        }`}>
                                            {isPositive ? '+' : ''}{formatMoney(account.pnl, account.currency)}
                                        </td>
                                        <td className="p-3.5 text-right font-mono text-fg/80">
                                            {(account.winRate || 0).toFixed(1)}%
                                        </td>
                                        <td className="p-3.5 text-right font-mono text-fg-muted">
                                            {account.trades}
                                        </td>
                                        <td className="p-3.5 text-center">
                                            <button
                                                onClick={() => selectAccount(account.id)}
                                                className="px-2.5 py-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-accent-fg text-[11px] font-bold transition-all flex items-center gap-1 mx-auto"
                                                title="Filtrar exclusivamente esta conta"
                                            >
                                                <span>Acessar</span>
                                                <ArrowRight size={12} />
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
