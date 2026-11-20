import { useEffect, useMemo, useState } from 'react';
import { Outlet, Link, Navigate, useNavigate, useLocation } from 'react-router-dom';
import {
    LayoutDashboard,
    Users,
    CreditCard,
    DollarSign,
    LogOut,
    Menu,
    X,
    Video,
    BarChart3,
    ShieldCheck,
    Sun,
    Moon,
    ExternalLink,
    CalendarClock,
    ChevronRight,
    Server,
} from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { useTheme } from '../../context/ThemeContext';
import { cn } from '../../lib/cn';
import { isValidAdminToken } from '../../lib/adminAuth';

interface NavDomain {
    domain: string;
    items: Array<{
        path: string;
        label: string;
        description: string;
        icon: typeof LayoutDashboard;
    }>;
}

const ADMIN_DOMAINS: NavDomain[] = [
    {
        domain: 'Governança & Inteligência',
        items: [
            {
                path: '/admin/dashboard',
                label: 'Visão Estrutural',
                description: 'KPIs, MT5 Auto-Sync & Filas',
                icon: LayoutDashboard,
            },
            {
                path: '/admin/mt5-telemetry',
                label: 'Telemetria MT5',
                description: 'Status anonimizado, workers & feedback',
                icon: Server,
            },
            {
                path: '/admin/analytics',
                label: 'Analytics & UTMs',
                description: 'Tráfego, atribuição & pixels',
                icon: BarChart3,
            },
        ],
    },
    {
        domain: 'Clientes & Receita',
        items: [
            {
                path: '/admin/users',
                label: 'Usuários & Acessos',
                description: 'Contas, planos & atribuição',
                icon: Users,
            },
            {
                path: '/admin/plans',
                label: 'Planos & Trial',
                description: 'Preços, limites & campanha',
                icon: CreditCard,
            },
            {
                path: '/admin/finance',
                label: 'Financeiro & MRR',
                description: 'Receita, pagamentos & retenção',
                icon: DollarSign,
            },
        ],
    },
    {
        domain: 'Conteúdo & Academia',
        items: [
            {
                path: '/admin/lessons',
                label: 'Academia & Aulas',
                description: 'Catálogo de videoaulas',
                icon: Video,
            },
        ],
    },
];

// Admin JWT check is centralized in ../../lib/adminAuth (isValidAdminToken)

export const AdminLayout = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { theme, toggleTheme } = useTheme();
    const [isMobileOpen, setIsMobileOpen] = useState(false);

    useEffect(() => {
        setIsMobileOpen(false);
    }, [location.pathname]);

    const currentRouteMeta = useMemo(() => {
        for (const group of ADMIN_DOMAINS) {
            const match = group.items.find((i) => location.pathname === i.path || location.pathname.startsWith(`${i.path}/`));
            if (match) return { domain: group.domain, item: match };
        }
        return {
            domain: 'Governança & Inteligência',
            item: ADMIN_DOMAINS[0].items[0],
        };
    }, [location.pathname]);

    if (!isValidAdminToken()) {
        return <Navigate to="/admin/login" replace />;
    }

    const handleLogout = () => {
        localStorage.removeItem('adminToken');
        navigate('/admin/login', { replace: true });
    };

    const renderNavContent = () => (
        <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
                <Link to="/admin/dashboard" className="flex items-center gap-2.5 group">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/15 border border-accent/25 text-accent-fg">
                        <ShieldCheck className="h-5 w-5" />
                    </div>
                    <div className="leading-tight">
                        <div className="text-sm font-bold text-fg tracking-tight">
                            Torex<span className="text-accent-fg">Admin</span>
                        </div>
                        <div className="text-[10px] font-medium uppercase tracking-wider text-fg-subtle">
                            Command Center
                        </div>
                    </div>
                </Link>
                <button
                    type="button"
                    onClick={() => setIsMobileOpen(false)}
                    className="lg:hidden rounded-lg p-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg transition-colors"
                    aria-label="Fechar menu"
                >
                    <X className="h-5 w-5" />
                </button>
            </div>

            <nav className="flex-1 overflow-y-auto px-3.5 py-4 space-y-5">
                {ADMIN_DOMAINS.map((group) => (
                    <div key={group.domain} className="space-y-1.5">
                        <div className="px-2.5 text-[10px] font-bold uppercase tracking-wider text-fg-subtle">
                            {group.domain}
                        </div>
                        <div className="space-y-1">
                            {group.items.map((item) => {
                                const Icon = item.icon;
                                const isActive =
                                    location.pathname === item.path ||
                                    location.pathname.startsWith(`${item.path}/`);
                                return (
                                    <Link
                                        key={item.path}
                                        to={item.path}
                                        className={cn(
                                            'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all border',
                                            isActive
                                                ? 'border-accent/25 bg-accent/10 text-accent-fg font-semibold shadow-sm'
                                                : 'border-transparent text-fg-muted hover:bg-surface-2 hover:text-fg',
                                        )}
                                    >
                                        <Icon
                                            className={cn(
                                                'h-4 w-4 shrink-0 transition-colors',
                                                isActive ? 'text-accent-fg' : 'text-fg-subtle group-hover:text-fg',
                                            )}
                                        />
                                        <div className="min-w-0 flex-1">
                                            <div className="truncate leading-tight">{item.label}</div>
                                            <div className="truncate text-[10px] text-fg-subtle font-normal mt-0.5">
                                                {item.description}
                                            </div>
                                        </div>
                                        {isActive && <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-70" />}
                                    </Link>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </nav>

            <div className="border-t border-line p-3.5 space-y-2.5 bg-surface-2/40">
                <Link
                    to="/calendar"
                    className="flex items-center justify-between rounded-xl border border-line bg-surface px-3 py-2 text-xs text-fg-muted hover:border-accent/30 hover:text-fg transition-colors"
                >
                    <span className="flex items-center gap-2 font-medium">
                        <CalendarClock className="h-3.5 w-3.5 text-accent-fg" />
                        Calendário MT5 Auto
                    </span>
                    <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" title="Automatizado via MT5" />
                </Link>

                <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleLogout}
                    fullWidth
                    icon={<LogOut className="h-3.5 w-3.5" />}
                >
                    Encerrar Sessão
                </Button>
            </div>
        </div>
    );

    return (
        <div className="min-h-screen bg-canvas text-fg flex">
            {/* Desktop Sidebar */}
            <aside className="hidden lg:flex lg:w-64 lg:shrink-0 lg:flex-col lg:sticky lg:top-0 lg:h-screen bg-surface border-r border-line">
                {renderNavContent()}
            </aside>

            {/* Mobile Drawer + Backdrop */}
            {isMobileOpen && (
                <div className="fixed inset-0 z-50 flex lg:hidden">
                    <div
                        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
                        onClick={() => setIsMobileOpen(false)}
                        aria-hidden
                    />
                    <aside className="relative z-10 w-72 max-w-[85vw] bg-surface border-r border-line shadow-panel h-full">
                        {renderNavContent()}
                    </aside>
                </div>
            )}

            {/* Main Content */}
            <div className="flex-1 min-w-0 flex flex-col">
                <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur-md">
                    <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
                        <div className="flex items-center gap-3 min-w-0">
                            <button
                                type="button"
                                onClick={() => setIsMobileOpen(true)}
                                className="lg:hidden rounded-lg border border-line bg-surface-2 p-2 text-fg hover:bg-surface-3 transition-colors"
                                aria-label="Abrir navegação administrativa"
                            >
                                <Menu className="h-4 w-4" />
                            </button>
                            <div className="flex items-center gap-2 text-xs text-fg-muted min-w-0">
                                <span className="hidden sm:inline font-medium text-fg-subtle truncate">
                                    {currentRouteMeta.domain}
                                </span>
                                <ChevronRight className="hidden sm:inline h-3.5 w-3.5 text-fg-subtle shrink-0" />
                                <span className="font-semibold text-fg truncate">
                                    {currentRouteMeta.item.label}
                                </span>
                            </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                            <Link
                                to="/dashboard"
                                className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-fg-muted hover:text-fg hover:border-line-strong transition-colors"
                            >
                                Plataforma
                                <ExternalLink className="h-3 w-3" />
                            </Link>

                            <button
                                type="button"
                                onClick={toggleTheme}
                                className="inline-flex items-center justify-center rounded-lg border border-line bg-surface-2 p-2 text-fg-muted hover:text-fg hover:border-line-strong transition-colors"
                                title={theme === 'dark' ? 'Alternar para modo claro' : 'Alternar para modo escuro'}
                                aria-label="Alternar tema"
                            >
                                {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                            </button>

                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleLogout}
                                className="sm:hidden"
                                icon={<LogOut className="h-4 w-4" />}
                                aria-label="Sair"
                            />
                        </div>
                    </div>
                </header>

                <main className="flex-1 min-w-0">
                    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
                        <Outlet />
                    </div>
                </main>
            </div>
        </div>
    );
};
