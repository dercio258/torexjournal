import { useState, useEffect, Suspense } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Sidebar } from '../components/Sidebar';
import { MobileBottomDock } from '../components/MobileBottomDock';
import { useAuth } from '../context/AuthContext';
import { DashboardFilterProvider } from '../context/DashboardFilterContext';
import { WorkspacePricingModal } from '../components/subscription/WorkspacePricingModal';
import { OnboardingSurvey } from '../components/onboarding/OnboardingSurvey';
import { AccountManagerModal } from '../components/account/AccountManagerModal';
import { Header } from '../components/Header';
import { RouteSkeletonResolver } from '../components/ui/Skeleton';

export const MainLayout = () => {
    const { user, isLoading } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();
    const isBacktestPage = location.pathname.includes('/replay/');
    const isTorexAiPage = location.pathname.startsWith('/torex-ai');
    const isJournalPage = location.pathname.startsWith('/journal');
    const showOnboarding = !isLoading && user && user.onboardingCompleted === false;
    const [isPlansModalOpen, setIsPlansModalOpen] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [isDesktopCollapsed, setIsDesktopCollapsed] = useState<boolean>(() => {
        try {
            return localStorage.getItem('torex_sidebar_collapsed') === 'true';
        } catch {
            return false;
        }
    });
    const [isBacktestFullscreen, setIsBacktestFullscreen] = useState(false);

    const toggleDesktopCollapse = () => {
        setIsDesktopCollapsed(prev => {
            const next = !prev;
            try {
                localStorage.setItem('torex_sidebar_collapsed', String(next));
            } catch {
                // ignore storage errors
            }
            return next;
        });
    };

    // Auto-collapse drawer on route navigation (mobile UX) and reset fullscreen outside replay
    useEffect(() => {
        setIsSidebarOpen(false);
        if (!isBacktestPage) {
            setIsBacktestFullscreen(false);
        }
    }, [isBacktestPage, location.pathname]);

    // Listen to Backtest Terminal Fullscreen toggle to hide Header, Sidebar & Widgets completely
    useEffect(() => {
        const handler = (e: Event) => {
            const custom = e as CustomEvent<{ isFullscreen: boolean }>;
            setIsBacktestFullscreen(Boolean(custom.detail?.isFullscreen));
            if (custom.detail?.isFullscreen) {
                setIsSidebarOpen(false);
            }
        };
        window.addEventListener('cossa:backtest-fullscreen', handler);
        return () => window.removeEventListener('cossa:backtest-fullscreen', handler);
    }, []);

    // Open centered plans modal via ?plans=1 query param or custom event
    useEffect(() => {
        const params = new URLSearchParams(location.search);
        if (params.get('plans') === '1') {
            setIsPlansModalOpen(true);
        }
    }, [location.search]);

    useEffect(() => {
        const openHandler = () => setIsPlansModalOpen(true);
        window.addEventListener('torex:open-plans-modal', openHandler);
        return () => window.removeEventListener('torex:open-plans-modal', openHandler);
    }, []);

    const handleClosePlansModal = () => {
        setIsPlansModalOpen(false);
        const params = new URLSearchParams(location.search);
        if (params.has('plans')) {
            params.delete('plans');
            const cleanSearch = params.toString();
            navigate(`${location.pathname}${cleanSearch ? `?${cleanSearch}` : ''}`, { replace: true });
        }
    };

    return (
        <DashboardFilterProvider>
            <div className="flex h-screen overflow-hidden bg-canvas font-sans text-fg transition-colors duration-200 selection:bg-accent/20">
                <WorkspacePricingModal
                    isOpen={isPlansModalOpen && !showOnboarding}
                    dismissible={true}
                    hasActivePlan={true}
                    onClose={handleClosePlansModal}
                    trialEligible={Boolean(user?.trialEligible)}
                />
                {showOnboarding && <OnboardingSurvey onComplete={() => {}} />}
                <AccountManagerModal />

                {/* Backdrop for drawer (mobile or when collapsed on /backtest) */}
                {!isBacktestFullscreen && isSidebarOpen && (
                    <div
                        className={`${isBacktestPage ? '' : 'md:hidden '}fixed inset-0 bg-canvas/75 backdrop-blur-sm z-[70]`}
                        onClick={() => setIsSidebarOpen(false)}
                    />
                )}

                {/* Sidebar Wrapper: completely hidden when in fullscreen or collapsed on /backtest */}
                {!isBacktestFullscreen && (
                    <div
                        className={
                            isBacktestPage
                                ? `fixed inset-y-0 left-0 transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} transition-transform duration-300 ease-in-out z-[75] h-full shrink-0`
                                : `fixed inset-y-0 left-0 transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:static md:translate-x-0 md:transform-none transition-transform duration-300 ease-in-out z-[75] h-full shrink-0`
                        }
                    >
                        <Sidebar
                            onClose={() => setIsSidebarOpen(false)}
                            collapsed={!isSidebarOpen && isDesktopCollapsed}
                            onToggleCollapse={toggleDesktopCollapse}
                        />
                    </div>
                )}

                <main className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
                    {/* Desktop: Header hidden on /backtesting/replay; Mobile: keep Header accessible */}
                    {!isBacktestFullscreen && (
                        <div className={isBacktestPage ? 'md:hidden' : ''}>
                            <Header
                                onOpenSidebar={() => setIsSidebarOpen(prev => !prev)}
                                isSidebarCollapsed={isBacktestPage}
                            />
                        </div>
                    )}

                    <div
                        className={`flex-1 min-h-0 scroll-smooth ${
                            isBacktestFullscreen || isBacktestPage || isTorexAiPage
                                ? 'p-0 overflow-hidden'
                                : isJournalPage
                                ? 'p-3 sm:p-4 lg:px-5 lg:py-4 pb-24 md:pb-4 overflow-y-auto lg:overflow-hidden'
                                : 'p-3 sm:p-4 lg:px-5 lg:py-4 pb-24 md:pb-4 overflow-y-auto'
                        }`}
                    >
                        <div
                            className={`w-full mx-auto ${
                                isBacktestFullscreen || isBacktestPage || isTorexAiPage
                                    ? 'max-w-full h-full'
                                    : isJournalPage
                                    ? 'max-w-[1680px] space-y-3 lg:space-y-0 lg:h-full lg:min-h-0 lg:flex lg:flex-col'
                                    : 'max-w-[1680px] space-y-3'
                            }`}
                        >
                            {isLoading && !user ? (
                                <RouteSkeletonResolver />
                            ) : (
                                <Suspense fallback={<RouteSkeletonResolver />}>
                                    <Outlet />
                                </Suspense>
                            )}
                        </div>
                    </div>

                    {!isBacktestFullscreen && <MobileBottomDock />}
                </main>
            </div>
        </DashboardFilterProvider>
    );
};
