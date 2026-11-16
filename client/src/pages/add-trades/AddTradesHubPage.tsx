import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, ChevronRight, FileSpreadsheet, Monitor, Search, X } from 'lucide-react';
import { MT5_BROKERS_CATALOG, Mt5BrokerGroup } from '../../constants/mt5ServersCatalog';
import { BrokerLogo } from '../../components/ui/BrokerLogo';
import { DerivIcon, Mt5Icon } from './icons';
import { useLocale } from '../../context/LocaleContext';

type CategoryFilter = 'ALL' | 'POPULAR' | 'Prop Firm' | 'Forex / ECN';

const getCategoryShort = (isEn: boolean): Record<string, string> => ({
    'Prop Firm': 'Prop Firm',
    'Forex / ECN': isEn ? 'FX / ECN' : 'Forex',
    Deriv: 'Deriv',
    MetaQuotes: 'MT5',
});

export const AddTradesHubPage = () => {
    const navigate = useNavigate();
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const CATEGORY_SHORT = getCategoryShort(isEn);
    const [search, setSearch] = useState('');
    const [category, setCategory] = useState<CategoryFilter>('ALL');

    const options = [
        {
            to: '/add-trades/deriv-sync',
            title: 'Deriv',
            tag: isEn ? 'Auto-Sync' : 'Automático',
            description: isEn ? 'Link your account via API token.' : 'Vincule sua conta com chave de acesso.',
            icon: (
                <div className="w-10 h-10 rounded-xl bg-canvas-subtle border border-line flex items-center justify-center shrink-0 p-2">
                    <DerivIcon className="w-full h-full" />
                </div>
            ),
        },
        {
            to: '/add-trades/mt5-sync',
            title: 'MetaTrader 5',
            tag: isEn ? 'Auto-Sync' : 'Automático',
            description: isEn
                ? 'Connect via account login, investor password & server.'
                : 'Entre com login, senha e servidor da corretora.',
            icon: (
                <div className="w-10 h-10 rounded-xl bg-canvas-subtle border border-line flex items-center justify-center shrink-0 p-2">
                    <Mt5Icon className="w-full h-full" />
                </div>
            ),
        },
        {
            to: '/add-trades/mt5-ea',
            title: isEn ? 'Desktop EA Bridge' : 'Conector PC',
            tag: 'Windows',
            description: isEn
                ? 'Stream executions directly from your local MT5 terminal.'
                : 'Envie direto da plataforma instalada no seu PC.',
            icon: (
                <div className="w-10 h-10 rounded-xl bg-canvas-subtle border border-line flex items-center justify-center text-fg shrink-0">
                    <Monitor size={18} />
                </div>
            ),
        },
        {
            to: '/add-trades/import',
            title: isEn ? 'Import File' : 'Importar Arquivo',
            tag: 'CSV · XLSX · HTML',
            description: isEn
                ? 'Upload broker statements or custom trade CSVs.'
                : 'Carregue relatórios ou planilhas do seu histórico.',
            icon: (
                <div className="w-10 h-10 rounded-xl bg-canvas-subtle border border-line flex items-center justify-center text-accent-fg shrink-0">
                    <FileSpreadsheet size={18} />
                </div>
            ),
        },
    ];

    const hasSearchQuery = search.trim().length > 0;

    const filteredBrokers = useMemo(() => {
        const q = search.trim().toLowerCase();
        return MT5_BROKERS_CATALOG.filter((group) => {
            if (!q && (group.id === 'deriv' || group.id === 'metaquotes')) {
                return false;
            }
            if (category === 'POPULAR' && !group.popular) return false;
            if (category !== 'ALL' && category !== 'POPULAR' && group.category !== category) {
                return false;
            }
            if (!q) return true;
            return (
                group.broker.toLowerCase().includes(q) ||
                group.category.toLowerCase().includes(q) ||
                group.servers.some(
                    (s) =>
                        s.name.toLowerCase().includes(q) ||
                        (s.description && s.description.toLowerCase().includes(q))
                )
            );
        });
    }, [search, category]);

    const handleSelectBroker = (group: Mt5BrokerGroup, chosenServer?: string) => {
        const server = chosenServer || group.servers[0]?.name || '';
        const params = new URLSearchParams();
        params.set('broker', group.broker);
        params.set('brokerId', group.id);
        if (server) params.set('server', server);
        navigate(`/add-trades/mt5-sync?${params.toString()}`);
    };

    return (
        <div className="space-y-4">
            {/* Primary Connection Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                {options.map((opt) => (
                    <Link
                        key={opt.to}
                        to={opt.to}
                        className="group rounded-xl border border-line bg-surface hover:bg-surface-2 hover:border-line-strong p-4 transition-all flex items-start gap-3.5"
                    >
                        {opt.icon}

                        <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex flex-wrap items-center justify-between gap-1.5">
                                <h2 className="text-sm font-bold text-fg group-hover:text-accent-fg transition-colors">
                                    {opt.title}
                                </h2>
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-canvas-subtle border border-line-subtle text-fg-subtle">
                                    {opt.tag}
                                </span>
                            </div>
                            <p className="text-xs text-fg-muted leading-snug">
                                {opt.description}
                            </p>
                        </div>

                        <ChevronRight
                            size={15}
                            className="text-fg-subtle group-hover:text-accent-fg group-hover:translate-x-0.5 transition-all shrink-0 mt-1"
                        />
                    </Link>
                ))}
            </div>

            {/* Brokers & Prop Firms Directory */}
            <section className="rounded-xl border border-line bg-surface p-4 sm:p-5 space-y-3.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                    <div>
                        <h2 className="text-sm font-bold text-fg">
                            {isEn ? 'Brokers & Prop Firms' : 'Corretoras e Mesas Proprietárias'}
                        </h2>
                        <p className="text-[11px] text-fg-muted">
                            {isEn
                                ? 'Quick access to pre-configured MetaTrader 5 trade servers'
                                : 'Acesso rápido aos servidores MetaTrader 5 pré-configurados'}
                        </p>
                    </div>

                    <div className="flex flex-wrap gap-1 bg-canvas-subtle border border-line-subtle p-1 rounded-lg">
                        {(
                            [
                                { id: 'ALL', label: isEn ? 'All' : 'Todas' },
                                { id: 'POPULAR', label: isEn ? 'Popular' : 'Populares' },
                                { id: 'Prop Firm', label: isEn ? 'Prop Firms' : 'Mesas Prop' },
                                { id: 'Forex / ECN', label: isEn ? 'Brokers' : 'Corretoras' },
                            ] as const
                        ).map((tab) => (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => setCategory(tab.id)}
                                className={`px-2.5 h-7 rounded-md text-xs font-semibold transition-colors border ${
                                    category === tab.id
                                        ? 'bg-surface-2 border-line text-fg'
                                        : 'border-transparent text-fg-muted hover:text-fg'
                                }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" size={15} />
                    <input
                        type="text"
                        placeholder={
                            isEn
                                ? 'Search broker, prop firm, or server (e.g., FTMO, Exness, IC Markets, FundingPips)...'
                                : 'Buscar corretora, mesa ou servidor (ex: FTMO, Exness, IC Markets, FundingPips)...'
                        }
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full h-9 bg-canvas-subtle border border-line hover:border-line-strong focus:border-accent/50 rounded-lg pl-9 pr-8 text-xs sm:text-sm text-fg focus:outline-none transition-colors placeholder:text-fg-subtle"
                    />
                    {search && (
                        <button
                            type="button"
                            onClick={() => setSearch('')}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-fg-subtle hover:text-fg p-1 rounded"
                            aria-label={isEn ? 'Clear search' : 'Limpar'}
                        >
                            <X size={14} />
                        </button>
                    )}
                </div>

                {filteredBrokers.length === 0 ? (
                    <div className="text-center py-8 px-4 bg-canvas-subtle border border-line-subtle rounded-xl space-y-2.5">
                        <p className="text-xs sm:text-sm font-medium text-fg">
                            {isEn ? `No matches for "${search}".` : `Nenhum resultado para "${search}".`}
                        </p>
                        {hasSearchQuery && (
                            <button
                                type="button"
                                onClick={() =>
                                    navigate(`/add-trades/mt5-sync?server=${encodeURIComponent(search.trim())}`)
                                }
                                className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg bg-accent/15 text-accent-fg border border-accent/30 text-xs font-semibold hover:bg-accent/25 transition-colors"
                            >
                                {isEn ? `Use "${search.trim()}" on MetaTrader 5` : `Usar "${search.trim()}" no MetaTrader 5`}
                                <ArrowRight size={13} />
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
                        {filteredBrokers.map((group) => {
                            const matchingServers = hasSearchQuery
                                ? group.servers
                                      .filter((s) =>
                                          s.name.toLowerCase().includes(search.trim().toLowerCase())
                                      )
                                      .slice(0, 3)
                                : [];

                            return (
                                <div
                                    key={group.id}
                                    className="rounded-xl border border-line-subtle bg-canvas-subtle hover:bg-surface-2 hover:border-line transition-all p-3 flex flex-col justify-between gap-2 group"
                                >
                                    <button
                                        type="button"
                                        onClick={() => handleSelectBroker(group)}
                                        className="w-full flex items-center justify-between gap-2.5 text-left"
                                    >
                                        <div className="flex items-center gap-2.5 min-w-0">
                                            <BrokerLogo broker={group} size="md" />
                                            <div className="min-w-0">
                                                <h3 className="font-semibold text-xs sm:text-sm text-fg group-hover:text-accent-fg transition-colors truncate">
                                                    {group.broker}
                                                </h3>
                                                <span className="text-[10px] text-fg-subtle block">
                                                    {CATEGORY_SHORT[group.category] || group.category}
                                                </span>
                                            </div>
                                        </div>
                                        <ChevronRight
                                            size={14}
                                            className="text-fg-subtle group-hover:text-accent-fg group-hover:translate-x-0.5 transition-all shrink-0"
                                        />
                                    </button>

                                    {matchingServers.length > 0 && (
                                        <div className="pt-2 border-t border-line-subtle flex flex-wrap gap-1">
                                            {matchingServers.map((srv) => (
                                                <button
                                                    key={srv.name}
                                                    type="button"
                                                    onClick={() => handleSelectBroker(group, srv.name)}
                                                    className="px-1.5 py-0.5 rounded bg-surface hover:bg-accent/15 border border-line-subtle hover:border-accent/30 text-[10px] font-mono text-fg transition-colors truncate max-w-full"
                                                >
                                                    {srv.name}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>
        </div>
    );
};
