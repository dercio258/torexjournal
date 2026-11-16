import React from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { EN_TOREX_ADVANTAGE } from './contentEn';
import { buildTaggedUrl } from '../../lib/attribution';
import {
    TOREX_ADVANTAGE_ICONS,
    VerifiedShieldIcon,
    type TorexAdvantageIconKey,
} from './TorexAdvantageIcons';

export const TorexAdvantageEnSection: React.FC = () => {
    const prefersReducedMotion = useReducedMotion();

    return (
        <section
            id="torex-advantage"
            className="relative z-20 mx-auto w-full max-w-7xl px-4 py-24 sm:px-6 lg:px-8 lg:py-32"
        >
            {/* Subtle top hairline separator breathing on obsidian canvas */}
            <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent sm:inset-x-6 lg:inset-x-8"
            />

            <div className="flex flex-col gap-14 lg:grid lg:grid-cols-12 lg:items-start lg:gap-14">
                {/* Sticky Editorial Column (Desktop Left, Mobile Bottom after value pillars) */}
                <div className="order-2 lg:order-1 lg:col-span-5 lg:sticky lg:top-28">
                    <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-accent-fg">
                        {EN_TOREX_ADVANTAGE.eyebrow}
                    </p>

                    <h2 className="mt-3 text-3xl font-extrabold leading-[1.1] tracking-[-0.025em] text-white sm:text-4xl lg:text-[42px]">
                        <span className="block">{EN_TOREX_ADVANTAGE.headlineLine1}</span>
                        <span className="block bg-gradient-to-r from-emerald-300 via-accent-fg to-sky-400 bg-clip-text text-transparent">
                            {EN_TOREX_ADVANTAGE.headlineGradient}
                        </span>
                    </h2>

                    <p className="mt-4 max-w-md text-[15.5px] leading-relaxed text-slate-400">
                        {EN_TOREX_ADVANTAGE.subheadline}
                    </p>

                    {/* Minimal Institutional Trust / Access Strip */}
                    <div className="mt-7 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/20 bg-[#071019]/80 px-4 py-3 backdrop-blur-md">
                        <div className="flex min-w-0 items-center gap-2.5">
                            <VerifiedShieldIcon />
                            <span className="text-xs font-medium text-slate-200">
                                {EN_TOREX_ADVANTAGE.trustStrip.label}
                            </span>
                        </div>
                        <Link
                            to={buildTaggedUrl(EN_TOREX_ADVANTAGE.trustStrip.linkHref, {
                                ctaTag: 'lp_en_advantage_trust_link',
                                intent: 'security_trust',
                            })}
                            data-cta-tag="lp_en_advantage_trust_link"
                            data-intent="security_trust"
                            className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-accent-fg hover:underline"
                        >
                            <span>{EN_TOREX_ADVANTAGE.trustStrip.linkLabel}</span>
                            <span aria-hidden="true">↗</span>
                        </Link>
                    </div>

                    {/* Primary CTA */}
                    <div className="mt-7">
                        <Link
                            to={buildTaggedUrl(EN_TOREX_ADVANTAGE.cta.href, {
                                ctaTag: 'lp_en_advantage_cta',
                                intent: 'free_trial_advantage',
                            })}
                            data-cta-tag="lp_en_advantage_cta"
                            data-intent="free_trial_advantage"
                            className="inline-flex items-center gap-2 rounded-full bg-accent px-7 py-3.5 text-sm font-bold text-accent-on shadow-glow transition-all hover:brightness-110"
                        >
                            <span>{EN_TOREX_ADVANTAGE.cta.label}</span>
                            <span aria-hidden="true">→</span>
                        </Link>
                    </div>
                </div>

                {/* Borderless Institutional 10-Pillar Grid (Desktop Right, Mobile Top) */}
                <div className="order-1 lg:order-2 lg:col-span-7">
                    <div className="grid grid-cols-1 gap-x-10 gap-y-11 sm:grid-cols-2">
                        {EN_TOREX_ADVANTAGE.pillars.map((pillar, index) => {
                            const IconComponent =
                                TOREX_ADVANTAGE_ICONS[pillar.iconKey as TorexAdvantageIconKey];

                            return (
                                <motion.article
                                    key={pillar.iconKey}
                                    initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
                                    whileInView={{ opacity: 1, y: 0 }}
                                    viewport={{ once: true, amount: 0.15 }}
                                    transition={
                                        prefersReducedMotion
                                            ? { duration: 0 }
                                            : { duration: 0.36, delay: index * 0.04 }
                                    }
                                    className="group relative flex flex-col items-start"
                                >
                                    {/* 40x40 Icon Container with subtle hover micro-halo */}
                                    <div className="relative mb-4 flex h-10 w-10 items-center justify-center">
                                        <span
                                            aria-hidden="true"
                                            className="pointer-events-none absolute -inset-2 rounded-full opacity-0 blur-md transition-opacity duration-300 group-hover:opacity-100"
                                            style={{
                                                background:
                                                    'radial-gradient(circle, rgba(16,185,129,0.28) 0%, rgba(56,189,248,0.14) 55%, transparent 75%)',
                                            }}
                                        />
                                        <IconComponent className="relative h-10 w-10 transition-transform duration-300 group-hover:-translate-y-0.5" />
                                    </div>

                                    <h3 className="text-[15.5px] font-semibold tracking-[-0.01em] text-white">
                                        {pillar.title}
                                    </h3>

                                    <p className="mt-1.5 text-[13.5px] leading-relaxed text-slate-400">
                                        {pillar.description}
                                    </p>
                                </motion.article>
                            );
                        })}
                    </div>
                </div>
            </div>
        </section>
    );
};
