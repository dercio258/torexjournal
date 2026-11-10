import { useState, useEffect } from 'react';
import { Outlet, useLocation, Navigate } from 'react-router-dom';
import { Sidebar } from '../components/Sidebar';
import { WhatsAppSupportWidget } from '../components/support/WhatsAppSupportWidget';
import { useAuth } from '../context/AuthContext';
import { PlanRequiredOverlay } from '../components/subscription/PlanRequiredOverlay';
import { OnboardingSurvey } from '../components/onboarding/OnboardingSurvey';
import { AccountManagerModal } from '../components/account/AccountManagerModal';
import { Header } from '../components/Header';

export const MainLayout = () => {
    const { user, isLoading } = useAuth();
    const location = useLocation();
    const isPaymentsPage = location.pathname === '/payments' || location.pathname === '/pricing';
    const isBacktestPage = location.pathname.includes('/replay/');
    const hasNoPlan = user && (!user.tier || user.tier === 'FREE') && !isPaymentsPage;
    const showOnboarding = user && user.onboardingCompleted === false;
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [isBacktestFullscreen, setIsBacktestFullscreen] = useState(false);

    // Auto-collapse sidebar whenever entering /backtest and reset fullscreen when leaving
    useEffect(() => {
        if (isBacktestPage) {
            setIsSidebarOpen(false);
        } else {
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

    if (isLoading) {
        return (
            <div className="flex h-screen items-center justify-center bg-canvas ">
                <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
        );
    }

    // Se o usuário já utilizou o período de teste e não possui plano ativo, redirecionar para a página de preços
    if (hasNoPlan && user?.hasUsedTrial && location.pathname !== '/pricing' && location.pathname !== '/payments') {
        return <Navigate to="/pricing" replace />;
    }

    return (
        <div className="flex h-screen overflow-hidden bg-canvas font-sans text-fg transition-colors duration-200 selection:bg-emerald-500/20">
            {hasNoPlan && <PlanRequiredOverlay />}
            {showOnboarding && <OnboardingSurvey onComplete={() => {}} />}
            <AccountManagerModal />

            {/* Backdrop for drawer (mobile or when collapsed on /backtest) */}
            {!isBacktestFullscreen && isSidebarOpen && (
                <div
                    className={`${isBacktestPage ? '' : 'md:hidden '}fixed inset-0 bg-black/70 backdrop-blur-sm z-40`}
                    onClick={() => setIsSidebarOpen(false)}
                />
            )}

            {/* Sidebar Wrapper: completely hidden when in fullscreen or collapsed on /backtest */}
            {!isBacktestFullscreen && (
                <div
                    className={
                        isBacktestPage
                            ? `fixed inset-y-0 left-0 transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} transition-transform duration-300 ease-in-out z-50 h-full shrink-0`
                            : `fixed inset-y-0 left-0 transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:static md:translate-x-0 md:transform-none transition-transform duration-300 ease-in-out z-50 h-full shrink-0`
                    }
                >
                    <Sidebar onClose={() => setIsSidebarOpen(false)} />
                </div>
            )}

            <main className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
                {/* Header hidden completely when Backtest is maximized */}
                {!isBacktestFullscreen && (
                    <Header onOpenSidebar={() => setIsSidebarOpen(prev => !prev)} isSidebarCollapsed={isBacktestPage} />
                )}

                {/* Subtle Ambient Glow */}
                {!isBacktestFullscreen && (
                    <div className="absolute top-0 left-0 w-full h-80 bg-gradient-to-b from-emerald-500/[0.03] to-transparent pointer-events-none" />
                )}

                <div
                    className={`flex-1 scroll-smooth ${
                        isBacktestFullscreen
                            ? 'p-0 overflow-hidden'
                            : isBacktestPage
                                ? 'p-2 sm:p-3 overflow-y-auto'
                                : 'p-4 sm:p-6 md:p-8 overflow-y-auto'
                    }`}
                >
                    <div
                        className={`w-full mx-auto ${
                            isBacktestFullscreen
                                ? 'max-w-full h-full'
                                : isBacktestPage
                                    ? 'max-w-full space-y-2'
                                    : 'max-w-[1680px] space-y-5'
                        }`}
                    >
                        {hasNoPlan ? null : <Outlet />}
                    </div>
                </div>

                {/* Floating WhatsApp Support Button (hidden when Backtest is maximized) */}
                {!isBacktestFullscreen && <WhatsAppSupportWidget />}
            </main>
        </div>
    );
};
