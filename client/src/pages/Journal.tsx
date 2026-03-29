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
            const res = await api.get('/trades');
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

    const fetchTechnicalJournal = async () => {
        try {
            const dateStr = selectedDate.toISOString().split('T')[0];
            const res = await api.get(`/technical-journal/${dateStr}`);
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

            await api.post(`/technical-journal`, payload);
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

                    {/* Top Row: Calendar Full Width */}
                    <div className="grid grid-cols-1 gap-6 items-stretch">
                        <div className="relative">
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
                            <div className="bg-slate-900/60 backdrop-blur-xl border border-indigo-500/30 rounded-3xl p-6 flex flex-col shadow-xl animate-in slide-in-from-right-4">
                                <div className="flex justify-between items-center mb-6">
                                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                        <Zap className="text-indigo-400" size={18} /> Trade #{selectedTrade.ticket}
                                    </h3>
                                    <button onClick={() => setSelectedTrade(null)} className="text-slate-500 hover:text-white">
                                        <X size={20} />
                                    </button>
                                </div>

                                <div className="space-y-4">
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Setup</label>
                                            <input 
                                                className="w-full bg-slate-800 border-slate-700 rounded-lg text-sm p-2 text-white outline-none focus:border-indigo-500 transition-colors"
                                                placeholder="Ex: Breakout H1"
                                                value={selectedTrade.setup || ''}
                                                onChange={e => handleUpdateTrade(selectedTrade.id, { setup: e.target.value })}
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Humor</label>
                                            <select 
                                                className="w-full bg-slate-800 border-slate-700 rounded-lg text-sm p-2 text-white outline-none focus:border-indigo-500 transition-colors"
                                                value={selectedTrade.mood || ''}
                                                onChange={e => handleUpdateTrade(selectedTrade.id, { mood: e.target.value })}
                                            >
                                                <option value="">Humor...</option>
                                                <option value="Focado">Focado</option>
                                                <option value="Ansioso">Ansioso</option>
                                                <option value="Calmo">Calmo</option>
                                                <option value="Impulsivo">Impulsivo</option>
                                                <option value="Confiante">Confiante</option>
                                            </select>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Setup</label>
                                            <input 
                                                className="w-full bg-slate-800 border-slate-700 rounded-lg text-sm p-2 text-white outline-none focus:border-indigo-500 transition-colors"
                                                placeholder="Ex: Breakout"
                                                value={selectedTrade.setup || ''}
                                                onChange={e => handleUpdateTrade(selectedTrade.id, { setup: e.target.value })}
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Humor</label>
                                            <select 
                                                className="w-full bg-slate-800 border-slate-700 rounded-lg text-sm p-2 text-white outline-none focus:border-indigo-500 transition-colors"
                                                value={selectedTrade.mood || ''}
                                                onChange={e => handleUpdateTrade(selectedTrade.id, { mood: e.target.value })}
                                            >
                                                <option value="">Humor...</option>
                                                <option value="Focado">Focado</option>
                                                <option value="Ansioso">Ansioso</option>
                                                <option value="Eufórico">Eufórico</option>
                                                <option value="Calmo">Calmo</option>
                                            </select>
                                        </div>
                                    </div>

                                    <div>
                                        <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Avaliação</label>
                                        <div className="flex gap-1">
                                            {[1, 2, 3, 4, 5].map((n: number) => (
                                                <button
                                                    key={n}
                                                    onClick={() => handleUpdateTrade(selectedTrade.id, { rating: n })}
                                                    className={`flex-1 h-8 rounded border flex items-center justify-center font-bold text-xs transition-all ${selectedTrade.rating >= n ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-500/10' : 'bg-slate-800 border-slate-700 text-slate-600 hover:border-slate-500'}`}
                                                >
                                                    {n}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div>
                                        <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Lições Aprendidas</label>
                                        <textarea 
                                            className="w-full bg-slate-800 border-slate-700 rounded-lg text-sm p-3 text-white outline-none h-20 resize-none focus:border-indigo-500 transition-colors"
                                            placeholder="O que você aprendeu com este trade?"
                                            value={selectedTrade.lesson || ''}
                                            onChange={e => handleUpdateTrade(selectedTrade.id, { lesson: e.target.value })}
                                        />
                                    </div>

                                    <button 
                                        onClick={() => navigate(`/trades/${selectedTrade.id}`)}
                                        className="w-full py-2 bg-slate-800 hover:bg-indigo-600 hover:text-white text-slate-300 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2"
                                    >
                                        Detalhes Completos <ArrowRight size={14} />
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

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-4">
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
                                    <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Nota do Dia</label>
                                    <div className="flex gap-1">
                                        {[1, 2, 3, 4, 5].map(n => (
                                            <button
                                                key={n}
                                                onClick={() => setTechForm(p => ({ ...p, rating: n }))}
                                                className={`flex-1 h-8 rounded border flex items-center justify-center font-bold text-xs ${techForm.rating >= n ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-500/10' : 'bg-slate-800 border-slate-700 text-slate-600'}`}
                                            >
                                                {n}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-4">
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
                                    <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Anotações do Dia</label>
                                    <textarea
                                        className="w-full bg-slate-800 border-slate-700 rounded-lg text-sm p-3 text-white outline-none h-24 resize-none focus:border-indigo-500 transition-colors"
                                        value={techForm.notes || ''}
                                        onChange={e => setTechForm({ ...techForm, notes: e.target.value })}
                                        placeholder="Breve resumo emocional ou do mercado..."
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};



