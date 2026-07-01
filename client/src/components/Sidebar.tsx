import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, BookOpen, CreditCard, Settings, LogOut, TrendingUp, BrainCircuit, CalendarDays, Bell, FlaskConical, Link, Users, X, Lock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

// Modal de funcionalidade em desenvolvimento
const DevelopmentModal = ({ featureName, onClose }: { featureName: string; onClose: () => void }) => {
    let description = "Esta funcionalidade está sendo preparada com muito carinho e estará disponível em breve para turbinar as suas análises.";
    if (featureName === 'Backtest') {
        description = "O Backtest Lab permitirá testar e simular as suas estratégias de trading com base no histórico real das suas operações. Em breve estará disponível.";
    } else if (featureName === 'Relatórios') {
        description = "O sistema de Relatórios Avançados trará gráficos completos de desempenho, análise de drawdown, curva de capital detalhada e estatísticas de consistência.";
    } else if (featureName === 'Calendário Econ.') {
        description = "O Calendário Econômico Inteligente manterá você atualizado sobre todos os eventos macroeconômicos de alto impacto diretamente integrados ao seu painel.";
    }

    return (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
            <div className="bg-slate-900/95 border border-slate-800 p-8 rounded-2xl max-w-md w-full shadow-2xl relative overflow-hidden flex flex-col items-center text-center animate-in fade-in zoom-in-95 duration-200">
                {/* Glow decorativo */}
                <div className="absolute -top-12 -left-12 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none" />
                <div className="absolute -bottom-12 -right-12 w-32 h-32 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none" />

                <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mb-6 shadow-lg shadow-emerald-500/5">
                    <Lock size={28} className="animate-pulse" />
                </div>

                <h3 className="text-xl font-bold text-white mb-2">
                    {featureName} em Desenvolvimento
                </h3>
                
                <p className="text-sm text-slate-400 leading-relaxed mb-8">
                    {description}
                </p>

                <button
                    onClick={onClose}
                    className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-bold py-3 px-6 rounded-xl transition-all shadow-lg shadow-emerald-500/15 active:scale-98"
                >
                    Entendido, até breve!
                </button>
            </div>
        </div>
    );
};

export const Sidebar = ({ onClose }: { onClose?: () => void }) => {
    const { logout, user, userEmail } = useAuth();
    const [devFeature, setDevFeature] = useState<string | null>(null);

    // Generate Initials
    const initials = user?.username
        ? user.username.substring(0, 2).toUpperCase()
        : (userEmail ? userEmail.substring(0, 2).toUpperCase() : 'U');

    const isBasic = user?.tier === 'BASIC';

    const links = [
        { to: '/dashboard', icon: <LayoutDashboard size={18} />, label: 'Painel' },
        { to: '/trades', icon: <BookOpen size={18} />, label: 'Trades' },
        { to: '/journal', icon: <BookOpen size={18} />, label: 'Diário' },
        { to: '/network', icon: <Users size={18} />, label: 'Network' },
        { to: '/emotional', icon: <BrainCircuit size={18} />, label: 'Gestão Emocional' },
        { to: '/notifications', icon: <Bell size={18} />, label: 'Notificações' },
        { to: '/backtest', icon: <FlaskConical size={18} />, label: 'Backtest', inDevelopment: true },
        { to: '/reports', icon: <TrendingUp size={18} />, label: 'Relatórios', inDevelopment: true },
        { to: '/calendar', icon: <CalendarDays size={18} />, label: 'Calendário Econ.', inDevelopment: true },
    ];

    const settingsLinks = [
        { to: '/payments', icon: <CreditCard size={18} />, label: 'Pagamentos' },
        { to: '/add-trades', icon: <Link size={18} />, label: 'Adicionar Trades' },
        { to: '/configuration', icon: <Settings size={18} />, label: 'Configuração' },
    ];

    const NavItem = ({ to, icon, label, requiresPremium, inDevelopment }: { to: string, icon: React.ReactNode, label: string, requiresPremium?: boolean, inDevelopment?: boolean }) => (
        inDevelopment ? (
            <button
                onClick={(e) => {
                    e.preventDefault();
                    if (onClose) onClose();
                    setDevFeature(label);
                }}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg transition-all group text-slate-400 hover:text-slate-100 hover:bg-slate-800/50"
            >
                <div className="flex items-center gap-3">
                    <span className="group-hover:text-emerald-400 transition-colors">{icon}</span>
                    <span className="font-medium text-sm">{label}</span>
                </div>
                <Lock size={14} className="text-slate-500 group-hover:text-emerald-400 transition-colors" />
            </button>
        ) : (
            <NavLink
                to={to}
                onClick={onClose}
                className={({ isActive }) => `
                    flex items-center justify-between px-3 py-2.5 rounded-lg transition-all group
                    ${isActive
                        ? 'bg-emerald-500/10 text-emerald-400 border-r-2 border-emerald-500'
                        : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/50'}
                `}
            >
                <div className="flex items-center gap-3">
                    <span className="group-hover:text-emerald-400 transition-colors">{icon}</span>
                    <span className="font-medium text-sm">{label}</span>
                </div>
                {requiresPremium && isBasic && (
                    <span className="text-[10px] bg-indigo-500/20 text-indigo-400 px-1.5 py-0.5 rounded-full border border-indigo-500/30 flex items-center gap-1 font-bold">
                        PRO
                    </span>
                )}
            </NavLink>
        )
    );

    return (
        <>
            <aside className="w-64 bg-slate-950 md:bg-slate-900/50 border-r border-slate-800 flex flex-col z-20 backdrop-blur-xl h-screen">
                <div className="p-6 flex items-center justify-between border-b border-slate-800/50">
                    <div className="flex items-center gap-3">
                        <img
                            src="https://res.cloudinary.com/dndlqdylc/image/upload/v1769335429/Touro_design_1_beuv9b.png"
                            alt="Logo"
                            className="w-8 h-8 object-contain"
                        />
                        <span className="font-bold text-lg tracking-tight text-slate-100">
                            TOREX <span className="text-emerald-400">JOURNAL</span>
                        </span>
                    </div>
                    {onClose && (
                        <button onClick={onClose} className="md:hidden p-1 text-slate-400 hover:text-white bg-slate-800 rounded-lg">
                            <X size={20} />
                        </button>
                    )}
                </div>

                <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
                    <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 px-2 mt-2">Plataforma</div>
                    {links.map(link => <NavItem key={link.label} {...link} />)}

                    <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 px-2 mt-6">Ajustes</div>
                    {settingsLinks.map(link => <NavItem key={link.to} {...link} />)}
                </nav>

                <div className="p-4 border-t border-slate-800/50 flex items-center justify-between gap-3">
                    <NavLink
                        to="/profile"
                        className="flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white font-bold text-sm shadow-lg shadow-indigo-500/30 hover:scale-105 transition-all overflow-hidden border border-indigo-400/30 ring-2 ring-slate-900 ring-offset-2 ring-offset-slate-900 hover:ring-indigo-500"
                        title="Meu Perfil"
                    >
                        {user?.avatarUrl ? (
                            <img src={user.avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                        ) : (
                            <span>{initials}</span>
                        )}
                    </NavLink>

                    <div className="flex-1 overflow-hidden flex flex-col justify-center">
                        <p className="text-sm font-bold text-slate-200 truncate leading-tight">
                            {user?.username || 'Trader'}
                        </p>
                        <p className="text-[10px] text-slate-500 truncate leading-tight">
                            {userEmail || ''}
                        </p>
                    </div>

                    <button
                        onClick={logout}
                        className="flex-shrink-0 p-2.5 rounded-xl bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 hover:text-rose-300 transition-all border border-rose-500/20"
                        title="Sair da Conta"
                    >
                        <LogOut size={16} />
                    </button>
                </div>
            </aside>

            {devFeature && (
                <DevelopmentModal
                    featureName={devFeature}
                    onClose={() => setDevFeature(null)}
                />
            )}
        </>
    );
};
