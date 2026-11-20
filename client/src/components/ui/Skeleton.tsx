import React from 'react';
import { useLocation } from 'react-router-dom';
import { getCurrentLocale } from '../../context/LocaleContext';
import { cn } from '../../lib/cn';

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
    className?: string;
}

export const Skeleton: React.FC<SkeletonProps> = ({ className, ...props }) => (
    <div
        aria-hidden="true"
        className={cn('skeleton-shimmer rounded-lg border-0', className)}
        {...props}
    />
);

/**
 * Inline table rows skeleton for `<tbody>` loading states (zero layout shift).
 */
export const TableRowsSkeleton: React.FC<{ columns?: number; rows?: number }> = ({
    columns = 8,
    rows = 8,
}) => (
    <>
        {Array.from({ length: rows }).map((_, rowIdx) => (
            <tr key={rowIdx}>
                {Array.from({ length: columns }).map((__, colIdx) => {
                    const widthClass =
                        colIdx === 0
                            ? 'w-20'
                            : colIdx === columns - 1
                              ? 'w-14 ml-auto'
                              : colIdx % 3 === 0
                                ? 'w-24'
                                : 'w-16';
                    return (
                        <td key={colIdx} className="px-3.5 py-3">
                            <Skeleton className={cn('h-3.5 rounded-md', widthClass)} />
                        </td>
                    );
                })}
            </tr>
        ))}
    </>
);

/**
 * Dashboard skeleton matching exact KPI + 3-col Charts + 8/4 Calendar/RecentTrades + Breakdown grid.
 */
export const DashboardSkeleton: React.FC = () => (
    <div className="space-y-3 pb-5 animate-fade-in-up" role="status" aria-label="Carregando painel">
        {/* Top Greeting & Action Bar */}
        <div className="flex items-center justify-between gap-2.5">
            <Skeleton className="h-5 w-40 rounded-md" />
            <div className="flex items-center gap-1.5">
                <Skeleton className="h-8 w-24 rounded-lg" />
                <Skeleton className="h-8 w-8 rounded-full" />
            </div>
        </div>

        {/* 4 High-Priority KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, idx) => (
                <div
                    key={idx}
                    className="bg-surface/80 rounded-xl px-3.5 py-2.5 sm:px-4 sm:py-3 flex flex-col justify-between min-h-[82px]"
                >
                    <div className="flex items-center justify-between gap-2">
                        <Skeleton className="h-3 w-24 rounded" />
                        <Skeleton className="h-4 w-14 rounded" />
                    </div>
                    <div className="flex items-end justify-between mt-2">
                        <Skeleton className="h-6 w-28 rounded-md" />
                        <Skeleton className="h-7 w-14 rounded-lg" />
                    </div>
                </div>
            ))}
        </div>

        {/* Main 3-Column Performance Row: Radar · Cumulative PnL · Daily PnL */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-stretch">
            {Array.from({ length: 3 }).map((_, idx) => (
                <div
                    key={idx}
                    className="bg-surface/80 rounded-xl p-4 flex flex-col justify-between h-[285px]"
                >
                    <div className="flex items-center justify-between">
                        <Skeleton className="h-3.5 w-32 rounded" />
                        <Skeleton className="h-5 w-16 rounded-md" />
                    </div>
                    <Skeleton className="flex-1 w-full my-3 rounded-lg" />
                    <div className="flex items-center justify-between">
                        <Skeleton className="h-2.5 w-20 rounded" />
                        <Skeleton className="h-2.5 w-20 rounded" />
                    </div>
                </div>
            ))}
        </div>

        {/* Operational Calendar (8 cols) + Recent Trades Table (4 cols) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-stretch">
            <div className="lg:col-span-8 bg-surface/80 rounded-xl p-4 space-y-3 min-h-[340px]">
                <div className="flex items-center justify-between">
                    <Skeleton className="h-4 w-36 rounded" />
                    <div className="flex items-center gap-1.5">
                        <Skeleton className="h-7 w-7 rounded-md" />
                        <Skeleton className="h-7 w-24 rounded-md" />
                        <Skeleton className="h-7 w-7 rounded-md" />
                    </div>
                </div>
                <div className="grid grid-cols-7 gap-1.5 pt-1">
                    {Array.from({ length: 35 }).map((_, i) => (
                        <Skeleton key={i} className="h-11 rounded-lg" />
                    ))}
                </div>
            </div>

            <div className="lg:col-span-4 bg-surface/80 rounded-xl p-4 space-y-2.5 min-h-[340px]">
                <div className="flex items-center justify-between pb-1">
                    <Skeleton className="h-4 w-28 rounded" />
                    <Skeleton className="h-3.5 w-16 rounded" />
                </div>
                {Array.from({ length: 7 }).map((_, i) => (
                    <div
                        key={i}
                        className="flex items-center justify-between py-2"
                    >
                        <div className="space-y-1">
                            <Skeleton className="h-3.5 w-20 rounded" />
                            <Skeleton className="h-2.5 w-14 rounded" />
                        </div>
                        <Skeleton className="h-4 w-16 rounded" />
                    </div>
                ))}
            </div>
        </div>

        {/* Operational Breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, idx) => (
                <div key={idx} className="bg-surface/80 rounded-xl p-4 space-y-2.5">
                    <Skeleton className="h-3.5 w-28 rounded" />
                    {Array.from({ length: 4 }).map((__, row) => (
                        <Skeleton key={row} className="h-7 w-full rounded-md" />
                    ))}
                </div>
            ))}
        </div>
    </div>
);

/**
 * Full-page Trades / Leaderboard / History Table Skeleton.
 */
export const TradesTableSkeleton: React.FC = () => (
    <div className="space-y-3 pb-6 animate-fade-in-up" role="status" aria-label={getCurrentLocale() === 'en' ? 'Loading trades' : 'Carregando operações'}>
        <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="space-y-1.5">
                <Skeleton className="h-5 w-44 rounded" />
                <Skeleton className="h-3 w-64 rounded" />
            </div>
            <div className="flex items-center gap-2">
                <Skeleton className="h-8 w-44 rounded-lg" />
                <Skeleton className="h-8 w-8 rounded-lg" />
                <Skeleton className="h-8 w-32 rounded-lg" />
            </div>
        </div>

        <div className="bg-surface/80 p-3 rounded-xl flex flex-wrap gap-2 items-center justify-between">
            <div className="flex flex-wrap gap-2 items-center">
                <Skeleton className="h-8 w-28 rounded-lg" />
                <Skeleton className="h-8 w-36 rounded-lg" />
                <Skeleton className="h-8 w-48 rounded-lg" />
            </div>
            <div className="flex flex-wrap gap-2 items-center">
                <Skeleton className="h-8 w-32 rounded-lg" />
                <Skeleton className="h-8 w-32 rounded-lg" />
            </div>
        </div>

        <div className="bg-surface/80 rounded-xl overflow-hidden">
            <table className="w-full">
                <tbody>
                    <TableRowsSkeleton columns={9} rows={10} />
                </tbody>
            </table>
        </div>
    </div>
);

/**
 * Inner body skeleton for `Reports.tsx` while executive metrics load.
 */
export const ReportsBodySkeleton: React.FC = () => (
    <div className="space-y-4 pt-1 animate-fade-in-up" role="status" aria-label={getCurrentLocale() === 'en' ? 'Loading report' : 'Carregando relatório'}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="bg-canvas-subtle/80 rounded-xl p-3.5 space-y-2">
                    <Skeleton className="h-3 w-24 rounded" />
                    <Skeleton className="h-6 w-28 rounded-md" />
                    <Skeleton className="h-2.5 w-32 rounded" />
                </div>
            ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
            <div className="lg:col-span-8 bg-canvas-subtle/80 rounded-xl p-4 space-y-3">
                <Skeleton className="h-4 w-40 rounded" />
                <Skeleton className="h-56 w-full rounded-lg" />
            </div>
            <div className="lg:col-span-4 bg-canvas-subtle/80 rounded-xl p-4 space-y-3">
                <Skeleton className="h-4 w-32 rounded" />
                <Skeleton className="h-56 w-full rounded-lg" />
            </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="bg-canvas-subtle/80 rounded-xl p-4 space-y-2.5">
                    <Skeleton className="h-3.5 w-28 rounded" />
                    <Skeleton className="h-32 w-full rounded-lg" />
                </div>
            ))}
        </div>
    </div>
);

export const ReportsSkeleton: React.FC = () => (
    <div className="w-full space-y-3 pb-10 animate-fade-in-up">
        <div className="bg-surface/80 rounded-xl p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
                <div className="flex items-center gap-3">
                    <Skeleton className="w-10 h-10 rounded-lg" />
                    <div className="space-y-1.5">
                        <Skeleton className="h-3 w-40 rounded" />
                        <Skeleton className="h-5 w-52 rounded" />
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Skeleton className="h-8 w-28 rounded-lg" />
                    <Skeleton className="h-8 w-20 rounded-lg" />
                </div>
            </div>
            <ReportsBodySkeleton />
        </div>
    </div>
);

/**
 * Technical Journal 2-column workspace skeleton.
 */
export const JournalSkeleton: React.FC = () => (
    <div className="w-full pb-8 animate-fade-in-up" role="status" aria-label={getCurrentLocale() === 'en' ? 'Loading technical journal' : 'Carregando diário técnico'}>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            <aside className="lg:col-span-4 xl:col-span-3 space-y-3">
                <Skeleton className="h-10 w-full rounded-xl" />
                <div className="flex gap-2">
                    <Skeleton className="h-9 flex-1 rounded-lg" />
                    <Skeleton className="h-9 w-24 rounded-lg" />
                </div>
                <div className="space-y-2.5">
                    {Array.from({ length: 6 }).map((_, idx) => (
                        <div key={idx} className="bg-surface/80 rounded-xl p-3.5 space-y-2">
                            <div className="flex items-center justify-between">
                                <Skeleton className="h-3.5 w-24 rounded" />
                                <Skeleton className="h-4 w-16 rounded" />
                            </div>
                            <Skeleton className="h-3 w-full rounded" />
                            <Skeleton className="h-3 w-2/3 rounded" />
                        </div>
                    ))}
                </div>
            </aside>

            <section className="lg:col-span-8 xl:col-span-9 space-y-3">
                <div className="bg-surface/80 rounded-xl p-5 space-y-4 min-h-[480px]">
                    <div className="flex items-center justify-between pb-3">
                        <div className="space-y-1.5">
                            <Skeleton className="h-5 w-48 rounded" />
                            <Skeleton className="h-3 w-32 rounded" />
                        </div>
                        <div className="flex gap-2">
                            <Skeleton className="h-8 w-24 rounded-lg" />
                            <Skeleton className="h-8 w-24 rounded-lg" />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                        {Array.from({ length: 4 }).map((_, i) => (
                            <Skeleton key={i} className="h-14 rounded-lg" />
                        ))}
                    </div>
                    <Skeleton className="h-64 w-full rounded-xl" />
                </div>
            </section>
        </div>
    </div>
);

/**
 * TradeDetails skeleton.
 */
export const TradeDetailsSkeleton: React.FC = () => (
    <div className="space-y-3 pb-8 animate-fade-in-up" role="status" aria-label={getCurrentLocale() === 'en' ? 'Loading trade details' : 'Carregando operação'}>
        <div className="bg-surface/80 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 rounded-lg" />
                <div className="space-y-1.5">
                    <Skeleton className="h-5 w-40 rounded" />
                    <Skeleton className="h-3 w-56 rounded" />
                </div>
            </div>
            <div className="flex items-center gap-2">
                <Skeleton className="h-8 w-28 rounded-lg" />
                <Skeleton className="h-8 w-28 rounded-lg" />
            </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
            <div className="lg:col-span-8 bg-surface/80 rounded-xl p-4 space-y-3">
                <Skeleton className="h-4 w-36 rounded" />
                <Skeleton className="h-[360px] w-full rounded-xl" />
            </div>
            <div className="lg:col-span-4 bg-surface/80 rounded-xl p-4 space-y-3">
                <Skeleton className="h-4 w-32 rounded" />
                {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-11 w-full rounded-lg" />
                ))}
            </div>
        </div>
    </div>
);

/**
 * Torex AI full-height chat workspace skeleton.
 */
export const TorexAiSkeleton: React.FC = () => (
    <div className="flex h-full w-full bg-canvas overflow-hidden animate-fade-in-up" role="status" aria-label="Carregando Torex AI">
        <div className="hidden md:flex w-64 shrink-0 bg-surface/60 p-3 flex-col gap-2.5">
            <Skeleton className="h-9 w-full rounded-lg" />
            <div className="space-y-2 mt-2">
                {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full rounded-lg" />
                ))}
            </div>
        </div>
        <div className="flex-1 flex flex-col justify-between p-4 sm:p-6 max-w-4xl mx-auto w-full">
            <div className="space-y-3 pt-8">
                <Skeleton className="h-7 w-56 mx-auto rounded-lg" />
                <Skeleton className="h-4 w-80 max-w-full mx-auto rounded" />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-6">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-16 rounded-xl" />
                    ))}
                </div>
            </div>
            <Skeleton className="h-14 w-full rounded-2xl" />
        </div>
    </div>
);

/**
 * Economic Calendar event groups skeleton.
 */
export const CalendarSkeleton: React.FC = () => (
    <div className="space-y-3 animate-fade-in-up" role="status" aria-label={getCurrentLocale() === 'en' ? 'Loading economic calendar' : 'Carregando calendário econômico'}>
        {Array.from({ length: 3 }).map((_, groupIdx) => (
            <div key={groupIdx} className="bg-surface/80 rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 bg-canvas-subtle flex items-center justify-between">
                    <Skeleton className="h-3.5 w-36 rounded" />
                    <Skeleton className="h-3.5 w-16 rounded" />
                </div>
                <div className="space-y-1">
                    {Array.from({ length: 4 }).map((__, rowIdx) => (
                        <div key={rowIdx} className="px-4 py-3 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                                <Skeleton className="h-4 w-12 rounded" />
                                <Skeleton className="h-5 w-10 rounded" />
                                <Skeleton className="h-4 w-48 sm:w-72 rounded" />
                            </div>
                            <div className="hidden sm:flex items-center gap-3">
                                <Skeleton className="h-4 w-14 rounded" />
                                <Skeleton className="h-4 w-14 rounded" />
                                <Skeleton className="h-4 w-14 rounded" />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        ))}
    </div>
);

/**
 * Configuration / Profile cards skeleton.
 */
export const ConfigurationSkeleton: React.FC = () => (
    <div className="w-full space-y-3 pb-10 animate-fade-in-up" role="status" aria-label={getCurrentLocale() === 'en' ? 'Loading settings' : 'Carregando configurações'}>
        {Array.from({ length: 3 }).map((_, idx) => (
            <div key={idx} className="bg-surface/80 rounded-xl p-5 space-y-4">
                <div className="space-y-1.5 pb-3">
                    <Skeleton className="h-4 w-40 rounded" />
                    <Skeleton className="h-3 w-64 rounded" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Skeleton className="h-10 w-full rounded-lg" />
                    <Skeleton className="h-10 w-full rounded-lg" />
                </div>
            </div>
        ))}
    </div>
);

/**
 * Dedicated Video Lesson Player skeleton.
 */
export const LessonPlayerSkeleton: React.FC = () => (
    <div className="space-y-4 pb-8 animate-fade-in-up" role="status" aria-label="Carregando aula">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-8 space-y-3">
                <Skeleton className="w-full aspect-video rounded-xl" />
                <div className="bg-surface/80 rounded-xl p-4 space-y-2.5">
                    <Skeleton className="h-5 w-2/3 rounded" />
                    <Skeleton className="h-3.5 w-1/3 rounded" />
                    <Skeleton className="h-16 w-full rounded-lg" />
                </div>
            </div>
            <div className="lg:col-span-4 bg-surface/80 rounded-xl p-4 space-y-2.5">
                <Skeleton className="h-4 w-36 rounded" />
                {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-14 w-full rounded-lg" />
                ))}
            </div>
        </div>
    </div>
);

/**
 * Fullscreen Backtest Replay Terminal skeleton.
 */
export const ReplayTerminalSkeleton: React.FC = () => (
    <div className="w-full h-screen bg-canvas flex flex-col overflow-hidden" role="status" aria-label="Preparando terminal de replay">
        <div className="h-11 bg-surface px-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
                <Skeleton className="h-7 w-24 rounded-md" />
                <Skeleton className="h-7 w-16 rounded-md" />
                <Skeleton className="h-7 w-28 rounded-md" />
            </div>
            <div className="flex items-center gap-2">
                <Skeleton className="h-7 w-32 rounded-md" />
                <Skeleton className="h-7 w-20 rounded-md" />
            </div>
        </div>
        <div className="flex-1 flex min-h-0">
            <div className="w-11 bg-surface/70 p-1.5 space-y-2 hidden sm:block">
                {Array.from({ length: 8 }).map((_, i) => (
                    <Skeleton key={i} className="h-7 w-full rounded-md" />
                ))}
            </div>
            <div className="flex-1 p-3 flex flex-col gap-2">
                <Skeleton className="flex-1 w-full rounded-xl" />
                <Skeleton className="h-12 w-72 mx-auto rounded-full" />
            </div>
        </div>
    </div>
);

/**
 * Pricing / Checkout standalone page skeleton.
 */
export const PricingSkeleton: React.FC = () => (
    <div className="min-h-screen bg-canvas px-4 py-12 animate-fade-in-up" role="status" aria-label="Carregando planos">
        <div className="max-w-6xl mx-auto space-y-8">
            <div className="text-center space-y-3">
                <Skeleton className="h-4 w-32 mx-auto rounded-full" />
                <Skeleton className="h-9 w-80 max-w-full mx-auto rounded-lg" />
                <Skeleton className="h-4 w-96 max-w-full mx-auto rounded" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
                {Array.from({ length: 3 }).map((_, idx) => (
                    <div key={idx} className="bg-surface/80 rounded-3xl p-7 space-y-5">
                        <Skeleton className="h-5 w-28 rounded" />
                        <Skeleton className="h-10 w-36 rounded-lg" />
                        <div className="space-y-2.5 pt-2">
                            {Array.from({ length: 6 }).map((__, fIdx) => (
                                <Skeleton key={fIdx} className="h-3.5 w-full rounded" />
                            ))}
                        </div>
                        <Skeleton className="h-11 w-full rounded-xl mt-4" />
                    </div>
                ))}
            </div>
        </div>
    </div>
);

/**
 * Standalone minimal page skeleton (for Checkout, CompleteProfile, AuthCallback, Legal, Admin lazy chunks).
 */
export const StandalonePageSkeleton: React.FC = () => (
    <div className="min-h-screen bg-canvas flex items-center justify-center p-4" role="status" aria-label={getCurrentLocale() === 'en' ? 'Loading page' : 'Carregando página'}>
        <div className="w-full max-w-lg bg-surface/80 rounded-2xl p-6 space-y-4">
            <Skeleton className="h-6 w-44 rounded-md" />
            <Skeleton className="h-3.5 w-64 rounded" />
            <div className="space-y-3 pt-2">
                <Skeleton className="h-11 w-full rounded-xl" />
                <Skeleton className="h-11 w-full rounded-xl" />
                <Skeleton className="h-11 w-full rounded-xl" />
            </div>
        </div>
    </div>
);

/**
 * Full AppShell Skeleton used while the lazy `AuthenticatedAppShell` chunk loads for the first time.
 * Preserves exact Sidebar + Header + Workspace proportions so transition into MainLayout is seamless.
 */
export const AppShellSkeleton: React.FC = () => {
    const location = useLocation();
    const isReplay = location.pathname.includes('/replay/');
    if (isReplay) {
        return <ReplayTerminalSkeleton />;
    }

    return (
        <div className="flex h-screen overflow-hidden bg-canvas font-sans text-fg">
            {/* Desktop Sidebar Skeleton */}
            <aside className="hidden md:flex w-60 shrink-0 bg-surface/80 flex-col justify-between p-3">
                <div className="space-y-4">
                    <div className="flex items-center gap-2.5 px-2 py-1.5">
                        <Skeleton className="w-7 h-7 rounded-lg" />
                        <Skeleton className="h-4 w-28 rounded" />
                    </div>
                    <div className="space-y-1.5 pt-2">
                        {Array.from({ length: 10 }).map((_, i) => (
                            <Skeleton key={i} className="h-9 w-full rounded-lg" />
                        ))}
                    </div>
                </div>
                <Skeleton className="h-12 w-full rounded-xl" />
            </aside>

            {/* Main Column */}
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                <header className="h-12 bg-canvas/95 px-3 sm:px-5 flex items-center justify-between shrink-0">
                    <Skeleton className="h-4 w-32 rounded" />
                    <div className="flex items-center gap-2">
                        <Skeleton className="h-8 w-24 rounded-lg hidden sm:block" />
                        <Skeleton className="h-8 w-36 rounded-lg" />
                        <Skeleton className="h-8 w-8 rounded-full" />
                    </div>
                </header>
                <div className="flex-1 overflow-y-auto p-3 sm:p-4 lg:px-5 lg:py-4">
                    <div className="w-full max-w-[1680px] mx-auto">
                        <RouteSkeletonResolver />
                    </div>
                </div>
            </div>
        </div>
    );
};

/**
 * Automatically selects the right geometric skeleton based on the active route inside MainLayout.
 */
export const RouteSkeletonResolver: React.FC = () => {
    const { pathname } = useLocation();

    if (pathname.includes('/replay/')) return <ReplayTerminalSkeleton />;
    if (pathname.endsWith('/dashboard') || pathname === '/') return <DashboardSkeleton />;
    if (pathname.includes('/torex-ai')) return <TorexAiSkeleton />;
    if (pathname.includes('/journal')) return <JournalSkeleton />;
    if (pathname.includes('/reports')) return <ReportsSkeleton />;
    if (pathname.match(/\/trades\/[^/]+$/)) return <TradeDetailsSkeleton />;
    if (pathname.includes('/trades') || pathname.includes('/leaderboard') || pathname.includes('/payments')) {
        return <TradesTableSkeleton />;
    }
    if (pathname.includes('/calendar')) return <CalendarSkeleton />;
    if (pathname.includes('/network/watch/')) return <LessonPlayerSkeleton />;
    if (pathname.includes('/configuration') || pathname.includes('/profile')) return <ConfigurationSkeleton />;

    return (
        <div className="space-y-3 pb-6 animate-fade-in-up" role="status" aria-label={getCurrentLocale() === 'en' ? 'Loading content' : 'Carregando conteúdo'}>
            <div className="flex items-center justify-between">
                <Skeleton className="h-5 w-44 rounded" />
                <Skeleton className="h-8 w-28 rounded-lg" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-28 rounded-xl" />
                ))}
            </div>
            <Skeleton className="h-72 w-full rounded-xl" />
        </div>
    );
};
