import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, RefreshCw, ShieldAlert, Sparkles } from 'lucide-react';
import { BRAND } from '../../constants/brand';
import { EN_AI_DECODE } from './contentEn';
import { buildTaggedUrl } from '../../lib/attribution';

export const AiDecodeDashboardEnSection: React.FC = () => {
    return (
        <section
            id="ai-decode"
            aria-label="AI Trading Intelligence Showcase"
            className="relative z-20 mx-auto w-full max-w-7xl px-4 pb-28 pt-6 sm:px-6 lg:px-8"
        >
            {/* Ambient background glow behind the right showcase */}
            <div
                aria-hidden="true"
                className="pointer-events-none absolute right-0 top-1/2 h-[420px] w-[420px] -translate-y-1/2 rounded-full opacity-30 blur-[110px]"
                style={{
                    background:
                        'radial-gradient(circle, rgba(16, 185, 129, 0.28) 0%, rgba(37, 99, 235, 0.22) 52%, transparent 75%)',
                }}
            />

            <div className="relative grid grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-10">
                {/* ============================================================
                   LEFT COLUMN: Authoritative Copy + Subheadline + CTA
                   ============================================================ */}
                <div className="flex flex-col items-start text-left lg:col-span-5">
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-accent/25 bg-accent/10 px-3 py-1 text-[10.5px] font-extrabold uppercase tracking-[0.08em] text-accent-fg">
                        <Sparkles size={12} />
                        <span>{EN_AI_DECODE.badge}</span>
                    </span>

                    <h2 className="mt-5 text-3xl font-extrabold leading-[1.12] tracking-tight text-white sm:text-4xl lg:text-[44px]">
                        <span className="block">{EN_AI_DECODE.headlineLine1}</span>
                        <span className="mt-1 block bg-gradient-to-r from-emerald-300 via-accent-fg to-sky-400 bg-clip-text text-transparent">
                            {EN_AI_DECODE.headlineLine2}
                        </span>
                    </h2>

                    <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-300/90 sm:text-[17px]">
                        {EN_AI_DECODE.subheadline}
                    </p>

                    <div className="mt-8 flex flex-wrap items-center gap-4">
                        <Link
                            to={buildTaggedUrl(EN_AI_DECODE.ctaHref, { ctaTag: 'lp_en_ai_decode_cta', intent: 'ai_journal' })}
                            data-cta-tag="lp_en_ai_decode_cta"
                            data-intent="ai_journal"
                            className="inline-flex h-12 items-center gap-2.5 rounded-full bg-accent px-7 text-sm font-extrabold tracking-wide text-accent-on shadow-[0_0_32px_rgba(16,185,129,0.32)] transition-all duration-200 hover:-translate-y-0.5 hover:brightness-110"
                        >
                            <span>{EN_AI_DECODE.ctaLabel}</span>
                            <ArrowRight size={16} />
                        </Link>
                    </div>
                </div>

                {/* ============================================================
                   RIGHT COLUMN: 50% Cropped `dashboard.svg` + Floating AI Mock
                   ============================================================ */}
                <div className="relative lg:col-span-7 lg:pl-2">
                    {/* Dashboard Window Frame (Shows Left 50% of `dashboard.svg`, Clips Right 50%) */}
                    <div className="relative ml-auto w-full overflow-hidden rounded-2xl border border-white/[0.11] bg-[#070B14] shadow-[0_32px_90px_-18px_rgba(0,0,0,0.92)] lg:w-[94%]">
                        {/* Subtle App Window Top Bar */}
                        <div className="flex items-center justify-between border-b border-white/[0.07] bg-[#0B101D] px-4 py-2.5">
                            <div className="flex items-center gap-2">
                                <span className="h-2.5 w-2.5 rounded-full bg-rose-500/75" />
                                <span className="h-2.5 w-2.5 rounded-full bg-amber-500/75" />
                                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/75" />
                                <div className="ml-2 flex items-center gap-1.5">
                                    <img
                                        src={BRAND.logoUrl}
                                        alt=""
                                        width={16}
                                        height={16}
                                        loading="lazy"
                                        decoding="async"
                                        className="h-4 w-4 rounded object-contain"
                                    />
                                    <span className="text-[11px] font-bold tracking-tight text-slate-200">
                                        TOREX <span className="text-accent-fg">JOURNAL</span>
                                    </span>
                                </div>
                            </div>
                            <span className="font-mono text-[10px] text-slate-500">Live Workspace · UTC</span>
                        </div>

                        {/* 50% Cropped Dashboard Viewport (`w-[200%]` inside `overflow-hidden` reveals exact left 50%) */}
                        <div className="relative w-full overflow-hidden bg-[#070B14]">
                            <img
                                src="/dashboard.svg"
                                alt="Torex Journal Trading Dashboard"
                                loading="lazy"
                                decoding="async"
                                className="block w-[200%] max-w-none select-none object-cover object-left opacity-95"
                            />

                            {/* Right & Bottom Edge Fade so the 50% crop blends seamlessly */}
                            <div
                                aria-hidden="true"
                                className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-[#070B14] via-[#070B14]/55 to-transparent"
                            />
                            <div
                                aria-hidden="true"
                                className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[#070B14] via-[#070B14]/45 to-transparent"
                            />
                        </div>
                    </div>

                    {/* ========================================================
                       FLOATING AI INSIGHT MOCK CARD (Top-Right Overlay)
                       Modeled on the reference layout with Torex Bull Icon,
                       English DM User Question, and Rapid +$22,642.60 AI Insight
                       ======================================================== */}
                    <div className="relative z-30 mx-auto -mt-12 w-[94%] max-w-[368px] rounded-2xl border border-emerald-400/25 bg-[#090E1A]/95 p-1.5 shadow-[0_28px_70px_rgba(0,0,0,0.92),0_0_40px_rgba(16,185,129,0.12)] backdrop-blur-xl sm:mr-3 sm:mt-[-190px] lg:absolute lg:-right-3 lg:-top-7 lg:m-0 lg:w-[358px]">
                        <div className="rounded-xl border border-white/[0.08] bg-[#0C1220]/95 p-4">
                            {/* Top Centered Torex AI Avatar Icon with Halo */}
                            <div className="mb-3.5 flex flex-col items-center">
                                <div className="relative flex h-12 w-12 items-center justify-center rounded-full border border-emerald-400/40 bg-gradient-to-b from-emerald-500/20 to-sky-500/15 p-1.5 shadow-[0_0_24px_rgba(16,185,129,0.28)]">
                                    <img
                                        src={BRAND.logoUrl}
                                        alt="Torex AI"
                                        width={36}
                                        height={36}
                                        loading="lazy"
                                        decoding="async"
                                        className="h-full w-full rounded-full object-cover"
                                    />
                                    <span
                                        aria-hidden="true"
                                        className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-[#0C1220] bg-emerald-500 text-[9px] text-slate-950"
                                    >
                                        <Sparkles size={9} strokeWidth={2.6} />
                                    </span>
                                </div>
                            </div>

                            {/* User Question Bubble + DM Badge */}
                            <div className="mb-3 flex items-end justify-end gap-2">
                                <div className="rounded-2xl rounded-br-sm border border-sky-400/25 bg-sky-500/15 px-3 py-2 text-[11.5px] font-medium leading-snug text-slate-100 shadow-sm">
                                    {EN_AI_DECODE.userPrompt}
                                </div>
                                <div
                                    title="Direct Message · Trader"
                                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-500/20 font-mono text-[9.5px] font-extrabold text-accent-fg"
                                >
                                    {EN_AI_DECODE.userInitials}
                                </div>
                            </div>

                            {/* Rapid Authoritative AI Response Box */}
                            <div className="rounded-xl border border-emerald-500/20 bg-[#070B14]/95 p-3.5 shadow-inner">
                                <div className="flex flex-wrap items-baseline justify-between gap-2">
                                    <span className="font-mono text-xl font-extrabold tracking-tight text-emerald-400 sm:text-[22px]">
                                        {EN_AI_DECODE.aiProfitValue}
                                    </span>
                                    <span className="rounded-md border border-emerald-400/25 bg-emerald-500/10 px-2 py-0.5 font-mono text-[9.5px] font-bold text-emerald-300">
                                        {EN_AI_DECODE.aiProfitBadge}
                                    </span>
                                </div>

                                <p className="mt-2 text-[11.5px] leading-[1.5] text-slate-300">
                                    Your <span className="font-semibold text-white">London Sweeps</span> &amp;{' '}
                                    <span className="font-semibold text-white">NY Breakouts</span> drive{' '}
                                    <span className="font-semibold text-emerald-400">118% of net profit</span> (
                                    <span className="font-mono text-[10.5px] text-slate-200">+2.46R avg</span>) — while
                                    off-plan entries after <span className="font-mono text-[10.5px] text-slate-200">16:00 UTC</span>{' '}
                                    cost <span className="font-semibold text-rose-400">-$3,410</span>. Cut late-session
                                    impulse trades to lock peak expectancy.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* ========================================================
                       BOTTOM-LEFT FLOATING TELEMETRY FEED (Mirrors Reference)
                       ======================================================== */}
                    <div className="mt-3 hidden w-[264px] rounded-2xl border border-white/[0.10] bg-[#0A0F1C]/95 p-3 shadow-[0_22px_50px_rgba(0,0,0,0.85)] backdrop-blur-xl lg:absolute lg:-bottom-6 lg:-left-3 lg:z-20 lg:mt-0 lg:block">
                        <div className="space-y-2.5 divide-y divide-white/[0.06]">
                            <div className="flex items-start gap-2.5">
                                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
                                    <RefreshCw size={11} />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center justify-between gap-1 text-[9px] font-bold uppercase tracking-wider text-slate-400">
                                        <span>Auto-Sync Verified</span>
                                        <span className="flex items-center gap-1 text-emerald-400">
                                            2s ago <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                                        </span>
                                    </div>
                                    <p className="mt-0.5 truncate text-[11px] font-medium text-slate-200">
                                        14 MT5 &amp; Deriv executions synced
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-start gap-2.5 pt-2.5">
                                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-400">
                                    <ShieldAlert size={11} />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center justify-between gap-1 text-[9px] font-bold uppercase tracking-wider text-slate-400">
                                        <span>Behavioral Leak Detected</span>
                                        <span className="text-amber-400">AI</span>
                                    </div>
                                    <p className="mt-0.5 truncate text-[11px] font-medium text-slate-200">
                                        Post-16:00 UTC overtrading flagged
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-start gap-2.5 pt-2.5">
                                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-500/15 text-sky-400">
                                    <CheckCircle2 size={11} />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center justify-between gap-1 text-[9px] font-bold uppercase tracking-wider text-slate-400">
                                        <span>Edge Expectancy</span>
                                        <span className="font-mono text-emerald-400">+2.46R</span>
                                    </div>
                                    <p className="mt-0.5 truncate text-[11px] font-medium text-slate-200">
                                        Top 2 setups at 74.2% session win rate
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default AiDecodeDashboardEnSection;
