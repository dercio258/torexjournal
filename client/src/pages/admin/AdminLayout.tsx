import { useState } from 'react';
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, Users, CreditCard, DollarSign, LogOut, Menu, X } from 'lucide-react';
import { Button } from '../../components/ui/Button';

export const AdminLayout = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);

    const handleLogout = () => {
        localStorage.removeItem('adminToken');
        navigate('/admin');
    };

    const navItems = [
        { path: '/admin/dashboard', label: 'Visão Geral', icon: LayoutDashboard },
        { path: '/admin/users', label: 'Usuários', icon: Users },
        { path: '/admin/finance', label: 'Financeiro', icon: DollarSign },
        { path: '/admin/plans', label: 'Planos', icon: CreditCard },
    ];

    return (
        <div className="min-h-screen bg-slate-950 flex">
            {/* Sidebar */}
            <aside
                className={`fixed inset-y-0 left-0 z-50 w-64 bg-slate-900 border-r border-slate-800 transition-transform duration-300 transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
                    } lg:translate-x-0 lg:static`}
            >
                <div className="h-full flex flex-col">
                    <div className="p-6 border-b border-slate-800 flex justify-between items-center">
                        <span className="text-xl font-bold text-white">Admin<span className="text-red-500">Panel</span></span>
                        <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden text-slate-400">
                            <X />
                        </button>
                    </div>

                    <nav className="flex-1 p-4 space-y-1">
                        {navItems.map((item) => {
                            const Icon = item.icon;
                            const isActive = location.pathname === item.path;
                            return (
                                <Link
                                    key={item.path}
                                    to={item.path}
                                    className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${isActive
                                            ? 'bg-red-500/10 text-red-500'
                                            : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                                        }`}
                                >
                                    <Icon size={20} />
                                    <span className="font-medium">{item.label}</span>
                                </Link>
                            );
                        })}
                    </nav>

                    <div className="p-4 border-t border-slate-800">
                        <Button
                            variant="secondary"
                            onClick={handleLogout}
                            className="w-full flex items-center justify-center gap-2"
                        >
                            <LogOut size={16} /> Sair
                        </Button>
                    </div>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 min-w-0 overflow-auto">
                <div className="lg:hidden p-4 border-b border-slate-800 bg-slate-900 flex items-center gap-4">
                    <button onClick={() => setIsSidebarOpen(true)} className="text-white">
                        <Menu />
                    </button>
                    <span className="font-bold text-white">Admin Panel</span>
                </div>
                <div className="p-6 lg:p-8 max-w-7xl mx-auto">
                    <Outlet />
                </div>
            </main>
        </div>
    );
};
