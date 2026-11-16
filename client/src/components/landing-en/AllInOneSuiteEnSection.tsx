import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BarChart3, BookOpen, Layers, PlayCircle } from 'lucide-react';
import { EN_ALL_IN_ONE_SUITE, type EnSuiteTabItem } from './contentEn';
import { buildTaggedUrl } from '../../lib/attribution';

const TAB_ICONS: Record<EnSuiteTabItem['id'], React.ElementType> = {
    analytics: BarChart3,
    backtesting: PlayCircle,
    journal: BookOpen,
};

/**
 * All-in-One Trading Suite section for `/en`.
 * Features clean interactive workflow buttons paired with pixel-uniform
 * (`1356 × 520`, exact `2.6077 : 1` ratio) Torex Journal workspace captures
 * so switching tabs preserves identical framing and zero layout shift.
 */
export const AllInOneSuiteEnSection: React.FC = () => {
    const [activeId, setActiveId] = useState<EnSuiteTabItem['id']>(EN_ALL_IN_ONE_SUITE.tabs[0].id);

    const activeTab =
        EN_ALL_IN_ONE_SUITE.tabs.find((tab) => tab.id === activeId) ?? EN_ALL_IN_ONE_SUITE.tabs[0];

    return (
        <section
            id="trading-suite"
            aria-label="All-in-One Trading Suite"
            className="relative z-20 mx-auto w-full max-w-7xl px-4 pb-28 pt-4 sm:px-6 lg:px-8"
        >
            {/* Subtle centered ambient glow */}
            <div
                aria-hidden="true"
                className="pointer-events-none absolute left-1/2 top-24 h-72 w-[520px] -translate-x-1/2 rounded-full opacity-25 blur-[120px]"
                style={{
                    background:
                        'radial-gradient(circle, rgba(16, 185, 129, 0.28) 0%, rgba(14, 165, 233, 0.16) 55%, transparent 78%)',
                }}
            />

            {/* ================================================================
               CENTERED HEADER: Eyebrow + Headline + Subheadline
               ================================================================ */}
            <div className="relative mx-auto flex max-w-3xl flex-col items-center text-center">
                <span className="inline-flex items-center gap-1.5 rounded-md border border-accent/25 bg-accent/10 px-3 py-1 text-[10.5px] font-extrabold uppercase tracking-[0.09em] text-accent-fg">
                    <Layers size={12} />
                    <span>{EN_ALL_IN_ONE_SUITE.eyebrow}</span>
                </span>

                <h2 className="mt-5 text-3xl font-extrabold leading-[1.12] tracking-tight text-white sm:text-4xl lg:text-[44px]">
                    {EN_ALL_IN_ONE_SUITE.headline}
                </h2>

                <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-300/90 sm:text-[17px]">
                    {EN_ALL_IN_ONE_SUITE.subheadline}
                </p>
            </div>

            {/* ================================================================
               INTERACTIVE WORKFLOW BUTTONS (Clean Pill Switcher)
               ================================================================ */}
            <div
                role="tablist"
                aria-label="Trading suite modules"
                className="relative mx-auto mt-10 grid max-w-4xl grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-3.5"
            >
                {EN_ALL_IN_ONE_SUITE.tabs.map((tab) => {
                    const Icon = TAB_ICONS[tab.id];
                    const isActive = tab.id === activeTab.id;

                    return (
                        <button
                            key={tab.id}
                            type="button"
                            role="tab"
                            aria-selected={isActive}
                            aria-controls={`suite-panel-${tab.id}`}
                            data-cta-tag={`lp_en_suite_tab_${tab.id}`}
                            data-intent={`interest_${tab.id}`}
                            onClick={() => setActiveId(tab.id)}
                            className={`group relative flex items-center gap-3.5 rounded-2xl border px-4 py-3.5 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${
                                isActive
                                    ? 'border-accent/45 bg-[#0B1420] shadow-[0_12px_34px_-12px_rgba(16,185,129,0.32)]'
                                    : 'border-white/[0.08] bg-[#070B13]/85 hover:border-white/20 hover:bg-[#0B101B]'
                            }`}
                        >
                            <div
                                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition-colors ${
                                    isActive
                                        ? 'border-accent/40 bg-accent/15 text-accent-fg'
                                        : 'border-white/[0.08] bg-white/[0.03] text-slate-400 group-hover:text-slate-200'
                                }`}
                            >
                                <Icon size={18} />
                            </div>

                            <div className="min-w-0 flex-1">
                                <div
                                    className={`truncate text-sm font-bold tracking-tight transition-colors ${
                                        isActive ? 'text-white' : 'text-slate-300 group-hover:text-white'
                                    }`}
                                >
                                    {tab.label}
                                </div>
                                <div className="mt-0.5 truncate text-[11.5px] font-medium text-slate-400">
                                    {tab.shortTag}
                                </div>
                            </div>

                            {isActive && (
                                <span
                                    aria-hidden="true"
                                    className="absolute inset-x-6 -bottom-px h-[2px] rounded-full bg-gradient-to-r from-transparent via-emerald-400 to-transparent"
                                />
                            )}
                        </button>
                    );
                })}
            </div>

            {/* ================================================================
               UNIFORM-PROPORTION IMAGE SHOWCASE STAGE (Exact 1356 × 520 Ratio)
               ================================================================ */}
            <div className="relative mx-auto mt-6 max-w-6xl overflow-hidden rounded-2xl border border-white/[0.11] bg-[#070B14] shadow-[0_32px_95px_-20px_rgba(0,0,0,0.92)]">
                {/* Clean Application Chrome Header */}
                <div className="flex items-center justify-between border-b border-white/[0.07] bg-[#0B101D] px-4 py-2.5 sm:px-5">
                    <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full bg-rose-500/75" />
                        <span className="h-2.5 w-2.5 rounded-full bg-amber-500/75" />
                        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/75" />
                        <span className="ml-2 text-xs font-semibold tracking-tight text-slate-300">
                            {activeTab.label}
                        </span>
                    </div>
                    <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] text-slate-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        Single Workspace
                    </span>
                </div>

                {/* Locked Identical Aspect-Ratio Viewport (`1356 × 520`) */}
                <div
                    role="tabpanel"
                    id={`suite-panel-${activeTab.id}`}
                    className="relative w-full aspect-[1356/520] overflow-hidden bg-[#0B0F15]"
                >
                    {EN_ALL_IN_ONE_SUITE.tabs.map((tab) => {
                        const isActive = tab.id === activeTab.id;
                        return (
                            <img
                                key={tab.id}
                                src={tab.imageSrc}
                                alt={tab.imageAlt}
                                width={1356}
                                height={520}
                                loading="lazy"
                                decoding="async"
                                className={`absolute inset-0 h-full w-full select-none object-cover object-center transition-opacity duration-300 ease-out ${
                                    isActive ? 'z-10 opacity-100' : 'pointer-events-none z-0 opacity-0'
                                }`}
                            />
                        );
                    })}
                </div>

                {/* Clean Single-Line Module Summary + CTA Footer */}
                <div className="flex flex-col items-start justify-between gap-3 border-t border-white/[0.07] bg-[#090D16] px-4 py-3.5 sm:flex-row sm:items-center sm:px-6">
                    <p className="text-xs leading-relaxed text-slate-300 sm:text-[13.5px]">
                        {activeTab.description}
                    </p>
                    <Link
                        to={buildTaggedUrl(activeTab.ctaHref, {
                            ctaTag: `lp_en_suite_cta_${activeTab.id}`,
                            intent: activeTab.id,
                        })}
                        data-cta-tag={`lp_en_suite_cta_${activeTab.id}`}
                        data-intent={activeTab.id}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-accent/35 bg-accent/15 px-4 py-1.5 text-xs font-bold tracking-wide text-accent-fg transition-all hover:bg-accent hover:text-accent-on"
                    >
                        <span>{activeTab.ctaLabel}</span>
                        <ArrowRight size={14} />
                    </Link>
                </div>
            </div>
        </section>
    );
};

export default AllInOneSuiteEnSection;
