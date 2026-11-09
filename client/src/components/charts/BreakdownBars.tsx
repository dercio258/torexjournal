import { cn } from '../../lib/cn';
import { ChartEmpty } from './ChartCard';
import { formatMoney } from './chartUtils';

export interface BreakdownRow {
    key: string;
    label: string;
    pnl: number;
    count: number;
    /** 0–100 */
    winRate?: number;
}

interface BreakdownBarsProps {
    rows: BreakdownRow[];
    /** `value` = rank by P&L (nominal categories); `natural` = keep given order (sessions, weekdays). */
    order?: 'value' | 'natural';
    /** Rows beyond this fold into "Outros". */
    maxRows?: number;
    emptyMessage?: string;
}

const foldTail = (rows: BreakdownRow[], max: number): BreakdownRow[] => {
    if (rows.length <= max) return rows;
    const head = rows.slice(0, max - 1);
    const tail = rows.slice(max - 1);
    const count = tail.reduce((a, r) => a + r.count, 0);
    const wins = tail.reduce((a, r) => a + ((r.winRate ?? 0) / 100) * r.count, 0);
    return [
        ...head,
        {
            key: '__other',
            label: `Outros (${tail.length})`,
            pnl: Math.round(tail.reduce((a, r) => a + r.pnl, 0) * 100) / 100,
            count,
            winRate: count ? Math.round((wins / count) * 100) : undefined,
        },
    ];
};

/**
 * Diverging horizontal bars around a zero line. Bar = P&L magnitude; side +
 * color + sign = polarity; trades and win rate printed as text on every row.
 */
export const BreakdownBars = ({ rows, order = 'value', maxRows = 6, emptyMessage = 'Sem trades no período' }: BreakdownBarsProps) => {
    const active = rows.filter((r) => r.count > 0 || r.pnl !== 0);
    if (active.length === 0) return <ChartEmpty message={emptyMessage} className="min-h-[180px]" />;

    const sorted = order === 'value' ? [...rows].filter((r) => r.count > 0).sort((a, b) => b.pnl - a.pnl) : rows;
    const shown = order === 'value' ? foldTail(sorted, maxRows) : sorted;

    const hasNeg = shown.some((r) => r.pnl < 0);
    const hasPos = shown.some((r) => r.pnl > 0);
    const maxAbs = Math.max(...shown.map((r) => Math.abs(r.pnl)), 1e-9);
    // Zero sits in the middle only when both signs are present.
    const zero = hasNeg && hasPos ? 50 : hasNeg ? 100 : 0;
    const span = hasNeg && hasPos ? 50 : 100;

    return (
        <ul className="flex flex-col gap-2.5">
            {shown.map((r) => {
                const pct = (Math.abs(r.pnl) / maxAbs) * span;
                const positive = r.pnl >= 0;
                const empty = r.count === 0;
                return (
                    <li
                        key={r.key}
                        className="group rounded-md px-1 py-0.5 transition-colors hover:bg-fg/[0.03]"
                        title={`${r.label}: ${formatMoney(r.pnl)} · ${r.count} trades${r.winRate !== undefined ? ` · ${r.winRate}% de acerto` : ''}`}
                    >
                        <div className="flex items-baseline justify-between gap-2">
                            <span className={cn('truncate text-xs font-semibold', empty ? 'text-fg-subtle' : 'text-fg')}>{r.label}</span>
                            <span
                                className={cn(
                                    'shrink-0 text-xs font-semibold tabular-nums',
                                    empty ? 'text-fg-subtle' : r.pnl > 0 ? 'text-accent-fg' : r.pnl < 0 ? 'text-danger-fg' : 'text-fg'
                                )}
                            >
                                {empty ? '—' : formatMoney(r.pnl)}
                            </span>
                        </div>

                        <div className="relative mt-1 h-2 w-full" aria-hidden>
                            {/* Track hairline + zero tick */}
                            <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line" />
                            {hasNeg && hasPos && <span className="absolute top-[-2px] h-3 w-px bg-fg-subtle/50" style={{ left: `${zero}%` }} />}
                            {!empty && pct > 0 && (
                                <span
                                    className={cn(
                                        'absolute inset-y-0',
                                        positive ? 'rounded-r-[4px] bg-data-pos' : 'rounded-l-[4px] bg-data-neg'
                                    )}
                                    style={positive ? { left: `${zero}%`, width: `max(${pct}%, 2px)` } : { right: `${100 - zero}%`, width: `max(${pct}%, 2px)` }}
                                />
                            )}
                        </div>

                        <p className="mt-0.5 text-[10.5px] text-fg-subtle tabular-nums">
                            {empty ? 'sem trades' : `${r.count} ${r.count === 1 ? 'trade' : 'trades'}`}
                            {!empty && r.winRate !== undefined && ` · ${r.winRate}% de acerto`}
                        </p>
                    </li>
                );
            })}
        </ul>
    );
};
