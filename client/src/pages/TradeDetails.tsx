import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Clock, Calendar, Brain, AlertTriangle, TrendingUp, TrendingDown, Target, Zap, Activity, Award, Share2, Globe, CheckCircle } from 'lucide-react';
import html2canvas from 'html2canvas';
import api from '../api';
import { useAuth } from '../context/AuthContext';

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
        setupQuality?: string;
        executionSpeed?: string;
        marketContext?: string;
        preMarketPrep?: string;
        rulesBroken?: string;
        actionPlan?: string;
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
    const { user } = useAuth();
    const [data, setData] = useState<TradeDetail | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isPrinting, setIsPrinting] = useState(false);

    // Network Publish State
    const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);
    const [publishCaption, setPublishCaption] = useState('');
    const [publishVisibility, setPublishVisibility] = useState('public');
    const [isPublishing, setIsPublishing] = useState(false);

    const printRef = useRef<HTMLDivElement>(null);

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

    const handleShare = async () => {
        if (!printRef.current || !data?.trade) return;
        try {
            setIsPrinting(true);

            // Wait a tiny bit for UI to update if needed
            await new Promise(resolve => setTimeout(resolve, 100));

            const canvas = await html2canvas(printRef.current, {
                background: '#020617',
                logging: false,
                useCORS: true
            });

            canvas.toBlob(async (blob) => {
                if (!blob) return;

                const file = new File([blob], `trade-${data.trade.ticket || data.trade.id}.png`, { type: 'image/png' });

                if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
                    try {
                        await navigator.share({
                            title: `Trade #${data.trade.ticket} - ${data.trade.symbol}`,
                            files: [file]
                        });
                    } catch (shareErr) {
                        console.log('Share canceled or failed', shareErr);
                        downloadFallback(canvas.toDataURL('image/png'));
                    }
                } else {
                    downloadFallback(canvas.toDataURL('image/png'));
                }
            }, 'image/png');
        } catch (err) {
            console.error('Failed to generate image', err);
        } finally {
            setIsPrinting(false);
        }
    };

    const handlePublishToNetwork = async () => {
        if (!printRef.current || !data?.trade) return;
        try {
            setIsPublishing(true);
            await new Promise(resolve => setTimeout(resolve, 100)); // UI paint

            const canvas = await html2canvas(printRef.current, {
                background: '#020617', // Match slate-950 background
                logging: false,
                useCORS: true
            });

            canvas.toBlob(async (blob) => {
                if (!blob) throw new Error('Failed to generate image blob');

                const formData = new FormData();
                formData.append('file', blob, `trade-${data.trade.ticket}.png`);

                const uploadRes = await api.post('/network/upload', formData, {
                    headers: { 'Content-Type': 'multipart/form-data' }
                });

                const netProfit = Number(data.trade.profit) + Number(data.trade.commission) + Number(data.trade.swap);

                await api.post('/network/post', {
                    content: publishCaption,
                    type: 'image',
                    tradeData: {
                        imageUrl: uploadRes.data.imageUrl,
                        ticket: data.trade.ticket,
                        symbol: data.trade.symbol,
                        profit: netProfit,
                        isWin: netProfit >= 0
                    },
                    visibility: publishVisibility
                });

                setIsPublishModalOpen(false);
                setPublishCaption('');
                setPublishVisibility('public');
                navigate('/network');
            }, 'image/png');
        } catch (err) {
            console.error('Failed to publish', err);
        } finally {
            setIsPublishing(false);
        }
    };

    const downloadFallback = (dataUrl: string) => {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `trade-${data?.trade?.ticket || 'detail'}.png`;
        a.click();
    };

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
        <div className="p-6 max-w-7xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header Actions (Not Printed) */}
            <div className="flex items-center justify-between mb-4">
                <button
                    onClick={() => navigate('/trades')}
                    className="p-2 bg-slate-800/50 hover:bg-slate-800 text-slate-400 hover:text-white rounded-xl transition-all flex items-center gap-2"
                >
                    <ArrowLeft size={18} />
                    <span className="text-sm font-bold hidden sm:inline">Voltar</span>
                </button>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setIsPublishModalOpen(true)}
                        className="p-2 px-4 bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-500/20 rounded-xl transition-all flex items-center gap-2 font-bold text-sm"
                    >
                        <Globe size={18} />
                        <span className="hidden sm:inline">Publicar</span>
                    </button>
                    <button
                        onClick={handleShare}
                        disabled={isPrinting}
                        className="p-2 px-4 bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 rounded-xl transition-all flex items-center gap-2 font-bold text-sm disabled:opacity-50"
                    >
                        <Share2 size={18} />
                        {isPrinting ? 'Gerando...' : 'Compartilhar'}
                    </button>
                </div>
            </div>

            {/* Printable Container */}
            <div ref={printRef} className="space-y-6 bg-slate-950 p-1 sm:p-4 rounded-3xl relative">
                {/* Watermark Logo (Visible only in explicit printed content visually due to layout rendering) */}
                <div className={`absolute top-6 right-8 z-10 ${isPrinting || isPublishing ? 'opacity-100' : 'opacity-0'} pointer-events-none flex flex-col items-end transition-opacity duration-300`}>
                    <div className="flex items-center gap-3 mb-2 drop-shadow-2xl">
                        <img src="https://res.cloudinary.com/dndlqdylc/image/upload/v1769335429/Touro_design_1_beuv9b.png" alt="Torex Journal Logo" className="h-10 w-10 object-contain drop-shadow-lg" />
                        <div className="text-3xl font-black text-white tracking-tighter uppercase leading-none">
                            Torex<span className="text-blue-500">Journal</span>
                        </div>
                    </div>
                    <div className="bg-slate-900/95 px-3 py-1.5 rounded-lg border border-blue-500/40 text-slate-300 font-bold tracking-wider text-[11px] uppercase shadow-2xl flex items-center gap-2">
                        <CheckCircle size={14} className="text-blue-500" />
                        <span className="text-blue-400 font-black">Verificado</span>
                        <span className="opacity-50">|</span>
                        <span className="text-blue-100">@{user?.username || user?.name || 'user'}</span>
                    </div>
                </div>

                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
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
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
                                    <div className="p-3 bg-slate-950/50 rounded-xl border border-slate-800">
                                        <span className="text-[10px] text-slate-500 uppercase font-bold block mb-1">Setup</span>
                                        <span className="font-bold text-slate-200 text-sm">{technicalJournal.setupQuality || '-'}</span>
                                    </div>
                                    <div className="p-3 bg-slate-950/50 rounded-xl border border-slate-800">
                                        <span className="text-[10px] text-slate-500 uppercase font-bold block mb-1">Execução</span>
                                        <span className="font-bold text-slate-200 text-sm">{technicalJournal.executionSpeed || '-'}</span>
                                    </div>
                                    <div className="p-3 bg-slate-950/50 rounded-xl border border-slate-800">
                                        <span className="text-[10px] text-slate-500 uppercase font-bold block mb-1">Contexto</span>
                                        <span className="font-bold text-slate-200 text-sm">{technicalJournal.marketContext || '-'}</span>
                                    </div>
                                    <div className="p-3 bg-slate-950/50 rounded-xl border border-slate-800">
                                        <span className="text-[10px] text-slate-500 uppercase font-bold block mb-1">Risco</span>
                                        <span className="font-bold text-slate-200 text-sm">{technicalJournal.riskManagement || '-'}</span>
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
                                            <p className="text-slate-300 text-sm whitespace-pre-line">{technicalJournal.mistakes}</p>
                                        </div>
                                    )}

                                    {(technicalJournal.rulesBroken) && (
                                        <div className="p-4 bg-rose-500/5 border border-rose-500/10 rounded-xl">
                                            <span className="text-xs text-rose-500 font-bold uppercase mb-2 block flex items-center gap-2">
                                                <AlertTriangle size={14} /> Regras Quebradas
                                            </span>
                                            <p className="text-slate-300 text-sm whitespace-pre-line">{technicalJournal.rulesBroken}</p>
                                        </div>
                                    )}

                                    {(technicalJournal.lessons) && (
                                        <div className="p-4 bg-emerald-500/5 border border-emerald-500/10 rounded-xl">
                                            <span className="text-xs text-emerald-400 font-bold uppercase mb-2 block flex items-center gap-2">
                                                <Award size={14} /> Lições
                                            </span>
                                            <p className="text-slate-300 text-sm whitespace-pre-line">{technicalJournal.lessons}</p>
                                        </div>
                                    )}

                                    {(technicalJournal.actionPlan) && (
                                        <div className="p-4 bg-blue-500/5 border border-blue-500/10 rounded-xl">
                                            <span className="text-xs text-blue-400 font-bold uppercase mb-2 block flex items-center gap-2">
                                                <Target size={14} /> Plano de Ação
                                            </span>
                                            <p className="text-slate-300 text-sm whitespace-pre-line">{technicalJournal.actionPlan}</p>
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

            {/* Publish Modal */}
            {isPublishModalOpen && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                    <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 w-full max-w-md animate-in zoom-in-95">
                        <h2 className="text-xl font-bold text-white mb-4">Publicar no Network</h2>
                        <label className="block text-sm text-slate-400 mb-2">Adicione uma legenda</label>
                        <textarea
                            value={publishCaption}
                            onChange={e => setPublishCaption(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white placeholder-slate-600 focus:ring-2 focus:ring-emerald-500 focus:outline-none resize-none h-24 mb-6"
                            placeholder="Descreva seu trade, o que achou da sua execução..."
                        />
                        <div className="mb-6">
                            <label className="block text-sm text-slate-400 mb-2 font-bold">Privacidade</label>
                            <div className="flex bg-slate-950 border border-slate-800 rounded-xl overflow-hidden p-1">
                                <button
                                    onClick={() => setPublishVisibility('public')}
                                    className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${publishVisibility === 'public' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'}`}
                                >
                                    Público (Comunidade)
                                </button>
                                <button
                                    onClick={() => setPublishVisibility('private')}
                                    className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${publishVisibility === 'private' ? 'bg-slate-800 text-white shadow-md' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'}`}
                                >
                                    Apenas Eu (Privado)
                                </button>
                            </div>
                        </div>

                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => setIsPublishModalOpen(false)}
                                className="px-4 py-2 bg-slate-800 text-slate-300 rounded-xl hover:bg-slate-700 font-bold"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handlePublishToNetwork}
                                disabled={isPublishing}
                                className="px-6 py-2 bg-emerald-600 text-white rounded-xl hover:bg-emerald-500 font-bold flex items-center gap-2 disabled:opacity-50"
                            >
                                {isPublishing ? 'Publicando...' : 'Publicar Agora'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
