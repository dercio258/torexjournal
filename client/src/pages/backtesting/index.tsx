import { Navigate, useSearchParams } from 'react-router-dom';

export { BacktestingLayout } from './BacktestingLayout';
export { SessionsPage } from './SessionsPage';
export { NewSessionPage } from './NewSessionPage';
export { SessionDetailPage } from './SessionDetailPage';
export { StrategiesPage } from './StrategiesPage';
export { BacktestDashboardPage } from './BacktestDashboardPage';
export { StrategyJournalPage } from './StrategyJournalPage';
export { HypothesesPage } from './HypothesesPage';

/** Canonical /backtesting sub-routes */
export const backtestingRoutes = {
    sessions: '/backtesting/sessions',
    newSession: '/backtesting/sessions/new',
    sessionDetail: (id: string) => `/backtesting/sessions/${id}`,
    strategies: '/backtesting/strategies',
    analytics: '/backtesting/analytics',
    dashboard: '/backtesting/analytics',
    journal: '/backtesting/journal',
    hypotheses: '/backtesting/hypotheses',
    replay: (id: string) => `/backtesting/replay/${id}`,
};

/** Old single-page tabs (`/backtesting?tab=…`) map to the canonical routes. */
const LEGACY_TABS: Record<string, string> = {
    sessions: '/backtesting/sessions',
    new_session: '/backtesting/sessions/new',
    strategies: '/backtesting/strategies',
    dashboard: '/backtesting/analytics',
    analytics: '/backtesting/analytics',
    journal: '/backtesting/journal',
    what_if: '/backtesting/hypotheses',
};

export const BacktestingIndexRedirect = () => {
    const [params] = useSearchParams();
    return <Navigate to={LEGACY_TABS[params.get('tab') || ''] || '/backtesting/sessions'} replace />;
};
