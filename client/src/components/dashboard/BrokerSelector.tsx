import { useState, useMemo } from 'react';
import { Monitor, Upload, Search, Lock, Building2, ChevronRight } from 'lucide-react';
import { MT5_BROKERS_CATALOG, Mt5BrokerGroup } from '../../constants/mt5ServersCatalog';
import { BrokerLogo } from '../ui/BrokerLogo';

export interface Broker {
    id: string;
    name: string;
    type: 'AUTO_SYNC' | 'MANUAL';
    icon: React.ReactNode;
    description: string;
    defaultServer?: string;
    brokerCatalogId?: string;
}

interface BrokerSelectorProps {
    onSelect: (broker: Broker) => void;
}

export const BrokerSelector = ({ onSelect }: BrokerSelectorProps) => {
    const [search, setSearch] = useState('');
    const [categoryFilter, setCategoryFilter] = useState<'ALL' | 'Deriv' | 'Forex / ECN' | 'Prop Firm' | 'MetaQuotes'>('ALL');

    const mainMethods: Broker[] = [
        {
            id: 'deriv',
            name: 'Deriv Autosync',
            type: 'AUTO_SYNC',
            icon: <img src="https://deriv.com/static/deriv-logo-c97b819f.svg" className="w-10 h-10" alt="Deriv" />,
            description: 'Sincronização automática da sua conta Deriv'
        },
        {
            id: 'mt5',
            name: 'Conectar MetaTrader 5',
            type: 'AUTO_SYNC',
            icon: <Monitor className="w-10 h-10 text-emerald-500" />,
            description: 'Sincronizar qualquer corretora automaticamente'
        },
        {
            id: 'mt4',
            name: 'Conectar MetaTrader 4',
            type: 'AUTO_SYNC',
            icon: <Monitor className="w-10 h-10 text-cyan-500" />,
            description: 'Sincronização automática para contas MT4'
        },
        {
            id: 'manual_csv',
            name: 'Importar Relatório (CSV / Excel / HTML / PDF)',
            type: 'MANUAL',
            icon: <Upload className="w-10 h-10 text-slate-400" />,
            description: 'Importar histórico de operações por arquivo'
        }
    ];

    const filteredMainMethods = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return mainMethods;
        return mainMethods.filter(
            (b) =>
                b.name.toLowerCase().includes(q) ||
                b.description.toLowerCase().includes(q)
        );
    }, [search]);

    const filteredCatalogBrokers = useMemo(() => {
        const q = search.trim().toLowerCase();
        return MT5_BROKERS_CATALOG.filter((group) => {
            if (categoryFilter !== 'ALL' && group.category !== categoryFilter) return false;
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
    }, [search, categoryFilter]);

    const handleSelectCatalogBroker = (group: Mt5BrokerGroup, chosenServer?: string) => {
        const defaultSrv = chosenServer || group.servers[0]?.name || '';
        onSelect({
            id: 'mt5_broker_direct',
            name: `${group.broker} (MT5)`,
            type: 'AUTO_SYNC',
            icon: <BrokerLogo broker={group} size="lg" />,
            description: `Servidor: ${defaultSrv}`,
            defaultServer: defaultSrv,
            brokerCatalogId: group.id,
        });
    };

    return (
        <div className="space-y-8">
            {/* Barra de Busca Global de Corretoras e Servidores */}
            <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#9CA3AF]" size={20} />
                <input
                    type="text"
                    placeholder="Pesquisar corretora ou servidor MT5 (Ex: Deriv, Exness, XM, FTMO, IC Markets, Deriv-Demo...)"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full bg-[#08090C] border border-white/[0.08] rounded-xl py-3.5 pl-11 pr-4 text-[#F3F4F6] focus:outline-none focus:border-emerald-500/50 transition-all placeholder:text-[#6B7280]"
                />
            </div>

            {/* Métodos Principais de Conexão */}
            {filteredMainMethods.length > 0 && (
                <div className="space-y-3">
                    <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                        Modos Principais de Conexão
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {filteredMainMethods.map((broker) => {
                            const isLocked = broker.id === 'mt4';
                            return (
                                <div
                                    key={broker.id}
                                    onClick={() => onSelect(broker)}
                                    className="group relative bg-[#111319] border border-white/[0.08] hover:bg-[#161822] hover:border-emerald-500/40 rounded-xl p-5 cursor-pointer transition-all flex items-center gap-4 overflow-hidden"
                                >
                                    {isLocked && (
                                        <div className="absolute top-3 right-3 text-[#6B7280] group-hover:text-emerald-400 transition-colors">
                                            <Lock size={14} />
                                        </div>
                                    )}
                                    <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/0 to-emerald-500/0 group-hover:from-emerald-500/5 group-hover:to-transparent transition-all" />

                                    <div className="relative shrink-0">{broker.icon}</div>

                                    <div className="relative">
                                        <h3 className="font-bold text-[#F3F4F6] group-hover:text-emerald-400 transition-colors">
                                            {broker.name}
                                        </h3>
                                        <div className="flex items-center gap-2 mt-1">
                                            <span
                                                className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                                                    broker.type === 'AUTO_SYNC'
                                                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                                        : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20'
                                                }`}
                                            >
                                                {broker.type === 'AUTO_SYNC' ? 'AUTO SYNC' : 'MULTI-FORMATO'}
                                            </span>
                                        </div>
                                        <p className="text-xs text-[#9CA3AF] mt-1 line-clamp-1">
                                            {broker.description}
                                        </p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Diretório Completo de Corretoras & Servidores MT5 Prontos */}
            <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                        <h2 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                            <Building2 size={16} className="text-emerald-400" />
                            Diretório de Corretoras &amp; Servidores MT5 ({filteredCatalogBrokers.length})
                        </h2>
                        <p className="text-xs text-slate-400">
                            Clique na sua corretora ou diretamente em um servidor pronto para conectar na Nuvem MT5.
                        </p>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                        {(['ALL', 'Deriv', 'Forex / ECN', 'Prop Firm', 'MetaQuotes'] as const).map((cat) => (
                            <button
                                key={cat}
                                type="button"
                                onClick={() => setCategoryFilter(cat)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                                    categoryFilter === cat
                                        ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                                        : 'bg-[#111319] border-white/[0.06] text-slate-400 hover:text-slate-200'
                                }`}
                            >
                                {cat === 'ALL' ? 'Todas' : cat}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredCatalogBrokers.map((group) => (
                        <div
                            key={group.id}
                            className="bg-[#111319] border border-white/[0.08] hover:border-emerald-500/40 rounded-xl p-4 transition-all flex flex-col justify-between gap-3 group"
                        >
                            <div>
                                <div
                                    onClick={() => handleSelectCatalogBroker(group)}
                                    className="flex items-start justify-between gap-2 cursor-pointer"
                                >
                                    <div className="flex items-center gap-2.5">
                                        <BrokerLogo broker={group} size="lg" />
                                        <div>
                                            <h3 className="font-bold text-sm text-[#F3F4F6] group-hover:text-emerald-400 transition-colors">
                                                {group.broker}
                                            </h3>
                                            <span className="text-[10px] text-slate-400">
                                                {group.category} • {group.servers.length} servidor(es)
                                            </span>
                                        </div>
                                    </div>
                                    <ChevronRight size={16} className="text-slate-500 group-hover:text-emerald-400 transition-colors mt-1" />
                                </div>

                                {/* Lista rápida dos primeiros servidores prontos da corretora */}
                                <div className="mt-3 flex flex-wrap gap-1.5">
                                    {group.servers.slice(0, 4).map((srv) => (
                                        <button
                                            key={srv.name}
                                            type="button"
                                            onClick={() => handleSelectCatalogBroker(group, srv.name)}
                                            className="px-2 py-1 rounded-md bg-[#08090C] hover:bg-emerald-500/15 border border-white/[0.06] hover:border-emerald-500/30 text-[11px] font-mono text-slate-300 hover:text-emerald-300 transition-all flex items-center gap-1"
                                            title={srv.description || srv.name}
                                        >
                                            <span className="truncate max-w-[140px]">{srv.name}</span>
                                            <span
                                                className={`text-[8px] font-sans font-bold px-1 rounded ${
                                                    srv.env === 'DEMO'
                                                        ? 'bg-cyan-500/15 text-cyan-300'
                                                        : 'bg-emerald-500/15 text-emerald-300'
                                                }`}
                                            >
                                                {srv.env}
                                            </span>
                                        </button>
                                    ))}
                                    {group.servers.length > 4 && (
                                        <button
                                            type="button"
                                            onClick={() => handleSelectCatalogBroker(group)}
                                            className="px-2 py-1 rounded-md bg-white/[0.03] hover:bg-white/[0.08] text-[10px] text-slate-400 hover:text-white transition-colors"
                                        >
                                            +{group.servers.length - 4} mais...
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {filteredMainMethods.length === 0 && filteredCatalogBrokers.length === 0 && (
                <div className="text-center py-12 bg-[#111319] border border-white/[0.06] rounded-2xl p-6 space-y-3">
                    <p className="text-[#9CA3AF]">
                        Nenhuma corretora pré-listada encontrada para &ldquo;{search}&rdquo;.
                    </p>
                    <button
                        type="button"
                        onClick={() =>
                            onSelect({
                                id: 'mt5_broker_direct',
                                name: 'MetaTrader 5 (Personalizado)',
                                type: 'AUTO_SYNC',
                                icon: <Monitor className="w-10 h-10 text-emerald-500" />,
                                description: 'Servidor personalizado',
                                defaultServer: search.trim(),
                            })
                        }
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-xs font-semibold hover:bg-emerald-500/25 transition-all"
                    >
                        Conectar MT5 usando servidor &ldquo;{search.trim()}&rdquo; →
                    </button>
                </div>
            )}
        </div>
    );
};
