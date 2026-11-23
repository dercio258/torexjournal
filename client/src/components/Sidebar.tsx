import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { NavLink } from 'react-router-dom';
import {
    LayoutGrid,
    CandlestickChart,
    BookOpen,
    TrendingUp,
    CalendarDays,
    FlaskConical,
    Users,
    Trophy,
    X,
    PanelLeftClose,
    PanelLeftOpen,
    Sparkles,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useLocale } from '../context/LocaleContext';
import { cn } from '../lib/cn';
import { isBasicPlanTier, openWorkspacePlansModal } from '../lib/planGate';
import { BasicPlanSimpleUpgradeCard } from './subscription/BasicPlanSimpleUpgradeCard';
import { UpgradeBadge } from './subscription/UpgradeBadge';

const DevelopmentModal = ({
    featureName,
    onClose,
    isEn,
}: {
    featureName: string;
    onClose: () => void;
    isEn: boolean;
}) => {
    let description = isEn
        ? 'This module is currently being calibrated for your trading desk and will roll out soon.'
        : 'Esta funcionalidade está sendo preparada com muito cuidado e estará disponível em breve para turbinar as suas análises.';
    if (featureName === 'Relatórios' || featureName === 'Reports') {
        description = isEn
            ? 'Advanced Reports will deliver executive performance charts, drawdown duration curves, equity attribution, and consistency scoring.'
            : 'O sistema de Relatórios Avançados trará gráficos executivos de desempenho, análise de drawdown, curva de capital detalhada e estatísticas de consistência.';
    } else if (featureName === 'Calendário Econ.' || featureName === 'Economic Calendar') {
        description = isEn
            ? 'The Smart Economic Calendar keeps you ahead of high-impact macro releases directly inside your trading workspace.'
            : 'O Calendário Econômico Inteligente manterá você atualizado sobre todos os eventos macroeconômicos de alto impacto diretamente integrados ao seu painel.';
    }

    return createPortal(
        <div
            className="fixed inset-0 bg-canvas/80 backdrop-blur-md z-[9999] flex items-center justify-center p-4 animate-in fade-in duration-200"
            onClick={onClose}
        >
            <div
                className="bg-surface border border-line p-6 sm:p-8 rounded-panel max-w-md w-full shadow-panel relative overflow-hidden flex flex-col items-center text-center animate-in zoom-in-95 duration-200"
                onClick={e => e.stopPropagation()}
            >
                <div className="absolute -top-12 -left-12 w-32 h-32 bg-warning/10 rounded-full blur-2xl pointer-events-none" />
                <div className="absolute -bottom-12 -right-12 w-32 h-32 bg-accent/10 rounded-full blur-2xl pointer-events-none" />

                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 p-2 rounded-xl text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors"
                    title={isEn ? 'Close' : 'Fechar'}
                >
                    <X size={18} />
                </button>

                <div className="w-14 h-14 rounded-2xl bg-warning/10 border border-warning/20 flex items-center justify-center text-warning mb-5">
                    <Sparkles size={26} />
                </div>

                <h3 className="text-lg sm:text-xl font-bold text-fg mb-2">
                    {isEn ? `${featureName} in Development` : `${featureName} em Desenvolvimento`}
                </h3>

                <p className="text-xs sm:text-sm text-fg-muted leading-relaxed mb-6 max-w-xs">{description}</p>

                <button
                    onClick={onClose}
                    className="w-full bg-accent hover:bg-accent-hover text-accent-on font-bold py-3 px-6 rounded-xl transition-all shadow-glow active:scale-95 text-xs sm:text-sm"
                >
                    {isEn ? 'Got it' : 'Entendido, até breve!'}
                </button>
            </div>
        </div>,
        document.body
    );
};

interface SidebarProps {
    onClose?: () => void;
    collapsed?: boolean;
    onToggleCollapse?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
    onClose,
    collapsed = false,
    onToggleCollapse,
}) => {
    const { user } = useAuth();
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const [devFeature, setDevFeature] = useState<string | null>(null);

    const isBasic = isBasicPlanTier(user?.tier);

    const links = isEn
        ? [
              { to: '/dashboard', icon: <LayoutGrid size={15} />, label: 'Dashboard' },
              { to: '/torex-ai', icon: <Sparkles size={15} />, label: 'Torex AI' },
              { to: '/trades', icon: <CandlestickChart size={15} />, label: 'Trades' },
              { to: '/journal', icon: <BookOpen size={15} />, label: 'Journal' },
              { to: '/reports', icon: <TrendingUp size={15} />, label: 'Reports' },
              { to: '/backtesting', icon: <FlaskConical size={15} />, label: 'Backtesting', requiresPremium: true },
              { to: '/calendar', icon: <CalendarDays size={15} />, label: 'Economic Calendar', requiresPremium: true },
              { to: '/leaderboard', icon: <Trophy size={15} />, label: 'Leaderboard' },
              { to: '/network', icon: <Users size={15} />, label: 'Community & Desk' },
          ]
        : [
              { to: '/dashboard', icon: <LayoutGrid size={15} />, label: 'Dashboard' },
              { to: '/torex-ai', icon: <Sparkles size={15} />, label: 'Torex AI' },
              { to: '/trades', icon: <CandlestickChart size={15} />, label: 'Trades' },
              { to: '/journal', icon: <BookOpen size={15} />, label: 'Diário' },
              { to: '/reports', icon: <TrendingUp size={15} />, label: 'Relatórios' },
              { to: '/backtesting', icon: <FlaskConical size={15} />, label: 'Backtesting', requiresPremium: true },
              { to: '/calendar', icon: <CalendarDays size={15} />, label: 'Calendário Econ.', requiresPremium: true },
              { to: '/leaderboard', icon: <Trophy size={15} />, label: 'Leaderboard' },
              { to: '/network', icon: <Users size={15} />, label: 'Comunidade & Aulas' },
          ];

    const handleCloseDevModal = () => {
        setDevFeature(null);
        if (onClose) onClose();
    };

    const NavItem = ({
        to,
        icon,
        label,
        requiresPremium,
        inDevelopment,
    }: {
        to: string;
        icon: React.ReactNode;
        label: string;
        requiresPremium?: boolean;
        inDevelopment?: boolean;
    }) =>
        inDevelopment ? (
            <button
                type="button"
                onClick={e => {
                    e.preventDefault();
                    setDevFeature(label);
                }}
                className={cn(
                    'w-full flex items-center rounded-lg transition-all group text-fg-muted hover:text-fg hover:bg-surface/70 cursor-pointer text-xs font-medium border border-transparent',
                    collapsed ? 'justify-center p-2' : 'justify-between px-2.5 py-1.5 text-left'
                )}
                title={`${label} (Em Desenvolvimento)`}
            >
                <div className={cn('flex items-center min-w-0', collapsed ? 'justify-center' : 'gap-2.5')}>
                    <span className="text-fg-subtle group-hover:text-warning transition-colors shrink-0">
                        {icon}
                    </span>
                    {!collapsed && <span className="truncate">{label}</span>}
                </div>
            </button>
        ) : (
            <NavLink
                to={to}
                onClick={(e) => {
                    if (requiresPremium && isBasic && to.startsWith('/calendar')) {
                        e.preventDefault();
                        openWorkspacePlansModal('sidebar_economic_calendar');
                    }
                    if (onClose) onClose();
                }}
                title={collapsed ? label : undefined}
                className={({ isActive }) =>
                    cn(
                        'relative flex items-center rounded-lg transition-all duration-150 group text-xs',
                        collapsed ? 'justify-center p-2' : 'justify-between px-2.5 py-1.5 text-left',
                        isActive
                            ? 'bg-surface-2/80 border border-line text-fg font-semibold'
                            : 'text-fg-muted hover:text-fg hover:bg-surface/65 border border-transparent font-medium'
                    )
                }
            >
                {({ isActive }) => (
                    <>
                        {isActive && (
                            <span
                                aria-hidden
                                className="absolute left-0 top-1.5 bottom-1.5 w-[2.5px] rounded-r-full bg-accent"
                            />
                        )}
                        <div className={cn('flex items-center min-w-0', collapsed ? 'justify-center' : 'gap-2.5')}>
                            <span
                                className={cn(
                                    'transition-colors shrink-0',
                                    isActive ? 'text-accent-fg' : 'text-fg-subtle group-hover:text-fg'
                                )}
                            >
                                {icon}
                            </span>
                            {!collapsed && <span className="truncate">{label}</span>}
                        </div>
                        {requiresPremium && isBasic && (
                            collapsed ? (
                                <UpgradeBadge
                                    variant="mini"
                                    tierLabel="PRO"
                                    onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        openWorkspacePlansModal(
                                            to.startsWith('/calendar')
                                                ? 'sidebar_economic_calendar'
                                                : 'sidebar_backtesting',
                                        );
                                        if (onClose) onClose();
                                    }}
                                    className="ml-0.5"
                                />
                            ) : (
                                <UpgradeBadge
                                    variant="pill"
                                    label="Upgrade"
                                    tierLabel="PRO"
                                    onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        openWorkspacePlansModal(
                                            to.startsWith('/calendar')
                                                ? 'sidebar_economic_calendar'
                                                : 'sidebar_backtesting',
                                        );
                                        if (onClose) onClose();
                                    }}
                                    className="ml-1"
                                />
                            )
                        )}
                    </>
                )}
            </NavLink>
        );

    return (
        <>
            <aside
                className={cn(
                    'bg-surface/95 backdrop-blur-xl md:bg-canvas-subtle/90 border-r border-line-subtle flex flex-col z-20 h-screen select-none overflow-hidden transition-[width,background-color,border-color] duration-200 shadow-2xl md:shadow-none shrink-0',
                    collapsed ? 'w-[248px] md:w-[58px]' : 'w-[248px] md:w-[198px]'
                )}
            >
                {/* Topo da Sidebar sincronizado em h-12 (48px) com o Header Principal */}
                <div
                    className={cn(
                        'h-12 flex items-center border-b border-line-subtle shrink-0',
                        collapsed ? 'justify-center px-1.5' : 'justify-between px-3'
                    )}
                >
                    <NavLink
                        to="/dashboard"
                        onClick={onClose}
                        title={collapsed ? 'Torex Journal' : undefined}
                        className="flex items-center gap-2 min-w-0 group"
                    >
                        <img
                            src="https://pub-354475384fd04c1e8c075e14e17ed14d.r2.dev/produtos/originals/1790957899791_0521d2dc46a60392_touro_design_1.jpeg"
                            alt="Torex Logo"
                            className="w-6 h-6 rounded-md object-contain shrink-0"
                        />
                        {!collapsed && (
                            <span className="font-bold text-xs tracking-wider text-fg uppercase leading-none truncate">
                                TOREX <span className="text-accent-fg">JOURNAL</span>
                            </span>
                        )}
                    </NavLink>

                    {/* Botão Desktop de Colapsar (quando expandido) */}
                    {!collapsed && onToggleCollapse && (
                        <button
                            type="button"
                            onClick={onToggleCollapse}
                            className="hidden md:flex w-6 h-6 items-center justify-center rounded-md text-fg-subtle hover:text-fg hover:bg-surface-2 transition-colors cursor-pointer shrink-0"
                            title={isEn ? 'Collapse sidebar' : 'Recolher menu lateral'}
                        >
                            <PanelLeftClose size={14} />
                        </button>
                    )}

                    {/* Botão Mobile de Fechar Drawer */}
                    {onClose && (
                        <button
                            onClick={onClose}
                            className="md:hidden p-1 text-fg-subtle hover:text-fg bg-surface rounded-md cursor-pointer transition-colors"
                            title={isEn ? 'Close menu' : 'Fechar menu'}
                        >
                            <X size={14} />
                        </button>
                    )}
                </div>

                {/* Navegação sutil e compacta */}
                <nav className="flex-1 px-2 py-2.5 space-y-0.5 overflow-y-auto no-scrollbar">
                    {links.map(link => (
                        <NavItem key={link.to} {...link} />
                    ))}
                </nav>

                {!collapsed && isBasic && (
                    <div className="px-2.5 pb-2.5 shrink-0">
                        <BasicPlanSimpleUpgradeCard compact />
                    </div>
                )}

                {/* Rodapé discreto para expandir/recolher rapidamente */}
                {onToggleCollapse && (
                    <div className="hidden md:flex items-center justify-center p-2 border-t border-line-subtle shrink-0">
                        <button
                            type="button"
                            onClick={onToggleCollapse}
                            className={cn(
                                'w-full flex items-center rounded-lg py-1.5 text-fg-subtle hover:text-fg hover:bg-surface/70 transition-colors cursor-pointer text-[11px] font-medium',
                                collapsed ? 'justify-center px-0' : 'justify-between px-2.5'
                            )}
                            title={
                                collapsed
                                    ? isEn
                                        ? 'Expand sidebar'
                                        : 'Expandir menu lateral'
                                    : isEn
                                      ? 'Compact mode'
                                      : 'Modo compacto'
                            }
                        >
                            {collapsed ? (
                                <PanelLeftOpen size={14} />
                            ) : (
                                <>
                                    <span>{isEn ? 'Collapse menu' : 'Recolher menu'}</span>
                                    <PanelLeftClose size={13} />
                                </>
                            )}
                        </button>
                    </div>
                )}
            </aside>

            {devFeature && (
                <DevelopmentModal featureName={devFeature} onClose={handleCloseDevModal} isEn={isEn} />
            )}
        </>
    );
};
