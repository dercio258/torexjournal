import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Building2, Check, Search, X } from 'lucide-react';
import { MT5_BROKERS_CATALOG } from '../../constants/mt5ServersCatalog';
import { BrokerLogo } from '../../components/ui/BrokerLogo';
import { useLocale } from '../../context/LocaleContext';

interface Mt5ServerModalProps {
    isOpen: boolean;
    currentServer: string;
    initialBrokerFilter?: string;
    onSelect: (serverName: string, brokerName?: string) => void;
    onClose: () => void;
}

const getCategoryLabels = (isEn: boolean): Record<string, string> => ({
    ALL: isEn ? 'All' : 'Todas',
    Deriv: 'Deriv',
    'Forex / ECN': isEn ? 'Brokers' : 'Corretoras',
    'Prop Firm': isEn ? 'Prop Firms' : 'Mesas Prop',
    MetaQuotes: 'MetaQuotes',
});

export const Mt5ServerModal = ({
    isOpen,
    currentServer,
    initialBrokerFilter = 'ALL',
    onSelect,
    onClose,
}: Mt5ServerModalProps) => {
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const CATEGORY_LABELS = getCategoryLabels(isEn);
    const [searchQuery, setSearchQuery] = useState('');
    const [brokerFilter, setBrokerFilter] = useState<string>(initialBrokerFilter || 'ALL');
    const [envFilter, setEnvFilter] = useState<'ALL' | 'DEMO' | 'REAL'>('ALL');

    useEffect(() => {
        if (isOpen) {
            setBrokerFilter(initialBrokerFilter || 'ALL');
            setSearchQuery('');
        }
    }, [isOpen, initialBrokerFilter]);

    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    const filteredGroups = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        return MT5_BROKERS_CATALOG.map((group) => {
            if (brokerFilter !== 'ALL' && group.id !== brokerFilter && group.category !== brokerFilter) {
                return null;
            }
            const brokerMatches =
                !q ||
                group.broker.toLowerCase().includes(q) ||
                group.id.toLowerCase().includes(q) ||
                group.category.toLowerCase().includes(q);

            const matchingServers = group.servers.filter((srv) => {
                if (envFilter !== 'ALL' && srv.env !== envFilter) return false;
                if (!q || brokerMatches) return true;
                return (
                    srv.name.toLowerCase().includes(q) ||
                    (srv.description && srv.description.toLowerCase().includes(q))
                );
            });

            if (matchingServers.length === 0) return null;
            return { ...group, servers: matchingServers };
        }).filter(Boolean) as typeof MT5_BROKERS_CATALOG;
    }, [searchQuery, brokerFilter, envFilter]);

    if (!isOpen || typeof document === 'undefined') return null;

    const customCandidate = searchQuery.trim() || currentServer.trim();

    return createPortal(
        <div
            className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150"
            onClick={onClose}
        >
            <div
                className="relative w-full sm:max-w-3xl max-h-[90dvh] sm:max-h-[85vh] flex flex-col bg-surface border-t sm:border border-line-strong rounded-t-2xl sm:rounded-2xl shadow-panel overflow-hidden animate-in zoom-in-95 duration-150"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="px-4 sm:px-6 py-4 border-b border-line flex items-center justify-between gap-3 shrink-0 bg-canvas-subtle">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center text-accent-fg shrink-0">
                            <Building2 size={18} />
                        </div>
                        <div className="min-w-0">
                            <h3 className="text-sm sm:text-base font-bold text-fg truncate">
                                {isEn ? 'Select Broker Trade Server' : 'Escolher Servidor da Corretora'}
                            </h3>
                            <p className="text-xs text-fg-muted truncate">
                                {isEn
                                    ? 'Search by broker name or pick the exact server listed in your terminal'
                                    : 'Busque pelo nome da corretora ou selecione o servidor da sua conta'}
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-2 rounded-xl bg-surface-2 hover:bg-surface-3 text-fg-muted hover:text-fg border border-line transition-colors shrink-0"
                        aria-label={isEn ? 'Close' : 'Fechar'}
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* Search & Filters */}
                <div className="p-3.5 sm:p-4 bg-surface border-b border-line space-y-3 shrink-0">
                    <div className="flex flex-col sm:flex-row gap-2">
                        <div className="relative flex-1">
                            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
                            <input
                                type="text"
                                autoFocus
                                placeholder={
                                    isEn
                                        ? 'Search broker or server (e.g., Deriv, Exness, FTMO)...'
                                        : 'Buscar corretora ou servidor (ex: Deriv, Exness, FTMO)...'
                                }
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full bg-canvas border border-line hover:border-line-strong focus:border-accent/60 rounded-xl py-2.5 pl-9 pr-8 text-xs sm:text-sm text-fg placeholder:text-fg-subtle focus:outline-none transition-colors"
                            />
                            {searchQuery && (
                                <button
                                    type="button"
                                    onClick={() => setSearchQuery('')}
                                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-fg-subtle hover:text-fg p-0.5"
                                    aria-label={isEn ? 'Clear search' : 'Limpar busca'}
                                >
                                    <X size={14} />
                                </button>
                            )}
                        </div>

                        <select
                            value={brokerFilter}
                            onChange={(e) => setBrokerFilter(e.target.value)}
                            className="bg-canvas border border-line hover:border-line-strong focus:border-accent/60 rounded-xl py-2.5 px-3 text-xs sm:text-sm text-fg focus:outline-none sm:w-56"
                        >
                            <option value="ALL">
                                {isEn ? `All brokers (${MT5_BROKERS_CATALOG.length})` : `Todas as corretoras (${MT5_BROKERS_CATALOG.length})`}
                            </option>
                            {MT5_BROKERS_CATALOG.map((b) => (
                                <option key={b.id} value={b.id}>
                                    {b.broker}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                            {(['ALL', 'Deriv', 'Forex / ECN', 'Prop Firm'] as const).map((tab) => (
                                <button
                                    key={tab}
                                    type="button"
                                    onClick={() => setBrokerFilter(tab)}
                                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors border ${
                                        brokerFilter === tab
                                            ? 'bg-accent/15 text-accent-fg border-accent/30'
                                            : 'bg-canvas text-fg-muted hover:text-fg border-line'
                                    }`}
                                >
                                    {CATEGORY_LABELS[tab]}
                                </button>
                            ))}
                        </div>

                        <div className="flex items-center gap-1 bg-canvas p-0.5 rounded-lg border border-line">
                            {(['ALL', 'REAL', 'DEMO'] as const).map((env) => (
                                <button
                                    key={env}
                                    type="button"
                                    onClick={() => setEnvFilter(env)}
                                    className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                                        envFilter === env
                                            ? 'bg-surface-2 text-fg shadow-xs'
                                            : 'text-fg-subtle hover:text-fg'
                                    }`}
                                >
                                    {env === 'ALL' ? (isEn ? 'All' : 'Todas') : env === 'REAL' ? (isEn ? 'Live' : 'Real') : 'Demo'}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Custom server quick action when typing */}
                {searchQuery.trim() && (
                    <div className="px-4 py-2.5 bg-canvas-subtle border-b border-line flex items-center justify-between gap-2 shrink-0">
                        <span className="text-xs text-fg-muted truncate">
                            {isEn ? 'Use custom server:' : 'Usar servidor digitado:'}{' '}
                            <strong className="text-fg font-mono">{customCandidate}</strong>
                        </span>
                        <button
                            type="button"
                            onClick={() => {
                                onSelect(customCandidate);
                                onClose();
                            }}
                            className="px-3 py-1 rounded-lg bg-accent/15 hover:bg-accent/25 text-accent-fg border border-accent/30 text-xs font-semibold shrink-0 transition-colors"
                        >
                            {isEn ? 'Use this name' : 'Usar este nome'}
                        </button>
                    </div>
                )}

                {/* Results list */}
                <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-line">
                    {filteredGroups.length === 0 ? (
                        <div className="p-8 text-center space-y-3">
                            <p className="text-sm text-fg font-medium">
                                {isEn
                                    ? `No listed servers match "${searchQuery}".`
                                    : `Nenhum servidor listado para "${searchQuery}".`}
                            </p>
                            <p className="text-xs text-fg-muted max-w-md mx-auto">
                                {isEn
                                    ? 'You can connect using the exact server name displayed inside your MetaTrader 5 terminal.'
                                    : 'Você pode usar exatamente o nome que aparece no seu MetaTrader 5.'}
                            </p>
                            {searchQuery.trim() && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        onSelect(searchQuery.trim());
                                        onClose();
                                    }}
                                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent/15 text-accent-fg border border-accent/30 text-xs font-semibold hover:bg-accent/25 transition-colors"
                                >
                                    <Check size={14} />
                                    {isEn ? `Use "${searchQuery.trim()}"` : `Usar "${searchQuery.trim()}"`}
                                </button>
                            )}
                        </div>
                    ) : (
                        filteredGroups.map((group) => (
                            <div key={group.id} className="p-4 space-y-3">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2.5 min-w-0">
                                        <BrokerLogo broker={group} size="md" />
                                        <div className="min-w-0">
                                            <span className="text-sm font-bold text-fg block truncate">
                                                {group.broker}
                                            </span>
                                            <span className="text-[11px] text-fg-subtle">
                                                {CATEGORY_LABELS[group.category] || group.category}
                                            </span>
                                        </div>
                                    </div>
                                    <span className="text-[11px] text-fg-muted shrink-0">
                                        {group.servers.length}{' '}
                                        {isEn
                                            ? (group.servers.length === 1 ? 'server' : 'servers')
                                            : (group.servers.length === 1 ? 'opção' : 'opções')}
                                    </span>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    {group.servers.map((srv) => {
                                        const isSelected = currentServer.trim().toLowerCase() === srv.name.toLowerCase();
                                        return (
                                            <button
                                                key={srv.name}
                                                type="button"
                                                onClick={() => {
                                                    onSelect(srv.name, group.broker);
                                                    onClose();
                                                }}
                                                className={`text-left px-3 py-2.5 rounded-xl border transition-all flex items-center justify-between gap-2.5 ${
                                                    isSelected
                                                        ? 'bg-accent/15 border-accent/40 text-fg'
                                                        : 'bg-canvas border-line hover:border-accent/30 hover:bg-surface-2 text-fg'
                                                }`}
                                            >
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="text-xs font-mono font-semibold truncate">
                                                            {srv.name}
                                                        </span>
                                                        {isSelected && <Check size={13} className="text-accent-fg shrink-0" />}
                                                    </div>
                                                    {srv.description && (
                                                        <p className="text-[11px] text-fg-muted truncate mt-0.5">
                                                            {srv.description}
                                                        </p>
                                                    )}
                                                </div>
                                                <span
                                                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-md shrink-0 border ${
                                                        srv.env === 'DEMO'
                                                            ? 'bg-sky-500/10 text-sky-500 dark:text-sky-300 border-sky-500/20'
                                                            : 'bg-accent/10 text-accent-fg border-accent/20'
                                                    }`}
                                                >
                                                    {srv.env === 'DEMO' ? 'Demo' : 'Real'}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
};
