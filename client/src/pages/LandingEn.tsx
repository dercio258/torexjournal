import { lazy, Suspense, useEffect } from 'react';
import { LandingEnNavbar } from '../components/landing-en/LandingEnNavbar';
import { HeroEnSection } from '../components/landing-en/HeroEnSection';
import { CookieConsentBanner } from '../components/legal/CookieConsentBanner';

// Below-the-fold sections lazy-loaded to keep initial Hero LCP & JS parse ultra-lean
const CorePillarsEnSection = lazy(() =>
    import('../components/landing-en/CorePillarsEnSection').then((m) => ({
        default: m.CorePillarsEnSection,
    }))
);
const BrokerIntegrationsEnSection = lazy(() =>
    import('../components/landing-en/BrokerIntegrationsEnSection').then((m) => ({
        default: m.BrokerIntegrationsEnSection,
    }))
);
const AiDecodeDashboardEnSection = lazy(() =>
    import('../components/landing-en/AiDecodeDashboardEnSection').then((m) => ({
        default: m.AiDecodeDashboardEnSection,
    }))
);
const AllInOneSuiteEnSection = lazy(() =>
    import('../components/landing-en/AllInOneSuiteEnSection').then((m) => ({
        default: m.AllInOneSuiteEnSection,
    }))
);
const AiBacktestingScrollEnSection = lazy(() =>
    import('../components/landing-en/AiBacktestingScrollEnSection').then((m) => ({
        default: m.AiBacktestingScrollEnSection,
    }))
);
const TorexAiAgentsEnSection = lazy(() =>
    import('../components/landing-en/TorexAiAgentsEnSection').then((m) => ({
        default: m.TorexAiAgentsEnSection,
    }))
);
const TorexAdvantageEnSection = lazy(() =>
    import('../components/landing-en/TorexAdvantageEnSection').then((m) => ({
        default: m.TorexAdvantageEnSection,
    }))
);
const LandingEnFooter = lazy(() =>
    import('../components/landing-en/LandingEnFooter').then((m) => ({
        default: m.LandingEnFooter,
    }))
);

const SectionFallback = ({ minHeight }: { minHeight: string }) => (
    <div aria-hidden="true" className="w-full bg-[#02040A]" style={{ minHeight }} />
);

/**
 * English Landing Page (`/en`).
 * Keeps Navbar + Hero eager for instantaneous LCP, while code-splitting
 * below-the-fold interactive modules, simulations, and the institutional footer.
 */
export const LandingEn = () => {
    useEffect(() => {
        const htmlEl = document.documentElement;
        const prevLang = htmlEl.lang;
        const prevTitle = document.title;
        const prevScrollBehavior = htmlEl.style.scrollBehavior;

        htmlEl.lang = 'en';
        document.title = 'TOREX JOURNAL — Master Your Trading. Command Your Edge.';

        const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!prefersReduced) {
            htmlEl.style.scrollBehavior = 'smooth';
        }

        let metaDesc = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
        let createdMeta = false;
        const prevMetaContent = metaDesc?.content ?? '';
        if (!metaDesc) {
            metaDesc = document.createElement('meta');
            metaDesc.name = 'description';
            document.head.appendChild(metaDesc);
            createdMeta = true;
        }
        metaDesc.content =
            'Torex Journal transforms your MT5, Deriv, and Prop Firm trades into actionable AI intelligence, realistic market replay, and autonomous risk guardrails.';

        return () => {
            htmlEl.lang = prevLang || 'pt';
            htmlEl.style.scrollBehavior = prevScrollBehavior;
            document.title = prevTitle || 'TOREX JOURNAL';
            if (createdMeta && metaDesc) {
                metaDesc.remove();
            } else if (metaDesc) {
                metaDesc.content = prevMetaContent;
            }
        };
    }, []);

    return (
        <div className="theme-dark flex min-h-screen flex-col overflow-x-clip bg-[#02040A] font-sans text-fg selection:bg-accent/25">
            <LandingEnNavbar />
            <main className="flex flex-1 flex-col">
                <HeroEnSection />

                <Suspense fallback={<SectionFallback minHeight="420px" />}>
                    <CorePillarsEnSection />
                </Suspense>

                <Suspense fallback={<SectionFallback minHeight="280px" />}>
                    <BrokerIntegrationsEnSection />
                </Suspense>

                <Suspense fallback={<SectionFallback minHeight="520px" />}>
                    <AiDecodeDashboardEnSection />
                </Suspense>

                <Suspense fallback={<SectionFallback minHeight="620px" />}>
                    <AllInOneSuiteEnSection />
                </Suspense>

                <Suspense fallback={<SectionFallback minHeight="860px" />}>
                    <AiBacktestingScrollEnSection />
                </Suspense>

                <Suspense fallback={<SectionFallback minHeight="960px" />}>
                    <TorexAiAgentsEnSection />
                </Suspense>

                <Suspense fallback={<SectionFallback minHeight="680px" />}>
                    <TorexAdvantageEnSection />
                </Suspense>
            </main>

            <Suspense fallback={<SectionFallback minHeight="320px" />}>
                <LandingEnFooter />
            </Suspense>
            <CookieConsentBanner locale="en" />
        </div>
    );
};
