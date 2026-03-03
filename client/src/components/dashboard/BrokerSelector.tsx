import { useState } from 'react';
import { Monitor, Upload, Search } from 'lucide-react';

interface Broker {
    id: string;
    name: string;
    type: 'AUTO_SYNC' | 'MANUAL';
    icon: React.ReactNode;
    description: string;
}

interface BrokerSelectorProps {
    onSelect: (broker: Broker) => void;
}

export const BrokerSelector = ({ onSelect }: BrokerSelectorProps) => {
    const [search, setSearch] = useState('');

    const brokers: Broker[] = [
        {
            id: 'deriv',
            name: 'Deriv Autosync',
            type: 'AUTO_SYNC',
            icon: <img src="https://deriv.com/static/deriv-logo-c97b819f.svg" className="w-10 h-10" alt="Deriv" />,
            description: 'Sincronização via API token'
        },
        {
            id: 'mt5',
            name: 'Connect MetaTrader 5',
            type: 'AUTO_SYNC',
            icon: <Monitor className="w-10 h-10 text-emerald-500" />,
            description: 'Conectar via EA local ou Nuvem'
        },
        {
            id: 'manual_csv',
            name: 'Upload Manual CSV',
            type: 'MANUAL',
            icon: <Upload className="w-10 h-10 text-slate-400" />,
            description: 'Importar relatórios manuais'
        }
    ];

    const filteredBrokers = brokers.filter(b => b.name.toLowerCase().includes(search.toLowerCase()));

    return (
        <div className="space-y-6">
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={20} />
                <input
                    type="text"
                    placeholder="Search your broker..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl py-3 pl-10 pr-4 text-slate-100 focus:outline-none focus:border-emerald-500/50 transition-all placeholder:text-slate-600"
                />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredBrokers.map(broker => (
                    <div
                        key={broker.id}
                        onClick={() => onSelect(broker)}
                        className="group relative bg-slate-900/50 border border-slate-800/50 hover:bg-slate-800/50 hover:border-emerald-500/30 rounded-xl p-5 cursor-pointer transition-all flex items-center gap-4 overflow-hidden"
                    >
                        <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/0 to-emerald-500/0 group-hover:from-emerald-500/5 group-hover:to-transparent transition-all" />

                        <div className="relative shrink-0">
                            {broker.icon}
                        </div>

                        <div className="relative">
                            <h3 className="font-bold text-slate-100 group-hover:text-emerald-400 transition-colors">
                                {broker.name}
                            </h3>
                            <div className="flex items-center gap-2 mt-1">
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${broker.type === 'AUTO_SYNC'
                                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                    : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20'
                                    }`}>
                                    {broker.type === 'AUTO_SYNC' ? 'AUTO SYNC' : 'MANUAL'}
                                </span>
                            </div>
                            <p className="text-xs text-slate-500 mt-1 line-clamp-1">{broker.description}</p>
                        </div>
                    </div>
                ))}
            </div>

            {filteredBrokers.length === 0 && (
                <div className="text-center py-12">
                    <p className="text-slate-500">No brokers found matching "{search}"</p>
                </div>
            )}
        </div>
    );
};
