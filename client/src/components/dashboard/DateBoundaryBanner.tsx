import { Calendar, HelpCircle, Check, ArrowRight } from 'lucide-react';

interface DateBoundaryBannerProps {
    includeToday: boolean;
    onToggle: () => void;
}

export const DateBoundaryBanner = ({ includeToday, onToggle }: DateBoundaryBannerProps) => {
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    const formatDate = (date: Date) => {
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        return `${day}/${month}/${year}`;
    };

    return (
        <div className="relative overflow-hidden bg-slate-900/40 backdrop-blur-xl border border-slate-800/80 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all hover:border-slate-700/60 shadow-lg group">
            {/* Ambient Glow */}
            <div className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-indigo-500/5 to-transparent rounded-full -mr-8 -mt-8 transition-opacity duration-500 ${includeToday ? 'opacity-100 from-emerald-500/5' : ''}`} />

            <div className="flex items-center gap-3.5 relative z-10">
                <div className={`p-2.5 rounded-xl border transition-all ${includeToday ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-lg shadow-emerald-500/5' : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20 shadow-lg shadow-indigo-500/5'}`}>
                    <Calendar size={20} className={includeToday ? '' : 'animate-pulse'} />
                </div>
                <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-1.5 leading-none">
                        {includeToday ? (
                            <>
                                <span>Dados de hoje incluídos</span>
                                <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
                            </>
                        ) : (
                            'Exibindo dados consolidados'
                        )}
                    </h3>
                    <p className="text-xs text-slate-400 mt-1 flex items-center gap-1.5 font-mono">
                        {includeToday ? (
                            <>
                                Até hoje: <span className="text-emerald-400 font-semibold">{formatDate(today)}</span>
                            </>
                        ) : (
                            <>
                                Até ontem: <span className="text-indigo-400 font-semibold">{formatDate(yesterday)}</span>
                                <span className="text-slate-600">|</span>
                                <span className="text-slate-500 text-[10px] flex items-center gap-1" title="Por padrão, ocultamos dados parciais do dia de hoje para evitar ruído de operações em andamento.">
                                    <HelpCircle size={12} className="cursor-help" /> dados até ontem
                                </span>
                            </>
                        )}
                    </p>
                </div>
            </div>

            <button
                onClick={onToggle}
                className={`relative z-10 flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl border transition-all duration-300 ${
                    includeToday
                        ? 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-750 hover:text-white'
                        : 'bg-indigo-600 text-white border-indigo-500 hover:bg-indigo-500 shadow-md shadow-indigo-600/10 hover:shadow-indigo-500/20 active:scale-95'
                }`}
            >
                {includeToday ? (
                    <>
                        <Check size={14} className="text-emerald-400 font-bold" />
                        Remover dados de hoje
                    </>
                ) : (
                    <>
                        <span>Puxar dados de hoje</span>
                        <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
                    </>
                )}
            </button>
        </div>
    );
};
