import { useState } from 'react';
import { NavLink, Outlet, useNavigate, useSearchParams } from 'react-router-dom';
import { BookOpen, FolderKanban, Layers, LayoutGrid, Lightbulb, Plus, RefreshCw } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useAuth } from '../../context/AuthContext';
import { useLocale } from '../../context/LocaleContext';
import { BacktestWorkspaceProvider, useBacktestWorkspace } from './BacktestWorkspaceContext';
import { QuickSessionModal } from '../../components/backtesting/QuickSessionModal';
import { FeatureUpgradeGateCard } from '../../components/subscription/FeatureUpgradeGateCard';
import { isBasicPlanTier } from '../../lib/planGate';

const Nav = () => {
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const { sessions, strategies } = useBacktestWorkspace();
    const [params] = useSearchParams();
    const activeStrategy = params.get('strategy') || params.get('estrategia');
    const qs = activeStrategy ? `?strategy=${encodeURIComponent(activeStrategy)}` : '';

    const items = [
        { to: `/backtesting/sessions${qs}`, label: isEn ? 'Sessions' : 'Sessões', icon: <FolderKanban size={13} />, count: sessions.length },
        { to: '/backtesting/strategies', label: isEn ? 'Playbooks' : 'Estratégias', icon: <Layers size={13} />, count: strategies.length },
        { to: `/backtesting/analytics${qs}`, label: 'Analytics', icon: <LayoutGrid size={13} /> },
        { to: `/backtesting/journal${qs}`, label: isEn ? 'Journal' : 'Diário', icon: <BookOpen size={13} /> },
        { to: '/backtesting/hypotheses', label: isEn ? 'Hypotheses' : 'Hipóteses', icon: <Lightbulb size={13} /> },
    ];
    return (
        <nav
            aria-label={isEn ? 'Backtesting sections' : 'Secções do backtesting'}
            className="flex items-center gap-1 overflow-x-auto no-scrollbar bg-canvas-subtle border border-line-subtle p-1 rounded-lg max-w-full"
        >
            {items.map((it) => (
                <NavLink
                    key={it.to}
                    to={it.to}
                    className={({ isActive }) =>
                        cn(
                            'inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 h-7 text-xs font-semibold transition-colors focus-visible:outline-none',
                            isActive
                                ? 'bg-surface-2 text-fg border border-line'
                                : 'text-fg-muted hover:text-fg border border-transparent'
                        )
                    }
                >
                    {({ isActive }) => (
                        <>
                            <span aria-hidden className={isActive ? 'text-accent-fg' : 'text-fg-subtle'}>
                                {it.icon}
                            </span>
                            <span>{it.label}</span>
                            {it.count !== undefined && (
                                <span
                                    className={cn(
                                        'rounded px-1.5 py-0.5 text-[10px] tabular-nums leading-none',
                                        isActive
                                            ? 'bg-accent/15 text-accent-fg'
                                            : 'bg-surface-3 text-fg-subtle'
                                    )}
                                >
                                    {it.count}
                                </span>
                            )}
                        </>
                    )}
                </NavLink>
            ))}
        </nav>
    );
};

const SubHeader = () => {
    const navigate = useNavigate();
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const { isCloudSyncing, localDbStats } = useBacktestWorkspace();
    const [params] = useSearchParams();
    const [quickModalOpen, setQuickModalOpen] = useState(false);
    const activeStrategy = params.get('strategy') || params.get('estrategia');
    const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;

    const statusLabel = isCloudSyncing
        ? isEn
            ? 'Syncing…'
            : 'A sincronizar…'
        : isOffline || localDbStats.pendingOutboxCount > 0
          ? isEn
              ? `Offline (${localDbStats.pendingOutboxCount})`
              : `Offline (${localDbStats.pendingOutboxCount})`
          : isEn
            ? 'Cloud synced'
            : 'Guardado na nuvem';

    return (
        <>
            <div className="rounded-xl border border-line bg-surface p-2.5 sm:px-3.5 flex flex-wrap items-center justify-between gap-2.5">
                <Nav />
                <div className="flex shrink-0 items-center gap-2 ml-auto">
                    <div
                        className="hidden lg:inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-line-subtle bg-canvas-subtle text-[11px] font-medium text-fg-muted"
                        title={
                            localDbStats.pendingOutboxCount > 0
                                ? isEn
                                    ? `${localDbStats.pendingOutboxCount} session(s) queued in local offline outbox`
                                    : `${localDbStats.pendingOutboxCount} sessão(ões) aguardando rede na fila local`
                                : isEn
                                  ? `Local Cache: ${localDbStats.totalCachedCandles.toLocaleString('en-US')} bars in ${localDbStats.candleBatchesCount} batches · Cloud synced`
                                  : `Cache Local: ${localDbStats.totalCachedCandles.toLocaleString('pt-BR')} velas em ${localDbStats.candleBatchesCount} lotes · Sincronizado na nuvem`
                        }
                    >
                        {isCloudSyncing ? (
                            <RefreshCw size={11} className="animate-spin text-accent-fg shrink-0" />
                        ) : (
                            <span
                                className={cn(
                                    'w-1.5 h-1.5 rounded-full shrink-0',
                                    isOffline || localDbStats.pendingOutboxCount > 0
                                        ? 'bg-amber-500'
                                        : 'bg-emerald-500'
                                )}
                            />
                        )}
                        <span>{statusLabel}</span>
                    </div>
                    <button
                        type="button"
                        onClick={() => navigate('/backtesting/strategies?new=1')}
                        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-canvas-subtle hover:bg-surface-2 border border-line text-xs font-semibold text-fg transition-colors cursor-pointer"
                    >
                        <Layers size={13} className="text-fg-muted" />
                        <span>{isEn ? 'New Playbook' : 'Nova estratégia'}</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => setQuickModalOpen(true)}
                        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-accent hover:opacity-95 text-xs font-semibold text-accent-on transition-opacity cursor-pointer"
                    >
                        <Plus size={14} />
                        <span>{isEn ? 'New Session' : 'Nova sessão'}</span>
                    </button>
                </div>
            </div>
            <QuickSessionModal
                open={quickModalOpen}
                initialStrategyId={activeStrategy}
                onClose={() => setQuickModalOpen(false)}
            />
        </>
    );
};

/** Shell for every /backtesting page except the full-screen replay terminal. */
export const BacktestingLayout = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const isBasic = isBasicPlanTier(user?.tier);

    if (isBasic) {
        return (
            <FeatureUpgradeGateCard
                featureKey="backtesting_workspace"
                title="Backtesting & Trade Replay exclusivos dos Planos Pro e Premium"
                titleEn="Backtesting & Trade Replay Require Pro or Premium"
                description="No plano Básico não é possível criar sessões de backteste nem abrir o terminal de Trade Replay. Atualize seu plano para desbloquear backtesting institucional completo."
                descriptionEn="Basic plan accounts cannot create backtest sessions or open the Trade Replay terminal. Upgrade your plan to unlock institutional backtesting."
                bullets={[
                    'Plano Pro: 10 sessões de backteste/mês + Trade Replay',
                    'Plano Premium: 100 sessões automáticas/mês + prioridade',
                    'Teste de estratégias e playbooks ilimitados',
                    'Analytics, diário visual candle a candle e hipóteses',
                ]}
                bulletsEn={[
                    'Pro Plan: 10 backtesting runs / month + Trade Replay',
                    'Premium Plan: 100 automated runs / month + priority',
                    'Test unlimited strategies & playbooks',
                    'Candle-by-candle Replay Journal & Analytics',
                ]}
                onBack={() => navigate('/dashboard')}
                backLabel="Voltar à Dashboard"
                backLabelEn="Back to Dashboard"
            />
        );
    }

    return (
        <BacktestWorkspaceProvider>
            <div className="w-full space-y-3 pb-8">
                <SubHeader />
                <Outlet />
            </div>
        </BacktestWorkspaceProvider>
    );
};
