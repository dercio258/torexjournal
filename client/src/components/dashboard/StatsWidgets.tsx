import React from 'react';


// --- Gauge de Proporção Profit vs Loss ---
export const WinrateGauge = ({ winrate = 0, trades = 0 }) => {
    const radius = 80;
    const stroke = 14;
    const normalizedRadius = radius - stroke;
    const circumference = normalizedRadius * Math.PI;

    const winStroke = (winrate / 100) * circumference;

    return (
        <div className="flex flex-col items-center justify-center relative py-4">
            <svg height={radius + 10} width={radius * 2} className="overflow-visible">
                <defs>
                    <filter id="glow-green">
                        <feGaussianBlur stdDeviation="2" result="coloredBlur" />
                        <feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge>
                    </filter>
                </defs>
                {/* Base de LOSS (Vermelho) */}
                <path
                    d={`M ${stroke},${radius} A ${normalizedRadius},${normalizedRadius} 0 0 1 ${radius * 2 - stroke},${radius}`}
                    fill="none"
                    stroke="#f43f5e"
                    strokeWidth={stroke}
                    strokeLinecap="round"
                />
                {/* Sobreposição de PROFIT (Verde) */}
                <path
                    d={`M ${stroke},${radius} A ${normalizedRadius},${normalizedRadius} 0 0 1 ${radius * 2 - stroke},${radius}`}
                    fill="none"
                    stroke="#10b981"
                    strokeWidth={stroke}
                    strokeDasharray={`${winStroke} ${circumference}`}
                    strokeLinecap="round"
                    filter="url(#glow-green)"
                    style={{ transition: 'stroke-dasharray 1s ease-in-out' }}
                />
            </svg>
            <div className="absolute top-12 flex flex-col items-center">
                <span className="text-3xl font-black text-slate-100 font-mono leading-none tracking-tighter">{trades}</span>
                <span className="text-[9px] text-slate-500 uppercase tracking-[0.2em] font-bold mt-1">Trades</span>
                <div className="mt-3 flex items-center gap-3">
                    <div className="text-center">
                        <span className="text-[10px] text-emerald-500 font-black block leading-none">{winrate.toFixed(1)}%</span>
                        <span className="text-[7px] text-slate-600 uppercase">Win</span>
                    </div>
                    <div className="w-px h-4 bg-slate-800" />
                    <div className="text-center">
                        <span className="text-[10px] text-rose-500 font-black block leading-none">{(100 - winrate).toFixed(1)}%</span>
                        <span className="text-[7px] text-slate-600 uppercase">Loss</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- Barra de Performance de Ativo ---
export const InstrumentRow = ({ symbol, wins, losses }: { symbol: string, wins: number, losses: number }) => {
    const total = wins + losses;
    const winPercent = total > 0 ? (wins / total) * 100 : 0;
    return (
        <div className="flex flex-col gap-1.5 py-2">
            <div className="flex justify-between items-center px-1">
                <span className="text-[11px] font-black text-slate-300 tracking-wider">{symbol}</span>
                <span className="text-[9px] font-mono text-slate-500">
                    <b className="text-emerald-500">{wins}W</b> <span className="mx-1 text-slate-700">|</span> <b className="text-rose-500">{losses}L</b>
                </span>
            </div>
            <div className="h-1.5 w-full bg-slate-900 rounded-full overflow-hidden flex">
                <div className="h-full bg-emerald-500" style={{ width: `${winPercent}%` }} />
                <div className="h-full bg-rose-500" style={{ width: `${100 - winPercent}%` }} />
            </div>
        </div>
    );
};

// --- Barra de Sessão ---
export const SessionRow = ({ name, percent, pnl = 0, active = false }: { name: string, percent: number, pnl?: number, active?: boolean }) => (
    <div className="flex flex-col gap-1.5 py-2">
        <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-widest px-1">
            <span className={active ? "text-blue-400" : "text-slate-500"}>{name}</span>
            <div className="flex items-center gap-2">
                <span className={`font-mono text-[9px] ${pnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                    {pnl >= 0 ? '+' : ''}{pnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span className="text-slate-400 font-mono text-[9px]">{percent.toFixed(1)}%</span>
            </div>
        </div>
        <div className="h-1 w-full bg-slate-900 rounded-full overflow-hidden">
            <div
                className={`h-full transition-all duration-700 ${active ? 'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]' : 'bg-slate-700'}`}
                style={{ width: `${percent}%` }}
            />
        </div>
    </div>
);

export const StatsContainer = ({ children }: { children: React.ReactNode }) => (
    <div className="bg-[#0b0e14] border border-slate-800 rounded-2xl p-6 shadow-2xl w-full flex flex-col gap-8 h-full">
        {children}
    </div>
);
