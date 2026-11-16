import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, BarChart3, ShieldAlert } from 'lucide-react';
import { Badge, EmptyState, fmtMoney, fmtNum, KpiCard, Panel, pnlTone } from './primitives';
import { cn } from '../../lib/cn';

export interface TearSheetSummary {
    totalTrades: number;
    endingBalance: number;
    netPnlUsd: number;
    totalReturnPct: number;
    cagrPct: number;
    winRatePct: number;
    profitFactor: number;
    expectancyUsd: number;
    expectancyR: number;
    sharpe: number;
    sortino: number;
    calmar: number;
    omega: number;
    ulcerIndex: number;
    tailRatio: number;
    recoveryFactor: number;
    sqn: number;
    kellyPct: number;
    var95Pct: number;
    cvar95Pct: number;
    maxDrawdownPct: number;
    maxDrawdownUsd: number;
    avgDrawdownPct: number;
    maxDdDurationTrades: number;
    maxConsecutiveWins: number;
    maxConsecutiveLosses: number;
}

export interface TearSheetData {
    engine: string;
    symbol: string;
    initialBalance: number;
    summary: TearSheetSummary;
    underwaterSeries: Array<{
        idx: number;
        timestamp: number;
        equity: number;
        underwaterPct: number;
    }>;
    monthlyReturns: Array<{
        year: number;
        months: Record<string, number>;
        ytdPct: number;
    }>;
    sessionBreakdown: Array<{
        session: string;
        label: string;
        trades: number;
        winRatePct: number;
        netPnlUsd: number;
        profitFactor: number;
        avgR: number;
    }>;
    rDistribution: Array<{
        bucket: string;
        count: number;
        pct: number;
    }>;
}

interface QuantTearSheetPanelProps {
    orders?: any[];
    initialBalance?: number;
    symbol?: string;
    isEn?: boolean;
    precomputedData?: TearSheetData | null;
    title?: string;
}

const MONTH_LABELS_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const MONTH_LABELS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const UnderwaterDrawdownSvg = ({
    series,
    maxDrawdownPct,
    maxDrawdownUsd,
    isEn,
}: {
    series: TearSheetData['underwaterSeries'];
    maxDrawdownPct: number;
    maxDrawdownUsd: number;
    isEn: boolean;
}) => {
    if (!series || series.length < 2) return null;
    const width = 760;
    const height = 185;
    const padX = 14;
    const padY = 16;

    const minUw = Math.min(-0.5, ...series.map((p) => p.underwaterPct));
    const span = Math.max(0.5, 0 - minUw);

    const toX = (i: number) => padX + (i / Math.max(1, series.length - 1)) * (width - padX * 2);
    const toY = (v: number) => padY + ((0 - v) / span) * (height - padY * 2);

    const linePts = series.map((p, i) => `${toX(i).toFixed(1)},${toY(p.underwaterPct).toFixed(1)}`).join(' ');
    const areaPts = `${padX},${padY} ${linePts} ${toX(series.length - 1).toFixed(1)},${padY}`;

    return (
        <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
                <span>
                    {isEn
                        ? 'Underwater Drawdown Curve (% below rolling equity high-water mark)'
                        : 'Curva Underwater (% abaixo do pico máximo de capital acumulado)'}
                </span>
                <span className="font-mono font-semibold text-rose-500 tabular-nums">
                    Max DD: -{maxDrawdownPct.toFixed(2)}% ({fmtMoney(-Math.abs(maxDrawdownUsd))})
                </span>
            </div>
            <svg viewBox={`0 0 ${width} ${height}`} className="h-44 w-full rounded-lg border border-line bg-surface-2/40">
                <line
                    x1={padX}
                    y1={padY}
                    x2={width - padX}
                    y2={padY}
                    stroke="currentColor"
                    strokeOpacity="0.3"
                    strokeDasharray="4 4"
                />
                <polygon fill="#f43f5e" fillOpacity="0.22" points={areaPts} />
                <polyline fill="none" stroke="#f43f5e" strokeWidth="2.2" strokeLinejoin="round" points={linePts} />
            </svg>
        </div>
    );
};

export const QuantTearSheetPanel = ({
    orders = [],
    initialBalance = 100000,
    symbol = 'XAUUSD',
    isEn = false,
    precomputedData = null,
    title,
}: QuantTearSheetPanelProps) => {
    const [fetchedData, setFetchedData] = useState<TearSheetData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const closedOrders = useMemo(
        () =>
            (orders || []).filter((o) => {
                const st = String(o?.status || 'CLOSED').toUpperCase();
                return !['CANCELLED', 'REJECTED', 'PENDING', 'OPEN'].includes(st);
            }),
        [orders]
    );

    const closedKey = useMemo(
        () =>
            `${symbol}:${initialBalance}:${closedOrders.length}:${closedOrders
                .slice(-4)
                .map((o) => `${o.id || ''}:${o.pnl || 0}`)
                .join('|')}`,
        [symbol, initialBalance, closedOrders]
    );

    useEffect(() => {
        if (precomputedData) {
            setFetchedData(null);
            setError(null);
            return;
        }
        if (closedOrders.length === 0) {
            setFetchedData(null);
            setError(null);
            return;
        }

        let cancelled = false;
        setLoading(true);
        setError(null);

        fetch('/api/quant/tearsheet', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                orders: closedOrders,
                initialBalance,
                symbol,
                locale: isEn ? 'en' : 'pt',
            }),
            signal: AbortSignal.timeout(15000),
        })
            .then(async (res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return (await res.json()) as TearSheetData;
            })
            .then((json) => {
                if (!cancelled) setFetchedData(json);
            })
            .catch((err) => {
                if (!cancelled) {
                    setError((err as Error)?.message || 'Failed to compute Tear-Sheet');
                }
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [precomputedData, closedKey, initialBalance, symbol, isEn]);

    const data = precomputedData || fetchedData;
    const monthLabels = isEn ? MONTH_LABELS_EN : MONTH_LABELS_PT;

    if (!precomputedData && closedOrders.length === 0) {
        return (
            <Panel
                title={title || (isEn ? 'QuantStats Institutional Tear-Sheet' : 'Tear-Sheet Institucional QuantStats')}
                subtitle={isEn ? 'Requires at least 1 closed trade to compute risk ratios.' : 'Requer pelo menos 1 trade fechado para calcular métricas quantitativas.'}
            >
                <EmptyState
                    icon={<BarChart3 size={20} />}
                    title={isEn ? 'No closed trades yet' : 'Ainda sem trades fechados nesta sessão'}
                    description={
                        isEn
                            ? 'Execute simulated trades in Replay or run a Quant Optimization to unlock Sharpe, Sortino, Ulcer Index, VaR/CVaR, Underwater Drawdown, and Session Breakdown.'
                            : 'Execute operações no Terminal Replay ou rode uma otimização Quant para desbloquear Sharpe, Sortino, Ulcer Index, VaR/CVaR 95%, Underwater e análise por Sessão.'
                    }
                />
            </Panel>
        );
    }

    if (loading && !data) {
        return (
            <Panel
                title={title || (isEn ? 'QuantStats Institutional Tear-Sheet' : 'Tear-Sheet Institucional QuantStats')}
            >
                <div className="flex items-center gap-2 py-8 text-sm text-fg-muted">
                    <Activity size={16} className="animate-spin text-accent-fg" />
                    <span>{isEn ? 'Computing QuantStats risk ratios, VaR/CVaR & session attribution...' : 'Calculando métricas QuantStats, VaR/CVaR 95% e sessões UTC...'}</span>
                </div>
            </Panel>
        );
    }

    if (error && !data) {
        return (
            <Panel title={title || 'QuantStats Tear-Sheet'}>
                <div className="flex items-center gap-2 rounded-lg border border-danger/35 bg-danger/10 p-3 text-xs text-danger-fg">
                    <AlertTriangle size={15} />
                    <span>{error}</span>
                </div>
            </Panel>
        );
    }

    if (!data) return null;
    const s = data.summary;
    const maxBinCount = Math.max(1, ...data.rDistribution.map((b) => b.count));

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="accent">{data.engine}</Badge>
                    <span className="text-sm font-bold text-fg">
                        {title || (isEn ? 'Institutional Tear-Sheet' : 'Tear-Sheet Quant Institucional')} · {data.symbol}
                    </span>
                    <span className="text-xs text-fg-muted tabular-nums">
                        {s.totalTrades} trades · {fmtMoney(data.initialBalance)} {'->'} {fmtMoney(s.endingBalance)}
                    </span>
                </div>
                <div className="flex items-center gap-3 text-xs tabular-nums">
                    <span className={cn('font-bold', pnlTone(s.totalReturnPct))}>
                        {s.totalReturnPct >= 0 ? '+' : ''}
                        {s.totalReturnPct.toFixed(2)}% ({fmtMoney(s.netPnlUsd, { sign: true })})
                    </span>
                    <Badge tone={s.profitFactor >= 1.4 ? 'accent' : s.profitFactor >= 1.0 ? 'warn' : 'danger'}>
                        PF {s.profitFactor.toFixed(2)}
                    </Badge>
                </div>
            </div>

            {/* 12-Card Institutional Ratio Grid */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                <KpiCard label="Sharpe Ratio" value={fmtNum(s.sharpe, 2)} tone={pnlTone(s.sharpe)} hint={`Sortino ${fmtNum(s.sortino, 2)}`} />
                <KpiCard label="Sortino Ratio" value={fmtNum(s.sortino, 2)} tone={pnlTone(s.sortino)} hint={`Omega ${fmtNum(s.omega, 2)}`} />
                <KpiCard label="Calmar Ratio" value={fmtNum(s.calmar, 2)} tone={pnlTone(s.calmar)} hint={`CAGR ${s.cagrPct.toFixed(1)}%`} />
                <KpiCard label="Omega Ratio" value={fmtNum(s.omega, 2)} tone={s.omega >= 1.2 ? 'text-emerald-500' : 'text-fg'} hint={`Tail ${fmtNum(s.tailRatio, 2)}`} />
                <KpiCard label="Ulcer Index" value={`${s.ulcerIndex.toFixed(2)}%`} hint={isEn ? `Avg DD ${s.avgDrawdownPct.toFixed(2)}%` : `DD Médio ${s.avgDrawdownPct.toFixed(2)}%`} />
                <KpiCard label="Tail Ratio" value={fmtNum(s.tailRatio, 2)} hint={isEn ? 'Right / Left tail' : 'Assimetria de cauda'} />
                <KpiCard label="Recovery Factor" value={fmtNum(s.recoveryFactor, 2)} tone={pnlTone(s.recoveryFactor)} hint={isEn ? 'Net / Max DD $' : 'Lucro / Max DD $'} />
                <KpiCard label="SQN (Van Tharp)" value={fmtNum(s.sqn, 2)} tone={s.sqn >= 2.0 ? 'text-emerald-500' : pnlTone(s.sqn)} hint={`Exp ${s.expectancyR >= 0 ? '+' : ''}${s.expectancyR.toFixed(2)}R`} />
                <KpiCard label="Half-Kelly" value={`${s.kellyPct.toFixed(2)}%`} hint={`Win Rate ${s.winRatePct.toFixed(1)}%`} />
                <KpiCard
                    label="VaR 95%"
                    value={`-${s.var95Pct.toFixed(2)}%`}
                    tone="text-amber-500"
                    hint={isEn ? 'Per-trade 95% tail' : 'Limite perda 95%'}
                />
                <KpiCard
                    label="CVaR 95% (ES)"
                    value={`-${s.cvar95Pct.toFixed(2)}%`}
                    tone="text-rose-500"
                    hint={isEn ? 'Expected Shortfall' : 'Média da cauda 5%'}
                />
                <KpiCard
                    label={isEn ? 'DD Dur. & Streaks' : 'Duração DD / Seq.'}
                    value={`${s.maxDdDurationTrades} tr`}
                    hint={`W:${s.maxConsecutiveWins} / L:${s.maxConsecutiveLosses}`}
                />
            </div>

            {/* Underwater Drawdown Area */}
            <Panel
                title={isEn ? 'Underwater Drawdown Profile' : 'Perfil de Drawdown (Underwater)'}
                subtitle={isEn ? 'Tracks depth & recovery duration across closed equity swings.' : 'Monitora profundidade e tempo de recuperação abaixo da máxima histórica.'}
            >
                <UnderwaterDrawdownSvg
                    series={data.underwaterSeries}
                    maxDrawdownPct={s.maxDrawdownPct}
                    maxDrawdownUsd={s.maxDrawdownUsd}
                    isEn={isEn}
                />
            </Panel>

            {/* Monthly Returns Matrix */}
            {data.monthlyReturns.length > 0 && (
                <Panel
                    title={isEn ? 'Monthly Returns Matrix (%)' : 'Matriz de Retornos Mensais (%)'}
                    subtitle={isEn ? 'Compounded monthly account return by UTC close month.' : 'Retorno mensal composto por mês de encerramento (UTC).'}
                    bodyClassName="p-0"
                >
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[760px] text-center text-xs tabular-nums">
                            <thead>
                                <tr className="border-b border-line text-[11px] uppercase tracking-wider text-fg-subtle">
                                    <th className="px-3 py-2 text-left">{isEn ? 'Year' : 'Ano'}</th>
                                    {monthLabels.map((m) => (
                                        <th key={m} className="px-2 py-2">
                                            {m}
                                        </th>
                                    ))}
                                    <th className="px-3 py-2 text-right font-bold">YTD</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-line">
                                {data.monthlyReturns.map((row) => (
                                    <tr key={row.year}>
                                        <th scope="row" className="px-3 py-2 text-left font-mono font-bold text-fg">
                                            {row.year}
                                        </th>
                                        {Array.from({ length: 12 }, (_, idx) => {
                                            const val = row.months[String(idx + 1)];
                                            if (val === undefined) {
                                                return (
                                                    <td key={idx} className="px-2 py-2 text-fg-subtle/50">
                                                        —
                                                    </td>
                                                );
                                            }
                                            return (
                                                <td key={idx} className="px-1.5 py-1.5">
                                                    <span
                                                        className={cn(
                                                            'inline-block min-w-[3.1rem] rounded px-1.5 py-1 font-mono font-semibold',
                                                            val > 0
                                                                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'
                                                                : val < 0
                                                                ? 'bg-rose-500/15 text-rose-600 dark:text-rose-300'
                                                                : 'bg-surface-2 text-fg-muted'
                                                        )}
                                                    >
                                                        {val >= 0 ? '+' : ''}
                                                        {val.toFixed(1)}%
                                                    </span>
                                                </td>
                                            );
                                        })}
                                        <td className={cn('px-3 py-2 text-right font-mono font-bold', pnlTone(row.ytdPct))}>
                                            {row.ytdPct >= 0 ? '+' : ''}
                                            {row.ytdPct.toFixed(2)}%
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </Panel>
            )}

            {/* Lower Grid: UTC Session Attribution & R-Multiple Histogram */}
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <Panel
                    title={isEn ? 'UTC Session Attribution' : 'Performance por Sessão UTC (Killzones)'}
                    subtitle={isEn ? 'Identifies whether edge concentrates in London, NY Overlap, or suffers in Asia.' : 'Identifica onde o edge é positivo e se a sessão asiática gera perda.'}
                    bodyClassName="p-0"
                >
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs tabular-nums">
                            <thead>
                                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-fg-subtle">
                                    <th className="px-3 py-2">{isEn ? 'Session' : 'Sessão'}</th>
                                    <th className="px-2 py-2 text-right">Trades</th>
                                    <th className="px-2 py-2 text-right">Win %</th>
                                    <th className="px-2 py-2 text-right">PF</th>
                                    <th className="px-2 py-2 text-right">Avg R</th>
                                    <th className="px-3 py-2 text-right">Net P&L</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-line">
                                {data.sessionBreakdown.map((row) => (
                                    <tr key={row.session} className="hover:bg-surface-2/40">
                                        <td className="px-3 py-2 font-medium text-fg">{row.label}</td>
                                        <td className="px-2 py-2 text-right">{row.trades}</td>
                                        <td className="px-2 py-2 text-right">{row.winRatePct.toFixed(1)}%</td>
                                        <td className="px-2 py-2 text-right">{row.profitFactor.toFixed(2)}</td>
                                        <td className={cn('px-2 py-2 text-right font-mono', pnlTone(row.avgR))}>
                                            {row.avgR >= 0 ? '+' : ''}
                                            {row.avgR.toFixed(2)}R
                                        </td>
                                        <td className={cn('px-3 py-2 text-right font-semibold', pnlTone(row.netPnlUsd))}>
                                            {fmtMoney(row.netPnlUsd, { sign: true })}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </Panel>

                <Panel
                    title={isEn ? 'R-Multiple Distribution' : 'Distribuição de Múltiplos R'}
                    subtitle={isEn ? 'Frequency across stop losses (-1R) and trailing asymmetry (> +2R).' : 'Assimetria entre stops (-1R) e vencedores esticados (> +2R).'}
                >
                    <div className="space-y-2.5">
                        {data.rDistribution.map((bin) => {
                            const isPositive = bin.bucket.includes('+');
                            const barWidth = Math.max(4, Math.round((bin.count / maxBinCount) * 100));
                            return (
                                <div key={bin.bucket} className="space-y-1">
                                    <div className="flex items-center justify-between text-xs tabular-nums">
                                        <span className="font-mono font-semibold text-fg">{bin.bucket}</span>
                                        <span className="text-fg-muted">
                                            {bin.count} ({bin.pct.toFixed(1)}%)
                                        </span>
                                    </div>
                                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
                                        <div
                                            className={cn(
                                                'h-full rounded-full transition-all',
                                                bin.count === 0
                                                    ? 'bg-transparent'
                                                    : isPositive
                                                    ? 'bg-emerald-500'
                                                    : 'bg-rose-500'
                                            )}
                                            style={{ width: bin.count === 0 ? '0%' : `${barWidth}%` }}
                                        />
                                    </div>
                                </div>
                            );
                        })}
                        <div className="flex items-center gap-1.5 pt-1 text-[11px] text-fg-subtle">
                            <ShieldAlert size={13} />
                            <span>
                                {isEn
                                    ? `Expectancy ${s.expectancyR >= 0 ? '+' : ''}${s.expectancyR.toFixed(3)}R per trade (${fmtMoney(s.expectancyUsd, { sign: true })}/trade)`
                                    : `Expectativa matemática ${s.expectancyR >= 0 ? '+' : ''}${s.expectancyR.toFixed(3)}R por operação (${fmtMoney(s.expectancyUsd, { sign: true })}/trade)`}
                            </span>
                        </div>
                    </div>
                </Panel>
            </div>
        </div>
    );
};
