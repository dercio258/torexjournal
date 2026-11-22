import React, { useState, useRef, useEffect, useMemo } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { useTheme } from '../context/ThemeContext';
import { useLocale } from '../context/LocaleContext';
import { LanguageSwitcher } from './ui/LanguageSwitcher';
import { OfflineSyncIndicator } from './ui/OfflineSyncIndicator';
import {
    getDatePresetOptions,
    useDashboardFilters,
} from '../context/DashboardFilterContext';
import { DashboardSessionBucket } from '../hooks/useDashboard';
import { useSubscriptionStatus } from '../hooks/useDashboard';
import { trackButtonClick } from '../lib/tracking';
import { normalizePlanTier, openWorkspacePlansModal } from '../lib/planGate';
import { BasicPlanSimpleUpgradeCard } from './subscription/BasicPlanSimpleUpgradeCard';
import {
    Menu,
    Sun,
    Moon,
    Bell,
    Clock,
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
    Trophy,
    Filter,
    Calendar,
    RotateCcw,
    Search,
} from 'lucide-react';

interface HeaderProps {
    onOpenSidebar: () => void;
    isSidebarCollapsed?: boolean;
}

const getSessionOptions = (isEn: boolean): { key: DashboardSessionBucket; label: string }[] =>
    isEn
        ? [
              { key: 'asia', label: 'Asia' },
              { key: 'london', label: 'London' },
              { key: 'overlap', label: 'London + NY' },
              { key: 'ny', label: 'New York' },
          ]
        : [
              { key: 'asia', label: 'Ásia' },
              { key: 'london', label: 'Londres' },
              { key: 'overlap', label: 'Londres + NY' },
              { key: 'ny', label: 'Nova Iorque' },
          ];

export const Header: React.FC<HeaderProps> = ({ onOpenSidebar, isSidebarCollapsed = false }) => {
    const { user, logout } = useAuth();
    const { data: subStatus } = useSubscriptionStatus();
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const sessionOptions = useMemo(() => getSessionOptions(isEn), [isEn]);
    const datePresetOptions = useMemo(() => getDatePresetOptions(locale), [locale]);
    const {
        accounts,
        selectedAccountId,
        selectedAccount,
        isConsolidated,
        selectAccount,
    } = useAccount();
    const { theme, toggleTheme } = useTheme();
    const {
        dateRange,
        setDatePreset,
        setCustomDateRange,
        filters,
        setSideFilter,
        setOutcomeFilter,
        toggleSessionFilter,
        toggleSymbolFilter,
        clearSymbolsFilter,
        resetFilters,
        activeFilterCount,
        hasActiveFilters,
        availableSymbols,
    } = useDashboardFilters();

    const location = useLocation();
    const navigate = useNavigate();

    const showAnalyticsFilters =
        location.pathname === '/dashboard' ||
        location.pathname === '/reports' ||
        location.pathname === '/journal';

    const [openPopover, setOpenPopover] = useState<'filters' | 'date' | 'account' | 'user' | null>(null);
    const [draftStart, setDraftStart] = useState(dateRange.customStart);
    const [draftEnd, setDraftEnd] = useState(dateRange.customEnd);
    const [symbolQuery, setSymbolQuery] = useState('');

    const headerControlsRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setDraftStart(dateRange.customStart);
        setDraftEnd(dateRange.customEnd);
    }, [dateRange.customStart, dateRange.customEnd]);

    // Fechar menus ao clicar fora ou pressionar Escape
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (headerControlsRef.current && !headerControlsRef.current.contains(event.target as Node)) {
                setOpenPopover(null);
            }
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setOpenPopover(null);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, []);

    // Fechar menus ao mudar de rota
    useEffect(() => {
        setOpenPopover(null);
    }, [location.pathname]);

    const activeAccounts = accounts.filter(a => !a.isArchived);

    const displayName = user?.name?.trim() || user?.username?.trim() || 'Trader';
    const userSubtitle = user?.email
        ? user.email
        : user?.username && user?.name
          ? `@${user.username}`
          : isEn
            ? 'Personal Desk'
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
            maximumFractionDigits: 2,
        }).format(val || 0);
    };

    const getPageTitle = () => {
        const path = location.pathname;
        if (path === '/dashboard' || path === '/dashboard-en') return 'Dashboard';
        if (path.startsWith('/torex-ai')) return 'Torex AI';
        if (path === '/trades') return isEn ? 'Execution Ledger' : 'Trades';
        if (path.startsWith('/trades/')) return isEn ? 'Execution Details' : 'Detalhes da Operação';
        if (path === '/journal') return isEn ? 'Trading Journal' : 'Diário Técnico';
        if (path === '/profile') return isEn ? 'Profile & Accounts' : 'Meu Perfil';
        if (path === '/configuration') return isEn ? 'Settings' : 'Configurações';
        if (path === '/payments') return isEn ? 'Billing & Plans' : 'Pagamentos';
        if (path === '/network') return isEn ? 'Trader Network' : 'Network';
        if (path === '/calendar') return isEn ? 'Economic Calendar' : 'Calendário Econômico';
        if (path === '/notifications') return isEn ? 'Notifications' : 'Notificações';
        if (path === '/reports') return isEn ? 'Performance Reports' : 'Relatórios';
        if (path === '/leaderboard') return 'Leaderboard';
        if (path.startsWith('/backtesting/replay/')) return isEn ? 'Market Replay' : 'Replay';
        if (path.startsWith('/backtest')) return 'Backtesting';
        if (path.startsWith('/add-trades')) return isEn ? 'Broker Sync & Import' : 'Adicionar Trades';
        return 'Torex Journal';
    };

    const getTypeTone = (type: string) => {
        switch (type) {
            case 'prop_firm':
            case 'challenge':
            case 'funded':
                return {
                    label: type === 'prop_firm' ? 'Prop' : type.charAt(0).toUpperCase() + type.slice(1),
                    dotClass: 'bg-warning',
                    icon: <Award size={12} className="text-warning" />,
                };
            case 'demo':
                return {
                    label: 'Demo',
                    dotClass: 'bg-data-1',
                    icon: <Shield size={12} className="text-data-1" />,
                };
            case 'live':
            default:
                return {
                    label: 'Live',
                    dotClass: 'bg-accent',
                    icon: <Flame size={12} className="text-accent-fg" />,
                };
        }
    };

    const totalConsolidatedPnl = activeAccounts.reduce((sum, a) => sum + (a.netPnl || 0), 0);

    const accountNumberSubtitle = useMemo(() => {
        if (isConsolidated) {
            if (isEn) {
                return `${activeAccounts.length} active ${activeAccounts.length === 1 ? 'account' : 'accounts'}`;
            }
            return `${activeAccounts.length} ${activeAccounts.length === 1 ? 'conta ativa' : 'contas ativas'}`;
        }
        if (selectedAccount?.mt5Id) {
            return `#${selectedAccount.mt5Id}`;
        }
        if (selectedAccount) {
            return `${selectedAccount.broker || 'Manual'} · ${selectedAccount.currency || 'USD'}`;
        }
        return isEn ? 'No account' : 'Sem conta';
    }, [isConsolidated, activeAccounts.length, selectedAccount, isEn]);

    const filteredAvailableSymbols = useMemo(() => {
        const q = symbolQuery.trim().toLowerCase();
        if (!q) return availableSymbols;
        return availableSymbols.filter(s => s.toLowerCase().includes(q));
    }, [availableSymbols, symbolQuery]);

    const handleApplyCustomDates = () => {
        if (!draftStart) return;
        setCustomDateRange(draftStart, draftEnd);
        setOpenPopover(null);
    };

    const togglePopover = (target: 'filters' | 'date' | 'account' | 'user') => {
        setOpenPopover(prev => (prev === target ? null : target));
    };

    const normalizedTier = normalizePlanTier(user?.tier);
    const avatarRingClass =
        normalizedTier === 'BASIC' || normalizedTier === 'FREE'
            ? openPopover === 'user'
                ? 'ring-yellow-300 shadow-glow scale-[1.02]'
                : 'ring-yellow-400 hover:ring-yellow-300'
            : normalizedTier === 'PRO'
              ? openPopover === 'user'
                  ? 'ring-red-400 shadow-glow scale-[1.02]'
                  : 'ring-red-500 hover:ring-red-400'
              : openPopover === 'user'
                ? 'ring-accent-hover shadow-glow scale-[1.02]'
                : 'ring-accent/80 hover:ring-accent';

    const popoverAvatarRingClass =
        normalizedTier === 'BASIC' || normalizedTier === 'FREE'
            ? 'ring-yellow-400'
            : normalizedTier === 'PRO'
              ? 'ring-red-500'
              : 'ring-accent/80';

    const tierLabelColorClass =
        normalizedTier === 'BASIC' || normalizedTier === 'FREE'
            ? 'text-yellow-400'
            : normalizedTier === 'PRO'
              ? 'text-red-400'
              : 'text-accent-fg';

    return (
        <header className="sticky top-0 z-30 w-full h-12 bg-canvas/95 backdrop-blur-xl border-b border-line-subtle flex items-center justify-between gap-1.5 px-2.5 sm:px-5 transition-colors duration-200">
            {/* LADO ESQUERDO: Hamburger Mobile + Título Limpo da Página */}
            <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0 flex-1 mr-1">
                <button
                    type="button"
                    onClick={onOpenSidebar}
                    aria-label={isEn ? 'Open navigation menu' : 'Abrir menu de navegação'}
                    className={`${
                        isSidebarCollapsed ? '' : 'md:hidden '
                    }shrink-0 p-1.5 text-fg-muted hover:text-fg bg-surface border border-line rounded-lg transition-colors focus:outline-none cursor-pointer`}
                    title={isEn ? 'Open sidebar' : 'Abrir menu lateral'}
                >
                    <Menu size={15} />
                </button>

                <h1 className="text-xs sm:text-sm font-semibold text-fg tracking-tight truncate max-w-[82px] xs:max-w-[125px] sm:max-w-none">
                    {getPageTitle()}
                </h1>
            </div>

            {/* LADO DIREITO: Filters · Date Range · Conta/Número · Utilitários · Avatar */}
            <div ref={headerControlsRef} className="flex items-center gap-1 sm:gap-2 shrink-0">
                {/* 1. FILTERS POPOVER (Visível no Dashboard e Relatórios) */}
                {showAnalyticsFilters && (
                    <div className="relative">
                        <button
                            type="button"
                            onClick={() => togglePopover('filters')}
                            className={`h-7 sm:h-8 px-1.5 sm:px-2.5 rounded-lg border text-[11px] sm:text-[11.5px] font-medium flex items-center gap-1 sm:gap-1.5 transition-all cursor-pointer focus:outline-none ${
                                openPopover === 'filters' || hasActiveFilters
                                    ? 'bg-surface-2 border-accent/45 text-fg shadow-xs'
                                    : 'bg-surface/80 hover:bg-surface-2 border-line hover:border-line-strong text-fg-muted hover:text-fg'
                            }`}
                            title={isEn ? 'Filter operational metrics' : 'Filtrar métricas operacionais'}
                        >
                            <Filter size={13} className={hasActiveFilters ? 'text-accent-fg' : 'text-fg-subtle'} />
                            <span className="hidden md:inline">{isEn ? 'Filters' : 'Filtros'}</span>
                            {activeFilterCount > 0 && (
                                <span className="px-1 py-0.5 rounded-full bg-accent/15 text-accent-fg text-[9.5px] font-bold leading-none tabular-nums">
                                    {activeFilterCount}
                                </span>
                            )}
                            <ChevronDown
                                size={13}
                                className={`hidden sm:block text-fg-subtle transition-transform duration-150 ${
                                    openPopover === 'filters' ? 'rotate-180 text-accent-fg' : ''
                                }`}
                            />
                        </button>

                        {openPopover === 'filters' && (
                            <div className="fixed inset-x-3 top-14 sm:inset-auto sm:absolute sm:right-0 sm:top-auto sm:mt-2 sm:w-80 rounded-xl bg-surface border border-line-strong shadow-panel backdrop-blur-xl z-50 overflow-hidden animate-fade-in-up">
                                <div className="px-3.5 py-2.5 border-b border-line bg-canvas-subtle flex items-center justify-between">
                                    <span className="text-xs font-semibold text-fg">
                                        {isEn ? 'Execution Filters' : 'Filtros Operacionais'}
                                    </span>
                                    {hasActiveFilters && (
                                        <button
                                            type="button"
                                            onClick={resetFilters}
                                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent-fg hover:underline cursor-pointer"
                                        >
                                            <RotateCcw size={11} />
                                            {isEn ? 'Reset' : 'Limpar'}
                                        </button>
                                    )}
                                </div>

                                <div className="p-3.5 space-y-3.5 max-h-[75vh] overflow-y-auto">
                                    {/* Direção */}
                                    <div>
                                        <span className="block text-[10px] font-semibold uppercase tracking-wider text-fg-subtle mb-1.5">
                                            {isEn ? 'Side' : 'Direção'}
                                        </span>
                                        <div className="grid grid-cols-3 gap-1 bg-canvas p-0.5 rounded-lg border border-line">
                                            {(isEn
                                                ? ([
                                                      { value: 'ALL', label: 'All' },
                                                      { value: 'BUY', label: 'Long' },
                                                      { value: 'SELL', label: 'Short' },
                                                  ] as const)
                                                : ([
                                                      { value: 'ALL', label: 'Todos' },
                                                      { value: 'BUY', label: 'Compra' },
                                                      { value: 'SELL', label: 'Venda' },
                                                  ] as const)
                                            ).map(opt => (
                                                <button
                                                    key={opt.value}
                                                    type="button"
                                                    onClick={() => setSideFilter(opt.value)}
                                                    className={`py-1.5 text-[11px] font-semibold rounded-md transition-colors cursor-pointer ${
                                                        filters.side === opt.value
                                                            ? 'bg-surface-2 text-fg shadow-sm border border-line'
                                                            : 'text-fg-subtle hover:text-fg border border-transparent'
                                                    }`}
                                                >
                                                    {opt.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Resultado */}
                                    <div>
                                        <span className="block text-[10px] font-semibold uppercase tracking-wider text-fg-subtle mb-1.5">
                                            {isEn ? 'Outcome' : 'Resultado'}
                                        </span>
                                        <div className="grid grid-cols-4 gap-1 bg-canvas p-0.5 rounded-lg border border-line">
                                            {(isEn
                                                ? ([
                                                      { value: 'ALL', label: 'All' },
                                                      { value: 'WIN', label: 'Win' },
                                                      { value: 'LOSS', label: 'Loss' },
                                                      { value: 'BE', label: 'BE' },
                                                  ] as const)
                                                : ([
                                                      { value: 'ALL', label: 'Todos' },
                                                      { value: 'WIN', label: 'Gain' },
                                                      { value: 'LOSS', label: 'Loss' },
                                                      { value: 'BE', label: 'BE' },
                                                  ] as const)
                                            ).map(opt => (
                                                <button
                                                    key={opt.value}
                                                    type="button"
                                                    onClick={() => setOutcomeFilter(opt.value)}
                                                    className={`py-1.5 text-[11px] font-semibold rounded-md transition-colors cursor-pointer ${
                                                        filters.outcome === opt.value
                                                            ? 'bg-surface-2 text-fg shadow-sm border border-line'
                                                            : 'text-fg-subtle hover:text-fg border border-transparent'
                                                    }`}
                                                >
                                                    {opt.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Sessão */}
                                    <div>
                                        <span className="block text-[10px] font-semibold uppercase tracking-wider text-fg-subtle mb-1.5">
                                            {isEn ? 'Sessions' : 'Sessões'}
                                        </span>
                                        <div className="grid grid-cols-2 gap-1.5">
                                            {sessionOptions.map(sess => {
                                                const active = filters.sessions.includes(sess.key);
                                                return (
                                                    <button
                                                        key={sess.key}
                                                        type="button"
                                                        onClick={() => toggleSessionFilter(sess.key)}
                                                        className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-medium text-left flex items-center justify-between transition-colors cursor-pointer ${
                                                            active
                                                                ? 'bg-accent/10 border-accent/40 text-accent-fg font-semibold'
                                                                : 'bg-canvas hover:bg-surface-2 border-line text-fg-muted hover:text-fg'
                                                        }`}
                                                    >
                                                        <span className="truncate">{sess.label}</span>
                                                        {active && <Check size={12} className="shrink-0" />}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {/* Ativos */}
                                    <div>
                                        <div className="flex items-center justify-between mb-1.5">
                                            <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
                                                {isEn ? 'Instruments' : 'Ativos'} ({availableSymbols.length})
                                            </span>
                                            {filters.symbols.length > 0 && (
                                                <button
                                                    type="button"
                                                    onClick={clearSymbolsFilter}
                                                    className="text-[10px] font-semibold text-fg-muted hover:text-fg cursor-pointer"
                                                >
                                                    {isEn ? 'All pairs' : 'Todos os ativos'}
                                                </button>
                                            )}
                                        </div>

                                        {availableSymbols.length === 0 ? (
                                            <p className="text-[11px] text-fg-subtle py-2 px-2.5 rounded-lg bg-canvas border border-line">
                                                {isEn
                                                    ? 'No instruments traded in this range.'
                                                    : 'Nenhum ativo operado no período atual.'}
                                            </p>
                                        ) : (
                                            <>
                                                {availableSymbols.length > 6 && (
                                                    <div className="relative mb-2">
                                                        <Search
                                                            size={12}
                                                            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle pointer-events-none"
                                                        />
                                                        <input
                                                            type="text"
                                                            value={symbolQuery}
                                                            onChange={e => setSymbolQuery(e.target.value)}
                                                            placeholder={isEn ? 'Search symbol...' : 'Buscar ativo...'}
                                                            className="w-full bg-canvas border border-line rounded-lg pl-7 pr-2.5 py-1.5 text-xs text-fg placeholder:text-fg-subtle focus:border-accent outline-none"
                                                        />
                                                    </div>
                                                )}

                                                <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto pr-0.5">
                                                    {filteredAvailableSymbols.map(sym => {
                                                        const active = filters.symbols.includes(sym);
                                                        return (
                                                            <button
                                                                key={sym}
                                                                type="button"
                                                                onClick={() => toggleSymbolFilter(sym)}
                                                                className={`px-2 py-1 rounded-md border text-[11px] font-mono font-medium transition-colors cursor-pointer ${
                                                                    active
                                                                        ? 'bg-accent/15 border-accent/45 text-accent-fg font-semibold'
                                                                        : 'bg-canvas hover:bg-surface-2 border-line text-fg-muted hover:text-fg'
                                                                }`}
                                                            >
                                                                {sym}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* 2. DATE RANGE POPOVER (Visível no Dashboard e Relatórios) */}
                {showAnalyticsFilters && (
                    <div className="relative">
                        <button
                            type="button"
                            onClick={() => togglePopover('date')}
                            className={`h-7 sm:h-8 px-1.5 sm:px-2.5 rounded-lg border text-[11px] sm:text-[11.5px] font-medium flex items-center gap-1 sm:gap-1.5 transition-all cursor-pointer focus:outline-none ${
                                openPopover === 'date' || dateRange.preset !== 'all'
                                    ? 'bg-surface-2 border-accent/45 text-fg shadow-xs'
                                    : 'bg-surface/80 hover:bg-surface-2 border-line hover:border-line-strong text-fg-muted hover:text-fg'
                            }`}
                            title={isEn ? 'Select date range' : 'Selecionar intervalo de datas'}
                        >
                            <Calendar
                                size={13}
                                className={dateRange.preset !== 'all' ? 'text-accent-fg' : 'text-fg-subtle'}
                            />
                            <span className="hidden sm:inline truncate max-w-[130px] tabular-nums">
                                {dateRange.preset === 'all' ? (isEn ? 'Timeframe' : 'Período') : dateRange.label}
                            </span>
                            <ChevronDown
                                size={13}
                                className={`hidden sm:block text-fg-subtle transition-transform duration-150 ${
                                    openPopover === 'date' ? 'rotate-180 text-accent-fg' : ''
                                }`}
                            />
                        </button>

                        {openPopover === 'date' && (
                            <div className="fixed inset-x-3 top-14 sm:inset-auto sm:absolute sm:right-0 sm:top-auto sm:mt-2 sm:w-72 rounded-xl bg-surface border border-line-strong shadow-panel backdrop-blur-xl z-50 overflow-hidden animate-fade-in-up">
                                <div className="px-3.5 py-2.5 border-b border-line bg-canvas-subtle flex items-center justify-between">
                                    <span className="text-xs font-semibold text-fg">
                                        {isEn ? 'Timeframe' : 'Período Operacional'}
                                    </span>
                                    <span className="text-[11px] font-medium text-accent-fg tabular-nums">
                                        {dateRange.label}
                                    </span>
                                </div>

                                <div className="p-3 space-y-3">
                                    <div className="grid grid-cols-2 gap-1.5">
                                        {datePresetOptions.map(opt => {
                                            const active = dateRange.preset === opt.value;
                                            return (
                                                <button
                                                    key={opt.value}
                                                    type="button"
                                                    onClick={() => {
                                                        setDatePreset(opt.value);
                                                        setOpenPopover(null);
                                                    }}
                                                    className={`px-2.5 py-2 rounded-lg border text-xs font-medium text-left flex items-center justify-between transition-colors cursor-pointer ${
                                                        active
                                                            ? 'bg-accent/10 border-accent/40 text-accent-fg font-semibold'
                                                            : 'bg-canvas hover:bg-surface-2 border-line text-fg-muted hover:text-fg'
                                                    }`}
                                                >
                                                    <span>{opt.shortLabel}</span>
                                                    {active && <Check size={12} />}
                                                </button>
                                            );
                                        })}
                                    </div>

                                    <div className="pt-2.5 border-t border-line space-y-2">
                                        <span className="block text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
                                            {isEn ? 'Custom Range' : 'Intervalo Personalizado'}
                                        </span>
                                        <div className="grid grid-cols-2 gap-2">
                                            <div>
                                                <label className="block text-[10px] text-fg-muted mb-1">
                                                    {isEn ? 'Start' : 'Início'}
                                                </label>
                                                <input
                                                    type="date"
                                                    value={draftStart}
                                                    onChange={e => setDraftStart(e.target.value)}
                                                    className="w-full bg-canvas border border-line rounded-lg px-2 py-1.5 text-[11px] text-fg tabular-nums focus:border-accent outline-none"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-[10px] text-fg-muted mb-1">
                                                    {isEn ? 'End' : 'Fim'}
                                                </label>
                                                <input
                                                    type="date"
                                                    value={draftEnd}
                                                    onChange={e => setDraftEnd(e.target.value)}
                                                    className="w-full bg-canvas border border-line rounded-lg px-2 py-1.5 text-[11px] text-fg tabular-nums focus:border-accent outline-none"
                                                />
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            disabled={!draftStart}
                                            onClick={handleApplyCustomDates}
                                            className="w-full py-2 rounded-lg bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:pointer-events-none text-accent-on font-semibold text-xs transition-colors cursor-pointer"
                                        >
                                            {isEn ? 'Apply Range' : 'Aplicar Período'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* 3. SELETOR DE CONTA DE TRADING (NOME DA CONTA / NÚMERO) */}
                <div className="relative">
                    <button
                        type="button"
                        onClick={() => togglePopover('account')}
                        className={`h-7 sm:h-8 px-1.5 sm:px-2.5 rounded-lg border transition-all duration-150 group flex items-center gap-1 sm:gap-2 max-w-[96px] xs:max-w-[120px] sm:max-w-none focus:outline-none cursor-pointer ${
                            openPopover === 'account'
                                ? 'bg-surface-2 border-accent/50 shadow-xs'
                                : 'bg-surface/80 hover:bg-surface-2 border-line hover:border-line-strong'
                        }`}
                        title={isEn ? 'Switch Trading Account' : 'Alternar Conta de Trading'}
                    >
                        <div className="flex flex-col text-left min-w-0">
                            <div className="flex items-center gap-1 sm:gap-1.5 min-w-0">
                                {!isConsolidated && selectedAccount ? (
                                    <span
                                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${getTypeTone(selectedAccount.type).dotClass}`}
                                    />
                                ) : (
                                    <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-purple" />
                                )}
                                <span className="text-[10px] sm:text-xs font-bold text-fg uppercase tracking-tight max-w-[62px] xs:max-w-[82px] sm:max-w-[150px] truncate leading-none">
                                    {isConsolidated
                                        ? isEn
                                            ? 'All'
                                            : 'Todas'
                                        : selectedAccount?.name || (isEn ? 'Primary' : 'Principal')}
                                </span>
                            </div>
                            <span className="hidden sm:block text-[10px] font-mono tabular-nums text-fg-muted leading-none mt-1 truncate max-w-[160px]">
                                {accountNumberSubtitle}
                            </span>
                        </div>

                        <ChevronDown
                            size={12}
                            className={`text-fg-subtle transition-transform duration-150 shrink-0 ${
                                openPopover === 'account' ? 'rotate-180 text-accent-fg' : 'group-hover:text-fg-muted'
                            }`}
                        />
                    </button>

                    {openPopover === 'account' && (
                        <div className="fixed inset-x-3 top-14 sm:inset-auto sm:absolute sm:right-0 sm:top-auto sm:mt-2 sm:w-80 rounded-xl bg-surface border border-line-strong shadow-panel backdrop-blur-xl z-50 overflow-hidden animate-fade-in-up">
                            <div className="px-3.5 py-2.5 border-b border-line flex items-center justify-between bg-canvas-subtle">
                                <span className="text-xs font-semibold text-fg">
                                    {isEn ? 'Trading Accounts' : 'Contas de Trading'}
                                </span>
                                <span className="text-[11px] text-fg-subtle tabular-nums font-medium">
                                    {activeAccounts.length}{' '}
                                    {isEn
                                        ? 'active'
                                        : activeAccounts.length === 1
                                          ? 'ativa'
                                          : 'ativas'}
                                </span>
                            </div>

                            {/* Visão Consolidada */}
                            <div className="p-1.5 border-b border-line">
                                <button
                                    type="button"
                                    onClick={() => {
                                        selectAccount('all');
                                        setOpenPopover(null);
                                    }}
                                    className={`w-full flex items-center justify-between p-2.5 rounded-lg text-left transition-all cursor-pointer ${
                                        isConsolidated
                                            ? 'bg-surface-2 border border-line-strong text-fg'
                                            : 'hover:bg-surface-2 text-fg-muted hover:text-fg border border-transparent'
                                    }`}
                                >
                                    <div className="flex items-center gap-2.5 overflow-hidden">
                                        <div
                                            className={`w-7 h-7 rounded-md flex items-center justify-center border shrink-0 ${
                                                isConsolidated
                                                    ? 'bg-purple/20 border-purple/40 text-purple-light'
                                                    : 'bg-surface-2 border-line text-fg-subtle'
                                            }`}
                                        >
                                            <Layers size={14} />
                                        </div>
                                        <div>
                                            <span className="text-xs font-semibold block leading-tight text-fg">
                                                {isEn ? 'All Accounts' : 'Todas as Contas'}
                                            </span>
                                            <span className="text-[11px] text-fg-subtle">
                                                {isEn ? 'Consolidated view' : 'Visão consolidada'} ({activeAccounts.length})
                                            </span>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2 shrink-0 pl-2">
                                        <span
                                            className={`text-xs tabular-nums font-semibold ${
                                                totalConsolidatedPnl >= 0 ? 'text-accent-fg' : 'text-danger-fg'
                                            }`}
                                        >
                                            {totalConsolidatedPnl >= 0 ? '+' : ''}
                                            {formatMoney(totalConsolidatedPnl)}
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
                                            type="button"
                                            onClick={() => {
                                                selectAccount(account.id);
                                                setOpenPopover(null);
                                            }}
                                            className={`w-full flex items-center justify-between p-2.5 rounded-lg text-left transition-all cursor-pointer ${
                                                isSelected
                                                    ? 'bg-accent/10 border border-accent/30 text-fg'
                                                    : 'hover:bg-surface-2 text-fg-muted hover:text-fg border border-transparent'
                                            }`}
                                        >
                                            <div className="flex items-center gap-2.5 min-w-0">
                                                <div
                                                    className={`w-7 h-7 rounded-md flex items-center justify-center border shrink-0 ${
                                                        isSelected
                                                            ? 'bg-accent/15 border-accent/30'
                                                            : 'bg-surface-2 border-line'
                                                    }`}
                                                >
                                                    {tone.icon}
                                                </div>

                                                <div className="flex flex-col min-w-0 truncate">
                                                    <span className="text-xs font-semibold text-fg truncate leading-tight">
                                                        {account.name}
                                                    </span>
                                                    <span className="text-[11px] font-mono text-fg-subtle truncate mt-0.5">
                                                        {account.mt5Id ? `#${account.mt5Id} · ` : ''}
                                                        {account.broker} · {tone.label}
                                                    </span>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-2 shrink-0 pl-2">
                                                <span
                                                    className={`text-xs tabular-nums font-semibold ${
                                                        netPnl >= 0 ? 'text-accent-fg' : 'text-danger-fg'
                                                    }`}
                                                >
                                                    {netPnl >= 0 ? '+' : ''}
                                                    {formatMoney(netPnl, account.currency)}
                                                </span>
                                                {isSelected && <Check size={14} className="text-accent-fg" />}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>

                            <div className="p-2 border-t border-line bg-canvas-subtle">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setOpenPopover(null);
                                        navigate('/profile');
                                    }}
                                    className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-surface hover:bg-surface-2 text-fg-muted hover:text-fg border border-line text-xs font-medium transition-colors cursor-pointer"
                                >
                                    <Briefcase size={13} className="text-fg-subtle" />
                                    <span>{isEn ? 'Manage Accounts' : 'Gerenciar Contas'}</span>
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* 3.4 BADGE DE EXPIRAÇÃO PRÓXIMA (<= 5 DIAS) */}
                {subStatus?.hasActive && typeof subStatus.daysLeft === 'number' && subStatus.daysLeft <= 5 && (
                    <button
                        type="button"
                        onClick={() => {
                            trackButtonClick({
                                ctaTag: 'header_expiry_pill',
                                intent: 'renewal',
                                label: `Header Expiry Pill (${subStatus.daysLeft}d)`,
                                metadata: {
                                    daysLeft: subStatus.daysLeft,
                                    tier: subStatus.tier,
                                    isTrial: Boolean(subStatus.isTrial),
                                },
                            });
                            openWorkspacePlansModal('header_expiry_pill', {
                                daysLeft: subStatus.daysLeft,
                                tier: subStatus.tier,
                            });
                        }}
                        title={
                            isEn
                                ? `Your ${subStatus.tier}${subStatus.isTrial ? ' trial' : ' plan'} expires in ${subStatus.daysLeft} day(s). Click to renew now and avoid interruptions.`
                                : `O seu plano ${subStatus.tier}${subStatus.isTrial ? ' (Teste)' : ''} expira em ${subStatus.daysLeft} dia(s). Clique para renovar e manter acesso contínuo.`
                        }
                        className={`hidden sm:inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border text-[11px] font-bold transition-all cursor-pointer shrink-0 ${
                            subStatus.daysLeft <= 2
                                ? 'bg-danger/15 border-danger/35 text-danger-fg hover:bg-danger/25'
                                : 'bg-amber-500/15 border-amber-500/35 text-amber-400 hover:bg-amber-500/25'
                        }`}
                    >
                        <Clock size={12} />
                        <span className="tabular-nums">
                            {subStatus.daysLeft === 0
                                ? isEn
                                    ? 'Expires today'
                                    : 'Expira hoje'
                                : isEn
                                  ? `Renews in ${subStatus.daysLeft}d`
                                  : `Expira em ${subStatus.daysLeft}d`}
                        </span>
                    </button>
                )}

                {/* 3.5 INDICADOR OFFLINE & FILA DE SINCRONIZAÇÃO */}
                <OfflineSyncIndicator />

                {/* 4. AÇÕES DISCRETAS DE IDIOMA, TEMA & NOTIFICAÇÕES (Desktop) */}
                <div className="hidden sm:flex items-center gap-1 pl-0.5">
                    <LanguageSwitcher variant="compact" className="mr-0.5" />
                    <button
                        type="button"
                        onClick={toggleTheme}
                        className="w-7 h-7 rounded-lg hover:bg-surface-2 text-fg-subtle hover:text-fg transition-colors flex items-center justify-center focus:outline-none cursor-pointer"
                        title={
                            theme === 'dark'
                                ? isEn
                                    ? 'Switch to Light Mode'
                                    : 'Alternar para Modo Claro'
                                : isEn
                                  ? 'Switch to Dark Mode'
                                  : 'Alternar para Modo Escuro'
                        }
                    >
                        {theme === 'dark' ? <Sun size={14} className="text-warning" /> : <Moon size={14} />}
                    </button>

                    <NavLink
                        to="/notifications"
                        className="w-7 h-7 rounded-lg hover:bg-surface-2 text-fg-subtle hover:text-fg transition-colors flex items-center justify-center focus:outline-none"
                        title={isEn ? 'Notifications' : 'Notificações'}
                    >
                        <Bell size={14} />
                    </NavLink>
                </div>

                {/* 5. AVATAR CIRCULAR COM ANEL POR PLANO (BASIC=AMARELO, PRO=VERMELHO, PREMIUM=EMERALD) */}
                <div className="relative pl-0.5">
                    <button
                        type="button"
                        onClick={() => togglePopover('user')}
                        className={`w-8 h-8 rounded-full flex items-center justify-center bg-surface-2 text-fg font-bold text-[11px] overflow-hidden transition-all duration-200 cursor-pointer focus:outline-none ring-2 ring-offset-2 ring-offset-canvas ${avatarRingClass}`}
                        title={isEn ? `${displayName}'s Profile (${normalizedTier})` : `Perfil de ${displayName} (${normalizedTier})`}
                    >
                        {user?.avatarUrl ? (
                            <img src={user.avatarUrl} alt={displayName} className="w-full h-full object-cover" />
                        ) : (
                            <span className="tracking-tight">{initials}</span>
                        )}
                    </button>

                    {openPopover === 'user' && (
                        <div className="absolute right-0 mt-2 w-64 rounded-xl bg-surface border border-line-strong shadow-panel backdrop-blur-xl z-50 overflow-hidden animate-fade-in-up">
                            <div className="p-3.5 border-b border-line bg-canvas-subtle space-y-2.5">
                                <div className="flex items-center gap-3">
                                    <div className={`w-10 h-10 rounded-full bg-surface-2 text-fg font-bold text-sm flex items-center justify-center ring-2 ${popoverAvatarRingClass} ring-offset-2 ring-offset-canvas-subtle shrink-0 overflow-hidden`}>
                                        {user?.avatarUrl ? (
                                            <img
                                                src={user.avatarUrl}
                                                alt={displayName}
                                                className="w-full h-full object-cover rounded-full"
                                            />
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
                                        <p className={`text-[11px] font-bold mt-1 ${tierLabelColorClass}`}>
                                            {isEn ? `${user?.tier || 'PRO'} Plan` : `Plano ${user?.tier || 'PRO'}`}
                                        </p>
                                    </div>
                                </div>
                                <BasicPlanSimpleUpgradeCard compact />
                            </div>

                            <div className="p-1.5 space-y-0.5">
                                {/* Atalhos mobile para Tema e Notificações */}
                                <div className="flex sm:hidden items-center gap-1 pb-1 mb-1 border-b border-line">
                                    <button
                                        type="button"
                                        onClick={toggleTheme}
                                        className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium text-fg-muted hover:text-fg hover:bg-surface-2"
                                    >
                                        {theme === 'dark' ? <Sun size={14} className="text-warning" /> : <Moon size={14} />}
                                        <span>
                                            {theme === 'dark'
                                                ? isEn
                                                    ? 'Light Mode'
                                                    : 'Modo Claro'
                                                : isEn
                                                  ? 'Dark Mode'
                                                  : 'Modo Escuro'}
                                        </span>
                                    </button>
                                    <NavLink
                                        to="/notifications"
                                        onClick={() => setOpenPopover(null)}
                                        className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium text-fg-muted hover:text-fg hover:bg-surface-2"
                                    >
                                        <Bell size={14} />
                                        <span>{isEn ? 'Alerts' : 'Alertas'}</span>
                                    </NavLink>
                                </div>

                                <LanguageSwitcher variant="menu" onSwitched={() => setOpenPopover(null)} />

                                <NavLink
                                    to="/profile"
                                    onClick={() => setOpenPopover(null)}
                                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors"
                                >
                                    <User size={15} className="text-accent-fg" />
                                    <span>{isEn ? 'Profile & Accounts' : 'Meu Perfil & Contas'}</span>
                                </NavLink>

                                <NavLink
                                    to="/leaderboard"
                                    onClick={() => setOpenPopover(null)}
                                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors"
                                >
                                    <Trophy size={15} className="text-warning" />
                                    <span>{isEn ? 'Leaderboard' : 'Tabela de Classificação'}</span>
                                </NavLink>

                                <NavLink
                                    to="/configuration"
                                    onClick={() => setOpenPopover(null)}
                                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors"
                                >
                                    <Settings size={15} className="text-fg-subtle" />
                                    <span>{isEn ? 'Settings' : 'Configurações'}</span>
                                </NavLink>

                                <NavLink
                                    to="/payments"
                                    onClick={() => setOpenPopover(null)}
                                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors"
                                >
                                    <CreditCard size={15} className="text-fg-subtle" />
                                    <span>{isEn ? 'Plans & Billing' : 'Planos & Assinatura'}</span>
                                </NavLink>
                            </div>

                            <div className="p-1.5 border-t border-line bg-canvas-subtle">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setOpenPopover(null);
                                        logout();
                                    }}
                                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-danger-fg hover:bg-danger/10 transition-colors cursor-pointer"
                                >
                                    <LogOut size={15} />
                                    <span>{isEn ? 'Sign Out' : 'Sair da Conta'}</span>
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </header>
    );
};
