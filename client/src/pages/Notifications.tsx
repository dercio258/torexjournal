import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
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
    Settings,
} from 'lucide-react';
import api from '../api';
import {
    deleteNotificationOfflineAware,
    markAllNotificationsReadOfflineAware,
    markNotificationReadOfflineAware,
    resolveAlertOfflineAware,
} from '../services/offlineMutations';
import { useLocale } from '../context/LocaleContext';
import { Modal } from '../components/ui/Modal';
import { Skeleton } from '../components/ui/Skeleton';

const Badge = ({ count, active = false }: { count?: number; active?: boolean }) => {
    if (!count || count <= 0) return null;
    return (
        <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-bold tabular-nums leading-none ${
                active ? 'bg-accent/15 text-accent-fg' : 'bg-surface-3 text-fg-muted'
            }`}
        >
            {count}
        </span>
    );
};

const TraderHealthScore = ({
    score,
    details,
    onOpenReports,
}: {
    score: number;
    details: any;
    onOpenReports: () => void;
}) => {
    const { locale } = useLocale();
    const isEn = locale === 'en';

    const getScoreColor = (s: number) => {
        if (s >= 80) return 'text-accent-fg';
        if (s >= 50) return 'text-warning';
        return 'text-danger-fg';
    };

    const getScoreLabel = (s: number) => {
        if (s >= 80) return isEn ? 'Peak Discipline' : 'Excelente Disciplina';
        if (s >= 50) return isEn ? 'Attention Required' : 'Atenção Necessária';
        return isEn ? 'High Operational Risk' : 'Risco Operacional Alto';
    };

    const radius = 26;
    const circumference = 2 * Math.PI * radius;

    return (
        <div className="bg-surface border border-line rounded-xl p-4 sm:p-5 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex flex-col sm:flex-row items-center gap-4 text-center sm:text-left">
                {/* Compact Circular Progress */}
                <div className="relative w-16 h-16 flex items-center justify-center shrink-0">
                    <svg className="w-full h-full -rotate-90" viewBox="0 0 64 64">
                        <circle
                            cx="32"
                            cy="32"
                            r={radius}
                            fill="transparent"
                            stroke="currentColor"
                            strokeWidth="5"
                            className="text-surface-3"
                        />
                        <circle
                            cx="32"
                            cy="32"
                            r={radius}
                            fill="transparent"
                            stroke="currentColor"
                            strokeWidth="5"
                            strokeDasharray={circumference}
                            strokeDashoffset={circumference - (circumference * score) / 100}
                            strokeLinecap="round"
                            className={`transition-all duration-700 ease-out ${getScoreColor(score)}`}
                        />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className={`text-base font-bold font-mono tabular-nums ${getScoreColor(score)}`}>
                            {score}
                        </span>
                    </div>
                </div>

                <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                        <h3 className="text-sm sm:text-base font-bold text-fg">
                            {isEn ? 'Trader Health:' : 'Saúde do Trader:'}{' '}
                            <span className={getScoreColor(score)}>{getScoreLabel(score)}</span>
                        </h3>
                    </div>
                    <p className="text-xs text-fg-muted">
                        {isEn
                            ? 'Score derived from trailing 7-day execution discipline.'
                            : 'Score calculado pela disciplina operacional dos últimos 7 dias.'}
                    </p>
                    <div className="flex flex-wrap justify-center sm:justify-start gap-2 pt-0.5">
                        <div className="bg-canvas-subtle px-2.5 py-1 rounded-lg border border-line-subtle inline-flex items-center gap-1.5 text-[11px]">
                            <span className="w-1.5 h-1.5 rounded-full bg-danger" />
                            <span className="text-fg-muted">{isEn ? 'Critical:' : 'Críticos:'}</span>
                            <span className="text-fg font-bold tabular-nums">
                                {details?.penalties?.critical || 0}
                            </span>
                        </div>
                        <div className="bg-canvas-subtle px-2.5 py-1 rounded-lg border border-line-subtle inline-flex items-center gap-1.5 text-[11px]">
                            <span className="w-1.5 h-1.5 rounded-full bg-warning" />
                            <span className="text-fg-muted">{isEn ? 'Warnings:' : 'Avisos:'}</span>
                            <span className="text-fg font-bold tabular-nums">
                                {details?.penalties?.warning || 0}
                            </span>
                        </div>
                        <div className="bg-canvas-subtle px-2.5 py-1 rounded-lg border border-line-subtle inline-flex items-center gap-1.5 text-[11px]">
                            <span className="w-1.5 h-1.5 rounded-full bg-data-1" />
                            <span className="text-fg-muted">{isEn ? 'Window:' : 'Janela:'}</span>
                            <span className="text-fg font-bold">7d</span>
                        </div>
                    </div>
                </div>
            </div>

            <button
                type="button"
                onClick={onOpenReports}
                className="h-8 px-3.5 bg-canvas-subtle hover:bg-surface-2 text-fg text-xs font-semibold rounded-lg transition-colors border border-line shrink-0"
            >
                {isEn ? 'View Reports' : 'Ver Relatórios'}
            </button>
        </div>
    );
};

const NotificationItem = ({ item, onRead, onDelete, onResolve }: any) => {
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const isAlert = 'severity' in item;
    const isMuted = Boolean(item.read || item.resolved);

    const getIcon = (type: string, severity?: string) => {
        if (severity === 'CRITICAL') return <AlertTriangle className="text-danger-fg" size={16} />;

        switch ((type || '').toLowerCase()) {
            case 'trade_success':
                return <TrendingUp className="text-accent-fg" size={16} />;
            case 'risk':
            case 'risk_alert':
                return <AlertTriangle className="text-danger-fg" size={16} />;
            case 'psychology':
            case 'mental_insight':
                return <BrainCircuit className="text-data-2" size={16} />;
            case 'performance':
                return <TrendingUp className="text-data-1" size={16} />;
            case 'discipline':
                return <CheckCircle2 className="text-warning" size={16} />;
            case 'system':
                return <Info className="text-data-1" size={16} />;
            case 'journal':
            case 'trade_neutral':
                return <Clock className="text-fg-muted" size={16} />;
            default:
                return <Bell className="text-fg-muted" size={16} />;
        }
    };

    const getCardStyles = () => {
        if (isMuted) {
            return 'border-line-subtle bg-canvas-subtle opacity-75';
        }
        if (isAlert) {
            switch (item.severity) {
                case 'CRITICAL':
                    return 'border-danger/35 bg-danger/5';
                case 'WARNING':
                    return 'border-warning/35 bg-warning/5';
                default:
                    return 'border-line bg-surface';
            }
        }
        return 'border-line bg-canvas-subtle hover:border-line-strong';
    };

    const timestamp = item.createdAt || item.time;

    return (
        <div className={`relative p-3.5 sm:p-4 rounded-xl border transition-colors ${getCardStyles()}`}>
            <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-surface border border-line">
                    {getIcon(item.type, item.severity)}
                </div>

                <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                            {isAlert && (
                                <span
                                    className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider border ${
                                        item.severity === 'CRITICAL'
                                            ? 'bg-danger/15 text-danger-fg border-danger/30'
                                            : item.severity === 'WARNING'
                                              ? 'bg-warning/15 text-warning border-warning/30'
                                              : 'bg-data-1/15 text-data-1 border-data-1/30'
                                    }`}
                                >
                                    {item.severity}
                                </span>
                            )}
                            <h4
                                className={`text-xs sm:text-sm font-bold truncate ${
                                    isMuted ? 'text-fg-muted' : 'text-fg'
                                }`}
                            >
                                {item.title}
                            </h4>
                            {!isMuted && (
                                <span
                                    className={`w-2 h-2 rounded-full shrink-0 ${
                                        item.severity === 'CRITICAL' ? 'bg-danger' : 'bg-accent'
                                    }`}
                                />
                            )}
                        </div>

                        {timestamp && (
                            <span className="text-[11px] text-fg-subtle whitespace-nowrap inline-flex items-center gap-1 tabular-nums">
                                <Clock size={11} />
                                {new Date(timestamp).toLocaleTimeString(isEn ? 'en-US' : [], {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                })}{' '}
                                · {new Date(timestamp).toLocaleDateString(isEn ? 'en-US' : 'pt-BR')}
                            </span>
                        )}
                    </div>

                    <p
                        className={`text-xs leading-relaxed ${
                            isMuted ? 'text-fg-subtle' : 'text-fg-muted'
                        }`}
                    >
                        {isAlert ? item.description : item.message}
                    </p>

                    {isAlert && item.metadata && Object.keys(item.metadata).length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-1">
                            {Object.entries(item.metadata).map(([key, value]: [string, any]) => (
                                <div
                                    key={key}
                                    className="bg-surface px-2.5 py-1 rounded-lg border border-line-subtle"
                                >
                                    <span className="text-[9px] text-fg-subtle uppercase block font-semibold">
                                        {key.replace('_', ' ')}
                                    </span>
                                    <span className="text-xs font-mono tabular-nums text-accent-fg font-bold">
                                        {typeof value === 'number' ? value.toFixed(2) : value}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="flex items-center gap-2 pt-1">
                        {isAlert && !item.resolved ? (
                            <button
                                type="button"
                                onClick={() => onResolve(item.id)}
                                className="h-7 px-3 rounded-lg text-[11px] font-semibold text-accent-on bg-accent hover:opacity-95 transition-opacity inline-flex items-center gap-1.5"
                            >
                                <Check size={12} />
                                <span>{isEn ? 'Resolve Alert' : 'Resolver Alerta'}</span>
                            </button>
                        ) : (
                            !isAlert &&
                            !item.read && (
                                <button
                                    type="button"
                                    onClick={() => onRead(item.id)}
                                    className="h-7 px-2.5 rounded-lg text-[11px] font-semibold text-accent-fg bg-accent/10 hover:bg-accent/20 border border-accent/25 transition-colors inline-flex items-center gap-1.5"
                                >
                                    <Check size={12} />
                                    <span>{isEn ? 'Mark as read' : 'Marcar como lida'}</span>
                                </button>
                            )
                        )}
                        <button
                            type="button"
                            onClick={() => onDelete(item.id, isAlert)}
                            className="h-7 px-2.5 rounded-lg text-[11px] font-semibold text-fg-subtle hover:text-danger-fg hover:bg-danger/10 transition-colors"
                        >
                            {isAlert ? (isEn ? 'Dismiss' : 'Descartar') : (isEn ? 'Delete' : 'Excluir')}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

const TelegramSettingsModal = ({ isOpen, onClose }: any) => {
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const [step, setStep] = useState<'initial' | 'otp' | 'connected'>('initial');
    const [otp, setOtp] = useState('');
    const [botUsername, setBotUsername] = useState('');
    const [loading, setLoading] = useState(false);
    const [preferences, setPreferences] = useState({
        trade_success: true,
        risk_alert: true,
        mental_insight: true,
        system: true,
    });

    useEffect(() => {
        if (isOpen) {
            checkStatus();
        }
    }, [isOpen]);

    const checkStatus = async () => {
        try {
            const { data } = await api.get('/notifications/telegram/status');
            setStep(data.connected ? 'connected' : 'initial');
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
    };

    const handlePreferenceChange = (key: string) => {
        setPreferences((prev) => ({ ...prev, [key]: !prev[key as keyof typeof prev] }));
        api.post('/notifications/settings', {
            notificationPreferences: {
                ...preferences,
                [key]: !preferences[key as keyof typeof preferences],
            },
        });
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={isEn ? 'Notification Settings' : 'Configurações de Notificação'}>
            <div className="space-y-4">
                <div className="bg-canvas-subtle p-4 rounded-xl border border-line space-y-3">
                    <div className="flex items-center gap-2.5">
                        <div className="p-2 bg-data-1/10 border border-data-1/25 rounded-lg">
                            <MessageCircle className="text-data-1" size={16} />
                        </div>
                        <div>
                            <h4 className="text-xs sm:text-sm font-bold text-fg">Telegram Bot</h4>
                            <p className="text-[11px] text-fg-muted">
                                {isEn ? 'Receive real-time execution & risk alerts on Telegram.' : 'Receba alertas em tempo real no seu Telegram.'}
                            </p>
                        </div>
                    </div>

                    {step === 'initial' && (
                        <button
                            type="button"
                            onClick={handleConnect}
                            disabled={loading}
                            className="w-full h-9 bg-accent hover:opacity-95 text-accent-on text-xs font-semibold rounded-lg transition-opacity flex items-center justify-center"
                        >
                            {loading ? (isEn ? 'Loading...' : 'Carregando...') : (isEn ? 'Connect Telegram' : 'Conectar Telegram')}
                        </button>
                    )}

                    {step === 'otp' && (
                        <div className="space-y-3">
                            <div className="text-center space-y-1.5">
                                <p className="text-xs text-fg-muted">{isEn ? 'Send this code to the bot:' : 'Envie este código para o bot:'}</p>
                                <div className="flex items-center justify-center gap-2">
                                    <code className="text-xl font-mono font-bold text-accent-fg bg-surface px-4 py-1.5 rounded-lg border border-line tracking-widest">
                                        {otp}
                                    </code>
                                    <button
                                        type="button"
                                        onClick={handleCopyOtp}
                                        className="p-2 hover:bg-surface-2 rounded-lg text-fg-muted hover:text-fg border border-line-subtle transition-colors"
                                    >
                                        <Copy size={15} />
                                    </button>
                                </div>
                            </div>

                            <div className="text-center">
                                <a
                                    href={`https://t.me/${botUsername}?start=${otp}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-block text-accent-fg hover:underline text-xs font-medium"
                                >
                                    {isEn ? 'Open' : 'Abrir'} @{botUsername || 'Bot'}
                                </a>
                            </div>

                            <button
                                type="button"
                                onClick={checkStatus}
                                className="w-full h-9 bg-surface-2 hover:bg-surface-3 border border-line text-fg font-semibold rounded-lg transition-colors text-xs"
                            >
                                {isEn ? "I've sent the code" : 'Já enviei o código'}
                            </button>
                        </div>
                    )}

                    {step === 'connected' && (
                        <div className="flex items-center justify-between bg-accent/10 border border-accent/25 p-3 rounded-lg">
                            <span className="text-accent-fg text-xs font-bold flex items-center gap-1.5">
                                <CheckCircle2 size={14} /> {isEn ? 'Connected' : 'Conectado'}
                            </span>
                            <button
                                type="button"
                                onClick={handleDisconnect}
                                disabled={loading}
                                className="text-xs text-danger-fg hover:underline font-medium"
                            >
                                {isEn ? 'Disconnect' : 'Desconectar'}
                            </button>
                        </div>
                    )}
                </div>

                <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-fg-subtle mb-2">
                        {isEn ? 'Preferences' : 'Preferências'}
                    </h4>
                    <div className="space-y-1.5">
                        {[
                            { id: 'trade_success', label: isEn ? 'Trades & Profit' : 'Trades e Profit' },
                            { id: 'risk_alert', label: isEn ? 'Risk Alerts' : 'Alertas de Risco' },
                            { id: 'mental_insight', label: isEn ? 'Psychology Insights' : 'Insights Mentais' },
                            { id: 'system', label: isEn ? 'System' : 'Sistema' },
                        ].map((pref) => (
                            <label
                                key={pref.id}
                                className="flex items-center justify-between px-3 py-2.5 bg-canvas-subtle border border-line-subtle rounded-lg cursor-pointer hover:bg-surface-2 transition-colors"
                            >
                                <span className="text-xs sm:text-sm text-fg">{pref.label}</span>
                                <input
                                    type="checkbox"
                                    checked={preferences[pref.id as keyof typeof preferences]}
                                    onChange={() => handlePreferenceChange(pref.id)}
                                    className="w-4 h-4 rounded border-line bg-surface text-accent focus:ring-accent/40"
                                />
                            </label>
                        ))}
                    </div>
                </div>
            </div>
        </Modal>
    );
};

export const Notifications = () => {
    const navigate = useNavigate();
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const [notifications, setNotifications] = useState<any[]>([]);
    const [alerts, setAlerts] = useState<any[]>([]);
    const [scoreData, setScoreData] = useState<{ score: number; details: any }>({
        score: 100,
        details: {},
    });
    const [filter, setFilter] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        setLoading(true);
        try {
            const [notifRes, alertRes, scoreRes] = await Promise.all([
                api.get('/notifications'),
                api.get('/alerts'),
                api.get('/alerts/score'),
            ]);

            setNotifications(
                notifRes.data.map((n: any) => ({
                    id: n.id,
                    type: n.type?.toLowerCase() || 'system',
                    title: n.title,
                    message: n.message,
                    read: n.isRead,
                    createdAt: n.createdAt,
                }))
            );

            setAlerts(alertRes.data);
            setScoreData(scoreRes.data);
        } catch (error) {
            console.error('Failed to fetch data', error);
        } finally {
            setLoading(false);
        }
    };

    const unreadCount = notifications.filter((n) => !n.read).length;
    const pendingAlertsCount = alerts.filter((a) => !a.resolved).length;

    const markAllAsRead = async () => {
        const hasUnread = notifications.some((n) => !n.read);
        if (!hasUnread) return;
        setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));

        try {
            await markAllNotificationsReadOfflineAware();
        } catch (error) {
            console.error('Failed to mark all notifications as read', error);
        }
    };

    const markAsRead = async (id: number | string) => {
        setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
        try {
            await markNotificationReadOfflineAware(id);
        } catch (error) {
            console.error('Failed to mark as read', id);
        }
    };

    const resolveAlert = async (id: string) => {
        setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, resolved: true } : a)));
        try {
            await resolveAlertOfflineAware(id);
        } catch (error) {
            console.error('Failed to resolve alert', id);
        }
    };

    const deleteItem = async (id: number | string, isAlert: boolean) => {
        if (isAlert) {
            setAlerts((prev) => prev.filter((a) => a.id !== id));
            await resolveAlert(id as string);
        } else {
            setNotifications((prev) => prev.filter((n) => n.id !== id));
            try {
                await deleteNotificationOfflineAware(id);
            } catch (error) {
                console.error('Failed to delete notification', id);
            }
        }
    };

    const combinedItems = [
        ...notifications.map((n) => ({ ...n, isAlert: false })),
        ...alerts.map((a) => ({ ...a, isAlert: true })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const filteredItems = combinedItems.filter((item) => {
        if (filter === 'unread' && (item.read || item.resolved)) return false;
        if (filter === 'alerts' && (!item.isAlert || item.resolved)) return false;
        if (searchQuery.trim()) {
            const q = searchQuery.trim().toLowerCase();
            const text = `${item.title || ''} ${item.message || ''} ${item.description || ''}`.toLowerCase();
            if (!text.includes(q)) return false;
        }
        return true;
    });

    return (
        <div className="w-full space-y-3 pb-10">
            <TelegramSettingsModal
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
            />

            {/* Health Score Widget */}
            {scoreData && (
                <TraderHealthScore
                    score={scoreData.score}
                    details={scoreData.details}
                    onOpenReports={() => navigate('/reports')}
                />
            )}

            {/* Main Container */}
            <div className="bg-surface border border-line rounded-xl overflow-hidden flex flex-col">
                {/* Filter & Actions Toolbar */}
                <div className="border-b border-line p-3 sm:px-4 flex flex-col lg:flex-row gap-2.5 justify-between lg:items-center">
                    <div className="flex items-center gap-1 bg-canvas-subtle border border-line-subtle p-1 rounded-lg overflow-x-auto no-scrollbar">
                        {[
                            { id: 'all', label: isEn ? 'All' : 'Todas' },
                            {
                                id: 'unread',
                                label: isEn ? 'Unread' : 'Não lidas',
                                count: unreadCount + pendingAlertsCount,
                            },
                            {
                                id: 'alerts',
                                label: isEn ? 'Risk Alerts' : 'Alertas de Risco',
                                count: pendingAlertsCount,
                            },
                        ].map((tab) => {
                            const active = filter === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    type="button"
                                    onClick={() => setFilter(tab.id)}
                                    className={`px-2.5 h-7 rounded-md text-xs font-semibold transition-colors whitespace-nowrap inline-flex items-center gap-1.5 border ${
                                        active
                                            ? 'bg-surface-2 border-line text-fg'
                                            : 'border-transparent text-fg-muted hover:text-fg'
                                    }`}
                                >
                                    <span>{tab.label}</span>
                                    <Badge count={tab.count} active={active} />
                                </button>
                            );
                        })}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <div className="relative flex-1 sm:w-56">
                            <Search
                                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle"
                                size={14}
                            />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder={isEn ? 'Search alerts...' : 'Buscar alertas...'}
                                className="w-full h-8 bg-canvas-subtle border border-line rounded-lg pl-8 pr-3 text-xs text-fg placeholder:text-fg-subtle focus:border-accent/50 outline-none"
                            />
                        </div>

                        <button
                            type="button"
                            onClick={markAllAsRead}
                            disabled={unreadCount === 0}
                            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-canvas-subtle hover:bg-surface-2 border border-line text-xs font-semibold text-fg disabled:opacity-45 disabled:cursor-not-allowed transition-colors"
                        >
                            <CheckCircle2 size={13} className="text-accent-fg" />
                            <span>{isEn ? 'Mark all read' : 'Marcar lidas'}</span>
                        </button>

                        <button
                            type="button"
                            onClick={() => setIsSettingsOpen(true)}
                            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-canvas-subtle hover:bg-surface-2 border border-line text-xs font-semibold text-fg transition-colors"
                        >
                            <Settings size={13} className="text-fg-muted" />
                            <span>Telegram</span>
                        </button>
                    </div>
                </div>

                {/* Notification List */}
                <div className="p-3 sm:p-4 space-y-2.5 min-h-[360px]">
                    {loading ? (
                        Array.from({ length: 5 }).map((_, idx) => (
                            <div
                                key={idx}
                                className="flex items-start justify-between gap-3 p-3.5 rounded-xl border border-line-subtle bg-canvas-subtle/50"
                            >
                                <div className="flex items-start gap-3 flex-1">
                                    <Skeleton className="w-8 h-8 rounded-lg shrink-0" />
                                    <div className="space-y-2 flex-1">
                                        <Skeleton className="h-3.5 w-44" />
                                        <Skeleton className="h-3 w-full max-w-md" />
                                        <Skeleton className="h-2.5 w-24" />
                                    </div>
                                </div>
                                <Skeleton className="h-6 w-16 rounded-md shrink-0" />
                            </div>
                        ))
                    ) : filteredItems.length > 0 ? (
                        filteredItems.map((item) => (
                            <NotificationItem
                                key={item.id}
                                item={item}
                                onRead={markAsRead}
                                onDelete={deleteItem}
                                onResolve={resolveAlert}
                            />
                        ))
                    ) : (
                        <div className="flex flex-col items-center justify-center text-center py-14">
                            <div className="w-12 h-12 bg-canvas-subtle border border-line-subtle rounded-xl flex items-center justify-center mb-3">
                                <Bell className="text-fg-subtle" size={20} />
                            </div>
                            <h3 className="text-sm font-bold text-fg mb-1">{isEn ? 'All caught up' : 'Tudo limpo por aqui'}</h3>
                            <p className="text-xs text-fg-muted max-w-xs">
                                {isEn
                                    ? 'No pending alerts or notifications in this view.'
                                    : 'Nenhum alerta pendente ou notificação encontrada nesta visualização.'}
                            </p>
                            {filter !== 'all' && (
                                <button
                                    type="button"
                                    onClick={() => setFilter('all')}
                                    className="mt-3 text-accent-fg hover:underline text-xs font-semibold inline-flex items-center gap-1"
                                >
                                    <span>{isEn ? 'View all notifications' : 'Ver todos os registros'}</span>
                                    <ArrowRight size={13} />
                                </button>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="bg-canvas-subtle border-t border-line-subtle px-4 py-2.5 flex flex-wrap justify-between items-center gap-2 text-[10px] text-fg-subtle uppercase tracking-wider font-semibold">
                    <span>{isEn ? 'Synced • Torex Engine' : 'Sincronizado • Torex Engine'}</span>
                    <div className="flex items-center gap-4">
                        <span className="inline-flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-accent" /> Trades
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-danger" /> {isEn ? 'Risk' : 'Risco'}
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-data-2" /> {isEn ? 'Behavior' : 'Comportamento'}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
};
