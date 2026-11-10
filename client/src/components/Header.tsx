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
    isSidebarCollapsed?: boolean;
}

export const Header: React.FC<HeaderProps> = ({ onOpenSidebar, isSidebarCollapsed = false }) => {
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

    const displayName = user?.name?.trim() || user?.username?.trim() || 'Trader';
    const userSubtitle = user?.email
        ? user.email
        : user?.username && user?.name
          ? `@${user.username}`
          : 'Conta Pessoal';

    const initials = (() => {
        const source = displayName || 'TR';
        const parts = source.split(/\s+/).filter(Boolean);
        if (parts.length >= 2) {
            return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
        }
        return source.substring(0, 2).toUpperCase();
    })();

    const formatMoney = (val: number, currency = 'USD') => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: currency || 'USD',
            minimumFractionDigits: 2,
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
        if (path.startsWith('/backtesting/replay/')) return 'Replay';
        if (path.startsWith('/backtest')) return 'Backtesting';
        if (path === '/add-trades') return 'Adicionar Trades';
        return 'Torex Journal';
    };

    const getTypeTone = (type: string) => {
        switch (type) {
            case 'prop_firm':
            case 'challenge':
            case 'funded':
                return {
                    label: type === 'prop_firm' ? 'Prop' : type.charAt(0).toUpperCase() + type.slice(1),
                    dotClass: 'bg-amber-400',
                    icon: <Award size={12} className="text-amber-400" />
                };
            case 'demo':
                return {
                    label: 'Demo',
                    dotClass: 'bg-sky-400',
                    icon: <Shield size={12} className="text-sky-400" />
                };
            case 'live':
            default:
                return {
                    label: 'Live',
                    dotClass: 'bg-emerald-400',
                    icon: <Flame size={12} className="text-accent-fg" />
                };
        }
    };

    const totalConsolidatedPnl = activeAccounts.reduce((sum, a) => sum + (a.netPnl || 0), 0);

    return (
        <header className="sticky top-0 z-30 w-full h-16 bg-surface/95 dark:bg-[#08090C]/90 backdrop-blur-xl border-b border-line flex items-center justify-between px-3 sm:px-6 transition-colors duration-200">
            {/* LADO ESQUERDO: Mobile Toggle / Título da Página / Seletor de Conta */}
            <div className="flex items-center gap-2.5 sm:gap-4 min-w-0">
                {/* Mobile / Collapsed Hamburger */}
                <button
                    onClick={onOpenSidebar}
                    className={`${isSidebarCollapsed ? '' : 'md:hidden '}p-2 text-fg-muted hover:text-fg bg-surface-2 border border-line rounded-lg transition-colors focus:outline-none cursor-pointer`}
                    title="Abrir menu lateral"
                >
                    <Menu size={18} />
                </button>

                {/* Mobile Logo */}
                <div className="flex md:hidden items-center gap-2">
                    <img
                        src="https://pub-354475384fd04c1e8c075e14e17ed14d.r2.dev/produtos/originals/1790957899791_0521d2dc46a60392_touro_design_1.jpeg"
                        alt="Logo"
                        className="w-7 h-7 object-contain"
                    />
                    <span className="font-bold text-xs tracking-tight text-fg hidden xs:inline">
                        TOREX <span className="text-accent-fg">JOURNAL</span>
                    </span>
                </div>

                {/* Desktop Page Title */}
                <div className="hidden md:flex items-center pr-4 border-r border-line">
                    <h1 className="text-sm font-semibold text-fg tracking-tight">
                        {getPageTitle()}
                    </h1>
                </div>

                {/* SELETOR DE CONTA DE TRADING NO HEADER */}
                <div className="relative" ref={accountMenuRef}>
                    <button
                        onClick={() => setIsAccountMenuOpen(!isAccountMenuOpen)}
                        className={`flex items-center gap-2.5 px-3 py-1.5 rounded-lg border transition-all duration-200 group focus:outline-none ${
                            isAccountMenuOpen
                                ? 'bg-surface-2 border-accent/50 shadow-sm'
                                : 'bg-surface hover:bg-surface-2 border-line hover:border-line-strong'
                        }`}
                        title="Alternar Conta de Trading"
                    >
                        <div className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 border ${
                            isConsolidated
                                ? 'bg-purple-500/15 border-purple-500/30 text-purple-400'
                                : 'bg-accent/10 border-accent/20 text-accent-fg'
                        }`}>
                            {isConsolidated ? <Layers size={13} /> : <Briefcase size={13} />}
                        </div>

                        <div className="flex flex-col text-left min-w-0">
                            <div className="flex items-center gap-1.5 min-w-0">
                                {!isConsolidated && selectedAccount && (
                                    <span
                                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${getTypeTone(selectedAccount.type).dotClass}`}
                                        title={`Conta ${getTypeTone(selectedAccount.type).label}`}
                                    />
                                )}
                                <span className="text-xs font-semibold text-fg max-w-[115px] sm:max-w-[165px] truncate leading-tight">
                                    {isConsolidated ? 'Todas as Contas' : (selectedAccount?.name || 'Conta Principal')}
                                </span>
                            </div>
                            <span className="text-[11px] tabular-nums leading-tight mt-0.5 truncate">
                                {isConsolidated ? (
                                    <span className="text-fg-muted font-medium">{activeAccounts.length} contas conectadas</span>
                                ) : (
                                    <span className={`font-semibold ${(selectedAccount?.netPnl || 0) >= 0 ? 'text-accent-fg' : 'text-danger-fg'}`}>
                                        {(selectedAccount?.netPnl || 0) >= 0 ? '+' : ''}
                                        {formatMoney(selectedAccount?.netPnl || 0, selectedAccount?.currency)}
                                    </span>
                                )}
                            </span>
                        </div>

                        <ChevronDown
                            size={13}
                            className={`text-fg-subtle transition-transform duration-200 ml-0.5 shrink-0 ${
                                isAccountMenuOpen ? 'rotate-180 text-accent-fg' : 'group-hover:text-fg-muted'
                            }`}
                        />
                    </button>

                    {/* Dropdown de Contas */}
                    {isAccountMenuOpen && (
                        <div className="absolute left-0 mt-2 w-72 sm:w-80 rounded-xl bg-surface border border-line shadow-2xl backdrop-blur-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
                            <div className="px-3.5 py-2.5 border-b border-line flex items-center justify-between bg-canvas-subtle">
                                <span className="text-xs font-semibold text-fg">
                                    Contas de Trading
                                </span>
                                <span className="text-[11px] text-fg-subtle tabular-nums font-medium">
                                    {activeAccounts.length} {activeAccounts.length === 1 ? 'ativa' : 'ativas'}
                                </span>
                            </div>

                            {/* Opção: Visão Consolidada */}
                            <div className="p-1.5 border-b border-line">
                                <button
                                    onClick={() => {
                                        selectAccount('all');
                                        setIsAccountMenuOpen(false);
                                    }}
                                    className={`w-full flex items-center justify-between p-2.5 rounded-lg text-left transition-all ${
                                        isConsolidated
                                            ? 'bg-surface-2 border border-line-strong text-fg'
                                            : 'hover:bg-surface-2 text-fg-muted hover:text-fg border border-transparent'
                                    }`}
                                >
                                    <div className="flex items-center gap-2.5 overflow-hidden">
                                        <div className={`w-7 h-7 rounded-md flex items-center justify-center border shrink-0 ${
                                            isConsolidated
                                                ? 'bg-purple-500/20 border-purple-500/40 text-purple-400'
                                                : 'bg-surface-2 border-line text-fg-subtle'
                                        }`}>
                                            <Layers size={14} />
                                        </div>
                                        <div>
                                            <span className="text-xs font-semibold block leading-tight text-fg">Todas as Contas</span>
                                            <span className="text-[11px] text-fg-subtle">
                                                Visão consolidada ({activeAccounts.length})
                                            </span>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2 shrink-0 pl-2">
                                        <span className={`text-xs tabular-nums font-semibold ${totalConsolidatedPnl >= 0 ? 'text-accent-fg' : 'text-danger-fg'}`}>
                                            {totalConsolidatedPnl >= 0 ? '+' : ''}{formatMoney(totalConsolidatedPnl)}
                                        </span>
                                        {isConsolidated && <Check size={14} className="text-accent-fg" />}
                                    </div>
                                </button>
                            </div>

                            {/* Lista de Contas Individuais */}
                            <div className="max-h-60 overflow-y-auto p-1.5 space-y-1">
                                {activeAccounts.map(account => {
                                    const isSelected = !isConsolidated && selectedAccountId === account.id;
                                    const tone = getTypeTone(account.type);
                                    const netPnl = account.netPnl || 0;

                                    return (
                                        <button
                                            key={account.id}
                                            onClick={() => {
                                                selectAccount(account.id);
                                                setIsAccountMenuOpen(false);
                                            }}
                                            className={`w-full flex items-center justify-between p-2.5 rounded-lg text-left transition-all ${
                                                isSelected
                                                    ? 'bg-accent/10 border border-accent/30 text-fg'
                                                    : 'hover:bg-surface-2 text-fg-muted hover:text-fg border border-transparent'
                                            }`}
                                        >
                                            <div className="flex items-center gap-2.5 min-w-0">
                                                <div className={`w-7 h-7 rounded-md flex items-center justify-center border shrink-0 ${
                                                    isSelected ? 'bg-accent/15 border-accent/30' : 'bg-surface-2 border-line'
                                                }`}>
                                                    {tone.icon}
                                                </div>

                                                <div className="flex flex-col min-w-0 truncate">
                                                    <span className="text-xs font-semibold text-fg truncate leading-tight">
                                                        {account.name}
                                                    </span>
                                                    <span className="text-[11px] text-fg-subtle truncate mt-0.5">
                                                        {account.broker} · {tone.label} · {account.currency}
                                                    </span>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-2 shrink-0 pl-2">
                                                <span className={`text-xs tabular-nums font-semibold ${netPnl >= 0 ? 'text-accent-fg' : 'text-danger-fg'}`}>
                                                    {netPnl >= 0 ? '+' : ''}{formatMoney(netPnl, account.currency)}
                                                </span>
                                                {isSelected && <Check size={14} className="text-accent-fg" />}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>

                            {/* Footer do Dropdown: Link para Perfil / Criar Conta */}
                            <div className="p-2 border-t border-line bg-canvas-subtle">
                                <button
                                    onClick={() => {
                                        setIsAccountMenuOpen(false);
                                        navigate('/profile');
                                    }}
                                    className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-surface hover:bg-surface-2 text-fg-muted hover:text-fg border border-line text-xs font-medium transition-colors"
                                >
                                    <Briefcase size={13} className="text-fg-subtle" />
                                    <span>Gerenciar Contas</span>
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* LADO DIREITO: Tema Claro/Escuro, Notificações e Perfil do Usuário */}
            <div className="flex items-center gap-2 sm:gap-2.5">
                {/* BOTÃO DE MUDAR MODO CLARO / ESCURO */}
                <button
                    onClick={toggleTheme}
                    className="p-2 rounded-lg bg-surface hover:bg-surface-2 border border-line hover:border-line-strong text-fg-muted hover:text-fg transition-all flex items-center justify-center focus:outline-none"
                    title={theme === 'dark' ? 'Alternar para Modo Claro' : 'Alternar para Modo Escuro'}
                >
                    {theme === 'dark' ? (
                        <Sun size={16} className="text-amber-400" />
                    ) : (
                        <Moon size={16} className="text-fg-muted" />
                    )}
                </button>

                {/* NOTIFICAÇÕES SHORTCUT */}
                <NavLink
                    to="/notifications"
                    className="p-2 rounded-lg bg-surface hover:bg-surface-2 border border-line hover:border-line-strong text-fg-muted hover:text-fg transition-all flex items-center justify-center focus:outline-none"
                    title="Notificações"
                >
                    <Bell size={16} />
                </NavLink>

                {/* PERFIL DO USUÁRIO NO HEADER (NOME DO USUÁRIO, NÃO CONTA DE TRADING) */}
                <div className="relative" ref={userMenuRef}>
                    <button
                        onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                        className={`flex items-center gap-2.5 p-1 sm:px-2.5 sm:py-1 rounded-lg border transition-all duration-200 group text-left focus:outline-none ${
                            isUserMenuOpen
                                ? 'bg-surface-2 border-accent/40 shadow-sm'
                                : 'hover:bg-surface-2 border-transparent hover:border-line'
                        }`}
                        title="Meu Perfil"
                    >
                        <div className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-teal-700 text-[#04110C] font-bold text-xs shadow-sm overflow-hidden border border-emerald-400/30">
                            {user?.avatarUrl ? (
                                <img src={user.avatarUrl} alt={displayName} className="w-full h-full object-cover" />
                            ) : (
                                <span>{initials}</span>
                            )}
                        </div>

                        <div className="hidden sm:flex flex-col min-w-0 max-w-[140px]">
                            <span className="text-xs font-semibold text-fg group-hover:text-accent-fg transition-colors leading-tight truncate">
                                {displayName}
                            </span>
                            <span className="text-[11px] text-fg-subtle leading-tight truncate mt-0.5">
                                {userSubtitle}
                            </span>
                        </div>

                        <ChevronDown
                            size={13}
                            className={`hidden sm:block text-fg-subtle transition-transform duration-200 ml-0.5 ${
                                isUserMenuOpen ? 'rotate-180 text-accent-fg' : 'group-hover:text-fg-muted'
                            }`}
                        />
                    </button>

                    {/* Dropdown do Usuário */}
                    {isUserMenuOpen && (
                        <div className="absolute right-0 mt-2 w-64 rounded-xl bg-surface border border-line shadow-2xl backdrop-blur-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
                            {/* Card do Usuário */}
                            <div className="p-3.5 border-b border-line bg-canvas-subtle">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-teal-700 text-[#04110C] font-bold text-sm flex items-center justify-center border border-emerald-400/30 shrink-0 overflow-hidden">
                                        {user?.avatarUrl ? (
                                            <img src={user.avatarUrl} alt={displayName} className="w-full h-full object-cover rounded-full" />
                                        ) : (
                                            <span>{initials}</span>
                                        )}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-sm font-semibold text-fg truncate leading-tight">
                                            {displayName}
                                        </p>
                                        <p className="text-xs text-fg-subtle truncate leading-tight mt-0.5">
                                            {user?.email || userSubtitle}
                                        </p>
                                        <p className="text-[11px] font-medium text-accent-fg mt-1">
                                            Plano {user?.tier || 'PRO'}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Links de Acesso Rápido */}
                            <div className="p-1.5 space-y-0.5">
                                <NavLink
                                    to="/profile"
                                    onClick={() => setIsUserMenuOpen(false)}
                                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors"
                                >
                                    <User size={15} className="text-accent-fg" />
                                    <span>Meu Perfil & Contas</span>
                                </NavLink>

                                <NavLink
                                    to="/leaderboard"
                                    onClick={() => setIsUserMenuOpen(false)}
                                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors"
                                >
                                    <Trophy size={15} className="text-amber-400" />
                                    <span>Tabela de Classificação</span>
                                </NavLink>

                                <NavLink
                                    to="/configuration"
                                    onClick={() => setIsUserMenuOpen(false)}
                                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors"
                                >
                                    <Settings size={15} className="text-fg-subtle" />
                                    <span>Configurações</span>
                                </NavLink>

                                <NavLink
                                    to="/payments"
                                    onClick={() => setIsUserMenuOpen(false)}
                                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors"
                                >
                                    <CreditCard size={15} className="text-fg-subtle" />
                                    <span>Planos & Assinatura</span>
                                </NavLink>
                            </div>

                            {/* Botão de Logout */}
                            <div className="p-1.5 border-t border-line bg-canvas-subtle">
                                <button
                                    onClick={() => {
                                        setIsUserMenuOpen(false);
                                        logout();
                                    }}
                                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-danger-fg hover:bg-danger/10 transition-colors"
                                >
                                    <LogOut size={15} />
                                    <span>Sair da Conta</span>
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </header>
    );
};
