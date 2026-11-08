import { useState } from 'react';
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
    const hasNoPlan = user && (!user.tier || user.tier === 'FREE') && !isPaymentsPage;
    const showOnboarding = user && user.onboardingCompleted === false;
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);

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

            {/* Backdrop for mobile drawer */}
            {isSidebarOpen && (
                <div className="md:hidden fixed inset-0 bg-black/70 backdrop-blur-sm z-40" onClick={() => setIsSidebarOpen(false)} />
            )}

            {/* Sidebar Wrapper (fixed drawer on mobile, static sidebar on desktop) */}
            <div className={`fixed inset-y-0 left-0 transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:static md:translate-x-0 md:transform-none transition-transform duration-300 ease-in-out z-50 h-full shrink-0`}>
                <Sidebar onClose={() => setIsSidebarOpen(false)} />
            </div>

            <main className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
                {/* Fixed, Robust Header Aligned with Sidebar */}
                <Header onOpenSidebar={() => setIsSidebarOpen(true)} />

                {/* Subtle Ambient Glow */}
                <div className="absolute top-0 left-0 w-full h-80 bg-gradient-to-b from-emerald-500/[0.03] to-transparent pointer-events-none" />

                <div className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8 scroll-smooth z-0">
                    <div className="w-full max-w-[1680px] mx-auto space-y-5">
                        {hasNoPlan ? null : <Outlet />}
                    </div>
                </div>

                {/* Floating WhatsApp Support Button */}
                <WhatsAppSupportWidget />
            </main>
        </div>
    );
};
