import { Outlet } from 'react-router-dom';
import { TrendingUp } from 'lucide-react';

export const AuthLayout = () => {
    return (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 relative overflow-hidden">
            {/* Background Effects */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] bg-emerald-500/5 rounded-full blur-3xl" />
                <div className="absolute top-[20%] -right-[10%] w-[50%] h-[50%] bg-blue-500/5 rounded-full blur-3xl" />
            </div>

            <div className="w-full max-w-md relative z-10">
                <div className="flex justify-center mb-8">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
                            <TrendingUp className="text-white w-6 h-6" />
                        </div>
                        <span className="font-bold text-2xl tracking-tight text-slate-100">
                            TOREX<span className="text-emerald-400">JOURNAL</span>
                        </span>
                    </div>
                </div>
                <Outlet />
            </div>
        </div>
    );
};
