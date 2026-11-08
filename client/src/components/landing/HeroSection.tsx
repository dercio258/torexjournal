import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { CandlestickHeroBackground } from './CandlestickBackground';
import { buttonVariants } from '../ui/Button';
import { StatusPill } from '../ui/StatusPill';
import { HERO, LANDING_ASSETS } from './content';
import { ShowcaseFrame } from './primitives';

export const HeroSection = () => (
    <header className="relative z-10 flex flex-col items-center overflow-hidden px-4 pb-20 pt-32 sm:px-6 md:pb-28 md:pt-40 lg:px-8">
        <CandlestickHeroBackground />

        <div className="relative z-20 mx-auto grid max-w-7xl grid-cols-1 items-center gap-10 lg:grid-cols-12 lg:gap-12">
            <div className="flex flex-col justify-center text-center lg:col-span-6 lg:text-left">
                <StatusPill className="mb-6 self-center lg:self-start">{HERO.eyebrow}</StatusPill>

                <h1 className="mb-6 text-4xl font-extrabold leading-[1.1] tracking-tight text-fg sm:text-5xl lg:text-6xl">
                    {HERO.title} <span className="text-accent-fg">{HERO.titleAccent}</span>
                </h1>

                <p className="mx-auto mb-8 max-w-xl text-base leading-relaxed text-fg-muted sm:text-lg lg:mx-0">{HERO.description}</p>

                <div className="flex flex-col items-center justify-center gap-3.5 sm:flex-row lg:justify-start">
                    <Link to="/register" className={buttonVariants({ variant: 'brand', size: 'lg', pill: true, className: 'w-full px-7 sm:w-auto' })}>
                        Começar agora <ArrowRight size={16} strokeWidth={2.5} aria-hidden />
                    </Link>
                    <a href="#plataforma" className={buttonVariants({ variant: 'outline', size: 'lg', pill: true, className: 'w-full px-6 font-semibold sm:w-auto' })}>
                        Ver a plataforma
                    </a>
                </div>
            </div>

            <ShowcaseFrame className="w-full lg:col-span-6">
                <img
                    src={LANDING_ASSETS.dashboardMockup}
                    alt="Dashboard do Torex Journal com métricas de performance"
                    width={1366}
                    height={680}
                    className="block h-auto w-full rounded-xl border border-line object-contain"
                />
            </ShowcaseFrame>
        </div>
    </header>
);
