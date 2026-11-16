import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { CandlestickHeroBackground } from './CandlestickBackground';
import { buttonVariants } from '../ui/Button';
import { StatusPill } from '../ui/StatusPill';
import { getLandingContent, LANDING_ASSETS, type LandingLocale } from './content';
import { ShowcaseFrame } from './primitives';
import { buildTaggedUrl } from '../../lib/attribution';

export const HeroSection = ({ locale = 'pt' }: { locale?: LandingLocale }) => {
    const { hero } = getLandingContent(locale);

    return (
        <header className="relative z-10 flex flex-col items-center overflow-hidden px-4 pb-20 pt-32 sm:px-6 md:pb-28 md:pt-40 lg:px-8">
            <CandlestickHeroBackground locale={locale} />

            <div className="relative z-20 mx-auto grid max-w-7xl grid-cols-1 items-center gap-10 lg:grid-cols-12 lg:gap-12">
                <div className="flex flex-col justify-center text-center lg:col-span-6 lg:text-left">
                    <StatusPill className="mb-6 self-center lg:self-start">{hero.eyebrow}</StatusPill>

                    <h1 className="mb-6 text-4xl font-extrabold leading-[1.1] tracking-tight text-fg sm:text-5xl lg:text-6xl">
                        {hero.title} <span className="text-accent-fg">{hero.titleAccent}</span>
                    </h1>

                    <h2 className="mx-auto mb-8 max-w-xl text-base font-normal leading-relaxed text-fg-muted sm:text-lg lg:mx-0">
                        {hero.description}
                    </h2>

                    <div className="flex flex-col items-center justify-center gap-3.5 sm:flex-row lg:justify-start">
                        <Link
                            to={buildTaggedUrl('/register', { ctaTag: 'lp_pt_hero_start_trial', intent: 'free_trial' })}
                            data-cta-tag="lp_pt_hero_start_trial"
                            data-intent="free_trial"
                            className={buttonVariants({ variant: 'brand', size: 'lg', pill: true, className: 'w-full px-7 sm:w-auto' })}
                        >
                            {hero.primaryCta} <ArrowRight size={16} strokeWidth={2.5} aria-hidden />
                        </Link>
                        <a
                            href={hero.secondaryHref}
                            data-cta-tag="lp_pt_hero_explore_platform"
                            data-intent="explore_platform"
                            className={buttonVariants({ variant: 'outline', size: 'lg', pill: true, className: 'w-full px-6 font-semibold sm:w-auto' })}
                        >
                            {hero.secondaryCta}
                        </a>
                    </div>
                </div>

                <ShowcaseFrame className="w-full lg:col-span-6">
                    <img
                        src={LANDING_ASSETS.dashboardMockup}
                        alt={hero.mockupAlt}
                        width={1366}
                        height={680}
                        className="block h-auto w-full rounded-xl border border-line object-contain"
                    />
                </ShowcaseFrame>
            </div>
        </header>
    );
};
