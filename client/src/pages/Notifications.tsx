
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

// --- Dados Mockados ---
const INITIAL_NOTIFICATIONS = [
    {
        id: 1,
        type: 'trade_success',
        title: 'Take Profit Atingido',
        message: 'Seu trade em EURUSD atingiu o alvo final (+2.5 RR). Ótima execução!',
        time: 'Há 5 minutos',
        read: false,
        priority: 'high'
    },
    {
        id: 2,
        type: 'risk_alert',
        title: 'Alerta de Drawdown',
        message: 'Você atingiu 4% de perda diária. O limite estipulado no seu plano é 5%. Cuidado.',
        time: 'Há 2 horas',
        read: false,
        priority: 'critical'
    },
    {
        id: 3,
        type: 'mental_insight',
        title: 'Padrão Comportamental Detectado',
        message: 'Notamos que sua performance cai 30% quando você opera após às 16h.',
        time: 'Há 1 dia',
        read: true,
        priority: 'normal'
    },
    {
        id: 4,
        type: 'system',
        title: 'Manutenção Programada',
        message: 'A plataforma passará por uma atualização rápida neste domingo às 03:00 UTC.',
        time: 'Há 2 dias',
        read: true,
        priority: 'low'
    },
    {
        id: 5,
        type: 'trade_neutral',
        title: 'Diário Pendente',
        message: 'Você tem 3 trades de ontem sem anotações. Preencha seu diário para manter as métricas precisas.',
        time: 'Há 2 dias',
        read: true,
        priority: 'normal'
    }
];

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

// --- Componente de Item da Lista ---

const NotificationItem = ({ notification, onRead, onDelete }: any) => {
    const getIcon = (type: string) => {
        switch (type) {
            case 'trade_success': return <TrendingUp className="text-emerald-400" size={20} />;
            case 'risk_alert': return <AlertTriangle className="text-red-400" size={20} />;
            case 'mental_insight': return <BrainCircuit className="text-purple-400" size={20} />;
            case 'system': return <Info className="text-blue-400" size={20} />;
            default: return <Bell className="text-slate-400" size={20} />;
        }
    };

    const getBorderColor = (type: string, read: boolean) => {
        if (read) return 'border-transparent';
        switch (type) {
            case 'trade_success': return 'border-emerald-500/30 bg-emerald-500/5';
            case 'risk_alert': return 'border-red-500/30 bg-red-500/5';
            case 'mental_insight': return 'border-purple-500/30 bg-purple-500/5';
            default: return 'border-slate-700 bg-slate-800/30';
        }
    };

    return (
        <div className={`group relative p-4 rounded-xl border transition-all duration-300 hover:bg-slate-800/50 ${notification.read ? 'border-slate-800/50 bg-transparent opacity-70 hover:opacity-100' : getBorderColor(notification.type, false)}`}>
            <div className="flex gap-4">
                {/* Ícone Container */}
                <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 bg-slate-900 border border-slate-800 ${!notification.read ? 'shadow-lg' : ''}`}>
                    {getIcon(notification.type)}
                </div>

                {/* Conteúdo */}
                <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start mb-1">
                        <h4 className={`text-sm font-bold truncate pr-4 ${notification.read ? 'text-slate-400' : 'text-white'}`}>
                            {notification.title}
                        </h4>
                        <span className="text-xs text-slate-500 whitespace-nowrap flex items-center gap-1">
                            <Clock size={10} /> {notification.time}
                        </span>
                    </div>
                    <p className="text-sm text-slate-400 leading-relaxed mb-3">
                        {notification.message}
                    </p>

                    {/* Ações Rápidas */}
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                        {!notification.read && (
                            <button onClick={() => onRead(notification.id)} className="text-xs font-medium text-emerald-400 hover:text-emerald-300 flex items-center gap-1 bg-emerald-500/10 px-2 py-1 rounded-md transition-colors">
                                <Check size={12} /> Marcar como lida
                            </button>
                        )}
                        <button onClick={() => onDelete(notification.id)} className="text-xs font-medium text-slate-500 hover:text-red-400 flex items-center gap-1 hover:bg-slate-800 px-2 py-1 rounded-md transition-colors">
                            Excluir
                        </button>
                    </div>
                </div>

                {/* Indicador de Não Lido */}
                {!notification.read && (
                    <div className="absolute top-4 right-4 w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div>
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
    const [notifications, setNotifications] = useState(INITIAL_NOTIFICATIONS);
    const [filter, setFilter] = useState('all'); // all, unread, alerts
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);

    const unreadCount = notifications.filter(n => !n.read).length;

    const markAllAsRead = () => {
        setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    };

    const markAsRead = (id: number) => {
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    };

    const deleteNotification = (id: number) => {
        setNotifications(prev => prev.filter(n => n.id !== id));
    };

    const filteredNotifications = notifications.filter(n => {
        if (filter === 'unread') return !n.read;
        if (filter === 'alerts') return ['risk_alert', 'trade_neutral'].includes(n.type);
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

                {/* Container Principal */}
                <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800 rounded-3xl overflow-hidden shadow-2xl min-h-[600px] flex flex-col">

                    {/* Barra de Filtros */}
                    <div className="border-b border-slate-800 p-4 md:p-6 flex flex-col md:flex-row gap-4 justify-between items-center bg-slate-900/50">
                        <div className="flex p-1 bg-slate-950 rounded-xl w-full md:w-auto overflow-x-auto">
                            {[
                                { id: 'all', label: 'Todas' },
                                { id: 'unread', label: 'Não lidas', count: unreadCount },
                                { id: 'alerts', label: 'Alertas', count: 0 }
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
                                placeholder="Buscar notificações..."
                                className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2 pl-10 pr-4 text-sm text-slate-200 placeholder:text-slate-600 focus:ring-0 focus:border-emerald-500/50 transition-all outline-none"
                            />
                        </div>
                    </div>

                    {/* Lista de Notificações */}
                    <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-3">
                        {filteredNotifications.length > 0 ? (
                            filteredNotifications.map(notification => (
                                <NotificationItem
                                    key={notification.id}
                                    notification={notification}
                                    onRead={markAsRead}
                                    onDelete={deleteNotification}
                                />
                            ))
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center text-center py-20 opacity-50">
                                <div className="w-20 h-20 bg-slate-800/50 rounded-full flex items-center justify-center mb-6">
                                    <Bell className="text-slate-600" size={32} />
                                </div>
                                <h3 className="text-xl font-bold text-slate-300 mb-2">Tudo limpo por aqui!</h3>
                                <p className="text-slate-500 max-w-xs">Você leu todas as notificações desta categoria.</p>
                                {filter !== 'all' && (
                                    <button onClick={() => setFilter('all')} className="mt-6 text-emerald-400 hover:text-emerald-300 text-sm font-bold flex items-center gap-2">
                                        Ver todas as notificações <ArrowRight size={14} />
                                    </button>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Footer da Lista */}
                    <div className="bg-slate-950/50 border-t border-slate-800 p-4 flex justify-between items-center text-xs text-slate-500">
                        <span>Exibindo {filteredNotifications.length} de {notifications.length}</span>
                        <div className="flex gap-4">
                            <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-emerald-500"></div> Trades</span>
                            <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-red-500"></div> Risco</span>
                            <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-purple-500"></div> Mental</span>
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
}
