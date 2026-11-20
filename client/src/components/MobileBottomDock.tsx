import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
    BarChart3,
    BookOpen,
    CalendarDays,
    FlaskConical,
    Gift,
    LayoutDashboard,
    Plus,
    Sparkles,
    Trophy,
    Upload,
    Users,
    X,
} from 'lucide-react';
import { useLocale } from '../context/LocaleContext';
import { cn } from '../lib/cn';

const CandlestickHighlightIcon: React.FC<{ className?: string; size?: number }> = ({
    className,
    size = 18,
}) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        aria-hidden="true"
    >
        {/* Left Bullish Candle */}
        <line x1="7" y1="3" x2="7" y2="7" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        <rect x="4.75" y="7" width="4.5" height="9" rx="1.2" fill="currentColor" fillOpacity="0.92" />
        <line x1="7" y1="16" x2="7" y2="20.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        {/* Right Accent Candle */}
        <line x1="17" y1="4.5" x2="17" y2="9" stroke="#34d399" strokeWidth="1.9" strokeLinecap="round" />
        <rect x="14.75" y="9" width="4.5" height="7.5" rx="1.2" fill="#34d399" />
        <line x1="17" y1="16.5" x2="17" y2="21" stroke="#34d399" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
);

export const MobileBottomDock: React.FC = () => {
    const location = useLocation();
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const [moreOpen, setMoreOpen] = useState(false);

    useEffect(() => {
        setMoreOpen(false);
    }, [location.pathname, location.search]);

    const path = location.pathname;
    const isOnDashboard = path === '/dashboard' || path === '/en/dashboard' || path === '/';
    const isOnBacktesting = path.startsWith('/backtesting');
    const isOnTrades = path.startsWith('/trades');
    const isOnAi = path.startsWith('/torex-ai');
    const isOnJournal = path.startsWith('/journal');

    // Slot 1 swaps between Dashboard & Backteste:
    // While on Dashboard -> shortcut goes directly to Backteste; on Backtesting or elsewhere -> returns to Dashboard.
    const slot1 = isOnDashboard
        ? {
              to: '/backtesting/sessions',
              label: isEn ? 'Backtest' : 'Backteste',
              icon: FlaskConical,
              active: isOnBacktesting,
          }
        : {
              to: '/dashboard',
              label: 'Dashboard',
              icon: LayoutDashboard,
              active: false,
          };

    // Slot 5 swaps to featured Candlesticks Trades when Slot 1 is Backteste or user is already in Backtesting.
    const useTradesInSlot5 = isOnDashboard || isOnBacktesting;

    const moreSecondaryLinks = [
        {
            to: '/reports',
            label: isEn ? 'Reports' : 'Relatórios',
            icon: BarChart3,
            active: path.startsWith('/reports'),
        },
        {
            to: '/economic-calendar',
            label: isEn ? 'Calendar' : 'Calendário Econ.',
            icon: CalendarDays,
            active: path.startsWith('/economic-calendar'),
        },
        {
            to: '/add-trades',
            label: isEn ? 'Import' : 'Importar Trades',
            icon: Upload,
            active: path.startsWith('/add-trades'),
        },
        {
            to: '/leaderboard',
            label: 'Leaderboard',
            icon: Trophy,
            active: path.startsWith('/leaderboard'),
        },
        {
            to: '/network',
            label: isEn ? 'Community' : 'Comunidade',
            icon: Users,
            active: path.startsWith('/network'),
        },
        {
            to: '/profile',
            label: isEn ? 'Affiliates' : 'Afiliados',
            icon: Gift,
            active: path.startsWith('/profile'),
        },
    ];

    return (
        <>
            {moreOpen && (
                <>
                    <div
                        className="md:hidden fixed inset-0 z-[64] bg-canvas/60 backdrop-blur-sm animate-fade-in"
                        onClick={() => setMoreOpen(false)}
                        aria-hidden="true"
                    />
                    <div
                        role="dialog"
                        aria-label={isEn ? 'More tools' : 'Mais ferramentas'}
                        className="md:hidden fixed inset-x-3 bottom-[5rem] z-[66] mx-auto max-w-md rounded-2xl border border-line/60 bg-surface/92 backdrop-blur-2xl p-3.5 shadow-2xl space-y-3 animate-fade-in-up"
                    >
                        <div className="flex items-center justify-between px-0.5">
                            <span className="text-[11px] font-bold uppercase tracking-wider text-fg-subtle">
                                {isEn ? 'More Tools' : 'Mais Ferramentas'}
                            </span>
                            <button
                                type="button"
                                onClick={() => setMoreOpen(false)}
                                className="p-1 rounded-lg text-fg-subtle hover:text-fg hover:bg-surface-2 cursor-pointer"
                                aria-label={isEn ? 'Close' : 'Fechar'}
                            >
                                <X size={15} />
                            </button>
                        </div>

                        {/* Highlighted Trades History Card with Candlesticks */}
                        <Link
                            to="/trades"
                            className={cn(
                                'flex items-center justify-between gap-3 rounded-xl border p-3 transition-all',
                                isOnTrades
                                    ? 'border-emerald-400/50 bg-emerald-500/15'
                                    : 'border-accent/35 bg-gradient-to-r from-accent/15 via-surface-2/70 to-emerald-500/10 hover:border-accent/60',
                            )}
                        >
                            <div className="flex items-center gap-3 min-w-0">
                                <div className="h-10 w-10 rounded-xl bg-accent/20 border border-accent/40 flex items-center justify-center text-accent-fg shrink-0">
                                    <CandlestickHighlightIcon size={21} />
                                </div>
                                <div className="min-w-0">
                                    <div className="text-xs font-bold text-fg flex items-center gap-1.5">
                                        <span>{isEn ? 'Trade History' : 'Histórico de Operações'}</span>
                                        <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-400">
                                            Trades
                                        </span>
                                    </div>
                                    <p className="text-[10.5px] text-fg-muted truncate">
                                        {isEn
                                            ? 'Inspect executions, MFE/MAE & candle replays'
                                            : 'Analise execuções, velas e detalhes de cada operação'}
                                    </p>
                                </div>
                            </div>
                        </Link>

                        {/* Grid of Remaining Tools */}
                        <div className="grid grid-cols-3 gap-2">
                            {moreSecondaryLinks.map((item) => {
                                const Icon = item.icon;
                                return (
                                    <Link
                                        key={item.to}
                                        to={item.to}
                                        className={cn(
                                            'flex flex-col items-center justify-center gap-1.5 rounded-xl border px-2 py-2.5 text-center transition-colors',
                                            item.active
                                                ? 'border-accent/45 bg-accent/15 text-accent-fg'
                                                : 'border-line/60 bg-canvas-subtle/75 text-fg-muted hover:text-fg hover:bg-surface-2',
                                        )}
                                    >
                                        <Icon size={17} />
                                        <span className="text-[10.5px] font-semibold leading-tight line-clamp-1">
                                            {item.label}
                                        </span>
                                    </Link>
                                );
                            })}
                        </div>
                    </div>
                </>
            )}

            <nav
                aria-label={isEn ? 'Mobile bottom navigation' : 'Barra de navegação móvel'}
                className="md:hidden fixed inset-x-0 bottom-0 z-[65] px-2.5 pb-[max(0.45rem,env(safe-area-inset-bottom))] pt-1 pointer-events-none"
            >
                <div className="pointer-events-auto mx-auto max-w-md rounded-2xl border border-line/50 bg-canvas/65 dark:bg-canvas/55 backdrop-blur-2xl shadow-[0_8px_32px_rgba(0,0,0,0.34)] px-1.5 py-1.5 grid grid-cols-5 items-center gap-0.5">
                    {/* Slot 1: Contextual Dashboard <-> Backteste */}
                    <Link
                        to={slot1.to}
                        className={cn(
                            'flex flex-col items-center justify-center gap-0.5 py-1 rounded-xl transition-colors',
                            slot1.active ? 'text-accent-fg bg-accent/10' : 'text-fg-muted hover:text-fg',
                        )}
                    >
                        <slot1.icon size={17} />
                        <span className="text-[10px] font-semibold leading-none tracking-tight truncate max-w-full px-0.5">
                            {slot1.label}
                        </span>
                    </Link>

                    {/* Slot 2: IA Coach */}
                    <Link
                        to="/torex-ai"
                        className={cn(
                            'flex flex-col items-center justify-center gap-0.5 py-1 rounded-xl transition-colors',
                            isOnAi ? 'text-accent-fg bg-accent/10' : 'text-fg-muted hover:text-fg',
                        )}
                    >
                        <Sparkles size={17} />
                        <span className="text-[10px] font-semibold leading-none tracking-tight truncate max-w-full px-0.5">
                            {isEn ? 'AI Coach' : 'IA Coach'}
                        </span>
                    </Link>

                    {/* Slot 3: Center Highlighted "+ Mais" */}
                    <button
                        type="button"
                        onClick={() => setMoreOpen((prev) => !prev)}
                        aria-expanded={moreOpen}
                        className="flex flex-col items-center justify-center gap-0.5 -mt-3.5 focus:outline-none cursor-pointer group"
                    >
                        <span
                            className={cn(
                                'flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-tr from-accent to-emerald-400 text-accent-on shadow-lg shadow-accent/30 ring-2 ring-canvas/75 transition-transform duration-200',
                                moreOpen && 'rotate-45 scale-95',
                            )}
                        >
                            <Plus size={19} strokeWidth={2.5} />
                        </span>
                        <span
                            className={cn(
                                'text-[10px] font-bold leading-none',
                                moreOpen ? 'text-accent-fg' : 'text-fg',
                            )}
                        >
                            {isEn ? 'More' : 'Mais'}
                        </span>
                    </button>

                    {/* Slot 4: Diário */}
                    <Link
                        to="/journal"
                        className={cn(
                            'flex flex-col items-center justify-center gap-0.5 py-1 rounded-xl transition-colors',
                            isOnJournal ? 'text-accent-fg bg-accent/10' : 'text-fg-muted hover:text-fg',
                        )}
                    >
                        <BookOpen size={17} />
                        <span className="text-[10px] font-semibold leading-none tracking-tight truncate max-w-full px-0.5">
                            {isEn ? 'Journal' : 'Diário'}
                        </span>
                    </Link>

                    {/* Slot 5: Backteste (default) or Highlighted Candlesticks Trades (when Slot 1 = Backteste or on Backtesting) */}
                    {useTradesInSlot5 ? (
                        <Link
                            to="/trades"
                            className={cn(
                                'flex flex-col items-center justify-center gap-0.5 py-1 rounded-xl transition-colors',
                                isOnTrades
                                    ? 'text-emerald-400 bg-emerald-500/15'
                                    : 'text-emerald-400/90 hover:text-emerald-300',
                            )}
                        >
                            <CandlestickHighlightIcon size={18} />
                            <span className="text-[10px] font-bold leading-none tracking-tight truncate max-w-full px-0.5">
                                Trades
                            </span>
                        </Link>
                    ) : (
                        <Link
                            to="/backtesting/sessions"
                            className={cn(
                                'flex flex-col items-center justify-center gap-0.5 py-1 rounded-xl transition-colors',
                                isOnBacktesting ? 'text-accent-fg bg-accent/10' : 'text-fg-muted hover:text-fg',
                            )}
                        >
                            <FlaskConical size={17} />
                            <span className="text-[10px] font-semibold leading-none tracking-tight truncate max-w-full px-0.5">
                                {isEn ? 'Backtest' : 'Backteste'}
                            </span>
                        </Link>
                    )}
                </div>
            </nav>
        </>
    );
};
