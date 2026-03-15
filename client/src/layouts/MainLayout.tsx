import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from '../components/Sidebar';
import { ChatWidget } from '../components/network/ChatWidget';
import { useAuth } from '../context/AuthContext';
import { PlanRequiredOverlay } from '../components/subscription/PlanRequiredOverlay';
import { OnboardingSurvey } from '../components/onboarding/OnboardingSurvey';
import { Menu } from 'lucide-react';

export const MainLayout = () => {
    const { user, isLoading } = useAuth();
    const hasNoPlan = user && (!user.tier || user.tier === 'FREE');
    const showOnboarding = user && user.onboardingCompleted === false;
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);

    if (isLoading) {
        return (
            <div className="flex h-screen items-center justify-center bg-slate-950">
                <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
        );
    }

    return (
        <div className="flex h-screen overflow-hidden bg-slate-950 font-sans text-slate-100 pb-16 md:pb-0">
            {hasNoPlan && <PlanRequiredOverlay />}
            {showOnboarding && <OnboardingSurvey onComplete={() => {}} />}

            {/* Mobile Header */}
            <div className="md:hidden fixed top-0 left-0 w-full h-16 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-4 z-40">
                <div className="flex items-center gap-2">
                    <img src="https://res.cloudinary.com/dndlqdylc/image/upload/v1769335429/Touro_design_1_beuv9b.png" alt="Logo" className="w-6 h-6 object-contain" />
                    <span className="font-bold text-lg tracking-tight text-slate-100">
                        TOREX <span className="text-emerald-400">JOURNAL</span>
                    </span>
                </div>
                <button onClick={() => setIsSidebarOpen(true)} className="p-2 text-slate-400 hover:text-white bg-slate-800 rounded-lg">
                    <Menu size={24} />
                </button>
            </div>

            {/* Backdrop */}
            {isSidebarOpen && (
                <div className="md:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-40" onClick={() => setIsSidebarOpen(false)} />
            )}

            {/* Sidebar Wrapper */}
            <div className={`fixed inset-y-0 left-0 transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:relative md:translate-x-0 transition-transform duration-300 ease-in-out z-50 h-full`}>
                <Sidebar onClose={() => setIsSidebarOpen(false)} />
            </div>

            <main className="flex-1 flex flex-col min-h-0 overflow-hidden relative pt-16 md:pt-0">
                {/* Background Gradients */}
                <div className="absolute top-0 left-0 w-full h-96 bg-gradient-to-b from-emerald-900/10 to-transparent pointer-events-none" />

                <div className="flex-1 overflow-y-auto p-4 md:p-8 scroll-smooth z-0">
                    <div className="max-w-7xl mx-auto space-y-6">
                        <Outlet />
                    </div>
                </div>

                {/* Global Chat Widget */}
                <ChatWidget />
            </main>
        </div>
    );
};
