
import React from 'react';
import { Card } from '../ui/Card';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { TrendingUp, Activity, BarChart2, DollarSign, Percent, AlertCircle } from 'lucide-react';

// --- Types ---
export interface StrategyConfigProps {
    config: any;
    onChange: (key: string, value: any) => void;
}

export interface MetricCardProps {
    label: string;
    value: string | number;
    subValue?: string;
    icon?: React.ReactNode;
    trend?: 'up' | 'down' | 'neutral';
    colorClass?: string;
}

// --- Components ---

export const StrategyConfig = ({ config, onChange }: StrategyConfigProps) => {
    return (
        <Card className="p-6 space-y-6">
            <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                <Activity size={18} className="text-blue-400" />
                Configuração
            </h3>

            <div className="space-y-4">
                <div>
                    <label className="block text-xs font-semibold uppercase text-slate-500 mb-3">Estratégia</label>
                    <div className="grid grid-cols-2 gap-2">
                        {['MACD Cross', 'RSI Reversal', 'Bollinger Breakout', 'Custom'].map(strat => (
                            <button
                                key={strat}
                                onClick={() => onChange('strategy', strat)}
                                className={`
                                    px-3 py-2 rounded-lg text-xs font-medium border transition-all
                                    ${config.strategy === strat
                                        ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50'
                                        : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'}
                                `}
                            >
                                {strat}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="border-t border-slate-800/50 my-4" />

                <div className="grid grid-cols-2 gap-4">
                    <Input
                        label="Saldo Inicial ($)"
                        type="number"
                        value={config.initialBalance}
                        onChange={(e) => onChange('initialBalance', e.target.value)}
                        variant="dark"
                    />
                    <Input
                        label="Risco por Trade (%)"
                        type="number"
                        value={config.riskPerTrade}
                        onChange={(e) => onChange('riskPerTrade', e.target.value)}
                        variant="dark"
                    />
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <Input
                        label="Comissão ($)"
                        type="number"
                        value={config.commission}
                        onChange={(e) => onChange('commission', e.target.value)}
                        variant="dark"
                    />
                    <Input
                        label="Slippage (pts)"
                        type="number"
                        value={config.slippage}
                        onChange={(e) => onChange('slippage', e.target.value)}
                        variant="dark"
                    />
                </div>

                <div className="pt-2">
                    <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2">Parâmetros Específicos</h4>
                    <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-800 space-y-3">
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-slate-400">Fast MA</span>
                            <input className="w-16 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-right text-slate-200 text-xs" defaultValue="12" />
                        </div>
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-slate-400">Slow MA</span>
                            <input className="w-16 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-right text-slate-200 text-xs" defaultValue="26" />
                        </div>
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-slate-400">Signal</span>
                            <input className="w-16 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-right text-slate-200 text-xs" defaultValue="9" />
                        </div>
                    </div>
                </div>
            </div>
        </Card>
    );
};

export const ResultsCard = ({ label, value, subValue, icon, trend, colorClass = 'text-slate-100' }: MetricCardProps) => (
    <div className="bg-slate-800/30 rounded-xl p-4 border border-slate-700/50 flex items-start justify-between">
        <div>
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-1">{label}</p>
            <h4 className={`text-xl font-bold ${colorClass}`}>{value}</h4>
            {subValue && <span className="text-xs text-slate-400">{subValue}</span>}
        </div>
        {icon && <div className="text-slate-600 opacity-50">{icon}</div>}
    </div>
);

export const BacktestStats = ({ results }: { results: any }) => {
    return (
        <Card className="p-6 space-y-6 flex flex-col h-full">
            <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                <BarChart2 size={18} className="text-purple-400" />
                Resultados
            </h3>

            <div className="grid grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-4">
                <ResultsCard
                    label="Net Profit"
                    value={`$${results?.netProfit || '0.00'}`}
                    subValue="+12.5%"
                    icon={<DollarSign size={18} />}
                    colorClass="text-emerald-400"
                />
                <ResultsCard
                    label="Win Rate"
                    value={`${results?.winRate || '0'}%`}
                    subValue={`${results?.totalTrades || 0} trades`}
                    icon={<Percent size={18} />}
                    colorClass="text-blue-400"
                />
                <ResultsCard
                    label="Profit Factor"
                    value={results?.profitFactor || '0.00'}
                    icon={<TrendingUp size={18} />}
                    colorClass={Number(results?.profitFactor) > 1.5 ? "text-emerald-400" : "text-amber-400"}
                />
                <ResultsCard
                    label="Max Drawdown"
                    value={`${results?.maxDrawdown || '0.00'}%`}
                    icon={<AlertCircle size={18} />}
                    colorClass="text-rose-400"
                />
            </div>

            <div className="bg-slate-800/20 rounded-lg p-4 border border-slate-800 flex-1">
                <h4 className="text-xs font-bold text-slate-500 uppercase mb-3">Insights da IA</h4>
                <ul className="space-y-2 text-sm text-slate-400">
                    <li className="flex gap-2">
                        <span className="text-emerald-500">•</span>
                        Bom desempenho em horários de vol. alta (NY Session).
                    </li>
                    <li className="flex gap-2">
                        <span className="text-amber-500">•</span>
                        Drawdown elevado em mercados laterais.
                    </li>
                    <li className="flex gap-2">
                        <span className="text-blue-500">•</span>
                        Melhor R:R observado: 1:2.5
                    </li>
                </ul>
            </div>
        </Card>
    );
};
