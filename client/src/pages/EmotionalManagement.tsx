
import { useState, useEffect, useRef } from 'react';
import { BrainCircuit, Save, Zap, Moon, Target, Smile, AlertTriangle, Coffee, History, ExternalLink, Calendar, Share2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/Button';
// keeping for now or remove if strictly unused. Actually I'll remove it.
import html2canvas from 'html2canvas';

interface MentalLog {
    id?: number;
    date: string;
    sleepQuality: number;
    energy: number;
    focus: number;
    mood: number;
    stress: number;
    caffeine: number;
    notes: string;
    overallScore: number;
    createdAt?: string;
    updatedAt?: string;
    imageUrl?: string;
    session?: string;
    time?: string;
}

const getSession = () => {
    const hour = new Date().getHours();
    if (hour >= 20 || hour < 6) return 'Asian';
    if (hour >= 6 && hour < 12) return 'London';
    if (hour >= 12 && hour < 20) return 'New York';
    return 'General';
};

const MetricSlider = ({
    label,
    value,
    onChange,
    icon: Icon,
    colorClass = "text-purple-400",
    bgClass = "accent-purple-500",
    reverse = false
}: {
    label: string,
    value: number,
    onChange: (val: number) => void,
    icon: any,
    colorClass?: string,
    bgClass?: string,
    reverse?: boolean
}) => {
    return (
        <div className="bg-slate-900/40 p-4 rounded-xl border border-slate-800/50 hover:border-slate-700/50 transition-colors">
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <Icon size={18} className={colorClass} />
                    <span className="text-sm font-medium text-slate-300">{label}</span>
                </div>
                <span className="text-lg font-bold text-slate-100">{value}</span>
            </div>
            <input
                type="range"
                min="1"
                max="10"
                value={value}
                onChange={(e) => onChange(parseInt(e.target.value))}
                className={`w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer ${bgClass}`}
            />
            <div className="flex justify-between text-[10px] text-slate-500 mt-2 uppercase tracking-wider font-medium">
                <span>{reverse ? 'Alto' : 'Baixo'}</span>
                <span>{reverse ? 'Baixo' : 'Alto'}</span>
            </div>
        </div>
    );
};

const MentalScore = ({ score }: { score: number }) => {
    // Calculate color based on score
    let color = "text-red-500";
    if (score >= 50) color = "text-yellow-500";
    if (score >= 75) color = "text-emerald-500";

    const radius = 60;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference - (score / 100) * circumference;

    return (
        <div className="relative w-48 h-48 flex items-center justify-center">
            {/* SVG Ring */}
            <svg className="w-full h-full transform -rotate-90">
                <circle
                    cx="96"
                    cy="96"
                    r={radius}
                    stroke="currentColor"
                    strokeWidth="12"
                    fill="transparent"
                    className="text-slate-800"
                />
                <circle
                    cx="96"
                    cy="96"
                    r={radius}
                    stroke="currentColor"
                    strokeWidth="12"
                    fill="transparent"
                    strokeDasharray={circumference}
                    strokeDashoffset={strokeDashoffset}
                    strokeLinecap="round"
                    className={`${color} transition-all duration-1000 ease-out`}
                />
            </svg>
            <div className="absolute flex flex-col items-center">
                <span className={`text-5xl font-bold ${color}`}>{score}</span>
                <span className="text-xs text-slate-500 uppercase tracking-widest mt-1">Mental Score</span>
            </div>
        </div>
    );
};

const EmotionalManagement = () => {
    const { token, userEmail } = useAuth();
    // const navigate = useNavigate(); // Unused
    const captureRef = useRef<HTMLDivElement>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [history, setHistory] = useState<any[]>([]);
    const [userName, setUserName] = useState<string>('');
    const currentSession = getSession();

    // Default State
    const [log, setLog] = useState<MentalLog>({
        date: new Date().toISOString().split('T')[0],
        sleepQuality: 5,
        energy: 5,
        focus: 5,
        mood: 5,
        stress: 5,
        caffeine: 1,
        notes: '',
        overallScore: 50,
        session: getSession(),
        time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    });

    useEffect(() => {
        if (token) {
            fetchLog();
            fetchUserProfile();
        }
    }, [token]);

    const fetchUserProfile = async () => {
        try {
            const res = await fetch(`http://localhost:3000/api/auth/profile`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setUserName(data.name || data.email || 'Trader');
            }
        } catch (error) {
            console.error("Failed to fetch profile", error);
        }
    };

    const fetchLog = async () => {
        try {
            setLoading(true);
            const res = await fetch(`http://localhost:3000/api/mental-log/today?session=${currentSession}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                if (data) setLog(data);
            }

            // Fetch History
            const historyRes = await fetch(`http://localhost:3000/api/mental-log/history`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (historyRes.ok) {
                const historyData = await historyRes.json();
                setHistory(historyData);
            }

        } catch (error) {
            console.error("Failed to fetch log", error);
        } finally {
            setLoading(false);
        }
    };



    const handleSave = async () => {
        try {
            setSaving(true);

            // 1. Save Text Data
            const res = await fetch(`http://localhost:3000/api/mental-log`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    ...log,
                    session: currentSession,
                    time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                })
            });

            if (res.ok) {
                const savedLog = await res.json();
                setLog(savedLog);

                // 2. Capture & Upload Screenshot
                if (captureRef.current) {
                    const canvas = await html2canvas(captureRef.current, {
                        backgroundColor: '#0f172a',
                        scale: 1,
                        useCORS: true,
                        allowTaint: true
                    } as any);

                    canvas.toBlob(async (blob) => {
                        if (blob) {
                            const formData = new FormData();
                            formData.append('file', blob, `log-${Date.now()}.png`);
                            formData.append('session', currentSession);

                            await fetch(`http://localhost:3000/api/mental-log/image`, {
                                method: 'POST',
                                headers: { 'Authorization': `Bearer ${token}` },
                                body: formData
                            });

                            // Refresh history to show new image link
                            fetchLog();
                        }
                    }, 'image/png');
                } else {
                    fetchLog();
                }
            }
        } catch (error) {
            console.error("Failed to save log", error);
        } finally {
            setSaving(false);
        }
    };

    const updateMetric = (key: keyof MentalLog, value: any) => {
        setLog(prev => {
            const newLog = { ...prev, [key]: value };

            // Recalculate score locally for instant feedback
            if (key !== 'notes') {
                const s = key === 'sleepQuality' ? value : prev.sleepQuality;
                const e = key === 'energy' ? value : prev.energy;
                const f = key === 'focus' ? value : prev.focus;
                const m = key === 'mood' ? value : prev.mood;
                const st = key === 'stress' ? value : prev.stress;

                const scoreVal = (s + e + f + m + (10 - st)) / 5;
                newLog.overallScore = parseFloat((scoreVal * 10).toFixed(1));
            }
            return newLog;
        });
    };

    const getInsight = (score: number) => {
        if (score >= 80) return "Estado mental excelente para operar! Disciplina máxima.";
        if (score >= 60) return "Estado bom. Mantenha o foco e cuidado com excesso de confiança.";
        if (score >= 40) return "Cuidado. Você não está no seu melhor. Reduza o risco.";
        return "PERIGO! Não opere hoje. Seu estado mental está comprometido.";
    };

    const handleShare = async (imageUrl: string) => {
        const fullUrl = `http://localhost:3000${imageUrl}`;
        if (navigator.share) {
            try {
                // Fetch image blob to share file directly if supported, otherwise share link
                // For simplicity/compatibility, sharing the link first or text.
                // Better UX: Share the image file itself if possible, but requires fetching blob.
                // Let's stick to sharing the text/url for now or just generic share.
                await navigator.share({
                    title: 'Meu Registro Mental - Torex Journal',
                    text: `Confira meu estado mental para operar hoje! Score: ${log.overallScore}`,
                    url: fullUrl
                });
            } catch (err) {
                console.log('Error sharing:', err);
            }
        } else {
            // Fallback: Copy to clipboard
            try {
                await navigator.clipboard.writeText(fullUrl);
                alert('Link da imagem copiado para a área de transferência!');
            } catch (err) {
                console.error('Failed to copy keys', err);
            }
        }
    };

    if (loading) return <div className="p-10 text-center text-slate-500">Carregando...</div>;

    return (
        <div className="space-y-6">
            <header className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
                        <BrainCircuit className="text-purple-400" />
                        Gestão Mental
                    </h1>
                    <p className="text-slate-400">Prepare sua mente antes de cada sessão.</p>
                </div>
                <div className="text-right hidden md:block">
                    <p className="text-sm text-slate-500">Hoje</p>
                    <p className="text-xl font-bold text-slate-200">
                        {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
                    </p>
                </div>
            </header>

            <div ref={captureRef} className="grid grid-cols-1 lg:grid-cols-3 gap-6 relative">
                {/* Print Header - Visible only in screenshot or usually hidden but we can make it part of the card design or just hidden and show on print. 
                     The user asked for "Data do registo, Nome do usuario" in the print. 
                     Since html2canvas captures what is visible, we should add a header block inside this div. 
                 */}
                <div className="lg:col-span-3 bg-slate-800/80 p-4 rounded-xl border border-slate-700/50 flex justify-between items-center mb-0">
                    <div className="flex items-center gap-4">
                        <img
                            src="https://res.cloudinary.com/dndlqdylc/image/upload/v1769335429/Touro_design_1_beuv9b.png"
                            alt="TOREX Logo"
                            className="w-12 h-12 object-contain"
                            crossOrigin="anonymous"
                        />
                        <div>
                            <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                TOREX JOURNAL
                            </h2>
                            <p className="text-slate-400 text-sm">Relatório Mental Diário</p>
                        </div>
                    </div>
                    <div className="text-right">
                        <p className="text-emerald-400 font-bold text-lg">{userName || userEmail}</p>
                        <p className="text-slate-500 text-sm">
                            {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                        </p>
                        <p className="text-slate-400 text-xs mt-1 font-mono">
                            {log.time || new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} • {log.session || currentSession}
                        </p>
                    </div>
                </div>

                {/* Score Column */}
                <div className="lg:col-span-1 bg-slate-900/50 backdrop-blur-xl border border-slate-800 rounded-2xl p-6 flex flex-col items-center justify-center text-center space-y-6">
                    <h3 className="text-lg font-semibold text-slate-300">Score Diário</h3>
                    <MentalScore score={log.overallScore} />

                    <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700/50 w-full">
                        <div className="flex items-center gap-2 mb-2 text-slate-300 font-medium">
                            <Target size={16} /> Insight do Sistema
                        </div>
                        <p className={`text-sm ${log.overallScore < 50 ? 'text-red-400' : 'text-slate-400'}`}>
                            {getInsight(log.overallScore)}
                        </p>
                    </div>

                    <Button
                        onClick={handleSave}
                        isLoading={saving}
                        variant="gradient"
                        className="w-full py-4 text-base shadow-lg shadow-emerald-500/20"
                        icon={<Save size={20} />}
                    >
                        Salvar Registro
                    </Button>
                </div>

                {/* Metrics Grid */}
                <div className="lg:col-span-2 space-y-6">
                    <div className="bg-slate-900/50 backdrop-blur-xl border border-slate-800 rounded-2xl p-6">
                        <h3 className="text-lg font-semibold text-slate-300 mb-6">Métricas Fisiológicas</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <MetricSlider
                                label="Qualidade do Sono"
                                value={log.sleepQuality}
                                onChange={(v) => updateMetric('sleepQuality', v)}
                                icon={Moon}
                                colorClass="text-indigo-400"
                                bgClass="accent-indigo-500"
                            />
                            <MetricSlider
                                label="Nível de Energia"
                                value={log.energy}
                                onChange={(v) => updateMetric('energy', v)}
                                icon={Zap}
                                colorClass="text-yellow-400"
                                bgClass="accent-yellow-500"
                            />
                            <MetricSlider
                                label="Nível de Foco"
                                value={log.focus}
                                onChange={(v) => updateMetric('focus', v)}
                                icon={Target}
                                colorClass="text-blue-400"
                                bgClass="accent-blue-500"
                            />
                            <MetricSlider
                                label="Consumo de Cafeína"
                                value={log.caffeine}
                                onChange={(v) => updateMetric('caffeine', v)}
                                icon={Coffee}
                                colorClass="text-amber-700"
                                bgClass="accent-amber-700"
                            />
                        </div>
                    </div>

                    <div className="bg-slate-900/50 backdrop-blur-xl border border-slate-800 rounded-2xl p-6">
                        <h3 className="text-lg font-semibold text-slate-300 mb-6">Estado Emocional</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <MetricSlider
                                label="Humor Geral"
                                value={log.mood}
                                onChange={(v) => updateMetric('mood', v)}
                                icon={Smile}
                                colorClass="text-emerald-400"
                                bgClass="accent-emerald-500"
                            />
                            <MetricSlider
                                label="Nível de Stress"
                                value={log.stress}
                                onChange={(v) => updateMetric('stress', v)}
                                icon={AlertTriangle}
                                colorClass="text-red-400"
                                bgClass="accent-red-500"
                                reverse={true} // High stress is bad
                            />
                        </div>
                    </div>

                    <div className="bg-slate-900/50 backdrop-blur-xl border border-slate-800 rounded-2xl p-6">
                        <h3 className="text-lg font-semibold text-slate-300 mb-4">Notas & Observações</h3>
                        <textarea
                            value={log.notes}
                            onChange={(e) => updateMetric('notes', e.target.value)}
                            className="w-full h-24 bg-slate-800/50 border border-slate-700 rounded-lg p-4 text-slate-100 focus:outline-none focus:ring-2 focus:ring-purple-500/50 resize-none transition-all placeholder:text-slate-600"
                            placeholder="Algum evento externo afetando seu trading hoje? Notícias, família, saúde..."
                        ></textarea>
                    </div>
                </div>
            </div>

            {/* History Section */}
            <div className="bg-slate-900/50 backdrop-blur-xl border border-slate-800 rounded-2xl p-6 mt-6">
                <div className="flex items-center gap-2 mb-6">
                    <History className="text-slate-400" />
                    <h3 className="text-lg font-semibold text-slate-300">Histórico de Registros</h3>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-slate-950/30 text-xs text-slate-500 uppercase tracking-wider font-semibold">
                            <tr>
                                <th className="p-4 rounded-tl-lg">Data & Hora</th>
                                <th className="p-4">Sessão</th>
                                <th className="p-4">Score</th>
                                <th className="p-4">Insight do Sistema</th>
                                <th className="p-4 rounded-tr-lg text-right">Ação</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/50 text-sm">
                            {history.length === 0 ? (
                                <tr>
                                    <td colSpan={4} className="p-8 text-center text-slate-500 italic">
                                        Nenhum registro encontrado no histórico.
                                    </td>
                                </tr>
                            ) : history.map((h) => (
                                <tr key={h.id} className="hover:bg-slate-800/30 transition-colors group">
                                    <td className="p-4 text-slate-300 font-medium whitespace-nowrap">
                                        <div className="flex items-center gap-2">
                                            <Calendar size={14} className="text-slate-500" />
                                            <div className="flex flex-col">
                                                <span>{new Date(h.date).toLocaleDateString('pt-BR')}</span>
                                                <span className="text-xs text-slate-500">{h.time || new Date(h.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="p-4">
                                        <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${h.session === 'London' ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20' :
                                            h.session === 'New York' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                                                h.session === 'Asian' ? 'bg-pink-500/10 text-pink-400 border border-pink-500/20' :
                                                    'bg-slate-800 text-slate-400 border border-slate-700'
                                            }`}>
                                            {h.session || 'N/A'}
                                        </span>
                                    </td>
                                    <td className="p-4">
                                        <span className={`px-2 py-1 rounded text-[10px] font-bold border ${h.overallScore >= 75 ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : h.overallScore >= 50 ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'}`}>
                                            {h.overallScore}
                                        </span>
                                    </td>
                                    <td className="p-4 text-slate-400">
                                        {getInsight(h.overallScore)}
                                    </td>
                                    <td className="p-4 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            {h.imageUrl ? (
                                                <>
                                                    <a
                                                        href={`http://localhost:3000${h.imageUrl}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="inline-flex items-center gap-2 p-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-emerald-400 hover:text-emerald-300 transition-colors text-xs font-bold uppercase tracking-wider border border-slate-700"
                                                        title="Ver Imagem Original"
                                                    >
                                                        <ExternalLink size={16} /> Ver
                                                    </a>
                                                    <button
                                                        onClick={() => handleShare(h.imageUrl)}
                                                        className="inline-flex items-center gap-2 p-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-blue-400 hover:text-blue-300 transition-colors text-xs font-bold uppercase tracking-wider border border-slate-700"
                                                        title="Compartilhar"
                                                    >
                                                        <Share2 size={16} /> Share
                                                    </button>
                                                </>

                                            ) : (
                                                <span className="text-slate-600 text-xs italic">Sem Imagem</span>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default EmotionalManagement;
