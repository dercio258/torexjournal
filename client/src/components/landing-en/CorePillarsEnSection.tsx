import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Copy, Link2, SlidersHorizontal, Sparkles } from 'lucide-react';
import { EN_CORE_PILLARS } from './contentEn';
import { buildTaggedUrl } from '../../lib/attribution';

/* ============================================================================
   CARD 1 ILLUSTRATION — TOREX AI (Prompt Bubble + R-Multiple vs Profit Factor)
   ============================================================================ */

const TorexAiPreview: React.FC = () => (
    <div className="relative flex min-h-[276px] w-full flex-col justify-between overflow-hidden bg-[#060911] p-3.5 sm:h-[296px] sm:p-5">
        {/* Ambient corner glow */}
        <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-10 -top-10 h-52 w-52 rounded-full opacity-55 blur-3xl"
            style={{
                background:
                    'radial-gradient(circle, rgba(16, 185, 129, 0.34) 0%, rgba(37, 99, 235, 0.22) 52%, transparent 75%)',
            }}
        />

        {/* Top-right Trader Prompt Bubble */}
        <div className="relative z-10 mb-2.5 flex items-end justify-end gap-2">
            <div className="max-w-[224px] rounded-2xl rounded-br-sm border border-emerald-400/30 bg-gradient-to-br from-emerald-500/25 via-teal-500/20 to-sky-500/20 px-3 py-2 text-[10.5px] font-medium leading-snug text-white/95 shadow-lg backdrop-blur-md sm:px-3.5 sm:text-[11px]">
                Which setup holds my highest edge and how can I scale it?
            </div>
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-500/20 text-[10px] font-bold text-accent-fg">
                TR
            </div>
        </div>

        {/* Torex AI Diagnostic Card */}
        <div className="relative z-10 mr-5 rounded-xl border border-white/[0.08] bg-[#0B0F18]/95 p-3 shadow-[0_18px_40px_rgba(0,0,0,0.65)] sm:p-3.5">
            <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-accent-fg sm:mb-1.5">
                <Sparkles size={11} />
                <span>Torex AI Insight</span>
            </div>
            <p className="text-[10.5px] leading-[1.46] text-slate-300 sm:text-[11px]">
                Your <span className="font-semibold text-white">&lsquo;London Breakout&rsquo;</span> setup leads with a{' '}
                <span className="font-semibold text-emerald-400">1.82 Profit Factor</span>, while holding past{' '}
                <span className="text-white">3.5R</span> erodes gains. Locking targets at{' '}
                <span className="font-semibold text-white">2R–3R</span> lifts your Win Rate and boosts Profit Factor to{' '}
                <span className="font-semibold text-emerald-400">2.18</span>.
            </p>

            {/* Mini Chart: R-Multiple vs Profit Factor */}
            <div className="mt-2.5 rounded-lg border border-white/[0.06] bg-[#070A10] px-2.5 py-2 sm:mt-3 sm:px-3 sm:py-2.5">
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1.5 text-[9px] sm:text-[9.5px]">
                    <span className="font-semibold text-slate-300">R-Multiple vs Profit Factor</span>
                    <div className="flex items-center gap-2 text-[8.5px] text-slate-400 sm:gap-2.5 sm:text-[9px]">
                        <span className="inline-flex items-center gap-1">
                            <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                            Actual
                        </span>
                        <span className="inline-flex items-center gap-1">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                            Projected
                        </span>
                    </div>
                </div>

                <svg viewBox="0 0 240 58" className="h-[48px] w-full overflow-visible sm:h-[52px]" aria-hidden="true">
                    <defs>
                        <linearGradient id="torexAiProjFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="rgba(16, 185, 129, 0.25)" />
                            <stop offset="100%" stopColor="rgba(16, 185, 129, 0)" />
                        </linearGradient>
                    </defs>
                    <line x1="0" y1="14" x2="240" y2="14" stroke="rgba(255,255,255,0.05)" strokeDasharray="2 3" />
                    <line x1="0" y1="34" x2="240" y2="34" stroke="rgba(255,255,255,0.05)" strokeDasharray="2 3" />
                    <line x1="0" y1="54" x2="240" y2="54" stroke="rgba(255,255,255,0.06)" />

                    {/* Projected Area + Curve */}
                    <path
                        d="M 4 50 C 42 46, 78 36, 118 28 C 156 20, 194 12, 236 8 L 236 54 L 4 54 Z"
                        fill="url(#torexAiProjFill)"
                    />
                    <path
                        d="M 4 50 C 42 46, 78 36, 118 28 C 156 20, 194 12, 236 8"
                        fill="none"
                        stroke="#10B981"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                    />

                    {/* Actual Curve */}
                    <path
                        d="M 4 52 C 45 49, 82 42, 120 39 C 160 36, 196 31, 236 27"
                        fill="none"
                        stroke="#F43F5E"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                    />
                    <circle cx="236" cy="8" r="2.6" fill="#34D399" />
                    <circle cx="236" cy="27" r="2.3" fill="#FB7185" />
                </svg>
            </div>
        </div>

        {/* Floating Action Pill */}
        <div
            aria-hidden="true"
            className="absolute bottom-3.5 right-3 z-20 flex flex-col items-center gap-2 rounded-lg border border-white/10 bg-[#101522]/95 p-1.5 text-slate-400 shadow-lg sm:bottom-4 sm:right-3.5"
        >
            <Copy size={11} />
            <Link2 size={11} />
        </div>
    </div>
);

/* ============================================================================
   CARD 2 ILLUSTRATION — TRAINING (Order Execution Ticket + Replay Candlesticks)
   ============================================================================ */

const REPLAY_PREVIEW_BARS = [
    { x: 184, open: 212, close: 196, high: 188, low: 222 },
    { x: 194, open: 196, close: 176, high: 168, low: 204 },
    { x: 204, open: 176, close: 186, high: 171, low: 194 },
    { x: 214, open: 186, close: 152, high: 144, low: 190 },
    { x: 224, open: 152, close: 122, high: 114, low: 158 },
    { x: 234, open: 122, close: 136, high: 118, low: 145 },
    { x: 244, open: 136, close: 96, high: 86, low: 140 },
    { x: 254, open: 96, close: 72, high: 62, low: 104 },
    { x: 264, open: 72, close: 84, high: 66, low: 92 },
    { x: 274, open: 84, close: 52, high: 38, low: 88 },
    { x: 284, open: 52, close: 66, high: 46, low: 76 },
];

const TrainingReplayPreview: React.FC = () => (
    <div className="relative min-h-[276px] w-full overflow-hidden bg-[#060911] sm:h-[296px]">
        {/* Background Replay Candlesticks + Price Scale */}
        <svg
            viewBox="0 0 360 260"
            preserveAspectRatio="xMidYMid slice"
            className="pointer-events-none absolute inset-0 h-full w-full"
            aria-hidden="true"
        >
            {/* Subtle Chart Grid */}
            {[42, 84, 126, 168, 210].map((gy) => (
                <line key={gy} x1="0" y1={gy} x2="312" y2={gy} stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
            ))}
            {[64, 128, 192, 256, 312].map((gx) => (
                <line key={gx} x1={gx} y1="0" x2={gx} y2="260" stroke="rgba(255,255,255,0.035)" strokeWidth="1" />
            ))}

            {/* Active Stop / Trigger Dashed Line */}
            <line
                x1="0"
                y1="82"
                x2="314"
                y2="82"
                stroke="rgba(244, 63, 94, 0.55)"
                strokeWidth="1"
                strokeDasharray="3 3"
            />

            {/* Candlesticks */}
            {REPLAY_PREVIEW_BARS.map((b, idx) => {
                const isBull = b.close <= b.open;
                const top = Math.min(b.open, b.close);
                const bodyH = Math.max(4, Math.abs(b.close - b.open));
                const color = isBull ? '#0EA5A0' : '#DC2626';
                return (
                    <g key={idx}>
                        <line x1={b.x} y1={b.high} x2={b.x} y2={b.low} stroke={color} strokeWidth="1.2" />
                        <rect x={b.x - 3} y={top} width="6" height={bodyH} rx="0.8" fill={color} />
                    </g>
                );
            })}

            {/* Execution Marker Triangle */}
            <polygon points="274,48 282,43 282,53" fill="#EF4444" />

            {/* Right Y-Axis Labels */}
            <text x="320" y="45" fill="#64748B" fontSize="8.5" fontFamily="monospace">2665.0</text>
            <rect x="314" y="74" width="42" height="15" rx="2.5" fill="#DC2626" />
            <text x="335" y="84" textAnchor="middle" fill="#FFFFFF" fontSize="8" fontFamily="monospace" fontWeight="700">
                2654.8
            </text>
            <text x="320" y="128" fill="#64748B" fontSize="8.5" fontFamily="monospace">2645.0</text>
            <text x="320" y="170" fill="#64748B" fontSize="8.5" fontFamily="monospace">2635.0</text>
            <text x="320" y="212" fill="#64748B" fontSize="8.5" fontFamily="monospace">2625.0</text>
        </svg>

        {/* Floating Order Ticket Card */}
        <div className="relative z-10 ml-3.5 mt-12 w-[min(212px,62%)] min-w-[172px] rounded-xl border border-white/[0.09] bg-[#0D111A]/95 p-3 shadow-[0_20px_45px_rgba(0,0,0,0.75)] backdrop-blur-md sm:ml-5 sm:mt-14 sm:p-3.5">
            <div className="mb-2.5 flex items-center gap-1.5 text-[10px] font-semibold text-slate-300 sm:text-[10.5px]">
                <SlidersHorizontal size={11} className="text-accent-fg" />
                <span>Place Order</span>
            </div>

            {/* BUY / SELL Segmented */}
            <div className="mb-2.5 grid grid-cols-2 gap-1.5 rounded-lg bg-[#070A10] p-1 sm:mb-3">
                <div className="rounded-md bg-accent py-1.5 text-center text-[10px] font-extrabold tracking-wide text-accent-on shadow-sm sm:text-[10.5px]">
                    BUY
                </div>
                <div className="rounded-md bg-white/[0.04] py-1.5 text-center text-[10px] font-bold tracking-wide text-slate-400 sm:text-[10.5px]">
                    SELL
                </div>
            </div>

            {/* Order Type Tabs */}
            <div className="mb-2.5 flex items-center justify-between gap-1 border-b border-white/[0.07] pb-1.5 text-[8.5px] font-medium text-slate-500 sm:mb-3 sm:text-[9.5px]">
                <span>Limit</span>
                <span>Market</span>
                <span className="relative font-semibold text-white after:absolute after:-bottom-[7px] after:left-0 after:right-0 after:h-[1.5px] after:bg-accent-fg">
                    Stop Loss
                </span>
                <span>Stop Limit</span>
            </div>

            {/* Quantity & Stop Price Rows */}
            <div className="space-y-1.5 text-[9.5px] sm:space-y-2 sm:text-[10px]">
                <div className="flex items-center justify-between rounded-md border border-white/[0.06] bg-[#070A10] px-2 py-1.5 sm:px-2.5">
                    <span className="text-slate-400">Lot Size</span>
                    <span className="font-mono font-bold text-white">2.00</span>
                </div>
                <div className="flex items-center justify-between rounded-md border border-white/[0.06] bg-[#070A10] px-2 py-1.5 sm:px-2.5">
                    <span className="text-slate-400">Stop Price</span>
                    <span className="font-mono font-bold text-white">
                        2,648.5 <span className="text-[8.5px] font-normal text-slate-500">USD</span>
                    </span>
                </div>
            </div>
        </div>
    </div>
);

/* ============================================================================
   CARD 3 ILLUSTRATION — JOURNAL (P&L Calendar Matrix + Account Performance)
   ============================================================================ */

const MINI_CALENDAR_CELLS: Array<{ day: number; pnl?: string; tone?: 'win' | 'loss' | 'flat'; trades?: string }> = [
    { day: 3, pnl: '+$420', tone: 'win', trades: '3t' },
    { day: 4 },
    { day: 5, pnl: '+$680', tone: 'win', trades: '4t' },
    { day: 6 },
    { day: 7, pnl: '-$190', tone: 'loss', trades: '2t' },
    { day: 10 },
    { day: 11, pnl: '+$310', tone: 'win', trades: '2t' },
    { day: 12, pnl: '+$940', tone: 'win', trades: '5t' },
    { day: 13, pnl: '-$140', tone: 'loss', trades: '2t' },
    { day: 14, pnl: '+$520', tone: 'win', trades: '3t' },
    { day: 17, pnl: '+$260', tone: 'win', trades: '2t' },
    { day: 18, pnl: '-$95', tone: 'loss', trades: '1t' },
    { day: 19, pnl: '+$1.1K', tone: 'win', trades: '4t' },
    { day: 20, pnl: '+$440', tone: 'win', trades: '3t' },
    { day: 21 },
];

const JournalAnalyticsPreview: React.FC = () => (
    <div className="relative min-h-[276px] w-full overflow-hidden bg-[#060911] p-3.5 sm:h-[296px] sm:p-5">
        {/* Back/Left Card: Monthly P&L Trading Calendar */}
        <div className="w-[82%] max-w-[270px] rounded-xl border border-white/[0.08] bg-[#0B0F18] p-2.5 shadow-xl sm:w-[78%] sm:p-3">
            <div className="mb-2 flex items-center justify-between">
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-200 sm:text-[10.5px]">
                    <ChevronDown size={11} className="text-accent-fg" />
                    Nov 2026
                </span>
                <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[8.5px] font-bold text-emerald-400 sm:text-[9px]">
                    +$4.19K
                </span>
            </div>

            <div className="mb-1 grid grid-cols-5 gap-1 text-center text-[7.5px] font-semibold uppercase tracking-wider text-slate-500 sm:text-[8px]">
                <span>Mon</span>
                <span>Tue</span>
                <span>Wed</span>
                <span>Thu</span>
                <span>Fri</span>
            </div>

            <div className="grid grid-cols-5 gap-1">
                {MINI_CALENDAR_CELLS.map((c) => {
                    const cls =
                        c.tone === 'win'
                            ? 'border-teal-500/35 bg-teal-500/20 text-emerald-300'
                            : c.tone === 'loss'
                              ? 'border-rose-500/35 bg-rose-500/20 text-rose-300'
                              : 'border-white/[0.05] bg-white/[0.02] text-slate-600';
                    return (
                        <div
                            key={c.day}
                            className={`flex h-[35px] flex-col justify-between rounded border p-1 sm:h-[38px] ${cls}`}
                        >
                            <div className="flex items-center justify-between text-[7px] opacity-75 sm:text-[7.5px]">
                                <span>{c.trades || ''}</span>
                                <span>{c.day}</span>
                            </div>
                            <span className="text-right font-mono text-[8px] font-bold leading-none sm:text-[8.5px]">
                                {c.pnl || ''}
                            </span>
                        </div>
                    );
                })}
            </div>

            <div className="mt-2 text-[8.5px] font-medium text-slate-500 sm:text-[9px]">View Full Report &rarr;</div>
        </div>

        {/* Overlapping Right Card: Account Performance */}
        <div className="absolute bottom-4 right-3 z-10 w-[min(176px,54%)] min-w-[146px] rounded-xl border border-white/[0.10] bg-[#0F1420]/95 p-2.5 shadow-[0_20px_48px_rgba(0,0,0,0.85)] backdrop-blur-md sm:bottom-5 sm:right-4 sm:p-3">
            <div className="mb-2 text-[9.5px] font-semibold text-slate-300 sm:text-[10px]">Account Performance</div>

            <div className="mb-2 grid grid-cols-3 gap-1 border-b border-white/[0.07] pb-2 sm:mb-2.5">
                <div>
                    <div className="font-mono text-[9.5px] font-bold text-emerald-400 sm:text-[10px]">$4,190</div>
                    <div className="text-[7px] text-slate-500 sm:text-[7.5px]">Net P&amp;L</div>
                </div>
                <div>
                    <div className="font-mono text-[9.5px] font-bold text-white sm:text-[10px]">2.42</div>
                    <div className="text-[7px] text-slate-500 sm:text-[7.5px]">Profit Factor</div>
                </div>
                <div>
                    <div className="font-mono text-[9.5px] font-bold text-white sm:text-[10px]">68.4%</div>
                    <div className="text-[7px] text-slate-500 sm:text-[7.5px]">Win Rate</div>
                </div>
            </div>

            <svg viewBox="0 0 150 56" className="h-[46px] w-full overflow-visible sm:h-[52px]" aria-hidden="true">
                <defs>
                    <linearGradient id="journalEquityWash" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="rgba(16, 185, 129, 0.28)" />
                        <stop offset="100%" stopColor="rgba(16, 185, 129, 0)" />
                    </linearGradient>
                </defs>
                <path
                    d="M 2 48 L 22 43 L 40 45 L 62 34 L 82 37 L 104 20 L 122 25 L 148 6 L 148 54 L 2 54 Z"
                    fill="url(#journalEquityWash)"
                />
                <path
                    d="M 2 48 L 22 43 L 40 45 L 62 34 L 82 37 L 104 20 L 122 25 L 148 6"
                    fill="none"
                    stroke="#10B981"
                    strokeWidth="1.9"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                />
                <circle cx="148" cy="6" r="2.5" fill="#34D399" />
            </svg>
        </div>
    </div>
);

/* ============================================================================
   PUBLIC SECTION — 3 Responsive Horizontal Feature Cards Below `/en` Hero
   ============================================================================ */

export const CorePillarsEnSection: React.FC = () => {
    const renderVisual = (id: (typeof EN_CORE_PILLARS)[number]['id']) => {
        if (id === 'torex-ai') return <TorexAiPreview />;
        if (id === 'training') return <TrainingReplayPreview />;
        return <JournalAnalyticsPreview />;
    };

    return (
        <section
            id="core-pillars"
            aria-label="Core Trading Intelligence Modules"
            className="relative z-20 mx-auto w-full max-w-7xl px-4 pb-10 pt-4 sm:px-6 sm:pb-14 sm:pt-6 lg:px-8"
        >
            <div className="grid grid-cols-1 gap-5 sm:gap-6 md:grid-cols-2 lg:grid-cols-3 md:[&>*:last-child]:col-span-2 md:[&>*:last-child]:mx-auto md:[&>*:last-child]:w-full md:[&>*:last-child]:max-w-[calc(50%-0.75rem)] lg:[&>*:last-child]:col-span-1 lg:[&>*:last-child]:max-w-none">
                {EN_CORE_PILLARS.map((card) => (
                    <Link
                        key={card.id}
                        to={buildTaggedUrl(card.href, {
                            ctaTag: `lp_en_pillar_${card.id}`,
                            intent: `pillar_${card.id}`,
                        })}
                        data-cta-tag={`lp_en_pillar_${card.id}`}
                        data-intent={`pillar_${card.id}`}
                        className="group flex flex-col justify-between overflow-hidden rounded-2xl border border-white/[0.08] bg-[#060911] transition-all duration-300 hover:-translate-y-1 hover:border-accent/35 hover:shadow-[0_24px_60px_-15px_rgba(16,185,129,0.16)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                    >
                        {renderVisual(card.id)}

                        <div className="border-t border-white/[0.05] bg-[#05080F] px-5 pb-6 pt-4 sm:px-6 sm:pb-7 sm:pt-5">
                            <span className="inline-flex items-center rounded-md border border-accent/25 bg-accent/10 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.08em] text-accent-fg sm:px-3 sm:text-[10.5px]">
                                {card.badge}
                            </span>

                            <h3 className="mt-3.5 text-lg font-bold leading-[1.25] tracking-tight text-white sm:mt-4 sm:text-[22px]">
                                <span className="block">{card.headlineLine1}</span>
                                <span className="block text-slate-200 transition-colors group-hover:text-accent-fg">
                                    {card.headlineLine2}
                                </span>
                            </h3>
                        </div>
                    </Link>
                ))}
            </div>
        </section>
    );
};

export default CorePillarsEnSection;
