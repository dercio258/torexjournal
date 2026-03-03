import { Outlet } from 'react-router-dom';
import { Sidebar } from '../components/Sidebar';
import { ChatWidget } from '../components/network/ChatWidget'; // Import

export const MainLayout = () => {
    return (
        <div className="flex h-screen overflow-hidden bg-slate-950 font-sans text-slate-100">
            <Sidebar />
            <main className="flex-1 flex flex-col h-screen overflow-hidden relative">
                {/* Background Gradients */}
                <div className="absolute top-0 left-0 w-full h-96 bg-gradient-to-b from-emerald-900/10 to-transparent pointer-events-none" />

                <div className="flex-1 overflow-y-auto p-8 scroll-smooth z-0">
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
