import React, { useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { ArrowDown, ArrowRight, Cpu } from 'lucide-react';
import { EN_AI_BACKTESTING_SCROLL } from './contentEn';
import { buildTaggedUrl } from '../../lib/attribution';

/**
 * Scroll-driven Curtain Cover section for `/en`.
 * Pins the AI-Powered Backtesting Eyebrow + Headline + Subheadline in view (`z-10`),
 * while the solid obsidian Curtain + Backtesting Simulator frame (`z-20`) scrolls up
 * directly over the sticky copy — smoothly covering it as you scroll down and
 * uncovering it again when scrolling back up.
 */
export const AiBacktestingScrollEnSection: React.FC = () => {
    const sectionRef = useRef<HTMLElement>(null);
    const curtainRef = useRef<HTMLDivElement>(null);
    const shouldReduceMotion = useReducedMotion();

    // Tracks the curtain entering from the bottom edge of the viewport up to full center cover
    const { scrollYProgress: curtainProgress } = useScroll({
        target: curtainRef,
        offset: ['start 96%', 'start 18%'],
    });

    // Sticky headline gently recedes & dims right as the solid curtain slides over it
    const headlineOpacity = useTransform(curtainProgress, [0, 0.35, 0.85], [1, 0.82, 0.12]);
    const headlineScale = useTransform(curtainProgress, [0, 0.85], [1, 0.93]);
    const hintOpacity = useTransform(curtainProgress, [0, 0.25], [1, 0]);

    // Simulator frame smoothly expands as it rises over the headline
    const showcaseScale = useTransform(curtainProgress, [0, 1], [0.92, 1]);
    const showcaseY = useTransform(curtainProgress, [0, 1], [36, 0]);

    return (
        <section
            id="ai-backtesting"
            ref={sectionRef}
            aria-label="AI-Powered Backtesting"
            className="relative z-20 w-full pb-28 pt-8 sm:pt-12"
        >
            {/* ================================================================
               BACK LAYER (Sticky): Eyebrow + Headline + Subheadline
               ================================================================ */}
            <div className="sticky top-16 z-10 flex min-h-[76vh] w-full items-center justify-center px-4 sm:top-20 sm:min-h-[80vh] sm:px-6 lg:px-8">
                {/* Ambient backdrop glow */}
                <div
                    aria-hidden="true"
                    className="pointer-events-none absolute left-1/2 top-1/2 h-[380px] w-[580px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-25 blur-[125px]"
                    style={{
                        background:
                            'radial-gradient(circle, rgba(16, 185, 129, 0.28) 0%, rgba(14, 165, 233, 0.16) 55%, transparent 78%)',
                    }}
                />

                <motion.div
                    style={
                        shouldReduceMotion
                            ? undefined
                            : { opacity: headlineOpacity, scale: headlineScale }
                    }
                    className="relative mx-auto flex max-w-4xl flex-col items-center text-center will-change-transform"
                >
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-accent/25 bg-accent/10 px-3 py-1 text-[10.5px] font-extrabold uppercase tracking-[0.09em] text-accent-fg">
                        <Cpu size={12} />
                        <span>{EN_AI_BACKTESTING_SCROLL.eyebrow}</span>
                    </span>

                    <h2 className="mt-5 text-3xl font-extrabold leading-[1.08] tracking-tight text-white sm:text-5xl lg:text-[54px]">
                        {EN_AI_BACKTESTING_SCROLL.headline}
                    </h2>

                    <p className="mt-5 max-w-3xl text-sm leading-relaxed text-slate-300/90 sm:text-base lg:text-[18px]">
                        {EN_AI_BACKTESTING_SCROLL.subheadline}
                    </p>

                    <motion.div
                        style={shouldReduceMotion ? undefined : { opacity: hintOpacity }}
                        className="mt-8 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 text-xs font-semibold text-slate-300"
                    >
                        <span>{EN_AI_BACKTESTING_SCROLL.scrollHint}</span>
                        <ArrowDown size={13} className="animate-bounce text-accent-fg" />
                    </motion.div>
                </motion.div>
            </div>

            {/* ================================================================
               FRONT CURTAIN LAYER: Solid dark sheet + Backtesting Showcase
               Physically scrolls upward OVER the sticky headline (`z-20` > `z-10`)
               ================================================================ */}
            <div
                ref={curtainRef}
                className="relative z-20 mt-6 bg-[#02040A] px-4 pb-10 pt-6 sm:mt-10 sm:px-6 lg:px-8"
            >
                {/* Soft top feather so the headline fades seamlessly under the rising curtain */}
                <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 -top-24 h-24 bg-gradient-to-t from-[#02040A] via-[#02040A]/85 to-transparent"
                />

                <motion.div
                    style={
                        shouldReduceMotion
                            ? undefined
                            : { scale: showcaseScale, y: showcaseY }
                    }
                    className="relative mx-auto w-full max-w-6xl will-change-transform"
                >
                    <div className="overflow-hidden rounded-2xl border border-emerald-400/25 bg-[#070B14] shadow-[0_40px_120px_-15px_rgba(0,0,0,0.96),0_0_65px_-22px_rgba(16,185,129,0.28)]">
                        {/* Window Top Chrome */}
                        <div className="flex items-center justify-between border-b border-white/[0.08] bg-[#0B101D] px-4 py-2.5 sm:px-5">
                            <div className="flex items-center gap-2">
                                <span className="h-2.5 w-2.5 rounded-full bg-rose-500/75" />
                                <span className="h-2.5 w-2.5 rounded-full bg-amber-500/75" />
                                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/75" />
                                <span className="ml-2 truncate text-[11px] font-semibold tracking-tight text-slate-300 sm:text-xs">
                                    {EN_AI_BACKTESTING_SCROLL.windowTitle}
                                </span>
                            </div>

                            <Link
                                to={buildTaggedUrl(EN_AI_BACKTESTING_SCROLL.ctaHref, {
                                    ctaTag: 'lp_en_backtesting_cta',
                                    intent: 'backtesting_simulator',
                                })}
                                data-cta-tag="lp_en_backtesting_cta"
                                data-intent="backtesting_simulator"
                                className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent px-3.5 py-1 text-[11px] font-extrabold text-accent-on transition-all hover:brightness-110"
                            >
                                <span>{EN_AI_BACKTESTING_SCROLL.ctaLabel}</span>
                                <ArrowRight size={12} />
                            </Link>
                        </div>

                        {/* Crisp 16:9 Backtesting Simulator Capture (`1280 × 720`) */}
                        <div className="relative aspect-video w-full overflow-hidden bg-[#0A0E14]">
                            <img
                                src={EN_AI_BACKTESTING_SCROLL.imageSrc}
                                alt={EN_AI_BACKTESTING_SCROLL.imageAlt}
                                width={1280}
                                height={720}
                                loading="lazy"
                                decoding="async"
                                className="block h-full w-full select-none object-cover object-center"
                            />
                        </div>
                    </div>
                </motion.div>
            </div>
        </section>
    );
};

export default AiBacktestingScrollEnSection;
