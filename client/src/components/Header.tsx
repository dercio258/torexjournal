import React, { useState, useRef, useEffect } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { useTheme } from '../context/ThemeContext';
import {
    Menu,
    Sun,
    Moon,
    Bell,
    ChevronDown,
    Check,
    Briefcase,
    Layers,
    LogOut,
    User,
    Settings,
    CreditCard,
    Shield,
    Flame,
    Award,
    Trophy
} from 'lucide-react';

interface HeaderProps {
    onOpenSidebar: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onOpenSidebar }) => {
    const { user, logout } = useAuth();
    const {
        accounts,
        selectedAccountId,
        selectedAccount,
        isConsolidated,
        selectAccount
    } = useAccount();
    const { theme, toggleTheme } = useTheme();
    const location = useLocation();
    const navigate = useNavigate();

    const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
    const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);

    const accountMenuRef = useRef<HTMLDivElement>(null);
    const userMenuRef = useRef<HTMLDivElement>(null);

    // Fechar menus ao clicar fora
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (accountMenuRef.current && !accountMenuRef.current.contains(event.target as Node)) {
                setIsAccountMenuOpen(false);
            }
            if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
                setIsUserMenuOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Fechar menus ao mudar de rota
    useEffect(() => {
        setIsAccountMenuOpen(false);
        setIsUserMenuOpen(false);
    }, [location.pathname]);

    const activeAccounts = accounts.filter(a => !a.isArchived);

    const initials = user?.username
        ? user.username.substring(0, 2).toUpperCase()
        : 'TR';

    const formatMoney = (val: number, currency = 'USD') => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: currency || 'USD',
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
        }).format(val || 0);
    };

    const getPageTitle = () => {
        const path = location.pathname;
        if (path === '/dashboard') return 'Painel Geral';
        if (path === '/trades') return 'Operações';
        if (path === '/journal') return 'Diário Técnico';
        if (path === '/profile') return 'Meu Perfil';
        if (path === '/configuration') return 'Configurações';
        if (path === '/payments') return 'Pagamentos';
        if (path === '/network') return 'Network';
        if (path === '/emotional') return 'Gestão Emocional';
        if (path === '/calendar') return 'Calendário Econômico';
        if (path === '/notifications') return 'Notificações';
        if (path === '/reports') return 'Relatórios';
        if (path === '/backtest') return 'Backtest Lab';
        if (path === '/add-trades') return 'Adicionar Trades';
        return 'Torex Journal';
    };

    const getTypeBadge = (type: string) => {
        switch (type) {
            case 'prop_firm':
            case 'challenge':
            case 'funded':
                return {
                    label: type === 'prop_firm' ? 'PROP' : type.toUpperCase(),
                    classes: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
                    icon: <Award size={11} className="text-amber-400" />
                };
            case 'demo':
                return {
                    label: 'DEMO',
                    classes: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
                    icon: <Shield size={11} className="text-sky-400" />
                };
            case 'live':
            default:
                return {
                    label: 'LIVE',
                    classes: 'bg-emerald-500/15 text-accent-fg border-emerald-500/30',
                    icon: <Flame size={11} className="text-accent-fg" />
                };
        }
    };

    const totalConsolidatedPnl = activeAccounts.reduce((sum, a) => sum + (a.netPnl || 0), 0);

    return (
        <header className="sticky top-0 z-30 w-full h-16 bg-white/95 dark:bg-[#08090C]/90 backdrop-blur-xl border-b border-line flex items-center justify-between px-3 sm:px-6 transition-colors duration-200 shadow-xs dark:shadow-none">
            {/* LADO ESQUERDO: Mobile Toggle / Breadcrumb / Seletor de Conta */}
            <div className="flex items-center gap-2 sm:gap-4 min-w-0">
                {/* Mobile Hamburger */}
                <button
                    onClick={onOpenSidebar}
                    className="md:hidden p-2 text-fg-muted hover:text-fg bg-slate-100 dark:bg-[#111319] border border-line rounded-lg transition-colors focus:outline-none"
                    title="Abrir menu lateral"
                >
                    <Menu size={19} />
                </button>

                {/* Mobile Logo */}
                <div className="flex md:hidden items-center gap-2">
                    <img
                        src="https://pub-354475384fd04c1e8c075e14e17ed14d.r2.dev/produtos/originals/1790957899791_0521d2dc46a60392_touro_design_1.jpeg"
                        alt="Logo"
                        className="w-7 h-7 object-contain"
                    />
                    <span className="font-bold text-xs tracking-tight text-fg hidden xs:inline">
                        TOREX <span className="text-emerald-500 dark:text-emerald-400">JOURNAL</span>
                    </span>
                </div>

                {/* Desktop Page Title */}
                <div className="hidden md:flex items-center gap-2 pr-3 border-r border-line ">
                    <span className="text-sm font-semibold text-fg tracking-tight">
                        {getPageTitle()}
                    </span>
                </div>

                {/* SELETOR DE CONTA DE TRADING NO HEADER */}
                <div className="relative" ref={accountMenuRef}>
                    <button
                        onClick={() => setIsAccountMenuOpen(!isAccountMenuOpen)}
                        className={`flex items-center gap-2.5 px-3 py-1.5 rounded-lg border transition-all duration-200 group focus:outline-none ${isAccountMenuOpen
 ? 'bg-surface-2 border-emerald-500/50 shadow-sm'
 : 'bg-slate-50 dark:bg-[#111319] hover:bg-surface-2 border-line hover:border-emerald-500/30'
 }`}
                        title="Alternar Conta de Trading"
                    >
                        <div className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 border ${isConsolidated
                                ? 'bg-purple-500/20 border-purple-500/30 text-[#A78BFA]'
                                : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500 dark:text-emerald-400'
                            }`}>
                            {isConsolidated ? <Layers size={13} /> : <Briefcase size={13} />}
                        </div>

                        <div className="flex flex-col text-left min-w-0">
                            <div className="flex items-center gap-1.5 min-w-0">
                                <span className="text-xs font-semibold text-fg max-w-[100px] sm:max-w-[140px] truncate leading-tight">
                                    {isConsolidated ? 'Todas as Contas' : (selectedAccount?.name || 'Conta Principal')}
                                </span>
                                {!isConsolidated && selectedAccount && (
                                    <span className={`text-[8.5px] font-bold px-1.5 py-0.2 rounded border shrink-0 ${getTypeBadge(selectedAccount.type).classes}`}>
                                        {getTypeBadge(selectedAccount.type).label}
                                    </span>
                                )}
                            </div>
                            <span className="text-[10px] font-mono leading-tight mt-0.5 truncate">
                                {isConsolidated ? (
                                    <span className="text-[#A78BFA] font-medium">{activeAccounts.length} contas</span>
                                ) : (
                                    <span className={`font-bold ${(selectedAccount?.netPnl || 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                        {(selectedAccount?.netPnl || 0) >= 0 ? '+' : ''}
                                        {formatMoney(selectedAccount?.netPnl || 0, selectedAccount?.currency)}
                                    </span>
                                )}
                            </span>
                        </div>

                        <ChevronDown
                            size={13}
                            className={`text-fg-muted dark:text-[#6B7280] transition-transform duration-200 ml-0.5 shrink-0 ${isAccountMenuOpen ? 'rotate-180 text-emerald-500 dark:text-emerald-400' : 'group-hover:text-fg-muted '
 }`}
                        />
                    </button>

                    {/* Dropdown de Contas */}
                    {isAccountMenuOpen && (
                        <div className="absolute left-0 mt-2 w-72 sm:w-80 rounded-xl bg-surface border border-line shadow-2xl backdrop-blur-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
                            <div className="p-3 border-b border-line flex items-center justify-between bg-slate-50 dark:bg-[#0C0D12]">
                                <div className="flex items-center gap-2 text-xs font-bold text-fg ">
                                    <Briefcase size={14} className="text-emerald-500 dark:text-emerald-400" />
                                    <span>Contas de Trading</span>
                                </div>
                                <span className="text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full font-mono font-bold">
                                    {activeAccounts.length} ativas
                                </span>
                            </div>

                            {/* Opção: Visão Consolidada */}
                            <div className="p-1.5 border-b border-line ">
                                <button
                                    onClick={() => {
                                        selectAccount('all');
                                        setIsAccountMenuOpen(false);
                                    }}
                                    className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left transition-all ${isConsolidated
 ? 'bg-indigo-500/15 border border-indigo-500/30 text-indigo-900 dark:text-white shadow-sm'
 : 'hover:bg-surface-2 text-fg-muted hover:text-fg border border-transparent'
 }`}
                                >
                                    <div className="flex items-center gap-2.5 overflow-hidden">
                                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center border shrink-0 ${isConsolidated ? 'bg-indigo-500/30 border-indigo-500/50 text-indigo-600 dark:text-indigo-300' : 'bg-surface-2 border-line text-fg-subtle dark:text-slate-400'
 }`}>
                                            <Layers size={16} />
                                        </div>
                                        <div>
                                            <span className="text-xs font-bold block leading-tight">Todas as Contas</span>
                                            <span className="text-[10px] text-fg-subtle dark:text-slate-400 font-mono">
                                                Visão consolidada ({activeAccounts.length} contas)
                                            </span>
                                        </div>
                                    </div>

                                    <div className="flex flex-col items-end shrink-0 pl-2">
                                        <span className={`text-[11px] font-mono font-bold ${totalConsolidatedPnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                            {totalConsolidatedPnl >= 0 ? '+' : ''}{formatMoney(totalConsolidatedPnl)}
                                        </span>
                                        {isConsolidated && <Check size={14} className="text-indigo-500 dark:text-indigo-400 mt-0.5" />}
                                    </div>
                                </button>
                            </div>

                            {/* Lista de Contas Individuais */}
                            <div className="max-h-60 overflow-y-auto p-1.5 space-y-1">
                                {activeAccounts.map(account => {
                                    const isSelected = !isConsolidated && selectedAccountId === account.id;
                                    const badge = getTypeBadge(account.type);
                                    const netPnl = account.netPnl || 0;

                                    return (
                                        <button
                                            key={account.id}
                                            onClick={() => {
                                                selectAccount(account.id);
                                                setIsAccountMenuOpen(false);
                                            }}
                                            className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left transition-all ${isSelected
 ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-900 dark:text-white shadow-sm'
 : 'hover:bg-surface-2 text-fg-muted hover:text-slate-950 dark:hover:text-white border border-transparent'
 }`}
                                        >
                                            <div className="flex items-center gap-2.5 min-w-0">
                                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center border shrink-0 ${isSelected ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-600 dark:text-emerald-300' : 'bg-surface-2 border-line '
 }`}>
                                                    {badge.icon}
                                                </div>

                                                <div className="flex flex-col min-w-0 truncate">
                                                    <div className="flex items-center gap-1.5 truncate">
                                                        <span className="text-xs font-semibold truncate leading-tight">
                                                            {account.name}
                                                        </span>
                                                        <span className={`text-[9px] font-bold px-1 rounded border shrink-0 ${badge.classes}`}>
                                                            {badge.label}
                                                        </span>
                                                    </div>
                                                    <span className="text-[10px] text-fg-subtle dark:text-slate-400 truncate mt-0.5">
                                                        {account.broker} • {account.currency}
                                                    </span>
                                                </div>
                                            </div>

                                            <div className="flex flex-col items-end shrink-0 pl-2">
                                                <span className={`text-[11px] font-mono font-bold ${netPnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                                    {netPnl >= 0 ? '+' : ''}{formatMoney(netPnl, account.currency)}
                                                </span>
                                                {isSelected && <Check size={14} className="text-emerald-500 dark:text-emerald-400 mt-0.5" />}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>

                            {/* Footer do Dropdown: Link para Perfil / Criar Conta */}
                            <div className="p-2 border-t border-line bg-slate-50 dark:bg-[#0C0D12] flex items-center justify-between gap-2">
                                <button
                                    onClick={() => {
                                        setIsAccountMenuOpen(false);
                                        navigate('/profile');
                                    }}
                                    className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-surface-2 hover:bg-slate-200 dark:hover:bg-[#1C1F2C] text-fg-muted border border-line text-xs font-semibold transition-colors"
                                >
                                    <Briefcase size={14} className="text-fg-subtle dark:text-slate-400" />
                                    <span>Gerenciar Contas no Perfil</span>
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* LADO DIREITO: Tema Claro/Escuro, Notificações e Perfil do Usuário */}
            <div className="flex items-center gap-2 sm:gap-3">
                {/* BOTÃO DE MUDAR MODO CLARO / ESCURO */}
                <button
                    onClick={toggleTheme}
                    className="p-2 rounded-lg bg-slate-100 dark:bg-[#111319] hover:bg-slate-200 dark:hover:bg-[#161822] border border-line hover:border-amber-500/30 text-fg-muted hover:text-amber-500 transition-all flex items-center justify-center focus:outline-none shadow-xs dark:shadow-none"
                    title={theme === 'dark' ? 'Alternar para Modo Claro' : 'Alternar para Modo Escuro'}
                >
                    {theme === 'dark' ? (
                        <Sun size={16} className="text-amber-400 transition-transform duration-300 hover:rotate-45" />
                    ) : (
                        <Moon size={16} className="text-indigo-600 transition-transform duration-300 hover:-rotate-12" />
                    )}
                </button>

                {/* NOTIFICAÇÕES SHORTCUT */}
                <NavLink
                    to="/notifications"
                    className="p-2 rounded-lg bg-slate-100 dark:bg-[#111319] hover:bg-slate-200 dark:hover:bg-[#161822] border border-line hover:border-emerald-500/30 text-fg-muted hover:text-fg transition-all flex items-center justify-center focus:outline-none shadow-xs dark:shadow-none"
                    title="Notificações"
                >
                    <Bell size={16} />
                </NavLink>

                {/* PERFIL DO USUÁRIO NO HEADER */}
                <div className="relative" ref={userMenuRef}>
                    <button
                        onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                        className={`flex items-center gap-2 p-1 sm:px-2 sm:py-1 rounded-lg border transition-all duration-200 group text-left focus:outline-none ${isUserMenuOpen
 ? 'bg-surface-2 border-emerald-500/50 shadow-sm'
 : 'hover:bg-surface-2 border-transparent hover:border-line '
 }`}
                        title="Meu Perfil"
                    >
                        <div className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-teal-700 text-[#04110C] font-bold text-xs shadow-md overflow-hidden border border-emerald-400/30">
                            {user?.avatarUrl ? (
                                <img src={user.avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                            ) : (
                                <span>{initials}</span>
                            )}
                        </div>

                        <div className="hidden sm:flex flex-col min-w-0 max-w-[110px]">
                            <span className="text-xs font-semibold text-fg group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors leading-tight truncate">
                                {user?.username || 'Trader'}
                            </span>
                            <span className="text-[9.5px] text-emerald-600 dark:text-[#34D399] font-medium leading-tight truncate mt-0.5">
                                {isConsolidated ? 'Todas as Contas' : (selectedAccount?.name || 'Conta Principal')}
                            </span>
                        </div>

                        <ChevronDown
                            size={14}
                            className={`hidden sm:block text-fg-muted dark:text-slate-400 transition-transform duration-200 ml-0.5 ${isUserMenuOpen ? 'rotate-180 text-emerald-500 dark:text-emerald-400' : 'group-hover:text-slate-600 dark:group-hover:text-slate-200'
                                }`}
                        />
                    </button>

                    {/* Dropdown do Usuário */}
                    {isUserMenuOpen && (
                        <div className="absolute right-0 mt-2 w-64 rounded-xl bg-surface border border-line shadow-2xl backdrop-blur-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
                            {/* Card do Usuário */}
                            <div className="p-4 border-b border-line bg-slate-50 dark:bg-[#0C0D12]">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-teal-700 text-[#04110C] font-bold text-sm flex items-center justify-center border border-emerald-400/30 shrink-0">
                                        {user?.avatarUrl ? (
                                            <img src={user.avatarUrl} alt="Avatar" className="w-full h-full object-cover rounded-full" />
                                        ) : (
                                            <span>{initials}</span>
                                        )}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-sm font-bold text-fg truncate leading-tight">
                                            {user?.username || 'Trader'}
                                        </p>
                                        <p className="text-xs text-fg-subtle dark:text-[#6B7280] truncate leading-tight mt-0.5">
                                            {user?.email || ''}
                                        </p>
                                        <span className="inline-block text-[9px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 uppercase tracking-wide mt-1.5">
                                            Plano {user?.tier || 'PRO'}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Links de Acesso Rápido */}
                            <div className="p-2 space-y-1">
                                <NavLink
                                    to="/profile"
                                    onClick={() => setIsUserMenuOpen(false)}
                                    className="flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold text-fg-muted hover:text-slate-950 dark:hover:text-white hover:bg-surface-2 transition-colors"
                                >
                                    <User size={15} className="text-emerald-600 dark:text-emerald-400" />
                                    <span>Meu Perfil & Contas</span>
                                </NavLink>

                                <NavLink
                                    to="/leaderboard"
                                    onClick={() => setIsUserMenuOpen(false)}
                                    className="flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold text-fg-muted hover:text-slate-950 dark:hover:text-white hover:bg-surface-2 transition-colors"
                                >
                                    <Trophy size={15} className="text-amber-500 dark:text-amber-400" />
                                    <span>Tabela de Classificação</span>
                                </NavLink>

                                <NavLink
                                    to="/configuration"
                                    onClick={() => setIsUserMenuOpen(false)}
                                    className="flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold text-fg-muted hover:text-slate-950 dark:hover:text-white hover:bg-surface-2 transition-colors"
                                >
                                    <Settings size={15} className="text-fg-subtle dark:text-slate-400" />
                                    <span>Configurações</span>
                                </NavLink>

                                <NavLink
                                    to="/payments"
                                    onClick={() => setIsUserMenuOpen(false)}
                                    className="flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold text-fg-muted hover:text-slate-950 dark:hover:text-white hover:bg-surface-2 transition-colors"
                                >
                                    <CreditCard size={15} className="text-fg-subtle dark:text-slate-400" />
                                    <span>Planos & Assinatura</span>
                                </NavLink>
                            </div>

                            {/* Botão de Logout */}
                            <div className="p-2 border-t border-line bg-slate-50 dark:bg-[#0C0D12]">
                                <button
                                    onClick={() => {
                                        setIsUserMenuOpen(false);
                                        logout();
                                    }}
                                    className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 hover:bg-rose-500/10 transition-colors"
                                >
                                    <span className="flex items-center gap-2">
                                        <LogOut size={15} />
                                        <span>Sair da Conta</span>
                                    </span>
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </header>
    );
};
