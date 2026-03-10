import React from 'react';
import { ShieldCheck, ShieldAlert } from 'lucide-react';


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

export const TraderHealthWidget = ({ score = 100, details = {} as any }) => {
    const getScoreColor = (s: number) => {
        if (s >= 80) return 'text-emerald-500';
        if (s >= 50) return 'text-amber-500';
        return 'text-rose-500';
    };

    const getScoreBg = (s: number) => {
        if (s >= 80) return 'bg-emerald-500/10 border-emerald-500/20';
        if (s >= 50) return 'bg-amber-500/10 border-amber-500/20';
        return 'bg-rose-500/10 border-rose-500/20';
    };

    const titles = {
        high: "Excelente Disciplina",
        med: "Atenção Necessária",
        low: "Risco Elevado"
    };

    const title = score >= 80 ? titles.high : score >= 50 ? titles.med : titles.low;

    return (
        <div className="flex flex-col gap-4 py-2 relative group mt-4">
            <div className={`p-4 rounded-xl border flex flex-col gap-3 transition-all duration-500 ${getScoreBg(score)}`}>
                <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                        {score >= 80 ? <ShieldCheck size={18} className="text-emerald-500" /> : <ShieldAlert size={18} className={getScoreColor(score)} />}
                        <span className="text-[11px] font-black uppercase tracking-wider text-slate-100">{title}</span>
                    </div>
                    <span className={`text-2xl font-black font-mono tracking-tighter ${getScoreColor(score)}`}>{score}</span>
                </div>

                <div className="flex flex-col gap-1.5">
                    <div className="flex justify-between items-center text-[9px] font-bold text-slate-500 uppercase tracking-widest">
                        <span>Status de Saúde</span>
                        <span>{score}%</span>
                    </div>
                    <div className="h-2 w-full bg-slate-900/50 rounded-full overflow-hidden">
                        <div
                            className={`h-full transition-all duration-1000 ease-out ${score >= 80 ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.4)]' : score >= 50 ? 'bg-amber-500' : 'bg-rose-500'}`}
                            style={{ width: `${score}%` }}
                        />
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-2 mt-1">
                    <div className="bg-slate-900/40 p-2 rounded-lg border border-slate-800/50">
                        <span className="block text-[8px] text-slate-500 uppercase font-black tracking-tighter">Alertas Ativos</span>
                        <span className="text-xs font-bold text-white">{details.totalAlerts || 0}</span>
                    </div>
                    <div className="bg-slate-900/40 p-2 rounded-lg border border-slate-800/50">
                        <span className="block text-[8px] text-slate-500 uppercase font-black tracking-tighter">Severidade</span>
                        <span className={`text-xs font-bold ${details.penalties?.critical > 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
                            {details.penalties?.critical > 0 ? 'Crítica' : 'Estável'}
                        </span>
                    </div>
                </div>
            </div>

            <button
                onClick={() => window.location.href = '/notifications?filter=alerts'}
                className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white text-[10px] font-bold uppercase tracking-widest rounded-xl border border-slate-800 transition-all flex items-center justify-center gap-2"
            >
                Ver Alertas Detalhados
            </button>
        </div>
    );
};

