import { useState } from 'react';
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, Users, CreditCard, DollarSign, LogOut, Menu, X, MessageSquare, Smartphone, Calendar } from 'lucide-react';
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
        { path: '/admin/calendar', label: 'Calendário Econômico', icon: Calendar },
        { path: '/admin/users', label: 'Usuários', icon: Users },
        { path: '/admin/notifications', label: 'Notificações', icon: MessageSquare },
        { path: '/admin/whatsapp', label: 'WhatsApp Bot', icon: Smartphone },
        { path: '/admin/finance', label: 'Financeiro', icon: DollarSign },
        { path: '/admin/plans', label: 'Planos', icon: CreditCard },
    ];

    return (
        <div className="min-h-screen bg-canvas flex">
            {/* Sidebar */}
            <aside
                className={`fixed inset-y-0 left-0 z-50 w-64 bg-surface border-r border-line transition-transform duration-300 transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
                    } lg:translate-x-0 lg:static`}
            >
                <div className="h-full flex flex-col">
                    <div className="p-6 border-b border-line flex justify-between items-center">
                        <span className="text-xl font-bold text-fg">Admin<span className="text-red-500">Panel</span></span>
                        <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden text-fg-muted">
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
                                            : 'text-fg-muted hover:bg-surface-2 hover:text-fg'
                                        }`}
                                >
                                    <Icon size={20} />
                                    <span className="font-medium">{item.label}</span>
                                </Link>
                            );
                        })}
                    </nav>

                    <div className="p-4 border-t border-line">
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
                <div className="lg:hidden p-4 border-b border-line bg-surface flex items-center gap-4">
                    <button onClick={() => setIsSidebarOpen(true)} className="text-fg">
                        <Menu />
                    </button>
                    <span className="font-bold text-fg">Admin Panel</span>
                </div>
                <div className="p-6 lg:p-8 max-w-7xl mx-auto">
                    <Outlet />
                </div>
            </main>
        </div>
    );
};
