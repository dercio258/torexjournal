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
        className="theme-light fixed inset-0 z-0 flex bg-slate-100 text-slate-900 select-none pointer-events-none overflow-hidden"
    >
        <div className="flex flex-1 min-w-0 opacity-95 blur-[0.75px]">
        {/* Static Sidebar Preview */}
        <aside className="hidden md:flex w-60 flex-col border-r border-slate-200/80 bg-white/95 p-4 space-y-5 shrink-0">
            <div className="flex items-center gap-2.5 px-2 py-1">
                <div className="h-8 w-8 rounded-xl bg-indigo-50 border border-indigo-200/70" />
                <div className="space-y-1">
                    <div className="text-xs font-black tracking-wider text-slate-900">TOREX JOURNAL</div>
                    <div className="text-[10px] text-slate-400 font-mono">DESK WORKSPACE</div>
                </div>
            </div>
            <div className="space-y-1.5">
                {['Dashboard', 'Torex AI Coach', 'Trades', 'Diário', 'Backtesting', 'Relatórios', 'Calendário'].map(
                    (item, idx) => (
                        <div
                            key={item}
                            className={`px-3 py-2 rounded-xl text-xs font-semibold ${
                                idx === 0
                                    ? 'bg-indigo-50 text-indigo-700'
                                    : 'text-slate-500'
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
            <header className="h-14 border-b border-slate-200/80 bg-white/90 px-6 flex items-center justify-between">
                <div className="text-sm font-bold text-slate-900">Performance Overview</div>
                <div className="flex items-center gap-2">
                    <span className="px-3 py-1 rounded-lg bg-slate-100 text-[11px] font-mono text-slate-500">
                        DEMO FEED · #409281
                    </span>
                </div>
            </header>

            <div className="p-6 space-y-5 max-w-[1440px] w-full mx-auto">
                {/* Mock KPI Strip */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    {MOCK_METRICS.map((m) => (
                        <div
                            key={m.label}
                            className="rounded-2xl bg-white p-4 space-y-1.5 shadow-sm border border-slate-200/60"
                        >
                            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                                {m.label}
                            </div>
                            <div
                                className={`text-2xl font-extrabold font-mono tabular-nums ${
                                    m.positive ? 'text-emerald-600' : 'text-rose-600'
                                }`}
                            >
                                {m.value}
                            </div>
                            <div className="text-[11px] text-slate-400">{m.sub}</div>
                        </div>
                    ))}
                </div>

                {/* Mock Equity Curve + Breakdown */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <div className="lg:col-span-2 rounded-2xl bg-white p-5 space-y-4 shadow-sm border border-slate-200/60">
                        <div className="flex items-center justify-between">
                            <div className="text-sm font-bold text-slate-900">Curva de Capital (Simulação)</div>
                            <div className="text-xs font-mono text-emerald-600">+14.8%</div>
                        </div>
                        <svg viewBox="0 0 600 180" className="w-full h-44 overflow-visible">
                            <defs>
                                <linearGradient id="mockEqGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="currentColor" stopOpacity="0.25" />
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

                    <div className="rounded-2xl bg-white p-5 space-y-3 shadow-sm border border-slate-200/60">
                        <div className="text-sm font-bold text-slate-900">Sessões & Ativos</div>
                        {MOCK_TRADES.map((t) => (
                            <div
                                key={`${t.symbol}-${t.pnl}`}
                                className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-xs"
                            >
                                <div>
                                    <div className="font-bold text-slate-900">{t.symbol}</div>
                                    <div className="text-[10px] text-slate-500">
                                        {t.side} · {t.lots} · {t.session}
                                    </div>
                                </div>
                                <div
                                    className={`font-mono font-bold ${
                                        t.positive ? 'text-emerald-600' : 'text-rose-600'
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
    </div>
);
