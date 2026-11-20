import { lazy, Suspense, useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { initOfflineSyncEngine } from './services/syncEngine';
import { initPwaManager, hasSeenStandaloneWelcome, isStandaloneMode } from './lib/pwaManager';
import { WebsitePwaPrompt } from './components/pwa/WebsitePwaPrompt';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { LocaleRouter } from './context/LocaleContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { GuestRoute } from './components/GuestRoute';
import {
    AppShellSkeleton,
    PricingSkeleton,
    StandalonePageSkeleton,
} from './components/ui/Skeleton';

// Core Public Entry Pages (kept eager for instantaneous zero-latency public & auth entry)
import { Landing } from './pages/Landing';
import { LandingEn } from './pages/LandingEn';
import { Login } from './pages/Login';
import { Register } from './pages/Register';

// Shared QueryClient imported from ./lib/queryClient so AuthContext can clear it on logout/switch.

const ReactQueryDevtoolsLazy = import.meta.env.DEV
    ? lazy(() =>
          import('@tanstack/react-query-devtools').then(m => ({
              default: m.ReactQueryDevtools,
          }))
      )
    : null;

// Lazy Secondary Public & Auth Pages
const VerifyAccount = lazy(() => import('./pages/VerifyAccount').then(m => ({ default: m.VerifyAccount })));
const TwoFactorVerify = lazy(() => import('./pages/TwoFactorVerify').then(m => ({ default: m.TwoFactorVerify })));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword').then(m => ({ default: m.ForgotPassword })));
const AuthCallback = lazy(() => import('./pages/AuthCallback').then(m => ({ default: m.AuthCallback })));
const PwaStandaloneWelcome = lazy(() => import('./components/pwa/PwaStandaloneWelcome'));

// Lazy Legal Pages
const LegalHub = lazy(() => import('./pages/legal/LegalHub').then(m => ({ default: m.LegalHub })));
const Terms = lazy(() => import('./pages/legal/Terms').then(m => ({ default: m.Terms })));
const Privacy = lazy(() => import('./pages/legal/Privacy').then(m => ({ default: m.Privacy })));
const RiskDisclosure = lazy(() => import('./pages/legal/RiskDisclosure').then(m => ({ default: m.RiskDisclosure })));
const RefundPolicy = lazy(() => import('./pages/legal/RefundPolicy').then(m => ({ default: m.RefundPolicy })));
const Cookies = lazy(() => import('./pages/legal/Cookies').then(m => ({ default: m.Cookies })));

// Lazy Standalone Protected Pages
const CompleteProfile = lazy(() => import('./pages/CompleteProfile').then(m => ({ default: m.CompleteProfile })));
const Pricing = lazy(() => import('./pages/Pricing').then(m => ({ default: m.Pricing })));
const Checkout = lazy(() => import('./pages/Checkout').then(m => ({ default: m.Checkout })));
const SubscriptionSuccess = lazy(() =>
    import('./pages/SubscriptionSuccess').then(m => ({ default: m.SubscriptionSuccess }))
);

// Lazy Admin Suite (completely isolated from regular users & public visitors)
const AdminLogin = lazy(() => import('./pages/admin/AdminLogin').then(m => ({ default: m.AdminLogin })));
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout').then(m => ({ default: m.AdminLayout })));
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard').then(m => ({ default: m.AdminDashboard })));
const AdminAnalytics = lazy(() => import('./pages/admin/AdminAnalytics').then(m => ({ default: m.AdminAnalytics })));
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers').then(m => ({ default: m.AdminUsers })));
const AdminFinance = lazy(() => import('./pages/admin/AdminFinance').then(m => ({ default: m.AdminFinance })));
const AdminPlans = lazy(() => import('./pages/admin/AdminPlans').then(m => ({ default: m.AdminPlans })));
const AdminLessons = lazy(() => import('./pages/admin/AdminLessons').then(m => ({ default: m.AdminLessons })));

// Lazy Authenticated Workspace Shell (mounts SocketProvider + AccountProvider + MainLayout ONLY for logged-in workspace)
const AuthenticatedAppShell = lazy(() =>
    import('./layouts/AuthenticatedAppShell').then(m => ({ default: m.AuthenticatedAppShell }))
);

// Lazy Protected Workspace Pages
const Dashboard = lazy(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })));
const DashboardEn = lazy(() => import('./pages/DashboardEn').then(m => ({ default: m.DashboardEn })));
const Journal = lazy(() => import('./pages/Journal').then(m => ({ default: m.Journal })));
const TorexAi = lazy(() => import('./pages/TorexAi').then(m => ({ default: m.TorexAi })));
const Payments = lazy(() => import('./pages/Payments').then(m => ({ default: m.Payments })));
const Configuration = lazy(() => import('./pages/Configuration').then(m => ({ default: m.Configuration })));
const Profile = lazy(() => import('./pages/Profile').then(m => ({ default: m.Profile })));
const Trades = lazy(() => import('./pages/Trades').then(m => ({ default: m.Trades })));
const TradeDetails = lazy(() => import('./pages/TradeDetails').then(m => ({ default: m.TradeDetails })));
const EconomicCalendar = lazy(() => import('./pages/EconomicCalendar'));
const Notifications = lazy(() => import('./pages/Notifications').then(m => ({ default: m.Notifications })));
const Network = lazy(() => import('./pages/Network').then(m => ({ default: m.Network })));
const NetworkLessonPlayer = lazy(() =>
    import('./pages/NetworkLessonPlayer').then(m => ({ default: m.NetworkLessonPlayer }))
);
const Reports = lazy(() => import('./pages/Reports').then(m => ({ default: m.Reports })));
const Leaderboard = lazy(() => import('./pages/Leaderboard').then(m => ({ default: m.Leaderboard })));

// Lazy Add-Trades Module
const AddTradesLayout = lazy(() => import('./pages/add-trades').then(m => ({ default: m.AddTradesLayout })));
const AddTradesHubPage = lazy(() => import('./pages/add-trades').then(m => ({ default: m.AddTradesHubPage })));
const DerivSyncPage = lazy(() => import('./pages/add-trades').then(m => ({ default: m.DerivSyncPage })));
const Mt5SyncPage = lazy(() => import('./pages/add-trades').then(m => ({ default: m.Mt5SyncPage })));
const Mt5EaSyncPage = lazy(() => import('./pages/add-trades').then(m => ({ default: m.Mt5EaSyncPage })));
const ManualImportPage = lazy(() => import('./pages/add-trades').then(m => ({ default: m.ManualImportPage })));
const ImportHistoryPage = lazy(() => import('./pages/add-trades').then(m => ({ default: m.ImportHistoryPage })));

// Lazy Backtesting & Replay Suite
const BacktestReplaySessionPage = lazy(() =>
    import('./pages/BacktestReplaySessionPage').then(m => ({ default: m.BacktestReplaySessionPage }))
);
const BacktestingLayout = lazy(() => import('./pages/backtesting').then(m => ({ default: m.BacktestingLayout })));
const BacktestingIndexRedirect = lazy(() =>
    import('./pages/backtesting').then(m => ({ default: m.BacktestingIndexRedirect }))
);
const SessionsPage = lazy(() => import('./pages/backtesting').then(m => ({ default: m.SessionsPage })));
const NewSessionPage = lazy(() => import('./pages/backtesting').then(m => ({ default: m.NewSessionPage })));
const SessionDetailPage = lazy(() => import('./pages/backtesting').then(m => ({ default: m.SessionDetailPage })));
const StrategiesPage = lazy(() => import('./pages/backtesting').then(m => ({ default: m.StrategiesPage })));
const BacktestDashboardPage = lazy(() =>
    import('./pages/backtesting').then(m => ({ default: m.BacktestDashboardPage }))
);
const StrategyJournalPage = lazy(() =>
    import('./pages/backtesting').then(m => ({ default: m.StrategyJournalPage }))
);
const HypothesesPage = lazy(() => import('./pages/backtesting').then(m => ({ default: m.HypothesesPage })));

const LegacyReplayRedirect = () => {
    const { sessionId } = useParams<{ sessionId: string }>();
    const location = useLocation();
    return (
        <Navigate
            to={`/backtesting/replay/${sessionId || ''}${location.search}`}
            replace
        />
    );
};

function App() {
    useEffect(() => {
        initOfflineSyncEngine(queryClient);
        initPwaManager();
    }, []);

    return (
        <QueryClientProvider client={queryClient}>
            <ThemeProvider>
                <AuthProvider>
                    <LocaleRouter>
                        <Routes>
                            {/* Fast Public Marketing Entry (PT on / and /pt, dedicated EN on /en via LocaleRouter) */}
                            <Route path="/" element={<Landing />} />
                            <Route path="/pt" element={<Landing locale="pt" />} />
                            <Route path="/en" element={<LandingEn />} />

                            {/* Legal Pages */}
                            <Route
                                path="/legal"
                                element={
                                    <Suspense fallback={<StandalonePageSkeleton />}>
                                        <LegalHub />
                                    </Suspense>
                                }
                            />
                            <Route
                                path="/terms"
                                element={
                                    <Suspense fallback={<StandalonePageSkeleton />}>
                                        <Terms />
                                    </Suspense>
                                }
                            />
                            <Route
                                path="/privacy"
                                element={
                                    <Suspense fallback={<StandalonePageSkeleton />}>
                                        <Privacy />
                                    </Suspense>
                                }
                            />
                            <Route
                                path="/risk-disclosure"
                                element={
                                    <Suspense fallback={<StandalonePageSkeleton />}>
                                        <RiskDisclosure />
                                    </Suspense>
                                }
                            />
                            <Route
                                path="/refund-policy"
                                element={
                                    <Suspense fallback={<StandalonePageSkeleton />}>
                                        <RefundPolicy />
                                    </Suspense>
                                }
                            />
                            <Route
                                path="/cookies"
                                element={
                                    <Suspense fallback={<StandalonePageSkeleton />}>
                                        <Cookies />
                                    </Suspense>
                                }
                            />

                            {/* Guest Routes (Redirect to Dashboard if logged in) */}
                            <Route
                                path="/login"
                                element={
                                    <GuestRoute>
                                        <Login />
                                    </GuestRoute>
                                }
                            />
                            <Route
                                path="/register"
                                element={
                                    <GuestRoute>
                                        <Register />
                                    </GuestRoute>
                                }
                            />
                            <Route
                                path="/verify-account"
                                element={
                                    <GuestRoute>
                                        <Suspense fallback={<StandalonePageSkeleton />}>
                                            <VerifyAccount />
                                        </Suspense>
                                    </GuestRoute>
                                }
                            />
                            <Route
                                path="/forgot-password"
                                element={
                                    <GuestRoute>
                                        <Suspense fallback={<StandalonePageSkeleton />}>
                                            <ForgotPassword />
                                        </Suspense>
                                    </GuestRoute>
                                }
                            />
                            <Route
                                path="/2fa"
                                element={
                                    <GuestRoute>
                                        <Suspense fallback={<StandalonePageSkeleton />}>
                                            <TwoFactorVerify />
                                        </Suspense>
                                    </GuestRoute>
                                }
                            />
                            <Route
                                path="/auth/callback"
                                element={
                                    <Suspense fallback={<StandalonePageSkeleton />}>
                                        <AuthCallback />
                                    </Suspense>
                                }
                            />
                            <Route
                                path="/app-welcome"
                                element={
                                    <Suspense fallback={<StandalonePageSkeleton />}>
                                        <PwaStandaloneWelcome />
                                    </Suspense>
                                }
                            />

                            {/* Protected Standalone Routes */}
                            <Route
                                path="/complete-profile"
                                element={
                                    <ProtectedRoute>
                                        <Suspense fallback={<StandalonePageSkeleton />}>
                                            <CompleteProfile />
                                        </Suspense>
                                    </ProtectedRoute>
                                }
                            />
                            <Route
                                path="/pricing"
                                element={
                                    <Suspense fallback={<PricingSkeleton />}>
                                        <Pricing />
                                    </Suspense>
                                }
                            />
                            <Route
                                path="/checkout"
                                element={
                                    <ProtectedRoute>
                                        <Suspense fallback={<StandalonePageSkeleton />}>
                                            <Checkout />
                                        </Suspense>
                                    </ProtectedRoute>
                                }
                            />
                            <Route
                                path="/subscription/success"
                                element={
                                    <ProtectedRoute>
                                        <Suspense fallback={<StandalonePageSkeleton />}>
                                            <SubscriptionSuccess />
                                        </Suspense>
                                    </ProtectedRoute>
                                }
                            />

                            {/* Admin Routes */}
                            <Route
                                path="/admin"
                                element={
                                    <Suspense fallback={<StandalonePageSkeleton />}>
                                        <AdminLogin />
                                    </Suspense>
                                }
                            />
                            <Route
                                path="/admin/login"
                                element={
                                    <Suspense fallback={<StandalonePageSkeleton />}>
                                        <AdminLogin />
                                    </Suspense>
                                }
                            />
                            <Route
                                element={
                                    <Suspense fallback={<StandalonePageSkeleton />}>
                                        <AdminLayout />
                                    </Suspense>
                                }
                            >
                                <Route path="/admin/dashboard" element={<AdminDashboard />} />
                                <Route path="/admin/analytics" element={<AdminAnalytics />} />
                                <Route path="/admin/lessons" element={<AdminLessons />} />
                                <Route path="/admin/users" element={<AdminUsers />} />
                                <Route path="/admin/finance" element={<AdminFinance />} />
                                <Route path="/admin/plans" element={<AdminPlans />} />
                                <Route path="/admin/calendar" element={<Navigate to="/admin/dashboard" replace />} />
                                <Route path="/admin/*" element={<Navigate to="/admin/dashboard" replace />} />
                            </Route>

                            {/* Protected App Routes (With Sidebar/Header + Smooth Route Skeletons) */}
                            <Route
                                element={
                                    <ProtectedRoute>
                                        <Suspense fallback={<AppShellSkeleton />}>
                                            <AuthenticatedAppShell />
                                        </Suspense>
                                    </ProtectedRoute>
                                }
                            >
                                <Route path="/dashboard" element={<Dashboard />} />
                                <Route path="/dashboard-en" element={<DashboardEn />} />
                                <Route path="/torex-ai/:sessionId?" element={<TorexAi />} />
                                <Route path="/profile" element={<Profile />} />
                                <Route path="/journal" element={<Journal />} />
                                <Route path="/leaderboard" element={<Leaderboard />} />
                                <Route path="/payments" element={<Payments />} />
                                <Route path="/configuration" element={<Configuration />} />
                                <Route path="/network" element={<Network />} />
                                <Route path="/network/watch/:lessonId" element={<NetworkLessonPlayer />} />
                                <Route path="/add-trades" element={<AddTradesLayout />}>
                                    <Route index element={<AddTradesHubPage />} />
                                    <Route path="deriv-sync" element={<DerivSyncPage />} />
                                    <Route path="deriv" element={<Navigate to="/add-trades/deriv-sync" replace />} />
                                    <Route path="mt5-sync" element={<Mt5SyncPage />} />
                                    <Route path="mt5" element={<Navigate to="/add-trades/mt5-sync" replace />} />
                                    <Route path="mt5-ea" element={<Mt5EaSyncPage />} />
                                    <Route path="ea-sync" element={<Navigate to="/add-trades/mt5-ea" replace />} />
                                    <Route path="import" element={<ManualImportPage />} />
                                    <Route path="file-import" element={<Navigate to="/add-trades/import" replace />} />
                                    <Route path="manual" element={<Navigate to="/add-trades/import" replace />} />
                                    <Route path="history" element={<ImportHistoryPage />} />
                                    <Route path="*" element={<Navigate to="/add-trades" replace />} />
                                </Route>
                                <Route path="/emotional" element={<Navigate to="/journal" replace />} />
                                <Route path="/emotional/share" element={<Navigate to="/journal" replace />} />
                                <Route path="/calendar" element={<EconomicCalendar />} />
                                <Route path="/notifications" element={<Notifications />} />
                                <Route path="/reports" element={<Reports />} />
                                <Route path="/trades" element={<Trades />} />
                                <Route path="/trades/:id" element={<TradeDetails />} />
                                {/* Backtesting: hub pages share a layout; the replay terminal is full-width */}
                                <Route path="/backtest" element={<Navigate to="/backtesting/sessions" replace />} />
                                <Route path="/backtest/replay/:sessionId" element={<LegacyReplayRedirect />} />
                                <Route path="/backtesting/replay/:sessionId" element={<BacktestReplaySessionPage />} />
                                <Route path="/backtesting" element={<BacktestingLayout />}>
                                    <Route index element={<BacktestingIndexRedirect />} />
                                    <Route path="sessions" element={<SessionsPage />} />
                                    <Route path="sessions/new" element={<NewSessionPage />} />
                                    <Route path="sessions/:sessionId" element={<SessionDetailPage />} />
                                    <Route path="strategies" element={<StrategiesPage />} />
                                    <Route path="analytics" element={<BacktestDashboardPage />} />
                                    <Route path="dashboard" element={<Navigate to="/backtesting/analytics" replace />} />
                                    <Route path="journal" element={<StrategyJournalPage />} />
                                    <Route path="hypotheses" element={<HypothesesPage />} />
                                    <Route path="*" element={<Navigate to="/backtesting/sessions" replace />} />
                                </Route>
                            </Route>

                            {/* Fallback */}
                            <Route path="*" element={<Navigate to="/dashboard" replace />} />
                        </Routes>
                        <PwaRuntimeBridge />
                        <DevtoolsMount />
                    </LocaleRouter>
                </AuthProvider>
            </ThemeProvider>
        </QueryClientProvider>
    );
}

function PwaRuntimeBridge() {
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const [showStandaloneWelcome, setShowStandaloneWelcome] = useState<boolean>(
        () => isStandaloneMode() && !hasSeenStandaloneWelcome(),
    );

    useEffect(() => {
        if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
        const onMessage = (event: MessageEvent) => {
            if (event.data?.type === 'TOREX_PUSH_NAVIGATE' && typeof event.data.url === 'string') {
                const targetUrl = event.data.url.startsWith('/') ? event.data.url : '/dashboard';
                navigate(targetUrl);
            }
        };
        navigator.serviceWorker.addEventListener('message', onMessage);
        return () => navigator.serviceWorker.removeEventListener('message', onMessage);
    }, [navigate]);

    const lower = pathname.toLowerCase();
    const isExcluded = lower.startsWith('/admin') || lower === '/app-welcome' || lower === '/verify-account';

    return (
        <>
            {!isExcluded && showStandaloneWelcome && (
                <Suspense fallback={null}>
                    <PwaStandaloneWelcome onContinue={() => setShowStandaloneWelcome(false)} />
                </Suspense>
            )}
            <WebsitePwaPrompt />
        </>
    );
}

function DevtoolsMount() {
    const { pathname } = useLocation();
    if (!ReactQueryDevtoolsLazy || pathname.startsWith('/backtesting/replay')) {
        return null;
    }
    return (
        <Suspense fallback={null}>
            <ReactQueryDevtoolsLazy initialIsOpen={false} />
        </Suspense>
    );
}

export default App;
