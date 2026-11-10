import { Navigate, useSearchParams } from 'react-router-dom';

export { BacktestingLayout } from './BacktestingLayout';
export { SessionsPage } from './SessionsPage';
export { NewSessionPage } from './NewSessionPage';
export { SessionDetailPage } from './SessionDetailPage';
export { StrategiesPage } from './StrategiesPage';
export { BacktestDashboardPage } from './BacktestDashboardPage';
export { HypothesesPage } from './HypothesesPage';

/** Old single-page tabs (`/backtesting?tab=…`) map to the new routes. */
const LEGACY_TABS: Record<string, string> = {
    sessions: '/backtesting/sessions',
    new_session: '/backtesting/sessions/new',
    strategies: '/backtesting/strategies',
    dashboard: '/backtesting/dashboard',
    what_if: '/backtesting/hypotheses',
};

export const BacktestingIndexRedirect = () => {
    const [params] = useSearchParams();
    return <Navigate to={LEGACY_TABS[params.get('tab') || ''] || '/backtesting/sessions'} replace />;
};
