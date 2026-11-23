import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    Activity,
    ArrowRight,
    BarChart3,
    Bug,
    CalendarClock,
    Compass,
    Cpu,
    CreditCard,
    Database,
    DollarSign,
    ExternalLink,
    Eye,
    Flame,
    LifeBuoy,
    Mail,
    Radio,
    RefreshCw,
    RotateCcw,
    Server,
    Sparkles,
    TrendingUp,
    UploadCloud,
    Users,
    Video,
} from 'lucide-react';
import api from '../../api';
import { Button } from '../../components/ui/Button';
import { cn } from '../../lib/cn';
import {
    AdminBadge,
    AdminBanner,
    AdminLoadingState,
    AdminPageHeader,
    AdminSectionCard,
    AdminStatCard,
} from './components/AdminPrimitives';

interface SupportQueueItem {
    id: string;
    name: string;
    email: string;
    whatsapp?: string | null;
    originLabel: string;
    originKey: string;
    planStatus: string;
    planTier?: string | null;
    expiresAt?: string | null;
    expiredDaysAgo?: number | null;
    daysLeft?: number | null;
    lastLoginAt?: string | null;
    lastActionLabel?: string | null;
    lastActionAt?: string | null;
    engagementScore: number;
    reason: string;
    priority: 'high' | 'medium';
}

interface OriginPerformanceItem {
    channelKey: string;
    channelLabel: string;
    networkGroup: string;
    isSocial: boolean;
    users: number;
    verified: number;
    imported: number;
    converted: number;
    activePlans: number;
    expiredPlans: number;
    conversionRatePct: number;
    activationRatePct: number;
    revenue: number;
}

interface RecommendationItem {
    id: string;
    severity: 'high' | 'medium' | 'opportunity';
    category: string;
    title: string;
    description: string;
    metric: string;
    actionLabel: string;
    actionPath: string;
}

interface SystemOverview {
    timestamp: string;
    finance?: {
        totalUsers?: number;
        activeSubscribers?: number;
        estimatedMonthlyRevenueMZN?: number;
        estimatedMonthlyRevenueZAR?: number;
        statuses?: { active: number; pending: number; cancelled: number };
    } | null;
    plans?: {
        total: number;
        active: number;
        trialCampaign?: { enabled?: boolean; days?: number } | null;
    };
    academy?: {
        totalLessons: number;
        publishedLessons: number;
    };
    mt5?: {
        workers: Array<{
            workerId?: string;
            hostname?: string;
            isOnline?: boolean;
            monitoredAccountsCount?: number;
            lastHeartbeat?: string;
        }>;
        onlineWorkers: number;
        demoFeed?: {
            configured?: boolean;
            login?: string;
            server?: string;
            connected?: boolean;
            connectionState?: string;
            workerOnline?: boolean;
            lastSyncAt?: string | null;
        } | null;
        calendarSync?: {
            lastSyncAt: string | null;
            source: string | null;
            analyzed: number;
            created: number;
            updated: number;
            totalStored: number;
            upcomingCount?: number;
            lastError: string | null;
        } | null;
    };
    telemetry?: {
        uptimeSeconds?: number;
        process?: { rssMb?: number; heapUsedMb?: number };
        http?: {
            totalRequests?: number;
            byStatusClass?: Record<string, number>;
            latency?: { p50Ms?: number; p95Ms?: number; p99Ms?: number };
        };
        email?: { enqueued?: number; sent?: number; failed?: number };
        mt5?: { workerHeartbeats?: number; wsActiveClients?: number };
        recentErrors?: Array<{ message?: string; route?: string; status?: number; timestamp?: string }>;
    };
    queues?: Record<
        string,
        {
            name: string;
            error?: string;
            counts?: {
                active?: number;
                waiting?: number;
                completed?: number;
                failed?: number;
                delayed?: number;
            };
        }
    >;
    intelligence?: {
        summary: {
            totalUsers: number;
            verifiedUsers: number;
            newUsers24h: number;
            newUsers7d: number;
            activeSubscribers: number;
            expiredSubscribers: number;
            pendingCheckouts: number;
            churnRatePct: number;
            overallConversionRatePct: number;
            activationRatePct: number;
            importedUsersCount: number;
            totalTradesCount: number;
            totalRevenueAllTime: number;
        };
        originPerformance: OriginPerformanceItem[];
        supportQueues: {
            checkoutAbandoned: SupportQueueItem[];
            recentlyExpired: SupportQueueItem[];
            stalledOnboarding: SupportQueueItem[];
            importErrors: SupportQueueItem[];
            expiringSoon: SupportQueueItem[];
        };
        recommendations: RecommendationItem[];
    } | null;
}

const QUEUE_LABELS: Record<string, string> = {
    'email-queue': 'Envio de Emails (SMTP)',
    'subscription-queue': 'Assinaturas & Cobrança',
    'behavioral-analysis': 'Análise Comportamental IA',
    'trade-import': 'Importação de Trades',
};

type QueueTabKey =
    | 'checkoutAbandoned'
    | 'recentlyExpired'
    | 'expiringSoon'
    | 'stalledOnboarding'
    | 'importErrors';

function formatUptime(sec?: number): string {
    if (!sec || sec < 0) return '0m';
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

function formatDateTime(iso?: string | null): string {
    if (!iso) return 'Nunca registrado';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return 'Nunca registrado';
    return d.toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' });
}

function formatRelativeShort(iso?: string | null): string {
    if (!iso) return 'Sem registo';
    const ts = new Date(iso).getTime();
    if (isNaN(ts)) return 'Sem registo';
    const mins = Math.floor((Date.now() - ts) / 60000);
    if (mins < 1) return 'Agora';
    if (mins < 60) return `Há ${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `Há ${hrs}h`;
    const days = Math.floor(hrs / 24);
    return `Há ${days}d`;
}

export const AdminDashboard = () => {
    const [overview, setOverview] = useState<SystemOverview | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [syncingCalendar, setSyncingCalendar] = useState(false);
    const [retryingQueue, setRetryingQueue] = useState<string | null>(null);
    const [activeQueueTab, setActiveQueueTab] = useState<QueueTabKey>('checkoutAbandoned');
    const [banner, setBanner] = useState<{ tone: 'success' | 'warning' | 'danger' | 'info'; message: string } | null>(
        null,
    );
    const delayedRefreshRef = useRef<number | null>(null);

    const fetchOverview = useCallback(async (silent = false) => {
        if (!silent) setRefreshing(true);
        try {
            const res = await api.get('/admin/system-overview');
            setOverview(res.data);
        } catch (err: any) {
            if (!silent) {
                setBanner({
                    tone: 'danger',
                    message: err.response?.data?.message || 'Erro ao carregar visão estrutural do sistema.',
                });
            }
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        fetchOverview();
        const interval = window.setInterval(() => fetchOverview(true), 30000);
        return () => {
            window.clearInterval(interval);
            if (delayedRefreshRef.current) window.clearTimeout(delayedRefreshRef.current);
        };
    }, [fetchOverview]);

    const handleTriggerCalendarSync = async () => {
        setSyncingCalendar(true);
        setBanner(null);
        try {
            const res = await api.post('/admin/mt5-calendar/sync');
            const data = res.data;
            if (data?.skipped) {
                setBanner({
                    tone: 'warning',
                    message: data.message || 'Nenhuma conta MT5/Demo Feed configurada no momento.',
                });
            } else {
                setBanner({
                    tone: 'success',
                    message: data?.message || 'Sincronização do Calendário MT5 enfileirada com sucesso.',
                });
                if (delayedRefreshRef.current) window.clearTimeout(delayedRefreshRef.current);
                delayedRefreshRef.current = window.setTimeout(() => fetchOverview(true), 4500);
            }
            if (data?.calendarSync) {
                setOverview((prev) =>
                    prev
                        ? {
                              ...prev,
                              mt5: {
                                  workers: prev.mt5?.workers || [],
                                  onlineWorkers: prev.mt5?.onlineWorkers || 0,
                                  demoFeed: prev.mt5?.demoFeed,
                                  calendarSync: data.calendarSync,
                              },
                          }
                        : prev,
                );
            }
        } catch (err: any) {
            setBanner({
                tone: 'danger',
                message: err.response?.data?.message || 'Falha ao disparar sincronização do calendário MT5.',
            });
        } finally {
            setSyncingCalendar(false);
        }
    };

    const handleRetryQueue = async (queueName: string) => {
        setRetryingQueue(queueName);
        try {
            const res = await api.post(`/admin/queues/${queueName}/retry-failed`);
            setBanner({
                tone: 'success',
                message: `Fila ${queueName}: ${res.data?.retried ?? 0} jobs reprocessados.`,
            });
            await fetchOverview(true);
        } catch (err: any) {
            setBanner({
                tone: 'danger',
                message: err.response?.data?.message || `Falha ao reprocessar fila ${queueName}.`,
            });
        } finally {
            setRetryingQueue(null);
        }
    };

    if (loading) {
        return <AdminLoadingState label="Consolidando inteligência executiva, filas de suporte e telemetria..." />;
    }

    const intelSummary = overview?.intelligence?.summary;
    const totalUsers = intelSummary?.totalUsers ?? overview?.finance?.totalUsers ?? 0;
    const activeSubs = intelSummary?.activeSubscribers ?? overview?.finance?.activeSubscribers ?? 0;
    const expiredSubs = intelSummary?.expiredSubscribers ?? 0;
    const overallConversion =
        intelSummary?.overallConversionRatePct ??
        Number(totalUsers > 0 ? ((activeSubs / totalUsers) * 100).toFixed(1) : '0');
    const revMzn = Number(overview?.finance?.estimatedMonthlyRevenueMZN || 0);
    const trialEnabled = Boolean(overview?.plans?.trialCampaign?.enabled);
    const p95Ms = Number(overview?.telemetry?.http?.latency?.p95Ms || 0);
    const recentErrCount = overview?.telemetry?.recentErrors?.length ?? 0;

    const calSync = overview?.mt5?.calendarSync;
    const demoFeed = overview?.mt5?.demoFeed;
    const onlineWorkers = overview?.mt5?.onlineWorkers ?? 0;
    const totalWorkers = overview?.mt5?.workers?.length ?? 0;
    const queues = Object.values(overview?.queues || {});
    const recommendations = overview?.intelligence?.recommendations || [];
    const originPerformance = overview?.intelligence?.originPerformance || [];
    const supportQueues = overview?.intelligence?.supportQueues || {
        checkoutAbandoned: [],
        recentlyExpired: [],
        stalledOnboarding: [],
        importErrors: [],
        expiringSoon: [],
    };

    const queueTabs: Array<{ key: QueueTabKey; label: string; items: SupportQueueItem[]; tone: string }> = [
        {
            key: 'checkoutAbandoned',
            label: 'Checkouts & Leads Quentes',
            items: supportQueues.checkoutAbandoned,
            tone: 'text-amber-500',
        },
        {
            key: 'recentlyExpired',
            label: 'Planos Já Expirados',
            items: supportQueues.recentlyExpired,
            tone: 'text-danger-fg',
        },
        {
            key: 'expiringSoon',
            label: 'Vence em 7d',
            items: supportQueues.expiringSoon,
            tone: 'text-amber-500',
        },
        {
            key: 'stalledOnboarding',
            label: 'Sem Importação (+24h)',
            items: supportQueues.stalledOnboarding,
            tone: 'text-sky-500',
        },
        {
            key: 'importErrors',
            label: 'Erros de Importação',
            items: supportQueues.importErrors,
            tone: 'text-danger-fg',
        },
    ];

    const currentQueueItems = supportQueues[activeQueueTab] || [];

    const domainCards = [
        {
            domain: 'Governança & Inteligência',
            description: 'Telemetria estrutural, eventos first-party e atribuição por funil.',
            links: [
                {
                    to: '/admin/errors',
                    title: 'Erros Técnicos & Referências',
                    meta: `${recentErrCount} incidente(s) recentes · busca por TRX-*`,
                    icon: Bug,
                },
                {
                    to: '/admin/analytics',
                    title: 'Analytics & UTMs',
                    meta: `${totalUsers} usuários rastreados`,
                    icon: BarChart3,
                },
            ],
        },
        {
            domain: 'Clientes & Receita',
            description: 'Gestão de contas 360°, planos ativos/expirados e faturamento.',
            links: [
                {
                    to: '/admin/users',
                    title: 'Usuários & Raio-X 360°',
                    meta: `${activeSubs} ativos · ${expiredSubs} já expirados`,
                    icon: Users,
                },
                {
                    to: '/admin/plans',
                    title: 'Planos & Trial',
                    meta: `${overview?.plans?.active ?? 0}/${overview?.plans?.total ?? 0} ativos · Trial ${trialEnabled ? 'ON' : 'OFF'}`,
                    icon: CreditCard,
                },
                {
                    to: '/admin/finance',
                    title: 'Financeiro & MRR',
                    meta: `${revMzn.toLocaleString('pt-MZ')} MT/mês`,
                    icon: DollarSign,
                },
            ],
        },
        {
            domain: 'Conteúdo & Academia',
            description: 'Curadoria de videoaulas e capacitação dos traders.',
            links: [
                {
                    to: '/admin/lessons',
                    title: 'Academia & Aulas',
                    meta: `${overview?.academy?.publishedLessons ?? 0}/${overview?.academy?.totalLessons ?? 0} aulas publicadas`,
                    icon: Video,
                },
            ],
        },
    ];

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            <AdminPageHeader
                badge="Painel Executivo"
                title="Visão Geral, Suporte Proativo & Crescimento"
                subtitle="Métricas acionáveis de conversão por canal, fila de atendimento em tempo real, recomendações inteligentes e monitoramento MT5."
                icon={<Activity className="h-5 w-5" />}
                actions={
                    <>
                        {overview?.timestamp && (
                            <span className="text-xs text-fg-subtle hidden sm:inline">
                                Atualizado às {new Date(overview.timestamp).toLocaleTimeString('pt-PT')}
                            </span>
                        )}
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => fetchOverview()}
                            isLoading={refreshing}
                            icon={<RefreshCw className="h-3.5 w-3.5" />}
                        >
                            Atualizar
                        </Button>
                    </>
                }
            />

            {banner && (
                <AdminBanner
                    tone={banner.tone}
                    message={banner.message}
                    onDismiss={() => setBanner(null)}
                />
            )}

            {/* 1. Executive KPI Grid */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <AdminStatCard
                    label="Base de Usuários"
                    value={totalUsers.toLocaleString('pt-PT')}
                    hint={`+${intelSummary?.newUsers7d ?? 0} nos últimos 7d · ${intelSummary?.verifiedUsers ?? 0} verificados`}
                    icon={<Users className="h-4 w-4" />}
                    tone="info"
                />
                <AdminStatCard
                    label="Planos Ativos vs Já Expirados"
                    value={
                        <span>
                            {activeSubs.toLocaleString('pt-PT')}{' '}
                            <span className="text-sm font-medium text-danger-fg">
                                / {expiredSubs} exp.
                            </span>
                        </span>
                    }
                    hint={`Churn histórico ${intelSummary?.churnRatePct ?? 0}% · ${intelSummary?.pendingCheckouts ?? 0} pendentes`}
                    icon={<CreditCard className="h-4 w-4" />}
                    tone={expiredSubs > 0 ? 'warning' : 'accent'}
                />
                <AdminStatCard
                    label="Taxa de Conversão Global"
                    value={`${overallConversion}%`}
                    hint={`${intelSummary?.pendingCheckouts ?? 0} checkout(s) aguardando pagamento`}
                    icon={<TrendingUp className="h-4 w-4" />}
                    tone="accent"
                />
                <AdminStatCard
                    label="MRR Estimado & Receita Total"
                    value={`${revMzn.toLocaleString('pt-MZ')} MT`}
                    hint={`Histórico: ${(intelSummary?.totalRevenueAllTime ?? 0).toLocaleString('pt-MZ')} MT`}
                    icon={<DollarSign className="h-4 w-4" />}
                    tone="accent"
                />
                <AdminStatCard
                    label="Ativação & Importação de Trades"
                    value={`${intelSummary?.activationRatePct ?? 0}%`}
                    hint={`${intelSummary?.importedUsersCount ?? 0} usuários · ${(intelSummary?.totalTradesCount ?? 0).toLocaleString('pt-PT')} trades`}
                    icon={<UploadCloud className="h-4 w-4" />}
                    tone="warning"
                />
                <AdminStatCard
                    label="Saúde da API & Workers"
                    value={`${p95Ms.toFixed(0)} ms`}
                    hint={`Uptime ${formatUptime(overview?.telemetry?.uptimeSeconds)} · ${onlineWorkers}/${totalWorkers} MT5 online · ${recentErrCount} erros`}
                    icon={<Server className="h-4 w-4" />}
                    tone={recentErrCount > 0 ? 'warning' : 'accent'}
                />
            </div>

            {/* 2. Strategic Recommendations & Insights */}
            <AdminSectionCard
                title="Sugestões & Recomendações Acionáveis"
                subtitle="Diagnóstico automático com base em conversões, planos expirados, falhas de importação e desempenho por origem."
                icon={<Sparkles className="h-5 w-5" />}
            >
                {recommendations.length === 0 ? (
                    <p className="text-xs text-fg-muted">
                        Nenhum alerta crítico ou gargalo identificado neste ciclo. Operação estável.
                    </p>
                ) : (
                    <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
                        {recommendations.map((rec) => {
                            const borderCls =
                                rec.severity === 'high'
                                    ? 'border-rose-500/30 bg-rose-500/5'
                                    : rec.severity === 'opportunity'
                                      ? 'border-emerald-500/30 bg-emerald-500/5'
                                      : 'border-amber-500/30 bg-amber-500/5';
                            const badgeTone =
                                rec.severity === 'high'
                                    ? 'danger'
                                    : rec.severity === 'opportunity'
                                      ? 'success'
                                      : 'warning';
                            return (
                                <div
                                    key={rec.id}
                                    className={cn(
                                        'rounded-xl border p-4 flex flex-col justify-between gap-3',
                                        borderCls,
                                    )}
                                >
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between gap-2">
                                            <AdminBadge tone={badgeTone}>{rec.category}</AdminBadge>
                                            <span className="text-[11px] font-bold text-fg tabular-nums">
                                                {rec.metric}
                                            </span>
                                        </div>
                                        <h3 className="text-sm font-bold text-fg leading-snug">{rec.title}</h3>
                                        <p className="text-xs text-fg-muted leading-relaxed">{rec.description}</p>
                                    </div>
                                    <div className="pt-1">
                                        <Link
                                            to={rec.actionPath}
                                            className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent-fg hover:underline"
                                        >
                                            {rec.actionLabel}
                                            <ArrowRight className="h-3.5 w-3.5" />
                                        </Link>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </AdminSectionCard>

            {/* 3. Proactive Customer Support & Retention Workbench */}
            <AdminSectionCard
                title="Central de Suporte Proativo & Retenção"
                subtitle="Filas priorizadas de usuários que precisam de acompanhamento comercial ou suporte técnico agora."
                icon={<LifeBuoy className="h-5 w-5" />}
                noPadding
            >
                <div className="border-b border-line px-5 py-3 flex flex-wrap gap-2 bg-surface-2/30">
                    {queueTabs.map((tab) => {
                        const active = activeQueueTab === tab.key;
                        return (
                            <button
                                key={tab.key}
                                type="button"
                                onClick={() => setActiveQueueTab(tab.key)}
                                className={cn(
                                    'inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all',
                                    active
                                        ? 'border-accent bg-accent/15 text-accent-fg'
                                        : 'border-line bg-surface text-fg-muted hover:text-fg hover:border-line-strong',
                                )}
                            >
                                <span>{tab.label}</span>
                                <span
                                    className={cn(
                                        'rounded-full bg-surface-2 px-1.5 py-0.2 text-[11px] font-bold tabular-nums',
                                        tab.items.length > 0 ? tab.tone : 'text-fg-subtle',
                                    )}
                                >
                                    {tab.items.length}
                                </span>
                            </button>
                        );
                    })}
                </div>

                {currentQueueItems.length === 0 ? (
                    <div className="p-8 text-center text-xs text-fg-muted">
                        Nenhum usuário nesta fila no momento. Excelente sinal!
                    </div>
                ) : (
                    <div className="divide-y divide-line">
                        {currentQueueItems.map((item) => {
                            return (
                                <div
                                    key={item.id}
                                    className="px-5 py-3.5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between hover:bg-surface-2/40 transition-colors"
                                >
                                    <div className="space-y-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            {item.priority === 'high' ? (
                                                <AdminBadge tone="danger" dot>
                                                    <Flame className="h-3 w-3" /> Alta Prioridade
                                                </AdminBadge>
                                            ) : (
                                                <AdminBadge tone="warning">Atenção</AdminBadge>
                                            )}
                                            <span className="font-semibold text-sm text-fg truncate">
                                                {item.name}
                                            </span>
                                            <span className="text-xs text-fg-muted truncate">{item.email}</span>
                                            <AdminBadge tone="neutral">{item.originLabel}</AdminBadge>
                                        </div>
                                        <div className="text-xs font-medium text-fg">{item.reason}</div>
                                        <div className="text-[11px] text-fg-subtle flex flex-wrap items-center gap-3">
                                            <span>
                                                Última ação: {item.lastActionLabel || 'Sem evento'} (
                                                {formatRelativeShort(item.lastActionAt)})
                                            </span>
                                            <span>Score: {item.engagementScore}%</span>
                                        </div>
                                    </div>

                                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                                        <a
                                            href={`mailto:${item.email}?subject=${encodeURIComponent('Torex Journal · Acompanhamento da sua conta')}`}
                                            className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-fg hover:bg-surface-2"
                                        >
                                            <Mail className="h-3.5 w-3.5" />
                                            E-mail
                                        </a>
                                        <Link
                                            to={`/admin/users?inspect=${item.id}`}
                                            className="inline-flex items-center gap-1.5 rounded-xl border border-accent/30 bg-accent/15 px-3 py-1.5 text-xs font-semibold text-accent-fg hover:bg-accent/25"
                                        >
                                            <Eye className="h-3.5 w-3.5" />
                                            Raio-X 360°
                                        </Link>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </AdminSectionCard>

            {/* 4. Origin Conversion Comparison Matrix */}
            <AdminSectionCard
                title="Conversão & Retenção por Origem / Rede Social"
                subtitle="Comparativo real de cadastros, ativação de trades, planos ativos/expirados e taxa de conversão por origem."
                icon={<Compass className="h-5 w-5" />}
                actions={
                    <Link
                        to="/admin/users"
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent-fg hover:underline"
                    >
                        Abrir Usuários & Atribuição <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                }
                noPadding
            >
                {originPerformance.length === 0 ? (
                    <div className="p-6 text-xs text-fg-muted">Nenhuma origem registada ainda.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                            <thead>
                                <tr className="border-b border-line bg-surface-2/50 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                                    <th className="px-4 py-3">Origem / Rede Social</th>
                                    <th className="px-4 py-3 text-right">Cadastros</th>
                                    <th className="px-4 py-3 text-right">Importaram</th>
                                    <th className="px-4 py-3 text-right">Ativação</th>
                                    <th className="px-4 py-3 text-right">Convertidos</th>
                                    <th className="px-4 py-3 text-right">Taxa Conv.</th>
                                    <th className="px-4 py-3 text-right">Ativos / Exp.</th>
                                    <th className="px-4 py-3 text-right">Receita (MZN)</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-line">
                                {originPerformance.slice(0, 12).map((row) => (
                                    <tr key={row.channelKey} className="hover:bg-surface-2/40 transition-colors">
                                        <td className="px-4 py-3 font-semibold text-fg">
                                            <Link
                                                to={`/admin/users?source=${encodeURIComponent(row.channelKey)}`}
                                                className="inline-flex items-center gap-2 hover:text-accent-fg"
                                            >
                                                <span>{row.channelLabel}</span>
                                                <span className="text-[10px] uppercase text-fg-subtle">
                                                    {row.networkGroup}
                                                </span>
                                            </Link>
                                        </td>
                                        <td className="px-4 py-3 text-right tabular-nums font-medium text-fg">
                                            {row.users}
                                        </td>
                                        <td className="px-4 py-3 text-right tabular-nums text-fg-muted">
                                            {row.imported}
                                        </td>
                                        <td className="px-4 py-3 text-right tabular-nums text-fg-muted">
                                            {row.activationRatePct}%
                                        </td>
                                        <td className="px-4 py-3 text-right tabular-nums font-medium text-fg">
                                            {row.converted}
                                        </td>
                                        <td className="px-4 py-3 text-right tabular-nums">
                                            <AdminBadge
                                                tone={
                                                    row.conversionRatePct >= 10
                                                        ? 'success'
                                                        : row.conversionRatePct > 0
                                                          ? 'info'
                                                          : 'neutral'
                                                }
                                            >
                                                {row.conversionRatePct}%
                                            </AdminBadge>
                                        </td>
                                        <td className="px-4 py-3 text-right tabular-nums text-fg-muted">
                                            <span className="text-accent-fg font-semibold">{row.activePlans}</span>
                                            {' / '}
                                            <span className={row.expiredPlans > 0 ? 'text-danger-fg' : ''}>
                                                {row.expiredPlans}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-right tabular-nums font-semibold text-fg">
                                            {row.revenue.toLocaleString('pt-MZ')} MT
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </AdminSectionCard>

            {/* 5. Automação MT5 & Calendário Econômico */}
            <AdminSectionCard
                title="Automação MT5 & Calendário Econômico"
                subtitle="O calendário público é alimentado automaticamente via EA headless TorexCalendarSync no MetaTrader 5."
                icon={<CalendarClock className="h-5 w-5" />}
                actions={
                    <div className="flex flex-wrap items-center gap-2">
                        <Link
                            to="/economic-calendar"
                            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-xs font-medium text-fg hover:border-line-strong transition-colors"
                        >
                            Ver Calendário Público
                            <ExternalLink className="h-3.5 w-3.5" />
                        </Link>
                        <Button
                            variant="brand"
                            size="sm"
                            onClick={handleTriggerCalendarSync}
                            isLoading={syncingCalendar}
                            icon={<RefreshCw className="h-3.5 w-3.5" />}
                        >
                            Sincronizar via MT5 Agora
                        </Button>
                    </div>
                }
            >
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div className="rounded-xl border border-line bg-surface-2/50 p-4 space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
                                Worker MT5 & Demo Feed
                            </span>
                            <AdminBadge tone={onlineWorkers > 0 ? 'success' : 'warning'} dot>
                                {onlineWorkers > 0 ? `${onlineWorkers}/${totalWorkers} Online` : 'Sem Worker Online'}
                            </AdminBadge>
                        </div>
                        <div className="text-sm font-semibold text-fg">
                            {demoFeed?.configured
                                ? `Conta #${demoFeed.login} (${demoFeed.server})`
                                : 'Nenhuma conta Demo Feed ativa'}
                        </div>
                        <div className="text-xs text-fg-subtle">
                            Estado: {demoFeed?.connectionState || 'DISCONNECTED'} ·{' '}
                            {overview?.telemetry?.mt5?.wsActiveClients ?? 0} clientes WS ativos
                        </div>
                    </div>

                    <div className="rounded-xl border border-line bg-surface-2/50 p-4 space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
                                Eventos no Calendário
                            </span>
                            <AdminBadge tone={(calSync?.totalStored ?? 0) > 0 ? 'info' : 'neutral'}>
                                {calSync?.source || 'MT5_CALENDAR'}
                            </AdminBadge>
                        </div>
                        <div className="text-2xl font-bold text-fg tabular-nums">
                            {calSync?.totalStored ?? 0}
                            <span className="ml-2 text-xs font-normal text-fg-muted">
                                ({calSync?.upcomingCount ?? 0} futuros)
                            </span>
                        </div>
                        <div className="text-xs text-fg-subtle">
                            Último lote: {calSync?.created ?? 0} criados · {calSync?.updated ?? 0} atualizados (
                            {calSync?.analyzed ?? 0} lidos)
                        </div>
                    </div>

                    <div className="rounded-xl border border-line bg-surface-2/50 p-4 space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
                                Última Sincronização
                            </span>
                            <AdminBadge tone={calSync?.lastError ? 'danger' : calSync?.lastSyncAt ? 'success' : 'neutral'}>
                                {calSync?.lastError ? 'Com Erro' : calSync?.lastSyncAt ? 'Saudável' : 'Aguardando'}
                            </AdminBadge>
                        </div>
                        <div className="text-sm font-semibold text-fg">{formatDateTime(calSync?.lastSyncAt)}</div>
                        <div className="text-xs text-fg-subtle truncate" title={calSync?.lastError || undefined}>
                            {calSync?.lastError
                                ? `Erro: ${calSync.lastError}`
                                : 'Ciclo automático a cada 10 min via MQL5 CalendarValueHistory (-7d a +14d)'}
                        </div>
                    </div>
                </div>
            </AdminSectionCard>

            {/* 6. Infraestrutura: Filas BullMQ & Telemetria */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <AdminSectionCard
                    className="lg:col-span-2"
                    title="Filas BullMQ & Processamento Assíncrono"
                    subtitle="Status em tempo real de workers de email, cobrança, IA e importação de trades."
                    icon={<Database className="h-5 w-5" />}
                >
                    {queues.length === 0 ? (
                        <p className="text-sm text-fg-muted">Nenhuma fila registrada.</p>
                    ) : (
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            {queues.map((q) => {
                                const counts = q.counts || {};
                                const failed = Number(counts.failed || 0);
                                return (
                                    <div
                                        key={q.name}
                                        className="rounded-xl border border-line bg-surface-2/40 p-4 space-y-3"
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <div className="text-sm font-semibold text-fg truncate">
                                                    {QUEUE_LABELS[q.name] || q.name}
                                                </div>
                                                <div className="text-[11px] font-mono text-fg-subtle">{q.name}</div>
                                            </div>
                                            {failed > 0 ? (
                                                <Button
                                                    variant="danger"
                                                    size="sm"
                                                    onClick={() => handleRetryQueue(q.name)}
                                                    isLoading={retryingQueue === q.name}
                                                    icon={<RotateCcw className="h-3 w-3" />}
                                                >
                                                    Reprocessar ({failed})
                                                </Button>
                                            ) : (
                                                <AdminBadge tone={q.error ? 'warning' : 'success'} dot>
                                                    {q.error ? 'Degradada' : 'OK'}
                                                </AdminBadge>
                                            )}
                                        </div>

                                        <div className="grid grid-cols-4 gap-2 text-center">
                                            {[
                                                { label: 'Ativos', val: counts.active ?? 0 },
                                                { label: 'Espera', val: counts.waiting ?? 0 },
                                                { label: 'Feitos', val: counts.completed ?? 0 },
                                                { label: 'Falhas', val: failed, danger: failed > 0 },
                                            ].map((metric) => (
                                                <div
                                                    key={metric.label}
                                                    className="rounded-lg bg-surface border border-line px-2 py-1.5"
                                                >
                                                    <div className="text-[10px] text-fg-subtle">{metric.label}</div>
                                                    <div
                                                        className={`text-sm font-bold tabular-nums ${
                                                            metric.danger ? 'text-danger-fg' : 'text-fg'
                                                        }`}
                                                    >
                                                        {metric.val}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </AdminSectionCard>

                <AdminSectionCard
                    title="Recursos & Entrega"
                    subtitle="Processo Node.js e estatísticas SMTP."
                    icon={<Cpu className="h-5 w-5" />}
                >
                    <div className="space-y-3 text-sm">
                        <div className="flex items-center justify-between rounded-xl border border-line bg-surface-2/40 px-3.5 py-2.5">
                            <span className="text-fg-muted flex items-center gap-2 text-xs">
                                <Server className="h-4 w-4 text-accent-fg" /> Memória RSS / Heap
                            </span>
                            <span className="font-mono font-semibold text-xs text-fg">
                                {overview?.telemetry?.process?.rssMb ?? 0} /{' '}
                                {overview?.telemetry?.process?.heapUsedMb ?? 0} MB
                            </span>
                        </div>
                        <div className="flex items-center justify-between rounded-xl border border-line bg-surface-2/40 px-3.5 py-2.5">
                            <span className="text-fg-muted flex items-center gap-2 text-xs">
                                <Radio className="h-4 w-4 text-sky-500" /> Requisições HTTP
                            </span>
                            <span className="font-mono font-semibold text-xs text-fg">
                                {(overview?.telemetry?.http?.totalRequests ?? 0).toLocaleString('pt-PT')}
                            </span>
                        </div>
                        <div className="flex items-center justify-between rounded-xl border border-line bg-surface-2/40 px-3.5 py-2.5">
                            <span className="text-fg-muted flex items-center gap-2 text-xs">
                                <Mail className="h-4 w-4 text-amber-500" /> Emails (Env / Falha)
                            </span>
                            <span className="font-mono font-semibold text-xs text-fg">
                                {overview?.telemetry?.email?.sent ?? 0} /{' '}
                                {overview?.telemetry?.email?.failed ?? 0}
                            </span>
                        </div>
                        <div className="rounded-xl border border-line bg-surface-2/40 px-3.5 py-2.5 text-xs">
                            <div className="text-fg-muted font-medium mb-1">Latência HTTP</div>
                            <div className="flex items-center justify-between font-mono text-fg">
                                <span>
                                    p50: {Number(overview?.telemetry?.http?.latency?.p50Ms ?? 0).toFixed(0)}ms
                                </span>
                                <span>p95: {p95Ms.toFixed(0)}ms</span>
                                <span>
                                    p99: {Number(overview?.telemetry?.http?.latency?.p99Ms ?? 0).toFixed(0)}ms
                                </span>
                            </div>
                        </div>
                    </div>
                </AdminSectionCard>
            </div>

            {/* 7. Diretório Estrutural de Módulos (3 Domínios) */}
            <AdminSectionCard
                title="Arquitetura Administrativa por Domínio"
                subtitle="Acesso direto aos módulos operacionais da plataforma."
            >
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
                    {domainCards.map((dom) => (
                        <div
                            key={dom.domain}
                            className="rounded-xl border border-line bg-surface-2/30 p-4 flex flex-col gap-3"
                        >
                            <div>
                                <h3 className="text-sm font-bold text-fg">{dom.domain}</h3>
                                <p className="text-xs text-fg-muted mt-0.5">{dom.description}</p>
                            </div>
                            <div className="space-y-2">
                                {dom.links.map((item) => {
                                    const Icon = item.icon;
                                    return (
                                        <Link
                                            key={item.to}
                                            to={item.to}
                                            className="flex items-center justify-between rounded-xl border border-line bg-surface px-3.5 py-2.5 hover:border-accent/35 hover:bg-surface-2 transition-all group"
                                        >
                                            <div className="flex items-center gap-3 min-w-0">
                                                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-accent-fg border border-line">
                                                    <Icon className="h-4 w-4" />
                                                </span>
                                                <div className="min-w-0">
                                                    <div className="text-xs font-semibold text-fg truncate">
                                                        {item.title}
                                                    </div>
                                                    <div className="text-[11px] text-fg-subtle truncate">
                                                        {item.meta}
                                                    </div>
                                                </div>
                                            </div>
                                            <ArrowRight className="h-3.5 w-3.5 text-fg-subtle group-hover:text-accent-fg group-hover:translate-x-0.5 transition-all shrink-0" />
                                        </Link>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            </AdminSectionCard>
        </div>
    );
};
