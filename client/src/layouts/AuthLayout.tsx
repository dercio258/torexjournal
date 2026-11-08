import React from 'react';
import { CandlestickHeroBackground } from '../components/landing/CandlestickBackground';
import { Logo } from '../components/ui/Logo';
import { cn } from '../lib/cn';

interface AuthLayoutProps {
    /** The form card. */
    children: React.ReactNode;
    /** Brand/marketing column, shown on large screens only. */
    aside?: React.ReactNode;
    /** Which side the aside sits on (desktop). */
    asideSide?: 'left' | 'right';
}

/**
 * Shared shell for every unauthenticated auth screen (login, register,
 * password recovery, 2FA). Always renders in the dark brand palette via the
 * scoped `.theme-dark` token set — it never mutates the global theme.
 */
export const AuthLayout = ({ children, aside, asideSide = 'left' }: AuthLayoutProps) => (
    <div className="theme-dark relative isolate flex min-h-screen flex-col overflow-hidden bg-canvas font-sans text-fg">
        <CandlestickHeroBackground opacity="opacity-50 sm:opacity-65" />
        <div aria-hidden className="pointer-events-none absolute -left-[10%] -top-[15%] h-1/2 w-1/2 rounded-full bg-accent/10 blur-[140px]" />
        <div aria-hidden className="pointer-events-none absolute bottom-0 right-0 h-[45%] w-[45%] rounded-full bg-teal-500/[0.08] blur-[120px]" />

        <header className="relative z-30 px-6 pt-6 md:px-8 md:pt-8">
            <Logo to="/" />
        </header>

        <main className="relative z-20 flex flex-1 items-center justify-center px-4 py-10 md:px-6">
            <div
                className={cn(
                    'grid w-full items-center gap-8',
                    aside ? 'max-w-6xl lg:grid-cols-2 lg:gap-20' : 'max-w-md'
                )}
            >
                {aside && (
                    <aside className={cn('hidden lg:block', asideSide === 'right' ? 'lg:order-2' : 'lg:order-1')}>{aside}</aside>
                )}
                <div className={cn('mx-auto w-full max-w-md', aside && (asideSide === 'right' ? 'lg:order-1' : 'lg:order-2'))}>
                    {children}
                </div>
            </div>
        </main>
    </div>
);
