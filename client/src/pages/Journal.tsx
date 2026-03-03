import { useEffect, useState } from 'react';
import {
    Edit3,
    Clock,
    BookOpen,
    LayoutGrid,
    Save
} from 'lucide-react';
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
    rating: number;
    notes: string;
    entryPrecision: string;
    riskManagement: string;
    tradeExit: string;
    emotionalState: string;
}

export const Journal = () => {
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
        rating: 0,
        notes: '',
        entryPrecision: '',
        riskManagement: '',
        tradeExit: '',
        emotionalState: ''
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
                    ticket: t.ticket || t.id,
                    close_time: new Date(t.closeTime).getTime(),
                    symbol: t.symbol,
                    type: t.type,
                    volume: t.volume,
                    profit: Number(t.profit) + Number(t.commission) + Number(t.swap),
                    rating: t.rating,
                    notes: t.notes,
                }));
                setTrades(mapped);
            }
        } catch (err) {
            console.error("Failed to load journal trades", err);
        }
    };

    const fetchTechnicalJournal = async () => {
        try {
            const dateStr = selectedDate.toISOString().split('T')[0];
            const res = await fetch(`http://localhost:3000/api/technical-journal/${dateStr}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const text = await res.text();
                const data = text ? JSON.parse(text) : null;

                if (data) {
                    setTechForm({
                        marketTrend: data.marketTrend || '',
                        volatility: data.volatility || '',
                        session: data.session || '',
                        strategyUsed: data.strategyUsed || '',
                        mistakes: data.mistakes || '',
                        lessons: data.lessons || '',
                        rating: data.rating || 0,
                        notes: data.notes || '',
                        entryPrecision: data.entryPrecision || '',
                        riskManagement: data.riskManagement || '',
                        tradeExit: data.tradeExit || '',
                        emotionalState: data.emotionalState || ''
                    });
                } else {
                    setTechForm({
                        marketTrend: '', vol: '', session: '', strategyUsed: '', mistakes: '', lessons: '', rating: 0, notes: '',
                        entryPrecision: '', riskManagement: '', tradeExit: '', emotionalState: ''
                    } as any);
                }
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

            await fetch(`http://localhost:3000/api/technical-journal`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(payload)
            });
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
                <div className="flex-1 min-h-0 flex flex-col bg-slate-900/40 backdrop-blur-xl border border-slate-800 rounded-3xl p-6 shadow-2xl">
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
                            value={techForm.notes}
                            onEditorChange={(content) => setTechForm({ ...techForm, notes: content })}
                            placeholder="Escreva livremente sobre o dia aqui..."
                            height={600} // Taller height for focus mode
                        />
                    </div>
                </div>
            ) : (
                <div className="flex flex-col gap-6">

                    {/* Top Row: Calendar & Trade List Inline */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                        {/* Calendar Widget */}
                        <div>
                            <CalendarWidget
                                currentDate={currentDate}
                                selectedDate={selectedDate}
                                onDateSelect={setSelectedDate}
                                onMonthChange={handleMonthChange}
                                trades={trades}
                            />
                        </div>

                        {/* Trade List for Selected Day */}
                        <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800 rounded-3xl p-6 flex flex-col shadow-xl min-h-[400px]">
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="text-sm font-bold text-white flex items-center gap-2">
                                    <Clock className="text-emerald-400" size={16} />
                                    {selectedDate.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                                </h2>
                                <span className="text-xs font-mono text-slate-500 bg-slate-800/50 px-2 py-1 rounded">
                                    {filteredTrades.length} Trades
                                </span>
                            </div>

                            <div className="flex-1 overflow-auto custom-scrollbar space-y-2">
                                {filteredTrades.length === 0 ? (
                                    <div className="text-center text-slate-500 text-xs py-10">Sem trades hoje.</div>
                                ) : (
                                    filteredTrades.map(t => (
                                        <div
                                            key={t.ticket}
                                            onClick={() => setSelectedTrade(t)}
                                            className={`p-3 rounded-xl border cursor-pointer hover:bg-slate-800/50 transition-colors ${selectedTrade?.ticket === t.ticket ? 'bg-indigo-500/10 border-indigo-500/30' : 'bg-slate-950/30 border-slate-800'
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
                                    ))
                                )}
                            </div>
                        </div>
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
                                    Salvar
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Inputs */}
                            <div className="space-y-4">
                                <div>
                                    <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Contexto</label>
                                    <select
                                        className="w-full bg-slate-800 border-slate-700 rounded-lg text-sm p-2.5 text-white focus:ring-1 focus:ring-indigo-500 outline-none"
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
                                                className={`flex-1 py-2 text-xs rounded-lg border font-medium transition-all ${techForm.volatility === v ? 'bg-slate-700 text-white border-slate-500' : 'bg-slate-800/50 text-slate-500 border-slate-700'
                                                    }`}
                                            >
                                                {v}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div>
                                    <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Estratégia</label>
                                    <input
                                        className="w-full bg-slate-800 border-slate-700 rounded-lg text-sm p-2.5 text-white outline-none"
                                        placeholder="Ex: Breakout"
                                        value={techForm.strategyUsed}
                                        onChange={e => setTechForm({ ...techForm, strategyUsed: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div>
                                    <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Checklist</label>
                                    <div className="p-3 bg-slate-800/50 rounded-lg border border-slate-700">
                                        <p className="text-xs text-slate-400 text-center italic">
                                            Responda as perguntas ao lado para calcular sua pontuação de disciplina.
                                        </p>
                                    </div>
                                </div>

                                <div>
                                    <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Nota do Dia</label>
                                    <div className="flex gap-1">
                                        {[1, 2, 3, 4, 5].map(n => (
                                            <button
                                                key={n}
                                                onClick={() => setTechForm(p => ({ ...p, rating: n }))}
                                                className={`flex-1 h-8 rounded border flex items-center justify-center font-bold text-xs ${techForm.rating >= n ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-600'
                                                    }`}
                                            >
                                                {n}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            {/* Text Areas (Full Width) */}
                            {/* Fundamental Questions Section */}
                            <div className="space-y-6">
                                <div className="bg-slate-800/50 p-6 rounded-xl border border-slate-700">
                                    <h4 className="text-xs font-bold text-indigo-400 uppercase tracking-wider mb-6 flex items-center gap-2">
                                        <BookOpen size={14} /> Avaliação Objetiva
                                    </h4>

                                    <div className="space-y-6">
                                        {/* Q1: Entry */}
                                        <div>
                                            <p className="text-sm text-slate-300 mb-2 font-medium">1. Precisão na Entrada</p>
                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                                {['Perfeita (No Setup)', 'Antecipada (Ansiedade)', 'Tardia (Hesitação)', 'Impulso (Sem Setup)'].map(opt => (
                                                    <button
                                                        key={opt}
                                                        onClick={() => setTechForm({ ...techForm, entryPrecision: opt })}
                                                        className={`px-3 py-2 rounded-lg text-xs font-bold border transition-all ${techForm.entryPrecision === opt
                                                            ? 'bg-indigo-500 text-white border-indigo-400 shadow-md'
                                                            : 'bg-slate-900 border-slate-700 text-slate-500 hover:border-slate-600'}`}
                                                    >
                                                        {opt}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Q2: Risk */}
                                        <div>
                                            <p className="text-sm text-slate-300 mb-2 font-medium">2. Gestão de Risco</p>
                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                                {['Segui o Plano', 'Lote Excessivo', 'Movi o Stop', 'Sem Stop'].map(opt => (
                                                    <button
                                                        key={opt}
                                                        onClick={() => setTechForm({ ...techForm, riskManagement: opt })}
                                                        className={`px-3 py-2 rounded-lg text-xs font-bold border transition-all ${techForm.riskManagement === opt
                                                            ? 'bg-indigo-500 text-white border-indigo-400 shadow-md'
                                                            : 'bg-slate-900 border-slate-700 text-slate-500 hover:border-slate-600'}`}
                                                    >
                                                        {opt}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Q3: Exit */}
                                        <div>
                                            <p className="text-sm text-slate-300 mb-2 font-medium">3. Execução da Saída</p>
                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                                {['No Alvo (TP)', 'Stop Técnico', 'Saída Antecipada (Medo)', 'Segurei Demais (Ganância)'].map(opt => (
                                                    <button
                                                        key={opt}
                                                        onClick={() => setTechForm({ ...techForm, tradeExit: opt })}
                                                        className={`px-3 py-2 rounded-lg text-xs font-bold border transition-all ${techForm.tradeExit === opt
                                                            ? 'bg-indigo-500 text-white border-indigo-400 shadow-md'
                                                            : 'bg-slate-900 border-slate-700 text-slate-500 hover:border-slate-600'}`}
                                                    >
                                                        {opt}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Q4: Mood */}
                                        <div>
                                            <p className="text-sm text-slate-300 mb-2 font-medium">4. Estado Emocional</p>
                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                                {['Focado / Calmo', 'Ansioso / Impaciente', 'Irritado / Vingativo', 'Excesso de Confiança'].map(opt => (
                                                    <button
                                                        key={opt}
                                                        onClick={() => setTechForm({ ...techForm, emotionalState: opt })}
                                                        className={`px-3 py-2 rounded-lg text-xs font-bold border transition-all ${techForm.emotionalState === opt
                                                            ? 'bg-indigo-500 text-white border-indigo-400 shadow-md'
                                                            : 'bg-slate-900 border-slate-700 text-slate-500 hover:border-slate-600'}`}
                                                    >
                                                        {opt}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 gap-6">
                                    <div>
                                        <label className="text-[10px] uppercase font-bold text-slate-500 mb-2 block text-rose-400">
                                            Onde eu falhei? (Erros & Hesitações)
                                        </label>
                                        <JournalEditor
                                            value={techForm.mistakes}
                                            onEditorChange={(content) => setTechForm({ ...techForm, mistakes: content })}
                                            placeholder="Responda com base nas perguntas acima: Onde você deviou do plano?"
                                            height={200}
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[10px] uppercase font-bold text-slate-500 mb-2 block text-emerald-400">
                                            O que funcionou? (Acertos & Padrões)
                                        </label>
                                        <JournalEditor
                                            value={techForm.lessons}
                                            onEditorChange={(content) => setTechForm({ ...techForm, lessons: content })}
                                            placeholder="O que você fez bem e deve repetir amanhã?"
                                            height={200}
                                        />
                                    </div>
                                </div>
                            </div>

                        </div>
                    </div>

                </div>
            )}
        </div>
    );
};



