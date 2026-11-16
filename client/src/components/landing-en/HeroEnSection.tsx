import { lazy, Suspense, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import gsap from 'gsap';
import { buttonVariants } from '../ui/Button';
import { EN_HERO } from './contentEn';
import { buildTaggedUrl } from '../../lib/attribution';

const EarthHorizonBackgroundLazy = lazy(() => import('./EarthHorizonBackground'));

const HeroFallbackBackdrop = () => (
    <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0 bg-[#02040A]"
    />
);

export const HeroEnSection = () => {
    const contentRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (prefersReduced || !contentRef.current) return;

        const ctx = gsap.context(() => {
            gsap.fromTo(
                '[data-hero-reveal]',
                { autoAlpha: 0, y: 18 },
                {
                    autoAlpha: 1,
                    y: 0,
                    duration: 0.9,
                    stagger: 0.11,
                    ease: 'power3.out',
                    clearProps: 'transform',
                }
            );
        }, contentRef);

        return () => ctx.revert();
    }, []);

    return (
        <header className="relative z-10 flex min-h-screen flex-col items-center justify-start overflow-hidden bg-[#02040A] px-4 pb-60 pt-28 sm:px-6 sm:pb-64 sm:pt-32 lg:px-8 lg:pt-36">
            <Suspense fallback={<HeroFallbackBackdrop />}>
                <EarthHorizonBackgroundLazy />
            </Suspense>

            {/* Centered Upper-Middle Composition cleanly above the Earth Horizon */}
            <div
                ref={contentRef}
                className="relative z-20 mx-auto flex max-w-4xl flex-col items-center text-center"
            >
                <h1 className="mb-6 font-sans text-4xl font-extrabold uppercase leading-[1.06] tracking-[-0.03em] sm:text-6xl lg:text-[4.25rem]">
                    <span data-hero-reveal className="block text-fg">
                        {EN_HERO.headlineLine1}
                    </span>
                    <span data-hero-reveal className="mt-1.5 block text-accent-fg">
                        {EN_HERO.headlineLine2}
                    </span>
                </h1>

                <h2
                    data-hero-reveal
                    className="mx-auto mb-9 max-w-2xl font-sans text-base font-normal leading-relaxed text-fg-muted sm:text-lg md:text-[1.125rem] md:leading-[1.7]"
                >
                    {EN_HERO.subheadline}
                </h2>

                <div data-hero-reveal className="flex items-center justify-center">
                    <Link
                        to={buildTaggedUrl(EN_HERO.ctaHref, { ctaTag: 'lp_en_hero_cta', intent: 'free_trial' })}
                        data-cta-tag="lp_en_hero_cta"
                        data-intent="free_trial"
                        className={buttonVariants({
                            variant: 'brand',
                            size: 'lg',
                            pill: true,
                            className: 'h-14 px-9 text-base font-bold shadow-glow',
                        })}
                    >
                        <span>{EN_HERO.ctaLabel}</span>
                        <ArrowRight
                            size={18}
                            strokeWidth={2.5}
                            aria-hidden
                            className="transition-transform duration-300 group-hover:translate-x-0.5"
                        />
                    </Link>
                </div>
            </div>
        </header>
    );
};
