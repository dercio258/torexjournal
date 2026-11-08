import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { NavLink } from 'react-router-dom';
import {
    LayoutDashboard,
    BookOpen,
    TrendingUp,
    BrainCircuit,
    CalendarDays,
    FlaskConical,
    Users,
    Trophy,
    X,
    Lock
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

// Modal de funcionalidade em desenvolvimento renderizado via Portal no centro da tela (document.body)
const DevelopmentModal = ({ featureName, onClose }: { featureName: string; onClose: () => void }) => {
    let description = "Esta funcionalidade está sendo preparada com muito cuidado e estará disponível em breve para turbinar as suas análises.";
    if (featureName === 'Backtest') {
        description = "O Laboratório de Backtest permitirá simular, calibrar e testar suas estratégias de trading com base no histórico real de operações e dados de mercado. Esta ferramenta está em fase final de desenvolvimento e será liberada em breve.";
    } else if (featureName === 'Relatórios') {
        description = "O sistema de Relatórios Avançados trará gráficos executivos de desempenho, análise de drawdown, curva de capital detalhada e estatísticas de consistência.";
    } else if (featureName === 'Calendário Econ.') {
        description = "O Calendário Econômico Inteligente manterá você atualizado sobre todos os eventos macroeconômicos de alto impacto diretamente integrados ao seu painel.";
    }

    return createPortal(
        <div
            className="fixed inset-0 bg-canvas/80 backdrop-blur-md z-[9999] flex items-center justify-center p-4 animate-in fade-in duration-200"
            onClick={onClose}
        >
            <div
                className="bg-surface border border-line p-6 sm:p-8 rounded-3xl max-w-md w-full shadow-2xl relative overflow-hidden flex flex-col items-center text-center animate-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Glow decorativo */}
                <div className="absolute -top-12 -left-12 w-32 h-32 bg-amber-500/10 rounded-full blur-2xl pointer-events-none" />
                <div className="absolute -bottom-12 -right-12 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none" />

                {/* Botão Fechar X */}
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 p-2 rounded-xl text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors"
                    title="Fechar"
                >
                    <X size={18} />
                </button>

                <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 mb-5 shadow-lg shadow-amber-500/5">
                    <Lock size={26} />
                </div>

                <h3 className="text-lg sm:text-xl font-bold text-fg mb-2">
                    {featureName} em Desenvolvimento
                </h3>

                <p className="text-xs sm:text-sm text-fg-muted leading-relaxed mb-6 max-w-xs">
                    {description}
                </p>

                <button
                    onClick={onClose}
                    className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 font-bold py-3 px-6 rounded-xl transition-all shadow-lg shadow-emerald-500/15 active:scale-98 text-xs sm:text-sm"
                >
                    Entendido, até breve!
                </button>
            </div>
        </div>,
        document.body
    );
};

export const Sidebar = ({ onClose }: { onClose?: () => void }) => {
    const { user } = useAuth();
    const [devFeature, setDevFeature] = useState<string | null>(null);

    const isBasic = user?.tier === 'BASIC';

    const links = [
        { to: '/dashboard', icon: <LayoutDashboard size={16} />, label: 'Painel' },
        { to: '/trades', icon: <BookOpen size={16} />, label: 'Trades' },
        { to: '/journal', icon: <BookOpen size={16} />, label: 'Diário' },
        { to: '/leaderboard', icon: <Trophy size={16} />, label: 'Leaderboard' },
        { to: '/network', icon: <Users size={16} />, label: 'Network' },
        { to: '/emotional', icon: <BrainCircuit size={16} />, label: 'Gestão Emocional' },
        { to: '/reports', icon: <TrendingUp size={16} />, label: 'Relatórios' },
        { to: '/calendar', icon: <CalendarDays size={16} />, label: 'Calendário Econ.' },
        { to: '/backtest', icon: <FlaskConical size={16} />, label: 'Backtest', inDevelopment: true },
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
        inDevelopment
    }: {
        to: string;
        icon: React.ReactNode;
        label: string;
        requiresPremium?: boolean;
        inDevelopment?: boolean;
    }) => (
        inDevelopment ? (
            <button
                type="button"
                onClick={(e) => {
                    e.preventDefault();
                    setDevFeature(label);
                }}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg transition-all group text-fg-muted hover:text-fg hover:bg-surface-2 cursor-pointer text-left text-sm font-medium"
                title={`${label} (Em Desenvolvimento)`}
            >
                <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-fg-muted dark:text-[#6B7280] group-hover:text-amber-500 dark:group-hover:text-amber-400 transition-colors shrink-0">
                        {icon}
                    </span>
                    <span className="truncate">{label}</span>
                </div>

            </button>
        ) : (
            <NavLink
                to={to}
                onClick={onClose}
                className={({ isActive }) => `
 relative flex items-center justify-between px-3 py-2 rounded-lg transition-all group text-left text-sm font-medium
 ${isActive
 ? 'bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-300 dark:border-emerald-500/30 text-emerald-700 dark:text-[#34D399] font-semibold shadow-xs'
 : 'text-fg-muted hover:text-fg hover:bg-surface-2 border border-transparent'}
 `}
            >
                {({ isActive }) => (
                    <>
                        <div className="flex items-center gap-2.5 min-w-0">
                            {/* Subtle green indicator dot on active item */}
                            {isActive && (
                                <span className="absolute left-1 w-1 h-3.5 bg-emerald-500 dark:bg-emerald-400 rounded-full shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
                            )}
                            <span className={`${isActive ? 'text-emerald-600 dark:text-emerald-400 pl-1' : 'text-fg-muted dark:text-[#6B7280] group-hover:text-emerald-600 dark:group-hover:text-emerald-400'} transition-colors shrink-0`}>
                                {icon}
                            </span>
                            <span className="truncate">{label}</span>
                        </div>
                        {requiresPremium && isBasic && (
                            <span className="text-[9px] bg-purple-500/10 text-purple-600 dark:text-[#A78BFA] px-1.5 py-0.5 rounded border border-purple-500/20 font-bold shrink-0 ml-1 uppercase">
                                PRO
                            </span>
                        )}
                    </>
                )}
            </NavLink>
        )
    );

    return (
        <>
            <aside className="w-64 bg-white dark:bg-[#0C0D12] border-r border-line flex flex-col z-20 h-screen select-none overflow-hidden transition-all duration-200 shadow-xl md:shadow-none shrink-0">
                {/* Header do Sidebar: Alinhado exatamente em h-16 (64px) com o Header Principal */}
                <div className="h-16 px-4 flex items-center justify-between border-b border-line shrink-0">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <img
                            src="https://pub-354475384fd04c1e8c075e14e17ed14d.r2.dev/produtos/originals/1790957899791_0521d2dc46a60392_touro_design_1.jpeg"
                            alt="Torex Logo"
                            className="w-7 h-7 object-contain shrink-0 drop-shadow-sm"
                        />
                        <div className="flex flex-col justify-center min-w-0">
                            <span className="font-bold text-sm tracking-wider text-fg uppercase leading-none truncate">
                                TOREX <span className="text-emerald-600 dark:text-emerald-400">JOURNAL</span>
                            </span>
                        </div>
                    </div>
                    {onClose && (
                        <button
                            onClick={onClose}
                            className="md:hidden p-1.5 text-fg-subtle dark:text-slate-400 hover:text-fg bg-surface-2 rounded-lg cursor-pointer transition-colors"
                            title="Fechar menu"
                        >
                            <X size={16} />
                        </button>
                    )}
                </div>

                {/* Navegação Estruturada */}
                <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
                    <div className="text-[10px] font-semibold text-fg-muted dark:text-[#6B7280] uppercase tracking-[0.14em] px-3 py-1.5 mb-1">
                        Plataforma
                    </div>
                    {links.map(link => <NavItem key={link.label} {...link} />)}
                </nav>
            </aside>

            {devFeature && (
                <DevelopmentModal
                    featureName={devFeature}
                    onClose={handleCloseDevModal}
                />
            )}
        </>
    );
};

