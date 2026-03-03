import { useState, useEffect } from 'react';
import { CalendarDays, ArrowRight, RefreshCw } from 'lucide-react';
import api from '../api';

const EconomicCalendar = () => {
    const [events, setEvents] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const fetchCalendar = async () => {
        setLoading(true);
        setError('');
        try {
            // Fetch from our backend which caches Finnhub data
            const res = await api.get('/finnhub/calendar');
            if (Array.isArray(res.data)) {
                // Sort by Date/Time
                const sorted = res.data.sort((a: any, b: any) => new Date(a.time).getTime() - new Date(b.time).getTime());
                setEvents(sorted);
            } else {
                setEvents([]);
            }
        } catch (err) {
            console.error('Failed to fetch calendar:', err);
            setError('Falha ao carregar dados. Verifique sua conexão.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchCalendar();
    }, []);

    const formatTime = (timeStr: string) => {
        try {
            const date = new Date(timeStr);
            return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        } catch {
            return timeStr;
        }
    };

    const formatDate = (timeStr: string) => {
        try {
            const date = new Date(timeStr);
            return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        } catch {
            return '';
        }
    };

    const getImpactColor = (impact: string) => {
        if (!impact) return 'text-slate-400 bg-slate-500/10 border-slate-500/20';
        switch (impact.toLowerCase()) {
            case 'high': return 'text-rose-400 bg-rose-500/10 border-rose-500/20';
            case 'medium': return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
            case 'low': return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
            default: return 'text-slate-400 bg-slate-500/10 border-slate-500/20';
        }
    };

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 font-sans relative overflow-hidden flex justify-center p-4 md:p-8">

            {/* Background Ambience */}
            <div className="fixed inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-0 right-0 w-[800px] h-[600px] bg-emerald-500/5 rounded-full blur-[120px] -z-10" />
                <div className="absolute inset-0 opacity-[0.02]" style={{ backgroundImage: 'radial-gradient(#fff 1px, transparent 1px)', backgroundSize: '32px 32px' }} />
            </div>

            <div className="w-full max-w-6xl relative z-10 space-y-6">

                {/* Header */}
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-2xl md:text-3xl font-bold text-white flex items-center gap-3">
                            <div className="p-2 bg-slate-900 border border-slate-800 rounded-lg">
                                <CalendarDays className="text-blue-400" size={24} />
                            </div>
                            Calendário Econômico
                        </h1>
                        <p className="text-slate-400 text-sm mt-2 ml-1">Eventos globais em tempo real (Cache: Finnhub).</p>
                    </div>
                    <button
                        onClick={fetchCalendar}
                        disabled={loading}
                        className="flex items-center gap-2 text-sm text-slate-400 hover:text-blue-400 transition-colors bg-slate-900/50 px-4 py-2 rounded-lg border border-slate-800 hover:border-blue-500/30 disabled:opacity-50"
                    >
                        <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                        <span>Atualizar</span>
                    </button>
                </header>

                {/* Tabela Principal */}
                <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800 rounded-3xl overflow-hidden shadow-2xl min-h-[400px]">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-slate-950/50 border-b border-slate-800 text-xs text-slate-500 uppercase tracking-wider">
                                    <th className="p-5 font-bold">Data/Hora</th>
                                    <th className="p-5 font-bold">Moeda</th>
                                    <th className="p-5 font-bold">Impacto</th>
                                    <th className="p-5 font-bold w-1/3">Evento</th>
                                    <th className="p-5 font-bold text-right">Anterior</th>
                                    <th className="p-5 font-bold text-right">Projeção</th>
                                    <th className="p-5 font-bold text-right">Atual</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/50">
                                {loading ? (
                                    <tr>
                                        <td colSpan={7} className="p-10 text-center text-slate-500">
                                            Carregando dados...
                                        </td>
                                    </tr>
                                ) : events.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="p-10 text-center text-slate-500">
                                            {error || 'Nenhum evento encontrado para os próximos dias.'}
                                        </td>
                                    </tr>
                                ) : (
                                    events.map((evt, idx) => (
                                        <tr key={idx} className="hover:bg-slate-800/40 transition-colors text-sm text-slate-300 group">
                                            <td className="p-5 font-mono text-slate-400 group-hover:text-white transition-colors">
                                                <div className="flex flex-col">
                                                    <span className="text-xs opacity-50">{formatDate(evt.time)}</span>
                                                    <span>{formatTime(evt.time)}</span>
                                                </div>
                                            </td>
                                            <td className="p-5 font-bold text-slate-200">{evt.currency}</td>
                                            <td className="p-5">
                                                <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold border ${getImpactColor(evt.impact)}`}>
                                                    {evt.impact || 'N/A'}
                                                </span>
                                            </td>
                                            <td className="p-5 font-medium">{evt.event}</td>
                                            <td className="p-5 text-right text-slate-500 font-mono">{evt.previous || '-'}</td>
                                            <td className="p-5 text-right text-slate-400 font-mono">{evt.forecast || '-'}</td>
                                            <td className={`p-5 text-right font-mono font-bold group-hover:text-white ${evt.actual && evt.forecast && parseFloat(evt.actual) > parseFloat(evt.forecast) ? 'text-emerald-400' :
                                                evt.actual && evt.forecast && parseFloat(evt.actual) < parseFloat(evt.forecast) ? 'text-rose-400' : 'text-slate-300'
                                                }`}>
                                                {evt.actual || '--'}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Footer da Tabela */}
                    <div className="p-4 bg-slate-950/30 border-t border-slate-800 flex justify-between items-center text-xs text-slate-500">
                        <span>* Horário Local</span>
                        <div className="flex items-center gap-1">
                            Dados fornecidos por <span className="font-bold text-slate-400">Finnhub IO</span>
                        </div>
                    </div>
                </div>

                {/* Banner Promocional Inferior */}
                <div className="bg-gradient-to-r from-blue-900/20 to-slate-900/20 border border-blue-500/10 rounded-2xl p-6 flex flex-col md:flex-row items-center justify-between gap-4">
                    <div>
                        <h3 className="text-blue-400 font-bold mb-1">Impacto nos seus Trades?</h3>
                        <p className="text-slate-400 text-sm">O Backtest Lab pode simular como sua estratégia performa em dias de alta volatilidade.</p>
                    </div>
                    <button className="text-blue-400 hover:text-white font-bold text-sm flex items-center gap-2 hover:translate-x-1 transition-all">
                        Ir para o Lab <ArrowRight size={16} />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default EconomicCalendar;
