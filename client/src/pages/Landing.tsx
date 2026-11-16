import { useEffect } from 'react';
import { LandingNavbar } from '../components/landing/LandingNavbar';
import { HeroSection } from '../components/landing/HeroSection';
import { PlatformShowcase } from '../components/landing/PlatformShowcase';
import { FeaturesGrid } from '../components/landing/FeaturesGrid';
import { ChecklistCta } from '../components/landing/ChecklistCta';
import { AwardsSection } from '../components/landing/AwardsSection';
import { LandingFooter } from '../components/landing/LandingFooter';
import { getLandingContent, type LandingLocale } from '../components/landing/content';
import { useLocale } from '../context/LocaleContext';
import { LandingEn } from './LandingEn';
import { CookieConsentBanner } from '../components/legal/CookieConsentBanner';

/**
 * Public marketing entry:
 * - `/` and `/pt` (`locale === 'pt'`) render the Portuguese landing page.
 * - `/en` (`locale === 'en'` via `LocaleRouter` basename or explicit prop) renders `LandingEn`.
 */
export const Landing = ({ locale: propLocale }: { locale?: LandingLocale }) => {
    const { locale: contextLocale } = useLocale();
    const locale: LandingLocale = propLocale || contextLocale;
    const ptContent = getLandingContent('pt');

    useEffect(() => {
        if (locale === 'en') return;
        const prevLang = document.documentElement.lang;
        const prevTitle = document.title;
        document.documentElement.lang = 'pt';
        document.title = ptContent.pageTitle;
        return () => {
            document.documentElement.lang = prevLang || 'pt';
            document.title = prevTitle || 'TOREX JOURNAL';
        };
    }, [locale, ptContent.pageTitle]);

    if (locale === 'en') {
        return <LandingEn />;
    }

    return (
        <div className="theme-dark flex min-h-screen flex-col overflow-x-hidden bg-canvas font-sans text-fg selection:bg-accent/25">
            <div
                aria-hidden
                className="pointer-events-none fixed inset-0 z-0 opacity-[0.025]"
                style={{ backgroundImage: 'radial-gradient(rgba(255, 255, 255, 0.4) 1px, transparent 1px)', backgroundSize: '28px 28px' }}
            />
            <LandingNavbar locale="pt" />
            <main className="flex flex-1 flex-col">
                <HeroSection locale="pt" />
                <PlatformShowcase locale="pt" />
                <FeaturesGrid locale="pt" />
                <ChecklistCta locale="pt" />
                <AwardsSection locale="pt" />
            </main>
            <LandingFooter locale="pt" />
            <CookieConsentBanner locale="pt" />
        </div>
    );
};
