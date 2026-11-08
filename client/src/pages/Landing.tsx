import { LandingNavbar } from '../components/landing/LandingNavbar';
import { HeroSection } from '../components/landing/HeroSection';
import { PlatformShowcase } from '../components/landing/PlatformShowcase';
import { FeaturesGrid } from '../components/landing/FeaturesGrid';
import { ChecklistCta } from '../components/landing/ChecklistCta';
import { AwardsSection } from '../components/landing/AwardsSection';
import { LandingFooter } from '../components/landing/LandingFooter';

/**
 * Public marketing page. Always dark via the scoped `.theme-dark` token set,
 * so it never changes the user's global theme. Copy lives in
 * `components/landing/content.ts`.
 */
export const Landing = () => (
    <div className="theme-dark flex min-h-screen flex-col overflow-x-hidden bg-canvas font-sans text-fg selection:bg-accent/25">
        <div
            aria-hidden
            className="pointer-events-none fixed inset-0 z-0 opacity-[0.025]"
            style={{ backgroundImage: 'radial-gradient(rgba(255, 255, 255, 0.4) 1px, transparent 1px)', backgroundSize: '28px 28px' }}
        />
        <LandingNavbar />
        <main className="flex flex-1 flex-col">
            <HeroSection />
            <PlatformShowcase />
            <FeaturesGrid />
            <ChecklistCta />
            <AwardsSection />
        </main>
        <LandingFooter />
    </div>
);
