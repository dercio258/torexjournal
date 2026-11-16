import React, { useMemo } from 'react';
import { cn } from '../../lib/cn';

export interface RecentTradeRow {
    ticket?: string;
    value: number;
    date?: string;
}

interface RecentTradesSimpleTableProps {
    trades?: RecentTradeRow[];
    locale?: 'pt' | 'en';
    className?: string;
}

const formatTradeProfit = (val: number) => {
    const abs = Math.abs(val);
    const formatted = abs.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
    if (val > 0.001) return `+$${formatted}`;
    if (val < -0.001) return `-$${formatted}`;
    return `$${formatted}`;
};

export const RecentTradesSimpleTable: React.FC<RecentTradesSimpleTableProps> = ({
    trades = [],
    locale = 'pt',
    className,
}) => {
    const recentRows = useMemo(() => [...trades].reverse(), [trades]);
    const isEn = locale === 'en';

    return (
        <section
            className={cn(
                'bg-surface border border-line hover:border-line-strong rounded-xl p-3.5 sm:p-4 transition-colors flex flex-col w-full h-full',
                className
            )}
        >
            {/* Compact Header */}
            <div className="flex items-center justify-between gap-2 pb-2.5 mb-2 border-b border-line-subtle shrink-0">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-fg-muted">
                    {isEn ? 'Recent Trades' : 'Trades Recentes'}
                </h3>
                <span className="px-2 py-0.5 rounded-full bg-canvas-subtle border border-line-subtle text-[10.5px] font-mono tabular-nums text-fg-subtle">
                    {recentRows.length}
                </span>
            </div>

            {/* Subtle Column Headers: Ticket + Net P&L / Lucro */}
            <div className="grid grid-cols-2 items-center px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle shrink-0">
                <span>Ticket</span>
                <span className="text-right">{isEn ? 'Net P&L' : 'Lucro'}</span>
            </div>

            {/* Compact Table Body synced with Calendar height on lg+ */}
            <div className="relative flex-1 min-h-[210px] max-h-[290px] lg:max-h-none overflow-hidden">
                {recentRows.length === 0 ? (
                    <div className="h-full min-h-[190px] flex items-center justify-center text-center px-3">
                        <p className="text-xs text-fg-subtle">
                            {isEn ? 'No recent trades in this period.' : 'Nenhum trade recente no período.'}
                        </p>
                    </div>
                ) : (
                    <div className="max-h-[290px] lg:max-h-none lg:absolute lg:inset-0 overflow-y-auto pr-0.5 divide-y divide-line-subtle">
                        {recentRows.map((trade, index) => {
                            const ticketLabel = trade.ticket
                                ? String(trade.ticket).startsWith('#')
                                    ? String(trade.ticket)
                                    : `#${trade.ticket}`
                                : `#${index + 1}`;
                            const isPos = trade.value > 0.001;
                            const isNeg = trade.value < -0.001;

                            return (
                                <div
                                    key={`${ticketLabel}-${index}`}
                                    className="grid grid-cols-2 items-center px-2 py-1.5 hover:bg-surface-2/60 rounded-md transition-colors"
                                >
                                    <span className="text-[11.5px] font-mono text-fg-muted truncate pr-2 tabular-nums">
                                        {ticketLabel}
                                    </span>
                                    <span
                                        className={cn(
                                            'text-[11.5px] font-bold tabular-nums text-right tracking-tight',
                                            isPos
                                                ? 'text-accent-fg'
                                                : isNeg
                                                  ? 'text-danger-fg'
                                                  : 'text-fg-muted'
                                        )}
                                    >
                                        {formatTradeProfit(trade.value)}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </section>
    );
};
