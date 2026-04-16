import { useEffect, useState } from 'react';
import {
    Edit3,
    Clock,
    Zap,
    X,
    ArrowRight,
    Save,
    BookOpen,
    LayoutGrid
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { CalendarWidget } from '../components/journal/CalendarWidget';
import { JournalEditor } from '../components/journal/JournalEditor';

interface TechnicalJournal {
    marketTrend: string;
    volatility: string;
    session: string;
    strategyUsed: string;
    mistakes: string;
    lessons: string;
    rulesBroken: string;
    actionPlan: string;
    rating: number;
    notes?: string;
    entryPrecision: string;
    riskManagement: string;
    tradeExit: string;
    emotionalState: string;
    setupQuality: string;
    executionSpeed: string;
    marketContext: string;
    preMarketPrep: string;
}

export const Journal = () => {
    const navigate = useNavigate();
    // State
    const { token } = useAuth();
    const [currentDate, setCurrentDate] = useState(new Date());
    const [selectedDate, setSelectedDate] = useState<Date>(new Date());
    const [viewMode, setViewMode] = useState<'journal' | 'analysis'>('journal');

    // Data State
    const [trades, setTrades] = useState<any[]>([]);
    const [selectedTrade, setSelectedTrade] = useState<any | null>(null);

    // Trade Editor Wizard State
    const [tradeEditStep, setTradeEditStep] = useState(1);
    const [tradeEditForm, setTradeEditForm] = useState<any>({});
    const [isSavingTrade, setIsSavingTrade] = useState(false);

    // Tech Journal Form State
    const [techForm, setTechForm] = useState<TechnicalJournal>({
        marketTrend: '',
        volatility: '',
        session: '',
        strategyUsed: '',
        mistakes: '',
        lessons: '',
        rulesBroken: '',
        actionPlan: '',
        rating: 0,
        notes: '',
        entryPrecision: '',
        riskManagement: '',
        tradeExit: '',
        emotionalState: '',
        setupQuality: '',
        executionSpeed: '',
        marketContext: '',
        preMarketPrep: ''
    });
    const [savingJournal, setSavingJournal] = useState(false);

    useEffect(() => {
        if (token) {
            fetchTrades();
        }
    }, [token]);

    useEffect(() => {
        if (selectedDate && token) {
            fetchTechnicalJournal();
        }
    }, [selectedDate, token]);

    const fetchTrades = async () => {
        try {
            const res = await api.get('/dashboard/trades');
            if (Array.isArray(res.data)) {
                const mapped = res.data.map((t: any) => ({
                    ...t, // Keep original fields for editing
                    ticket: t.ticket || t.id,
                    close_time: new Date(t.closeTime).getTime(),
                    symbol: t.symbol,
                    type: t.type,
                    volume: t.volume,
                    profit: Number(t.profit) + Number(t.commission) + Number(t.swap),
                }));
                setTrades(mapped);
            }
        } catch (err) {
            console.error("Failed to load journal trades", err);
        }
    };

    const handleUpdateTrade = async (tradeId: string | number, updates: Partial<any>) => {
        try {
            await api.patch(`/dashboard/trades/${tradeId}`, updates);
            // Refresh list
            fetchTrades();
            // Update selected trade if necessary
            if (selectedTrade?.id === tradeId || selectedTrade?.ticket === tradeId) {
                setSelectedTrade({ ...selectedTrade, ...updates });
            }
        } catch (err) {
            console.error("Failed to update trade", err);
        }
    };

    useEffect(() => {
        if (selectedTrade) {
            setTradeEditStep(1);
            setTradeEditForm({
                setup: selectedTrade.setup || '',
                mood: selectedTrade.mood || '',
                rating: selectedTrade.rating || 0,
                lesson: selectedTrade.lesson || '',
                mistakes: selectedTrade.mistakes || '',
                tradeExit: selectedTrade.tradeExit || '',
                executionSpeed: selectedTrade.executionSpeed || '',
                actionPlan: selectedTrade.actionPlan || '',
                entryPrecision: selectedTrade.entryPrecision || ''
            });
        }
    }, [selectedTrade]);

    const handleSaveTradeForm = async () => {
        if (!selectedTrade) return;
        try {
            setIsSavingTrade(true);
            await handleUpdateTrade(selectedTrade.id, tradeEditForm);
            // Optionally could advance step or show toast. Let's just stay on same step or go to 1.
            setTradeEditStep(1); 
        } finally {
            setIsSavingTrade(false);
        }
    };

    const fetchTechnicalJournal = async () => {
        try {
            const dateStr = selectedDate.toISOString().split('T')[0];
            const res = await api.get(`/dashboard/technical-journal/${dateStr}`);
            const data = res.data;

            if (data) {
                setTechForm({
                    marketTrend: data.marketTrend || '',
                    volatility: data.volatility || '',
                    session: data.session || '',
                    strategyUsed: data.strategyUsed || '',
                    mistakes: data.mistakes || '',
                    lessons: data.lessons || '',
                    rulesBroken: data.rulesBroken || '',
                    actionPlan: data.actionPlan || '',
                    rating: data.rating || 0,
                    notes: data.notes || '',
                    entryPrecision: data.entryPrecision || '',
                    riskManagement: data.riskManagement || '',
                    tradeExit: data.tradeExit || '',
                    emotionalState: data.emotionalState || '',
                    setupQuality: data.setupQuality || '',
                    executionSpeed: data.executionSpeed || '',
                    marketContext: data.marketContext || '',
                    preMarketPrep: data.preMarketPrep || ''
                });
            } else {
                setTechForm({
                    marketTrend: '', volatility: '', session: '', strategyUsed: '', mistakes: '', lessons: '', rulesBroken: '', actionPlan: '', rating: 0, notes: '',
                    entryPrecision: '', riskManagement: '', tradeExit: '', emotionalState: '', setupQuality: '', executionSpeed: '', marketContext: '', preMarketPrep: ''
                });
            }
        } catch (error) {
            console.error("Failed to fetch journal", error);
        }
    };

    const handleSaveJournal = async () => {
        try {
            setSavingJournal(true);
            const dateStr = selectedDate.toISOString().split('T')[0];
            const payload = { ...techForm, date: dateStr };

            await api.post(`/dashboard/technical-journal`, payload);
        } catch (error) {
            console.error("Failed to save journal", error);
        } finally {
            setSavingJournal(false);
        }
    };

    const handleMonthChange = (offset: number) => {
        const newDate = new Date(currentDate);
        newDate.setMonth(newDate.getMonth() + offset);
        setCurrentDate(newDate);
    };

    const filteredTrades = trades.filter(t => {
        if (!selectedDate) return false;
        const d = new Date(t.close_time);
        return d.getDate() === selectedDate.getDate() &&
            d.getMonth() === selectedDate.getMonth() &&
            d.getFullYear() === selectedDate.getFullYear();
    });

    return (
        <div className="flex flex-col gap-6 pb-10">

            {/* Header with Tabs */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-white mb-1 flex items-center gap-3">
                        <BookOpen className="text-indigo-400" /> Diário de Trading
                    </h1>
                    <p className="text-slate-400 text-sm">Registro técnico e análise de performance.</p>
                </div>

                <div className="bg-slate-900/50 p-1 rounded-xl border border-slate-800 flex">
                    <button
                        onClick={() => setViewMode('journal')}
                        className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${viewMode === 'journal' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'
                            }`}
                    >
                        <LayoutGrid size={16} /> Diário
                    </button>
                    <button
                        onClick={() => setViewMode('analysis')}
                        className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${viewMode === 'analysis' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'
                            }`}
                    >
                        <Edit3 size={16} /> Anotações
                    </button>
                </div>
            </div>

            {viewMode === 'analysis' ? (
                <div className="flex flex-col bg-slate-900/40 backdrop-blur-xl border border-slate-800 rounded-3xl p-6 shadow-2xl">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-lg font-bold text-white flex items-center gap-2">
                            <Edit3 className="text-indigo-400" /> Anotações Detalhadas
                        </h3>
                        <button
                            onClick={handleSaveJournal}
                            disabled={savingJournal}
                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg font-bold text-xs shadow-lg shadow-indigo-900/20 transition-all flex items-center gap-2"
                        >
                            {savingJournal ? <Clock className="animate-spin" size={14} /> : <Save size={14} />}
                            Salvar
                        </button>
                    </div>
                    <div className="flex-1 overflow-hidden rounded-xl border border-slate-700">
                        <JournalEditor
                            value={techForm.notes || ''}
                            onEditorChange={(content) => setTechForm({ ...techForm, notes: content })}
                            placeholder="Escreva livremente sobre o dia aqui..."
                            height={600} // Taller height for focus mode
                        />
                    </div>
                </div>
            ) : (
                <div className="flex flex-col gap-6">

                    {/* Top Row: Calendar - Restricted Width for better balance */}
                    <div className="flex justify-center w-full">
                        <div className="relative w-full max-w-4xl">
                            <div className="absolute -inset-1 bg-gradient-to-r from-indigo-500/20 to-purple-500/20 rounded-3xl blur-xl -z-10"></div>
                            <CalendarWidget
                                currentDate={currentDate}
                                selectedDate={selectedDate}
                                onDateSelect={setSelectedDate}
                                onMonthChange={handleMonthChange}
                                trades={trades}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                        {/* Trade List for Selected Day */}
                        <div className="bg-slate-900/60 backdrop-blur-xl border border-slate-800 rounded-3xl p-6 flex flex-col shadow-xl min-h-[400px]">
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="text-sm font-bold text-white flex items-center gap-2">
                                    <Clock className="text-emerald-400" size={16} />
                                    {selectedDate.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                                </h2>
                                <span className="text-xs font-mono text-slate-500 bg-slate-800/50 px-2 py-1 rounded">
                                    {filteredTrades.length} Trades
                                </span>
                            </div>

                            {filteredTrades.length > 0 ? (
                                <div className="flex-1 overflow-auto custom-scrollbar space-y-2 pr-2">
                                    {filteredTrades.map((t: any) => (
                                        <div
                                            key={t.ticket}
                                            onClick={() => setSelectedTrade(t)}
                                            className={`p-3 rounded-xl border cursor-pointer hover:bg-slate-800/50 transition-all ${selectedTrade?.ticket === t.ticket ? 'bg-indigo-500/10 border-indigo-500/30 ring-1 ring-indigo-500/20' : 'bg-slate-950/30 border-slate-800'
                                                }`}
                                        >
                                            <div className="flex justify-between items-center mb-1">
                                                <span className="text-xs font-bold text-slate-300">{t.symbol}</span>
                                                <span className={`text-xs font-mono font-bold ${t.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                    {t.profit >= 0 ? '+' : ''}{t.profit.toFixed(2)}
                                                </span>
                                            </div>
                                            <div className="flex justify-between items-center text-[10px] text-slate-500">
                                                <span>{t.type} • {t.volume}</span>
                                                <span>{new Date(t.close_time).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="flex-1 flex flex-col items-center justify-center text-center text-slate-600">
                                    <p className="text-xs italic">Nenhum trade para este dia.</p>
                                </div>
                            )}
                        </div>

                        {/* Per-Trade Editor (appears when selected) */}
                        {selectedTrade ? (
                            <div className="bg-slate-900/60 backdrop-blur-xl border border-indigo-500/30 rounded-3xl p-6 flex flex-col shadow-xl animate-in slide-in-from-right-4 relative">
                                <div className="flex justify-between items-center mb-6">
                                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                        <Zap className="text-indigo-400" size={18} /> Trade #{selectedTrade.ticket}
                                    </h3>
                                    <button onClick={() => setSelectedTrade(null)} className="text-slate-500 hover:text-white">
                                        <X size={20} />
                                    </button>
                                </div>
                                
                                {/* Step Indicators */}
                                <div className="flex gap-2 mb-6">
                                    {[1, 2, 3].map(step => (
                                        <div key={step} className={`h-1 flex-1 rounded-full ${tradeEditStep >= step ? 'bg-indigo-500' : 'bg-slate-800'}`} />
                                    ))}
                                </div>

                                <div className="space-y-4 flex-1">
                                    {tradeEditStep === 1 && (
                                        <div className="space-y-4 animate-in fade-in">
                                            <div>
                                                <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Setup Principal</label>
                                                <input 
                                                    className="w-full bg-slate-800 border-slate-700 rounded-lg text-sm p-2 text-white outline-none focus:border-indigo-500 transition-colors"
                                                    placeholder="Ex: Breakout H1"
                                                    value={tradeEditForm.setup || ''}
                                                    onChange={e => setTradeEditForm({ ...tradeEditForm, setup: e.target.value })}
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Estado Emocional Inicial</label>
                                                <select 
                                                    className="w-full bg-slate-800 border-slate-700 rounded-lg text-sm p-2 text-white outline-none focus:border-indigo-500 transition-colors"
                                                    value={tradeEditForm.mood || ''}
                                                    onChange={e => setTradeEditForm({ ...tradeEditForm, mood: e.target.value })}
                                                >
                                                    <option value="">Humor...</option>
                                                    <option value="Focado">Focado</option>
                                                    <option value="Ansioso">Ansioso</option>
                                                    <option value="Eufórico">Eufórico</option>
                                                    <option value="Calmo">Calmo</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Avaliação do Setup (1-5)</label>
                                                <div className="flex gap-1">
                                                    {[1, 2, 3, 4, 5].map((n: number) => (
                                                        <button
                                                            key={n}
                                                            onClick={() => setTradeEditForm({ ...tradeEditForm, rating: n })}
                                                            className={`flex-1 h-8 rounded border flex items-center justify-center font-bold text-xs transition-all ${tradeEditForm.rating >= n ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-500/10' : 'bg-slate-800 border-slate-700 text-slate-600 hover:border-slate-500'}`}
                                                        >
                                                            {n}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {tradeEditStep === 2 && (
                                        <div className="space-y-4 animate-in fade-in">
                                            <div>
                                                <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Precisão da Entrada</label>
                                                <select 
                                                    className="w-full bg-slate-800 border-slate-700 rounded-lg text-sm p-2 text-white outline-none focus:border-indigo-500 transition-colors"
                                                    value={tradeEditForm.entryPrecision || ''}
                                                    onChange={e => setTradeEditForm({ ...tradeEditForm, entryPrecision: e.target.value })}
                                                >
                                                    <option value="">Selecione...</option>
                                                    <option value="Perfeita">Perfeita</option>
                                                    <option value="Atrasada">Atrasada</option>
                                                    <option value="Adiantada">Adiantada</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Qualidade da Saída</label>
                                                <select 
                                                    className="w-full bg-slate-800 border-slate-700 rounded-lg text-sm p-2 text-white outline-none focus:border-indigo-500 transition-colors"
                                                    value={tradeEditForm.tradeExit || ''}
                                                    onChange={e => setTradeEditForm({ ...tradeEditForm, tradeExit: e.target.value })}
                                                >
                                                    <option value="">Selecione...</option>
                                                    <option value="No Alvo">No Alvo</option>
                                                    <option value="Prematura">Prematura</option>
                                                    <option value="Arrastada">Arrastada (Hold)</option>
                                                    <option value="Stop Loss">Stop Loss</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Erros de Execução</label>
                                                <textarea 
                                                    className="w-full bg-slate-800 border-slate-700 rounded-lg text-sm p-3 text-white outline-none h-16 resize-none focus:border-indigo-500 transition-colors"
                                                    placeholder="Cometeu algum erro na execução?"
                                                    value={tradeEditForm.mistakes || ''}
                                                    onChange={e => setTradeEditForm({ ...tradeEditForm, mistakes: e.target.value })}
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {tradeEditStep === 3 && (
                                        <div className="space-y-4 animate-in fade-in">
                                            <div>
                                                <label className="text-[10px] uppercase font-bold text-emerald-500 mb-1 block">Lições Aprendidas</label>
                                                <textarea 
                                                    className="w-full bg-emerald-500/5 border-emerald-500/20 rounded-lg text-sm p-3 text-emerald-100 outline-none h-16 resize-none focus:border-emerald-500 transition-colors"
                                                    placeholder="O que você aprendeu com este trade?"
                                                    value={tradeEditForm.lesson || ''}
                                                    onChange={e => setTradeEditForm({ ...tradeEditForm, lesson: e.target.value })}
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[10px] uppercase font-bold text-blue-500 mb-1 block">Plano de Ação</label>
                                                <textarea 
                                                    className="w-full bg-blue-500/5 border-blue-500/20 rounded-lg text-sm p-3 text-blue-100 outline-none h-16 resize-none focus:border-blue-500 transition-colors"
                                                    placeholder="Como agir de forma diferente?"
                                                    value={tradeEditForm.actionPlan || ''}
                                                    onChange={e => setTradeEditForm({ ...tradeEditForm, actionPlan: e.target.value })}
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div className="mt-6 flex flex-col gap-2">
                                    <div className="flex gap-2">
                                        {tradeEditStep > 1 && (
                                            <button 
                                                onClick={() => setTradeEditStep(s => s - 1)}
                                                className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-bold transition-all"
                                            >
                                                Voltar
                                            </button>
                                        )}
                                        {tradeEditStep < 3 ? (
                                            <button 
                                                onClick={() => setTradeEditStep(s => s + 1)}
                                                className="flex-[2] py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2"
                                            >
                                                Avançar <ArrowRight size={14} />
                                            </button>
                                        ) : (
                                            <button 
                                                onClick={handleSaveTradeForm}
                                                disabled={isSavingTrade}
                                                className="flex-[2] py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2"
                                            >
                                                {isSavingTrade ? <Clock className="animate-spin" size={14} /> : <Save size={14} />}
                                                Salvar Análise
                                            </button>
                                        )}
                                    </div>
                                    <button 
                                        onClick={() => navigate(`/trades/${selectedTrade.id}`)}
                                        className="w-full py-2 bg-slate-900/50 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2"
                                    >
                                        Ver Detalhes Completos <ArrowRight size={14} />
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="bg-slate-900/40 border border-dashed border-slate-800 rounded-3xl p-8 flex flex-col items-center justify-center text-center text-slate-500 min-h-[300px]">
                                <p className="text-xs">Selecione um trade para editar.</p>
                            </div>
                        )}
                    </div>

                    {/* Bottom Row: Technical Journal Form */}
                    <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800 rounded-3xl p-6 shadow-2xl">
                        <div className="flex items-center gap-3 mb-6 border-b border-slate-800 pb-4">
                            <div className="p-2 bg-indigo-500/10 rounded-lg">
                                <Edit3 className="text-indigo-400" size={20} />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-white">Análise Técnica</h3>
                                <p className="text-slate-400 text-xs">Registro do dia {selectedDate.toLocaleDateString()}</p>
                            </div>
                            <div className="ml-auto">
                                <button
                                    onClick={handleSaveJournal}
                                    disabled={savingJournal}
                                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg font-bold text-xs shadow-lg shadow-indigo-900/20 transition-all flex items-center gap-2"
                                >
                                    {savingJournal ? <Clock className="animate-spin" size={14} /> : <Save size={14} />}
                                    Salvar Diário
                                </button>
                            </div>
                        </div>

                        <div className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div>
                                    <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Contexto</label>
                                    <select
                                        className="w-full bg-slate-800 border-slate-700 rounded-lg text-sm p-2.5 text-white outline-none focus:border-indigo-500 transition-colors"
                                        value={techForm.marketTrend}
                                        onChange={e => setTechForm({ ...techForm, marketTrend: e.target.value })}
                                    >
                                        <option value="">Tendência...</option>
                                        <option value="Alta Forte">Alta Forte</option>
                                        <option value="Consolidação">Consolidação</option>
                                        <option value="Baixa Forte">Baixa Forte</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Volatilidade</label>
                                    <div className="flex gap-2">
                                        {['Baixa', 'Média', 'Alta'].map(v => (
                                            <button
                                                key={v}
                                                onClick={() => setTechForm(p => ({ ...p, volatility: v }))}
                                                className={`flex-1 py-1.5 text-xs rounded-lg border font-medium transition-all ${techForm.volatility === v ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-slate-800 text-slate-500 border-slate-700'}`}
                                            >
                                                {v}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Estratégia Principal</label>
                                    <input
                                        className="w-full bg-slate-800 border-slate-700 rounded-lg text-sm p-2.5 text-white outline-none focus:border-indigo-500 transition-colors"
                                        value={techForm.strategyUsed}
                                        onChange={e => setTechForm({ ...techForm, strategyUsed: e.target.value })}
                                        placeholder="Ex: Breakout H1"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Qualidade do Setup</label>
                                    <select
                                        className="w-full bg-slate-800 border-slate-700 rounded-lg text-sm p-2.5 text-white outline-none focus:border-indigo-500 transition-colors"
                                        value={techForm.setupQuality}
                                        onChange={e => setTechForm({ ...techForm, setupQuality: e.target.value })}
                                    >
                                        <option value="">Selecione...</option>
                                        <option value="A+">Setup A+ (Perfeito)</option>
                                        <option value="B">Setup B (Bom)</option>
                                        <option value="C">Setup C (Forçado)</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Sessão</label>
                                    <select
                                        className="w-full bg-slate-800 border-slate-700 rounded-lg text-sm p-2.5 text-white outline-none focus:border-indigo-500 transition-colors"
                                        value={techForm.session}
                                        onChange={e => setTechForm({ ...techForm, session: e.target.value })}
                                    >
                                        <option value="">Selecione...</option>
                                        <option value="London">London</option>
                                        <option value="New York">New York</option>
                                        <option value="Asia">Asia</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Nota do Dia</label>
                                    <div className="flex gap-1">
                                        {[1, 2, 3, 4, 5].map(n => (
                                            <button
                                                key={n}
                                                onClick={() => setTechForm(p => ({ ...p, rating: n }))}
                                                className={`flex-1 h-10 rounded border flex items-center justify-center font-bold text-xs ${techForm.rating >= n ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-500/10' : 'bg-slate-800 border-slate-700 text-slate-600'}`}
                                            >
                                                {n}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                <div>
                                    <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Entrada</label>
                                    <select
                                        className="w-full bg-slate-800 border-slate-700 rounded-lg text-sm p-2 text-white outline-none focus:border-indigo-500 transition-colors"
                                        value={techForm.entryPrecision}
                                        onChange={e => setTechForm({ ...techForm, entryPrecision: e.target.value })}
                                    >
                                        <option value="">Selecione...</option>
                                        <option value="Perfeita">Perfeita</option>
                                        <option value="Atrasada">Atrasada</option>
                                        <option value="Adiantada">Adiantada</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Saída</label>
                                    <select
                                        className="w-full bg-slate-800 border-slate-700 rounded-lg text-sm p-2 text-white outline-none focus:border-indigo-500 transition-colors"
                                        value={techForm.tradeExit}
                                        onChange={e => setTechForm({ ...techForm, tradeExit: e.target.value })}
                                    >
                                        <option value="">Selecione...</option>
                                        <option value="No Alvo">No Alvo</option>
                                        <option value="Prematura">Prematura</option>
                                        <option value="Arrasatada">Arrastada (Hold)</option>
                                        <option value="Stop Loss">Stop Loss</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Gestão de Risco</label>
                                    <select
                                        className="w-full bg-slate-800 border-slate-700 rounded-lg text-sm p-2 text-white outline-none focus:border-indigo-500 transition-colors"
                                        value={techForm.riskManagement}
                                        onChange={e => setTechForm({ ...techForm, riskManagement: e.target.value })}
                                    >
                                        <option value="">Selecione...</option>
                                        <option value="Respeitado">Risco Respeitado</option>
                                        <option value="Excesso">Excesso de Risco</option>
                                        <option value="Micro Lotes">Micro Lotes (Medo)</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Estado Emocional</label>
                                    <select
                                        className="w-full bg-slate-800 border-slate-700 rounded-lg text-sm p-2 text-white outline-none focus:border-indigo-500 transition-colors"
                                        value={techForm.emotionalState}
                                        onChange={e => setTechForm({ ...techForm, emotionalState: e.target.value })}
                                    >
                                        <option value="">Selecione...</option>
                                        <option value="Focado">Focado</option>
                                        <option value="Impulsivo">Impulsivo</option>
                                        <option value="Ansioso">Ansioso</option>
                                        <option value="Frustrado">Frustrado</option>
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="text-[10px] uppercase font-bold text-rose-500 mb-1 block">Erros Cometidos</label>
                                    <textarea
                                        className="w-full bg-rose-500/5 border-rose-500/20 rounded-lg text-sm p-3 text-rose-100 outline-none h-20 resize-none focus:border-rose-500 transition-colors placeholder-rose-900/50"
                                        value={techForm.mistakes || ''}
                                        onChange={e => setTechForm({ ...techForm, mistakes: e.target.value })}
                                        placeholder="Ex: Entrei por FOMO..."
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] uppercase font-bold text-rose-500 mb-1 block">Regras Quebradas</label>
                                    <textarea
                                        className="w-full bg-rose-500/5 border-rose-500/20 rounded-lg text-sm p-3 text-rose-100 outline-none h-20 resize-none focus:border-rose-500 transition-colors placeholder-rose-900/50"
                                        value={techForm.rulesBroken || ''}
                                        onChange={e => setTechForm({ ...techForm, rulesBroken: e.target.value })}
                                        placeholder="Ex: Não esperei pelo fecho de vela..."
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] uppercase font-bold text-emerald-500 mb-1 block">Lições Aprendidas</label>
                                    <textarea
                                        className="w-full bg-emerald-500/5 border-emerald-500/20 rounded-lg text-sm p-3 text-emerald-100 outline-none h-20 resize-none focus:border-emerald-500 transition-colors placeholder-emerald-900/50"
                                        value={techForm.lessons || ''}
                                        onChange={e => setTechForm({ ...techForm, lessons: e.target.value })}
                                        placeholder="O que levaste desta sessão..."
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] uppercase font-bold text-blue-500 mb-1 block">Plano de Ação</label>
                                    <textarea
                                        className="w-full bg-blue-500/5 border-blue-500/20 rounded-lg text-sm p-3 text-blue-100 outline-none h-20 resize-none focus:border-blue-500 transition-colors placeholder-blue-900/50"
                                        value={techForm.actionPlan || ''}
                                        onChange={e => setTechForm({ ...techForm, actionPlan: e.target.value })}
                                        placeholder="O que vais fazer melhor da próxima vez..."
                                    />
                                </div>
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Preparação Pré-Mercado</label>
                                    <input
                                        className="w-full bg-slate-800 border-slate-700 rounded-lg text-sm p-2 text-white outline-none focus:border-indigo-500 transition-colors"
                                        value={techForm.preMarketPrep}
                                        onChange={e => setTechForm({ ...techForm, preMarketPrep: e.target.value })}
                                        placeholder="Como te preparaste?"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Contexto de Mercado (Resumo)</label>
                                    <input
                                        className="w-full bg-slate-800 border-slate-700 rounded-lg text-sm p-2 text-white outline-none focus:border-indigo-500 transition-colors"
                                        value={techForm.marketContext}
                                        onChange={e => setTechForm({ ...techForm, marketContext: e.target.value })}
                                        placeholder="Ex: NFP + CPI no mesmo dia"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Anotações do Dia / Resumo</label>
                                <textarea
                                    className="w-full bg-slate-800 border-slate-700 rounded-lg text-sm p-3 text-white outline-none h-20 resize-none focus:border-indigo-500 transition-colors"
                                    value={techForm.notes || ''}
                                    onChange={e => setTechForm({ ...techForm, notes: e.target.value })}
                                    placeholder="Breve comentário..."
                                />
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};



