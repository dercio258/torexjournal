import React from 'react';
import { CandlestickHeroBackground } from '../components/landing/CandlestickBackground';
import { Logo } from '../components/ui/Logo';
import { LanguageSwitcher } from '../components/ui/LanguageSwitcher';
import { cn } from '../lib/cn';

interface AuthLayoutProps {
    /** The form card. */
    children: React.ReactNode;
    /** Brand/marketing column, shown on large screens only. */
    aside?: React.ReactNode;
    /** Which side the aside sits on (desktop). */
    asideSide?: 'left' | 'right';
    /** Show the top bar with brand logo and language pill. */
    showHeader?: boolean;
    /** Align the grid toward the top of the viewport instead of vertically centering it. */
    alignTop?: boolean;
}

/**
 * Shared shell for every unauthenticated auth screen (login, register,
 * password recovery, 2FA). Always renders in the dark brand palette via the
 * scoped `.theme-dark` token set — it never mutates the global theme.
 */
export const AuthLayout = ({
    children,
    aside,
    asideSide = 'left',
    showHeader = true,
    alignTop = false,
}: AuthLayoutProps) => (
    <div className="theme-dark relative isolate flex min-h-screen flex-col overflow-hidden bg-canvas font-sans text-fg">
        <CandlestickHeroBackground opacity="opacity-50 sm:opacity-65" />
        <div aria-hidden className="pointer-events-none absolute -left-[10%] -top-[15%] h-1/2 w-1/2 rounded-full bg-accent/10 blur-[140px]" />
        <div aria-hidden className="pointer-events-none absolute bottom-0 right-0 h-[45%] w-[45%] rounded-full bg-teal-500/[0.08] blur-[120px]" />

        {showHeader && (
            <header className="relative z-30 flex items-center justify-between px-6 pt-6 md:px-8 md:pt-8">
                <Logo to="/" />
                <LanguageSwitcher variant="pill" />
            </header>
        )}

        <main
            className={cn(
                'relative z-20 flex flex-1 justify-center px-4 md:px-6',
                alignTop ? 'items-start pt-8 pb-12 sm:pt-10 md:pt-14' : 'items-center py-10'
            )}
        >
            <div
                className={cn(
                    'grid w-full gap-8',
                    alignTop ? 'items-start' : 'items-center',
                    aside ? 'max-w-6xl lg:grid-cols-2 lg:gap-16' : 'max-w-md'
                )}
            >
                {aside && (
                    <aside
                        className={cn(
                            'hidden lg:block',
                            alignTop && 'lg:pt-2',
                            asideSide === 'right' ? 'lg:order-2' : 'lg:order-1'
                        )}
                    >
                        {aside}
                    </aside>
                )}
                <div className={cn('mx-auto w-full max-w-md', aside && (asideSide === 'right' ? 'lg:order-1' : 'lg:order-2'))}>
                    {children}
                </div>
            </div>
        </main>
    </div>
);
