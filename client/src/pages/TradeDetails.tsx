import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Clock, Calendar, Brain, AlertTriangle, TrendingUp, TrendingDown, Target, Zap, Activity, Award } from 'lucide-react';
import api from '../api';

interface TradeDetail {
    trade: {
        id: number;
        ticket: number;
        symbol: string;
        type: string;
        volume: number;
        openPrice: number;
        closePrice: number;
        openTime: string;
        closeTime: string;
        profit: number;
        commission: number;
        swap: number;
        comment: string;
        status?: string; // e.g. 'CLOSED'
    };
    technicalJournal?: {
        marketTrend: string;
        volatility: string;
        strategyUsed: string;
        mistakes: string;
        lessons: string;
        rating: number;
        notes: string;
        entryPrecision?: string;
        riskManagement?: string;
        tradeExit?: string;
        emotionalState?: string;
    };
    mentalLog?: {
        mood: number;
        stress: number;
        focus: number;
        energy: number;
        notes: string;
        overallScore?: number;
    };
}

const getEmoji = (label: string, val: number) => {
    if (label === 'Humor') return val >= 7 ? '😄' : val >= 4 ? '😐' : '😠';
    if (label === 'Estresse') return val <= 3 ? '😌' : val <= 6 ? '😬' : '🤯';
    if (label === 'Foco') return val >= 7 ? '🎯' : val >= 4 ? '👀' : '😵';
    if (label === 'Energia') return val >= 7 ? '⚡' : val >= 4 ? '🔋' : '🪫';
    return '📊';
};

const getScoreInsight = (score: number) => {
    if (score >= 90) return "Desempenho de Elite! Você estava no fluxo.";
    if (score >= 75) return "Ótimo estado mental para operar.";
    if (score >= 50) return "Estado mental estável, mas cuidado com distrações.";
    return "Cuidado: Estado mental subótimo. Considere descansar.";
};

import { TradeChart } from '../components/charts/TradeChart';

export const TradeDetails = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const [data, setData] = useState<TradeDetail | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchDetails = async () => {
            try {
                const res = await api.get(`/trades/${id}`);
                setData(res.data);
            } catch (err) {
                console.error('Failed to fetch trade details', err);
            } finally {
                setIsLoading(false);
            }
        };

        if (id) fetchDetails();
    }, [id]);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500"></div>
            </div>
        );
    }

    if (!data || !data.trade) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-slate-400">
                <AlertTriangle size={48} className="mb-4 text-yellow-500" />
                <h2 className="text-xl font-bold text-white">Trade não encontrado</h2>
                <button onClick={() => navigate('/trades')} className="mt-4 px-4 py-2 bg-slate-800 rounded-lg hover:bg-slate-700">
                    Voltar para Lista
                </button>
            </div>
        );
    }

    const { trade, technicalJournal, mentalLog } = data;
    const netProfit = Number(trade.profit) + Number(trade.commission) + Number(trade.swap);
    const grossProfit = Number(trade.profit);
    const isWin = netProfit >= 0;
    const duration = new Date(trade.closeTime).getTime() - new Date(trade.openTime).getTime();
    const durationStr = new Date(duration).toISOString().substr(11, 8);

    return (
        <div className="p-6 max-w-7xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => navigate('/trades')}
                        className="p-2 bg-slate-800/50 hover:bg-slate-800 text-slate-400 hover:text-white rounded-xl transition-all"
                    >
                        <ArrowLeft size={20} />
                    </button>
                    <div>
                        <div className="flex items-center gap-3">
                            <h1 className="text-2xl font-bold text-white">
                                {trade.symbol} <span className="text-slate-500 text-lg font-mono">#{trade.ticket || trade.id.toString().split('-')[0]}</span>
                            </h1>
                            <span className={`px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider ${isWin ? 'bg-emerald-500 text-slate-950' : 'bg-rose-500 text-white'}`}>
                                {isWin ? 'WIN' : 'LOSS'}
                            </span>
                            <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase border ${trade.type === 'BUY' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'}`}>
                                {trade.type}
                            </span>
                        </div>
                        <p className="text-slate-400 text-sm flex items-center gap-2 mt-1">
                            <Calendar size={12} />
                            {new Date(trade.openTime).toLocaleString('pt-BR')}
                        </p>
                    </div>
                </div>

                <div className={`px-6 py-3 rounded-2xl font-bold text-3xl flex items-center gap-3 border ${isWin ? 'bg-emerald-500/5 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/5 text-rose-400 border-rose-500/20'}`}>
                    {isWin ? <TrendingUp size={32} /> : <TrendingDown size={32} />}
                    {netProfit >= 0 ? '+' : ''}{netProfit.toFixed(2)}
                </div>
            </div>

            {/* Main Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800 p-4 rounded-2xl flex flex-col gap-1">
                    <span className="text-xs text-slate-500 uppercase font-bold tracking-wider">Lote / Volume</span>
                    <div className="flex items-end gap-2">
                        <span className="text-2xl font-mono text-white font-bold">{Number(trade.volume).toFixed(2)}</span>
                    </div>
                </div>
                <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800 p-4 rounded-2xl flex flex-col gap-1">
                    <span className="text-xs text-slate-500 uppercase font-bold tracking-wider">Preço Entrada</span>
                    <span className="text-2xl font-mono text-slate-200">{Number(trade.openPrice)}</span>
                </div>
                <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800 p-4 rounded-2xl flex flex-col gap-1">
                    <span className="text-xs text-slate-500 uppercase font-bold tracking-wider">Duração</span>
                    <span className="text-2xl font-mono text-slate-200 flex items-center gap-2">
                        <Clock size={20} className="text-slate-500" /> {durationStr}
                    </span>
                </div>
                <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800 p-4 rounded-2xl flex flex-col gap-1">
                    <span className="text-xs text-slate-500 uppercase font-bold tracking-wider">Resultado Bruto</span>
                    <span className={`text-2xl font-mono font-bold ${grossProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {grossProfit >= 0 ? '+' : ''}{grossProfit.toFixed(2)}
                    </span>
                </div>
            </div>

            {/* Trade Replay Chart */}
            <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800 p-6 rounded-2xl">
                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                    <Activity className="text-emerald-500" /> Replay do Trade
                </h3>
                <TradeChart
                    symbol={trade.symbol}
                    openTime={trade.openTime}
                    closeTime={trade.closeTime}
                    openPrice={Number(trade.openPrice)}
                    closePrice={Number(trade.closePrice)}
                    type={trade.type}
                />
            </div>

            {/* Context Sections */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                {/* Technical Journal Context */}
                <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800 rounded-2xl p-6 h-full flex flex-col">
                    <div className="flex items-center justify-between mb-6">
                        <h3 className="text-lg font-bold text-white flex items-center gap-2">
                            <Target className="text-blue-500" /> Análise Técnica
                        </h3>
                        {technicalJournal?.rating && (
                            <div className="px-3 py-1 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-bold">
                                Avaliação: {technicalJournal.rating}/10
                            </div>
                        )}
                    </div>

                    {technicalJournal ? (
                        <div className="space-y-6 flex-1">
                            {/* Key Metrics Grid */}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="p-3 bg-slate-950/50 rounded-xl border border-slate-800">
                                    <span className="text-[10px] text-slate-500 uppercase font-bold block mb-1">Tendência</span>
                                    <span className="font-bold text-slate-200 text-sm">{technicalJournal.marketTrend || '-'}</span>
                                </div>
                                <div className="p-3 bg-slate-950/50 rounded-xl border border-slate-800">
                                    <span className="text-[10px] text-slate-500 uppercase font-bold block mb-1">Volatilidade</span>
                                    <span className="font-bold text-slate-200 text-sm">{technicalJournal.volatility || '-'}</span>
                                </div>
                                <div className="p-3 bg-slate-950/50 rounded-xl border border-slate-800">
                                    <span className="text-[10px] text-slate-500 uppercase font-bold block mb-1">Entrada</span>
                                    <span className="font-bold text-slate-200 text-sm">{technicalJournal.entryPrecision || '-'}</span>
                                </div>
                                <div className="p-3 bg-slate-950/50 rounded-xl border border-slate-800">
                                    <span className="text-[10px] text-slate-500 uppercase font-bold block mb-1">Saída</span>
                                    <span className="font-bold text-slate-200 text-sm">{technicalJournal.tradeExit || '-'}</span>
                                </div>
                            </div>

                            {/* Detailed Text Sections */}
                            <div className="space-y-4">
                                <div className="p-4 bg-slate-950/30 rounded-xl border border-slate-800/50">
                                    <span className="text-xs text-indigo-400 font-bold uppercase mb-2 block flex items-center gap-2">
                                        <Zap size={14} /> Estratégia
                                    </span>
                                    <p className="text-slate-300 text-sm leading-relaxed">{technicalJournal.strategyUsed || 'Não especificado'}</p>
                                </div>

                                {(technicalJournal.mistakes) && (
                                    <div className="p-4 bg-rose-500/5 border border-rose-500/10 rounded-xl">
                                        <span className="text-xs text-rose-400 font-bold uppercase mb-2 block flex items-center gap-2">
                                            <AlertTriangle size={14} /> Erros
                                        </span>
                                        <p className="text-slate-300 text-sm">{technicalJournal.mistakes}</p>
                                    </div>
                                )}

                                {(technicalJournal.lessons) && (
                                    <div className="p-4 bg-emerald-500/5 border border-emerald-500/10 rounded-xl">
                                        <span className="text-xs text-emerald-400 font-bold uppercase mb-2 block flex items-center gap-2">
                                            <Award size={14} /> Lições
                                        </span>
                                        <p className="text-slate-300 text-sm">{technicalJournal.lessons}</p>
                                    </div>
                                )}

                                {(technicalJournal.notes) && (
                                    <div className="p-4 bg-slate-950/30 border border-slate-800/50 rounded-xl">
                                        <span className="text-xs text-slate-500 font-bold uppercase mb-2 block">Notas Adicionais</span>
                                        <p className="text-slate-400 text-sm italic">"{technicalJournal.notes}"</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-slate-500 border-2 border-dashed border-slate-800 rounded-xl p-8">
                            <Calendar size={32} className="mb-2 opacity-50" />
                            <p>Nenhum diário técnico encontrado para esta data.</p>
                        </div>
                    )}
                </div>

                {/* Mental Context */}
                <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800 rounded-2xl p-6 h-full flex flex-col">
                    <div className="flex items-center justify-between mb-6">
                        <h3 className="text-lg font-bold text-white flex items-center gap-2">
                            <Brain className="text-purple-500" /> Gestão Emocional
                        </h3>
                        {mentalLog?.overallScore && (
                            <div className="px-3 py-1 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-400 text-xs font-bold">
                                Score Diário: {mentalLog.overallScore}/100
                            </div>
                        )}
                    </div>

                    {mentalLog ? (
                        <div className="space-y-6 flex-1">
                            {/* Percentage Grid */}
                            <div className="grid grid-cols-2 gap-4">
                                {[
                                    { label: 'Humor', val: mentalLog.mood, color: 'text-yellow-400' },
                                    { label: 'Estresse', val: mentalLog.stress, color: 'text-rose-400' },
                                    { label: 'Foco', val: mentalLog.focus, color: 'text-blue-400' },
                                    { label: 'Energia', val: mentalLog.energy, color: 'text-emerald-400' }
                                ].map((stat, i) => (
                                    <div key={i} className="flex flex-col items-center justify-center p-4 bg-slate-950/50 rounded-xl border border-slate-800 relative overflow-hidden group">
                                        <div className="text-4xl mb-2 filter grayscale group-hover:grayscale-0 transition-all duration-300 transform group-hover:scale-110">
                                            {getEmoji(stat.label, stat.val)}
                                        </div>
                                        <span className={`text-2xl font-black ${stat.color}`}>{stat.val * 10}%</span>
                                        <span className="text-[10px] uppercase text-slate-500 font-bold mt-1">{stat.label}</span>

                                        {/* Progress Bar Background */}
                                        <div className="absolute bottom-0 left-0 w-full h-1 bg-slate-800">
                                            <div
                                                className={`h-full opacity-50 ${stat.label === 'Estresse' ? 'bg-rose-500' : 'bg-emerald-500'}`}
                                                style={{ width: `${stat.val * 10}%` }}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Insight Section */}
                            {mentalLog.overallScore && (
                                <div className="p-4 bg-purple-500/5 border border-purple-500/10 rounded-xl flex items-start gap-3">
                                    <Activity className="text-purple-400 shrink-0 mt-0.5" size={18} />
                                    <div>
                                        <span className="text-xs text-purple-400 font-bold uppercase block mb-1">Análise de Performance</span>
                                        <p className="text-slate-200 text-sm font-medium">
                                            {getScoreInsight(mentalLog.overallScore)}
                                        </p>
                                    </div>
                                </div>
                            )}

                            {mentalLog.notes && (
                                <div className="p-4 bg-slate-950/30 rounded-xl border border-slate-800/50">
                                    <span className="text-xs text-slate-500 block mb-2 font-bold uppercase">Diário Emocional</span>
                                    <p className="text-slate-300 text-sm italic">"{mentalLog.notes}"</p>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-slate-500 border-2 border-dashed border-slate-800 rounded-xl p-8">
                            <Brain size={32} className="mb-2 opacity-50" />
                            <p>Nenhum registro emocional encontrado para esta data.</p>
                        </div>
                    )}
                </div>

            </div>
        </div>
    );
};
