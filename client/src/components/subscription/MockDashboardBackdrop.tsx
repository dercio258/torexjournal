import React from 'react';

const MOCK_METRICS = [
    { label: 'Net P&L', value: '+$4,820.50', sub: '+14.8% this month', positive: true },
    { label: 'Win Rate', value: '68.4%', sub: '39W / 18L', positive: true },
    { label: 'Profit Factor', value: '2.41', sub: 'Expectancy +$84.57', positive: true },
    { label: 'Avg R:R', value: '1 : 2.3', sub: 'Disciplined execution', positive: true },
];

const MOCK_TRADES = [
    { symbol: 'XAUUSD', side: 'BUY', lots: '0.50', session: 'New York', pnl: '+$412.00', positive: true },
    { symbol: 'EURUSD', side: 'SELL', lots: '1.00', session: 'London', pnl: '+$285.50', positive: true },
    { symbol: 'NAS100', side: 'BUY', lots: '0.25', session: 'New York', pnl: '-$96.00', positive: false },
    { symbol: 'GBPUSD', side: 'BUY', lots: '0.75', session: 'London', pnl: '+$318.20', positive: true },
];

/**
 * Purely static visual preview of the Torex Dashboard rendered behind the centered
 * pricing/activation modal. Contains zero hooks, zero API calls, and zero real user data.
 */
export const MockDashboardBackdrop: React.FC = () => (
    <div
        aria-hidden="true"
        className="fixed inset-0 z-0 flex bg-canvas text-fg select-none pointer-events-none overflow-hidden opacity-55 blur-[2.5px] scale-[1.01]"
    >
        {/* Static Sidebar Preview */}
        <aside className="hidden md:flex w-60 flex-col border-r border-line bg-surface/80 p-4 space-y-5 shrink-0">
            <div className="flex items-center gap-2.5 px-2 py-1">
                <div className="h-8 w-8 rounded-xl bg-accent/20 border border-accent/30" />
                <div className="space-y-1">
                    <div className="text-xs font-black tracking-wider text-fg">TOREX JOURNAL</div>
                    <div className="text-[10px] text-fg-subtle font-mono">DESK WORKSPACE</div>
                </div>
            </div>
            <div className="space-y-1.5">
                {['Dashboard', 'Torex AI Coach', 'Trades', 'Diário', 'Backtesting', 'Relatórios', 'Calendário'].map(
                    (item, idx) => (
                        <div
                            key={item}
                            className={`px-3 py-2 rounded-xl text-xs font-semibold ${
                                idx === 0
                                    ? 'bg-accent/15 text-accent-fg border border-accent/25'
                                    : 'text-fg-muted'
                            }`}
                        >
                            {item}
                        </div>
                    ),
                )}
            </div>
        </aside>

        {/* Static Dashboard Body Preview */}
        <div className="flex-1 flex flex-col min-w-0">
            <header className="h-14 border-b border-line bg-surface/70 px-6 flex items-center justify-between">
                <div className="text-sm font-bold text-fg">Performance Overview</div>
                <div className="flex items-center gap-2">
                    <span className="px-3 py-1 rounded-lg border border-line bg-surface-2 text-[11px] font-mono text-fg-muted">
                        DEMO FEED · #409281
                    </span>
                </div>
            </header>

            <div className="p-6 space-y-5 max-w-[1440px] w-full mx-auto">
                {/* Mock KPI Strip */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    {MOCK_METRICS.map((m) => (
                        <div key={m.label} className="rounded-2xl border border-line bg-surface p-4 space-y-1.5">
                            <div className="text-[11px] font-semibold text-fg-muted uppercase tracking-wider">
                                {m.label}
                            </div>
                            <div
                                className={`text-2xl font-extrabold font-mono tabular-nums ${
                                    m.positive ? 'text-accent-fg' : 'text-danger-fg'
                                }`}
                            >
                                {m.value}
                            </div>
                            <div className="text-[11px] text-fg-subtle">{m.sub}</div>
                        </div>
                    ))}
                </div>

                {/* Mock Equity Curve + Breakdown */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <div className="lg:col-span-2 rounded-2xl border border-line bg-surface p-5 space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="text-sm font-bold text-fg">Curva de Capital (Simulação)</div>
                            <div className="text-xs font-mono text-accent-fg">+14.8%</div>
                        </div>
                        <svg viewBox="0 0 600 180" className="w-full h-44 overflow-visible">
                            <defs>
                                <linearGradient id="mockEqGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="currentColor" stopOpacity="0.32" />
                                    <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
                                </linearGradient>
                            </defs>
                            <path
                                d="M0,150 C60,142 100,120 160,125 C220,130 260,82 320,78 C380,74 420,96 480,48 C530,22 570,18 600,12 L600,180 L0,180 Z"
                                fill="url(#mockEqGrad)"
                                className="text-emerald-500"
                            />
                            <path
                                d="M0,150 C60,142 100,120 160,125 C220,130 260,82 320,78 C380,74 420,96 480,48 C530,22 570,18 600,12"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="3"
                                className="text-emerald-500"
                            />
                        </svg>
                    </div>

                    <div className="rounded-2xl border border-line bg-surface p-5 space-y-3">
                        <div className="text-sm font-bold text-fg">Sessões & Ativos</div>
                        {MOCK_TRADES.map((t) => (
                            <div
                                key={`${t.symbol}-${t.pnl}`}
                                className="flex items-center justify-between rounded-xl border border-line bg-surface-2/40 px-3 py-2 text-xs"
                            >
                                <div>
                                    <div className="font-bold text-fg font-mono">{t.symbol}</div>
                                    <div className="text-[10px] text-fg-subtle">
                                        {t.side} · {t.lots} · {t.session}
                                    </div>
                                </div>
                                <div
                                    className={`font-mono font-bold ${
                                        t.positive ? 'text-accent-fg' : 'text-danger-fg'
                                    }`}
                                >
                                    {t.pnl}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    </div>
);
