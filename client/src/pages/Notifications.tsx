
import { useState, useEffect } from 'react';
import {
    Bell,
    Check,
    TrendingUp,
    AlertTriangle,
    Info,
    BrainCircuit,
    Search,
    CheckCircle2,
    Clock,
    ArrowRight,
    MessageCircle,
    Copy,
    Settings
} from 'lucide-react';
import api from '../api';
import { Modal } from '../components/ui/Modal';

// Dados carregados dinamicamente via API

// --- Componentes UI Reutilizáveis ---

const NotificationButton = ({ children, variant = 'primary', className = '', icon: Icon, ...props }: any) => {
    const baseStyles = "relative px-4 py-2 rounded-xl font-bold transition-all duration-300 flex items-center justify-center disabled:opacity-70 disabled:cursor-not-allowed active:scale-[0.98] text-sm";

    const variants: any = {
        primary: "bg-emerald-500 hover:bg-emerald-400 text-white shadow-lg shadow-emerald-900/20 border border-transparent",
        secondary: "bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 border border-slate-700",
        ghost: "bg-transparent text-slate-400 hover:text-white hover:bg-slate-800/50",
        danger: "bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20"
    };

    return (
        <button className={`${baseStyles} ${variants[variant]} ${className}`} {...props}>
            {Icon && <Icon size={16} className="mr-2" />}
            {children}
        </button>
    );
};

const Badge = ({ count, variant = 'default' }: any) => {
    if (count === 0) return null;
    const colors: any = {
        default: "bg-slate-700 text-slate-300",
        emerald: "bg-emerald-500 text-white",
        red: "bg-red-500 text-white"
    };
    return (
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${colors[variant]}`}>
            {count}
        </span>
    );
};

const TraderHealthScore = ({ score, details }: { score: number; details: any }) => {
    const getScoreColor = (s: number) => {
        if (s >= 80) return 'text-emerald-400';
        if (s >= 50) return 'text-amber-400';
        return 'text-red-400';
    };

    const getScoreLabel = (s: number) => {
        if (s >= 80) return 'Excelente Disciplina';
        if (s >= 50) return 'Atenção Necessária';
        return 'Risco Operacional Alto';
    };

    return (
        <div className="bg-slate-900/60 backdrop-blur-xl border border-slate-800 rounded-3xl p-6 mb-8 flex flex-col md:flex-row items-center gap-8 shadow-2xl relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/5 rounded-full blur-[80px] -z-10 group-hover:bg-emerald-500/10 transition-colors duration-700" />

            {/* Circular Progress */}
            <div className="relative w-32 h-32 flex items-center justify-center">
                <svg className="w-full h-full -rotate-90">
                    <circle
                        cx="64"
                        cy="64"
                        r="58"
                        fill="transparent"
                        stroke="currentColor"
                        strokeWidth="8"
                        className="text-slate-800"
                    />
                    <circle
                        cx="64"
                        cy="64"
                        r="58"
                        fill="transparent"
                        stroke="currentColor"
                        strokeWidth="8"
                        strokeDasharray={364.4}
                        strokeDashoffset={364.4 - (364.4 * score) / 100}
                        strokeLinecap="round"
                        className={`transition-all duration-1000 ease-out ${getScoreColor(score)}`}
                    />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className={`text-3xl font-black ${getScoreColor(score)}`}>{score}</span>
                    <span className="text-[10px] text-slate-500 font-bold uppercase tracking-tighter">Health</span>
                </div>
            </div>

            <div className="flex-1 text-center md:text-left">
                <h3 className="text-xl font-bold text-white mb-1 flex items-center justify-center md:justify-start gap-2">
                    Saúde do Trader: <span className={getScoreColor(score)}>{getScoreLabel(score)}</span>
                </h3>
                <p className="text-slate-400 text-sm mb-4">
                    Seu score é baseado na disciplina dos últimos 7 dias. Evite alertas críticos para manter uma alta pontuação.
                </p>
                <div className="flex flex-wrap justify-center md:justify-start gap-3">
                    <div className="bg-slate-950/50 px-3 py-1.5 rounded-xl border border-slate-800 flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
                        <span className="text-xs text-slate-400 font-medium">Críticos: <span className="text-white font-bold">{details?.penalties?.critical || 0}</span></span>
                    </div>
                    <div className="bg-slate-950/50 px-3 py-1.5 rounded-xl border border-slate-800 flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        <span className="text-xs text-slate-400 font-medium">Avisos: <span className="text-white font-bold">{details?.penalties?.warning || 0}</span></span>
                    </div>
                    <div className="bg-slate-950/50 px-3 py-1.5 rounded-xl border border-slate-800 flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                        <span className="text-xs text-slate-400 font-medium">Periodo: <span className="text-white font-bold">7d</span></span>
                    </div>
                </div>
            </div>

            <button onClick={() => window.location.href = '/performance'} className="px-5 py-2.5 bg-slate-800 hover:bg-slate-750 text-white text-xs font-bold rounded-xl transition-all border border-slate-700 hover:border-slate-600">
                Ver Relatório
            </button>
        </div>
    );
};

// --- Componente de Item da Lista ---

const NotificationItem = ({ item, onRead, onDelete, onResolve }: any) => {
    const isAlert = 'severity' in item;

    const getIcon = (type: string, severity?: string) => {
        if (severity === 'CRITICAL') return <Search className="text-red-500 animate-pulse" size={20} />;

        switch (type.toLowerCase()) {
            case 'trade_success': return <TrendingUp className="text-emerald-400" size={20} />;
            case 'risk':
            case 'risk_alert': return <AlertTriangle className="text-red-400" size={20} />;
            case 'psychology':
            case 'mental_insight': return <BrainCircuit className="text-purple-400" size={20} />;
            case 'performance': return <TrendingUp className="text-blue-400" size={20} />;
            case 'discipline': return <CheckCircle2 className="text-amber-400" size={20} />;
            case 'system': return <Info className="text-blue-400" size={20} />;
            case 'journal':
            case 'trade_neutral': return <Clock className="text-slate-400" size={20} />;
            default: return <Bell className="text-slate-400" size={20} />;
        }
    };

    const getSeverityStyles = (severity: string) => {
        switch (severity) {
            case 'CRITICAL': return 'border-red-500/50 bg-red-500/10 shadow-[0_0_15px_rgba(239,68,68,0.1)]';
            case 'WARNING': return 'border-amber-500/40 bg-amber-500/5';
            case 'INFO': return 'border-blue-500/30 bg-blue-500/5';
            default: return 'border-slate-800 bg-slate-800/20';
        }
    };

    const getStatusColor = (type: string, isRead: boolean) => {
        if (isRead) return 'border-transparent opacity-60';
        switch (type.toLowerCase()) {
            case 'trade_success': return 'border-emerald-500/30 bg-emerald-500/5';
            case 'risk_alert':
            case 'risk': return 'border-red-500/30 bg-red-500/5';
            default: return 'border-slate-800 bg-slate-900/40';
        }
    };

    return (
        <div className={`group relative p-5 rounded-2xl border transition-all duration-500 hover:scale-[1.01] ${isAlert ? getSeverityStyles(item.severity) : getStatusColor(item.type, item.read)}`}>
            <div className="flex gap-4">
                {/* Ícone Container */}
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 bg-slate-950 border border-slate-800 group-hover:border-slate-700 transition-colors ${!item.read ? 'shadow-xl' : ''}`}>
                    {getIcon(item.type, item.severity)}
                </div>

                {/* Conteúdo */}
                <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start mb-1">
                        <div className="flex items-center gap-2">
                            {isAlert && (
                                <span className={`text-[10px] font-black px-2 py-0.5 rounded-md tracking-wider ${item.severity === 'CRITICAL' ? 'bg-red-500 text-white' :
                                    item.severity === 'WARNING' ? 'bg-amber-500 text-white' : 'bg-blue-500 text-white'
                                    }`}>
                                    {item.severity}
                                </span>
                            )}
                            <h4 className={`text-base font-bold truncate pr-4 ${item.read || item.resolved ? 'text-slate-400' : 'text-white'}`}>
                                {item.title}
                            </h4>
                        </div>
                        <span className="text-xs text-slate-500 whitespace-nowrap flex items-center gap-1 font-medium bg-slate-950/50 px-2 py-1 rounded-lg">
                            <Clock size={12} /> {new Date(item.createdAt || item.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {new Date(item.createdAt || item.time).toLocaleDateString()}
                        </span>
                    </div>

                    <p className={`text-sm leading-relaxed mb-4 ${item.read || item.resolved ? 'text-slate-500' : 'text-slate-300'}`}>
                        {isAlert ? item.description : item.message}
                    </p>

                    {/* Meta Data (if Alert) */}
                    {isAlert && item.metadata && (
                        <div className="flex gap-4 mb-4">
                            {Object.entries(item.metadata).map(([key, value]: [string, any]) => (
                                <div key={key} className="bg-slate-950/80 px-3 py-1.5 rounded-xl border border-slate-800/50">
                                    <span className="text-[10px] text-slate-500 uppercase block font-bold mb-0.5">{key.replace('_', ' ')}</span>
                                    <span className="text-xs font-mono text-emerald-400 font-bold">{typeof value === 'number' ? value.toFixed(2) : value}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Ações Rápidas */}
                    <div className="flex items-center gap-3">
                        {isAlert && !item.resolved ? (
                            <button
                                onClick={() => onResolve(item.id)}
                                className="text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 px-4 py-2 rounded-xl transition-all shadow-lg shadow-emerald-900/20 active:scale-95 flex items-center gap-2"
                            >
                                <Check size={14} /> Resolver Alerta
                            </button>
                        ) : !isAlert && !item.read && (
                            <button onClick={() => onRead(item.id)} className="text-xs font-bold text-emerald-400 hover:text-emerald-300 flex items-center gap-2 bg-emerald-500/10 px-3 py-1.5 rounded-xl transition-colors border border-emerald-500/20">
                                <Check size={14} /> Marcar como lida
                            </button>
                        )}
                        <button onClick={() => onDelete(item.id, isAlert)} className="text-xs font-bold text-slate-500 hover:text-red-400 flex items-center gap-2 hover:bg-red-500/5 px-3 py-1.5 rounded-xl transition-colors">
                            {isAlert ? 'Descartar' : 'Excluir'}
                        </button>
                    </div>
                </div>

                {/* Status Indicator */}
                {!item.read && !item.resolved && (
                    <div className={`absolute top-5 right-5 w-2.5 h-2.5 rounded-full ${item.severity === 'CRITICAL' ? 'bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.8)]' : 'bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.8)]'}`}></div>
                )}
            </div>
        </div>
    );
};

const TelegramSettingsModal = ({ isOpen, onClose }: any) => {
    const [step, setStep] = useState<'initial' | 'otp' | 'connected'>('initial');
    const [otp, setOtp] = useState('');
    const [botUsername, setBotUsername] = useState('');
    const [loading, setLoading] = useState(false);
    const [preferences, setPreferences] = useState({
        trade_success: true,
        risk_alert: true,
        mental_insight: true,
        system: true
    });

    useEffect(() => {
        if (isOpen) {
            checkStatus();
        }
    }, [isOpen]);

    const checkStatus = async () => {
        try {
            const { data } = await api.get('/notifications/telegram/status');
            if (data.connected) {
                setStep('connected');
            } else {
                setStep('initial');
            }
        } catch (error) {
            console.error('Failed to check Telegram status', error);
        }
    };

    const handleConnect = async () => {
        setLoading(true);
        try {
            const { data } = await api.post('/notifications/telegram/setup');
            setOtp(data.otp);
            setBotUsername(data.botUsername);
            setStep('otp');
        } catch (error) {
            console.error('Failed to setup Telegram', error);
        } finally {
            setLoading(false);
        }
    };

    const handleDisconnect = async () => {
        setLoading(true);
        try {
            await api.post('/notifications/telegram/disconnect');
            setStep('initial');
            setOtp('');
        } catch (error) {
            console.error('Failed to disconnect Telegram', error);
        } finally {
            setLoading(false);
        }
    };

    const handleCopyOtp = () => {
        navigator.clipboard.writeText(otp);
        // Could show toast here
    };

    const handlePreferenceChange = (key: string) => {
        setPreferences(prev => ({ ...prev, [key]: !prev[key as keyof typeof prev] }));
        // Debounce save or save on close?
        // For simplicity, we can save immediately or have a save button.
        // Let's implicit save for now or separate API call needed if backend supports it.
        // Backend updateSettings supports notificationPreferences.
        api.post('/notifications/settings', { notificationPreferences: { ...preferences, [key]: !preferences[key as keyof typeof preferences] } });
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Configurações de Notificação">
            <div className="space-y-6">

                {/* Telegram Section */}
                <div className="bg-slate-950/50 p-4 rounded-xl border border-slate-800">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="p-2 bg-blue-500/10 rounded-lg">
                            <MessageCircle className="text-blue-400" size={20} />
                        </div>
                        <div>
                            <h4 className="font-bold text-white">Telegram Bot</h4>
                            <p className="text-xs text-slate-400">Receba alertas em tempo real no seu Telegram.</p>
                        </div>
                    </div>

                    {step === 'initial' && (
                        <button
                            onClick={handleConnect}
                            disabled={loading}
                            className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg transition-colors flex items-center justify-center gap-2"
                        >
                            {loading ? 'Carregando...' : 'Conectar Telegram'}
                        </button>
                    )}

                    {step === 'otp' && (
                        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
                            <div className="text-center">
                                <p className="text-sm text-slate-400 mb-2">Envie este código para o nosso bot:</p>
                                <div className="flex items-center justify-center gap-2">
                                    <code className="text-2xl font-mono font-bold text-emerald-400 bg-slate-900 px-4 py-2 rounded-lg border border-slate-700 tracking-widest">
                                        {otp}
                                    </code>
                                    <button onClick={handleCopyOtp} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors">
                                        <Copy size={18} />
                                    </button>
                                </div>
                            </div>

                            <div className="text-center">
                                <a
                                    href={`https://t.me/${botUsername}?start=${otp}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-block text-blue-400 hover:text-blue-300 text-sm hover:underline"
                                >
                                    Abrir @{botUsername || 'Bot'}
                                </a>
                            </div>

                            <button
                                onClick={checkStatus}
                                className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-lg transition-colors text-sm"
                            >
                                Já enviei o código
                            </button>
                        </div>
                    )}

                    {step === 'connected' && (
                        <div className="flex items-center justify-between bg-emerald-500/10 border border-emerald-500/20 p-3 rounded-lg">
                            <span className="text-emerald-400 text-sm font-bold flex items-center gap-2">
                                <CheckCircle2 size={16} /> Conectado
                            </span>
                            <button
                                onClick={handleDisconnect}
                                disabled={loading}
                                className="text-xs text-red-400 hover:text-red-300 hover:underline"
                            >
                                Desconectar
                            </button>
                        </div>
                    )}
                </div>

                {/* Preferences Section */}
                <div>
                    <h4 className="font-bold text-white mb-3">Preferências</h4>
                    <div className="space-y-2">
                        {[
                            { id: 'trade_success', label: 'Trades e Profit' },
                            { id: 'risk_alert', label: 'Alertas de Risco' },
                            { id: 'mental_insight', label: 'Insights Mentais' },
                            { id: 'system', label: 'Sistema' }
                        ].map(pref => (
                            <label key={pref.id} className="flex items-center justify-between p-3 bg-slate-900 rounded-lg cursor-pointer hover:bg-slate-800/50 transition-colors">
                                <span className="text-sm text-slate-300">{pref.label}</span>
                                <input
                                    type="checkbox"
                                    checked={preferences[pref.id as keyof typeof preferences]}
                                    onChange={() => handlePreferenceChange(pref.id)}
                                    className="w-5 h-5 rounded border-slate-700 bg-slate-800 text-emerald-500 focus:ring-emerald-500/50"
                                />
                            </label>
                        ))}
                    </div>
                </div>

            </div>
        </Modal>
    );
};

// --- Componente Principal ---

export const Notifications = () => {
    const [notifications, setNotifications] = useState<any[]>([]);
    const [alerts, setAlerts] = useState<any[]>([]);
    const [scoreData, setScoreData] = useState<{ score: number; details: any }>({ score: 100, details: {} });
    const [filter, setFilter] = useState('all'); // all, unread, alerts
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        try {
            const [notifRes, alertRes, scoreRes] = await Promise.all([
                api.get('/notifications'),
                api.get('/alerts'),
                api.get('/alerts/score')
            ]);

            setNotifications(notifRes.data.map((n: any) => ({
                id: n.id,
                type: n.type?.toLowerCase() || 'system',
                title: n.title,
                message: n.message,
                read: n.isRead,
                createdAt: n.createdAt
            })));

            setAlerts(alertRes.data);
            setScoreData(scoreRes.data);
        } catch (error) {
            console.error('Failed to fetch data', error);
        }
    }

    const unreadCount = notifications.filter(n => !n.read).length;
    const pendingAlertsCount = alerts.filter(a => !a.resolved).length;

    const markAllAsRead = async () => {
        const unreadIds = notifications.filter(n => !n.read).map(n => n.id);
        setNotifications(prev => prev.map(n => ({ ...n, read: true })));

        for (const id of unreadIds) {
            try {
                await api.patch(`/notifications/${id}/read`);
            } catch (error) {
                console.error('Failed to mark as read', id);
            }
        }
    };

    const markAsRead = async (id: number | string) => {
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
        try {
            await api.patch(`/notifications/${id}/read`);
        } catch (error) {
            console.error('Failed to mark as read', id);
        }
    };

    const resolveAlert = async (id: string) => {
        setAlerts(prev => prev.map(a => a.id === id ? { ...a, resolved: true } : a));
        try {
            await api.patch(`/alerts/${id}/resolve`);
        } catch (error) {
            console.error('Failed to resolve alert', id);
        }
    };

    const deleteItem = async (id: number | string, isAlert: boolean) => {
        if (isAlert) {
            setAlerts(prev => prev.filter(a => a.id !== id));
            // Backend might need a delete endpoint for alerts if requested, for now we just resolve
            await resolveAlert(id as string);
        } else {
            setNotifications(prev => prev.filter(n => n.id !== id));
            try {
                await api.delete(`/notifications/${id}`);
            } catch (error) {
                console.error('Failed to delete notification', id);
            }
        }
    };

    const combinedItems = [
        ...notifications.map(n => ({ ...n, isAlert: false })),
        ...alerts.map(a => ({ ...a, isAlert: true }))
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const filteredItems = combinedItems.filter(item => {
        if (filter === 'unread') return !item.read && !item.resolved;
        if (filter === 'alerts') return item.isAlert && !item.resolved;
        return true;
    });

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 font-sans relative overflow-hidden flex justify-center p-4 md:p-8">

            {/* Background Ambience */}
            <div className="fixed inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-0 right-0 w-[800px] h-[600px] bg-emerald-500/5 rounded-full blur-[120px] -z-10" />
                <div className="absolute inset-0 opacity-[0.02]" style={{ backgroundImage: 'radial-gradient(#fff 1px, transparent 1px)', backgroundSize: '32px 32px' }} />
            </div>

            <div className="w-full max-w-4xl relative z-10">

                {/* Header da Página */}
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <div className="p-2 bg-slate-900 border border-slate-800 rounded-lg">
                                <Bell className="text-emerald-400" size={24} />
                            </div>
                            <h1 className="text-2xl md:text-3xl font-bold text-white">Notificações</h1>
                        </div>
                        <p className="text-slate-400 text-sm">Gerencie seus alertas de trade e insights do sistema.</p>
                    </div>

                    <div className="flex items-center gap-3">
                        <NotificationButton variant="secondary" onClick={markAllAsRead} disabled={unreadCount === 0} icon={CheckCircle2}>
                            Marcar lidas
                        </NotificationButton>
                        <div className="h-8 w-px bg-slate-800 hidden md:block"></div>
                        <NotificationButton
                            variant="ghost"
                            className="hidden md:flex"
                            onClick={() => setIsSettingsOpen(true)}
                        >
                            <Settings size={18} className="mr-2" /> Configurações
                        </NotificationButton>
                    </div>
                </header>

                <TelegramSettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />

                {/* Health Score Widget */}
                {scoreData && <TraderHealthScore score={scoreData.score} details={scoreData.details} />}

                {/* Container Principal */}
                <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800 rounded-3xl overflow-hidden shadow-2xl min-h-[600px] flex flex-col">

                    {/* Barra de Filtros */}
                    <div className="border-b border-slate-800 p-4 md:p-6 flex flex-col md:flex-row gap-4 justify-between items-center bg-slate-900/50">
                        <div className="flex p-1 bg-slate-950 rounded-xl w-full md:w-auto overflow-x-auto">
                            {[
                                { id: 'all', label: 'Todas' },
                                { id: 'unread', label: 'Não lidas', count: unreadCount + pendingAlertsCount },
                                { id: 'alerts', label: 'Professional Alerts', count: pendingAlertsCount }
                            ].map(tab => (
                                <button
                                    key={tab.id}
                                    onClick={() => setFilter(tab.id)}
                                    className={`px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap flex items-center gap-2 ${filter === tab.id
                                        ? 'bg-slate-800 text-white shadow-md'
                                        : 'text-slate-500 hover:text-slate-300'
                                        }`}
                                >
                                    {tab.label}
                                    {(tab.count || 0) > 0 && <Badge count={tab.count} variant={filter === tab.id ? 'emerald' : 'default'} />}
                                </button>
                            ))}
                        </div>

                        <div className="relative w-full md:w-64 group">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-emerald-400 transition-colors" size={16} />
                            <input
                                type="text"
                                placeholder="Buscar alertas..."
                                className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2 pl-10 pr-4 text-sm text-slate-200 placeholder:text-slate-600 focus:ring-0 focus:border-emerald-500/50 transition-all outline-none"
                            />
                        </div>
                    </div>

                    {/* Lista de Notificações */}
                    <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
                        {filteredItems.length > 0 ? (
                            filteredItems.map(item => (
                                <NotificationItem
                                    key={item.id}
                                    item={item}
                                    onRead={markAsRead}
                                    onDelete={deleteItem}
                                    onResolve={resolveAlert}
                                />
                            ))
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center text-center py-20 opacity-50">
                                <div className="w-20 h-20 bg-slate-800/50 rounded-full flex items-center justify-center mb-6">
                                    <Bell className="text-slate-600" size={32} />
                                </div>
                                <h3 className="text-xl font-bold text-slate-300 mb-2">Tudo limpo por aqui!</h3>
                                <p className="text-slate-500 max-w-xs">Você resolveu todos os alertas desta categoria.</p>
                                {filter !== 'all' && (
                                    <button onClick={() => setFilter('all')} className="mt-6 text-emerald-400 hover:text-emerald-300 text-sm font-bold flex items-center gap-2">
                                        Ver todos os alertas <ArrowRight size={14} />
                                    </button>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Footer da Lista */}
                    <div className="bg-slate-950/50 border-t border-slate-800 p-4 flex justify-between items-center text-[10px] text-slate-500 uppercase tracking-widest font-bold">
                        <span>Sincronizado há pouco • Torex Engine v2.0</span>
                        <div className="flex gap-6">
                            <span className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div> Trades</span>
                            <span className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-red-500"></div> Risco</span>
                            <span className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-purple-500"></div> Comportamento</span>
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
}
