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
    ArrowRight,
} from 'lucide-react';

interface ConsolidatedDashboardViewProps {
    stats: any;
    locale?: 'pt' | 'en';
}

export const ConsolidatedDashboardView: React.FC<ConsolidatedDashboardViewProps> = ({
    stats,
    locale = 'pt',
}) => {
    const { selectAccount, openManageModal } = useAccount();
    const isEn = locale === 'en';

    const formatMoney = (val: number, currency = 'USD') => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: currency || 'USD',
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
        }).format(val || 0);
    };

    const breakdown = stats.accountBreakdown || [];
    const hasMultipleCurrencies = stats.hasMultipleCurrencies;
    const currencies = stats.currencies || ['USD'];

    return (
        <div className="space-y-3 animate-in fade-in duration-300">
            {/* Aviso de Múltiplas Moedas */}
            {hasMultipleCurrencies && (
                <div className="px-3.5 py-2.5 rounded-xl bg-warning/10 border border-warning/20 text-warning text-xs flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <AlertCircle size={15} className="text-warning flex-shrink-0" />
                        <span>
                            {isEn ? (
                                <>
                                    <b>Multi-Currency Portfolio:</b> Your portfolio spans accounts in distinct currencies (
                                    {currencies.join(', ')}). Consolidated totals are tracked with strict currency accuracy.
                                </>
                            ) : (
                                <>
                                    <b>Atenção Contábil:</b> Seu portfólio possui contas em moedas distintas (
                                    {currencies.join(', ')}). Os valores consolidados são segregados por exatidão financeira.
                                </>
                            )}
                        </span>
                    </div>
                </div>
            )}

            {/* Banner da Visão Consolidada */}
            <div className="p-3.5 sm:p-4 rounded-xl bg-surface border border-line flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-accent/10 border border-accent/25 flex items-center justify-center text-accent-fg shrink-0">
                        <Layers size={18} />
                    </div>
                    <div>
                        <div className="flex items-center gap-2 flex-wrap">
                            <h2 className="text-sm font-bold text-fg tracking-tight">
                                {isEn ? 'Consolidated Overview' : 'Visão Consolidada'}
                            </h2>
                            <span className="text-[10px] bg-accent/10 text-accent-fg px-2 py-0.5 rounded-md border border-accent/20 font-semibold uppercase tracking-wider">
                                {isEn ? 'All Accounts' : 'Todas as Contas'}
                            </span>
                        </div>
                        <p className="text-[11px] text-fg-muted mt-0.5">
                            {isEn
                                ? `Unified performance across ${breakdown.length} active trading accounts`
                                : `Performance unificada de ${breakdown.length} contas de trading ativas`}
                        </p>
                    </div>
                </div>

                <button
                    onClick={() => openManageModal('accounts')}
                    className="h-8 px-3 rounded-lg bg-surface-2 hover:bg-surface-3 text-xs font-semibold text-fg transition-colors border border-line cursor-pointer"
                >
                    {isEn ? 'Manage Accounts' : 'Gerenciar Contas'}
                </button>
            </div>

            {/* KPI Cards Consolidados (2x2 em dispositivos móveis, 1x4 horizontal no desktop) */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
                {/* Total PnL */}
                <div className="p-2.5 sm:p-4 rounded-xl bg-surface border border-line flex flex-col justify-between min-h-[82px]">
                    <div className="flex justify-between items-center gap-1.5 mb-1.5">
                        <span className="text-[9.5px] sm:text-[10px] font-semibold uppercase tracking-wider text-fg-subtle flex items-center gap-1 truncate">
                            <DollarSign
                                size={12}
                                className={`shrink-0 ${stats.totalPnL >= 0 ? 'text-accent-fg' : 'text-danger-fg'}`}
                            />
                            <span className="truncate">
                                {isEn ? 'Consolidated Net P&L' : 'Lucro Líquido Consolidado'}
                            </span>
                        </span>
                        <span
                            className={`hidden sm:inline-flex text-[10px] font-semibold px-1.5 py-0.5 rounded items-center gap-0.5 shrink-0 ${
                                stats.totalPnL >= 0 ? 'bg-accent/10 text-accent-fg' : 'bg-danger/10 text-danger-fg'
                            }`}
                        >
                            {stats.totalPnL >= 0 ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
                            {stats.totalPnL >= 0 ? (isEn ? 'Profit' : 'Lucro') : isEn ? 'Loss' : 'Prejuízo'}
                        </span>
                    </div>
                    <div
                        className={`text-lg sm:text-xl font-bold font-mono tabular-nums tracking-tight ${
                            stats.totalPnL >= 0 ? 'text-accent-fg' : 'text-danger-fg'
                        }`}
                    >
                        {stats.totalPnL >= 0 ? '+' : ''}
                        {formatMoney(stats.totalPnL)}
                    </div>
                </div>

                {/* Win Rate */}
                <div className="p-2.5 sm:p-4 rounded-xl bg-surface border border-line flex flex-col justify-between min-h-[82px]">
                    <div className="flex justify-between items-center gap-1.5 mb-1.5">
                        <span className="text-[9.5px] sm:text-[10px] font-semibold uppercase tracking-wider text-fg-subtle flex items-center gap-1 truncate">
                            <PieChart size={12} className="text-fg-muted shrink-0" />
                            <span className="truncate">{isEn ? 'Win Rate' : 'Taxa de Acerto Geral'}</span>
                        </span>
                        <span className="hidden sm:inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded bg-surface-2 text-fg-muted border border-line-subtle tabular-nums shrink-0">
                            {stats.totalTrades} trades
                        </span>
                    </div>
                    <div className="text-lg sm:text-xl font-bold text-fg font-mono tabular-nums tracking-tight">
                        {(stats.winRate || 0).toFixed(1)}%
                    </div>
                </div>

                {/* Total Operações / Profit Factor */}
                <div className="p-2.5 sm:p-4 rounded-xl bg-surface border border-line flex flex-col justify-between min-h-[82px]">
                    <div className="flex justify-between items-center gap-1.5 mb-1.5">
                        <span className="text-[9.5px] sm:text-[10px] font-semibold uppercase tracking-wider text-fg-subtle flex items-center gap-1 truncate">
                            <Activity size={12} className="text-fg-muted shrink-0" />
                            <span className="truncate">{isEn ? 'Profit Factor' : 'Total de Operações'}</span>
                        </span>
                        <span className="text-[9.5px] sm:text-[10px] font-semibold px-1.5 py-0.5 rounded bg-accent/10 text-accent-fg tabular-nums shrink-0">
                            {isEn ? `${stats.totalTrades} tr` : `PF ${(stats.profitFactor || 0).toFixed(2)}`}
                        </span>
                    </div>
                    <div className="text-lg sm:text-xl font-bold text-fg font-mono tabular-nums tracking-tight">
                        {isEn ? (stats.profitFactor || 0).toFixed(2) : stats.totalTrades}
                    </div>
                </div>

                {/* Média por Operação / Expectancy */}
                <div className="p-2.5 sm:p-4 rounded-xl bg-surface border border-line flex flex-col justify-between min-h-[82px]">
                    <div className="flex justify-between items-center gap-1.5 mb-1.5">
                        <span className="text-[9.5px] sm:text-[10px] font-semibold uppercase tracking-wider text-fg-subtle flex items-center gap-1 truncate">
                            <TrendingUp size={12} className="text-fg-muted shrink-0" />
                            <span className="truncate">{isEn ? 'Expectancy / Trade' : 'Média Líquida / Trade'}</span>
                        </span>
                        <span className="hidden sm:inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded bg-surface-2 text-fg-muted border border-line-subtle tabular-nums shrink-0">
                            {breakdown.length} {isEn ? 'Accts' : 'Contas'}
                        </span>
                    </div>
                    <div
                        className={`text-lg sm:text-xl font-bold font-mono tabular-nums tracking-tight ${
                            (stats.totalTrades > 0 ? stats.totalPnL / stats.totalTrades : 0) >= 0
                                ? 'text-accent-fg'
                                : 'text-danger-fg'
                        }`}
                    >
                        {formatMoney(stats.totalTrades > 0 ? stats.totalPnL / stats.totalTrades : 0)}
                    </div>
                </div>
            </div>

            {/* Tabela de Decomposição por Conta */}
            <div className="rounded-xl bg-surface border border-line overflow-hidden">
                <div className="px-4 py-3 border-b border-line-subtle flex items-center justify-between">
                    <div>
                        <h3 className="text-xs font-bold uppercase tracking-wider text-fg">
                            {isEn ? 'Account Breakdown' : 'Desempenho Individual por Conta'}
                        </h3>
                        <p className="text-[11px] text-fg-muted mt-0.5">
                            {isEn ? 'Isolated metrics by trading account' : 'Resultados isolados por conta operacional'}
                        </p>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                        <thead className="bg-canvas-subtle text-fg-subtle border-b border-line-subtle text-[10px] uppercase tracking-wider font-semibold">
                            <tr>
                                <th className="px-4 py-2.5">{isEn ? 'Account' : 'Conta'}</th>
                                <th className="px-4 py-2.5">{isEn ? 'Broker' : 'Corretora'}</th>
                                <th className="px-4 py-2.5">{isEn ? 'Type' : 'Tipo'}</th>
                                <th className="px-4 py-2.5 text-right">{isEn ? 'Net P&L' : 'Lucro Líquido'}</th>
                                <th className="px-4 py-2.5 text-right">Win Rate</th>
                                <th className="px-4 py-2.5 text-right">Trades</th>
                                <th className="px-4 py-2.5 text-center">{isEn ? 'Action' : 'Ação'}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-line-subtle">
                            {breakdown.map((account: any) => {
                                const isPositive = account.pnl >= 0;

                                return (
                                    <tr key={account.id} className="hover:bg-surface-2/50 transition-colors">
                                        <td className="px-4 py-2.5 font-semibold text-fg">{account.name}</td>
                                        <td className="px-4 py-2.5 text-fg-muted">{account.broker}</td>
                                        <td className="px-4 py-2.5">
                                            <span
                                                className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border ${
                                                    account.type === 'prop_firm' ||
                                                    account.type === 'challenge' ||
                                                    account.type === 'funded'
                                                        ? 'bg-warning/10 text-warning border-warning/25'
                                                        : account.type === 'demo'
                                                          ? 'bg-surface-2 text-fg-muted border-line'
                                                          : 'bg-accent/10 text-accent-fg border-accent/25'
                                                }`}
                                            >
                                                {account.type.toUpperCase()}
                                            </span>
                                        </td>
                                        <td
                                            className={`px-4 py-2.5 text-right font-mono font-semibold tabular-nums ${
                                                isPositive ? 'text-accent-fg' : 'text-danger-fg'
                                            }`}
                                        >
                                            {isPositive ? '+' : ''}
                                            {formatMoney(account.pnl, account.currency)}
                                        </td>
                                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-fg-muted">
                                            {(account.winRate || 0).toFixed(1)}%
                                        </td>
                                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-fg-muted">
                                            {account.trades}
                                        </td>
                                        <td className="px-4 py-2.5 text-center">
                                            <button
                                                onClick={() => selectAccount(account.id)}
                                                className="px-2.5 py-1 rounded-lg bg-accent/10 hover:bg-accent/20 text-accent-fg text-[11px] font-semibold transition-colors inline-flex items-center gap-1 cursor-pointer"
                                                title={
                                                    isEn
                                                        ? 'Filter exclusively by this account'
                                                        : 'Filtrar exclusivamente esta conta'
                                                }
                                            >
                                                <span>{isEn ? 'Open' : 'Acessar'}</span>
                                                <ArrowRight size={11} />
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
