import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../api';
import {
    Activity,
    AlertTriangle,
    ArrowDownUp,
    BarChart3,
    Calendar,
    CheckCircle2,
    ChevronLeft,
    ChevronRight,
    Compass,
    CreditCard,
    Download,
    Eye,
    FileSpreadsheet,
    Globe,
    History,
    KeyRound,
    Layers,
    Mail,
    MessageCircle,
    MousePointerClick,
    RefreshCw,
    Search,
    ShieldAlert,
    ShieldCheck,
    Sparkles,
    TrendingUp,
    UploadCloud,
    UserCheck,
    Users,
    XCircle,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { cn } from '../../lib/cn';
import {
    AdminBadge,
    AdminBanner,
    AdminEmptyState,
    AdminLoadingState,
    AdminPageHeader,
    AdminSectionCard,
    AdminStatCard,
} from './components/AdminPrimitives';

interface OriginPerformanceMetric {
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

interface UsersSummary {
    totalUsers: number;
    verifiedUsers: number;
    activeSubscribers: number;
    expiredSubscribers: number;
    pendingCheckouts: number;
    freeUsers: number;
    importedUsers: number;
    overallConversionRatePct: number;
    activationRatePct: number;
}

interface AdminUserRow {
    id: string;
    name?: string | null;
    username?: string | null;
    email: string;
    whatsapp?: string | null;
    preferredMpesa?: string | null;
    preferredEmola?: string | null;
    lastPaymentMethod?: string | null;
    preferredLocale?: string;
    timezone?: string | null;
    createdAt: string | null;
    emailVerified: boolean;
    emailVerifiedAt: string | null;
    authProvider: 'google' | 'github' | 'email';
    isBlocked: boolean;
    twoFactorEnabled: boolean;
    onboardingCompleted: boolean;
    hasUsedTrial: boolean;
    lastLoginAt: string | null;
    lastActionAt: string | null;
    lastActionType: string | null;
    lastActionLabel: string | null;
    lastActionPath: string | null;
    plan: {
        planStatus: 'ACTIVE' | 'EXPIRED' | 'PENDING' | 'FREE';
        statusLabel: string;
        isActivePlan: boolean;
        isExpiredPlan: boolean;
        hasEverConverted: boolean;
        planTier: string | null;
        expiresAt: string | null;
        daysLeft: number | null;
        expiredDaysAgo: number | null;
        cycle: string | null;
        paymentMethod: string | null;
        latestSubscriptionId: string | null;
    };
    origin: {
        channelKey: string;
        channelLabel: string;
        networkGroup: string;
        isSocial: boolean;
        rawSource: string | null;
        medium: string | null;
        campaign: string | null;
        content: string | null;
        term: string | null;
        clickIdType: string | null;
        clickId: string | null;
        landingPath: string | null;
        referrerHost: string | null;
        utmSummary: string | null;
    };
    originStats?: {
        channelUsers: number;
        channelConverted: number;
        channelConversionRatePct: number;
        channelActivationRatePct: number;
        channelRevenue: number;
    };
    behavior: {
        sessionsCount: number;
        loginCount: number;
        pageviewsCount: number;
        distinctPagesCount: number;
        clicksCount: number;
        visitedPricingOrCheckout: boolean;
        totalImports: number;
        successImports: number;
        failedImports: number;
        tradesCount: number;
        importedTradesCount: number;
        accountsCount: number;
        connectedAccountsCount: number;
        journalEntriesCount: number;
        backtestSessionsCount: number;
        aiSessionsCount: number;
        whatsappLinked: boolean;
        emailSentCount: number;
        emailOpenCount: number;
        emailClickCount: number;
        totalRevenue: number;
        paymentsCount: number;
        lastImportAt: string | null;
        lastImportMethod: string | null;
        lastImportStatus: string | null;
    };
    journey: {
        engagementScore: number;
        funnelStage: string;
        funnelLabel: string;
        checklist: {
            emailVerified: boolean;
            hasLoggedIn: boolean;
            completedOnboarding: boolean;
            visitedPricingOrCheckout: boolean;
            clickedCta: boolean;
            importedTrades: boolean;
            usedProductTools: boolean;
            convertedPaid: boolean;
        };
        recommendations: string[];
    };
    referrer?: string | null;
    landingPath?: string | null;
    subscriptions?: any[];
}

interface User360Intelligence {
    user: AdminUserRow & {
        attributionData?: any;
        surveyAnswers?: any;
        visitorId?: string | null;
    };
    accounts: Array<{
        id: string;
        name: string;
        broker: string;
        type: string;
        currency: string;
        mt5Id?: string | null;
        balance: number;
        equity: number;
        isPrimary: boolean;
        isArchived: boolean;
        isConnected: boolean;
        lastSeen?: string | null;
        tradesCount: number;
    }>;
    importLogs: Array<{
        id: number;
        method: string;
        status: string;
        details?: string | null;
        tradesCount: number;
        accountId?: string | null;
        createdAt: string;
    }>;
    payments: Array<{
        id: number;
        produto: string;
        preco: number;
        status: string;
        vendaId: string;
        dataHora: string;
        createdAt: string;
    }>;
    sessions: Array<{
        id: string;
        userAgent?: string | null;
        ipAddress?: string | null;
        isActive: boolean;
        expiresAt: string;
        createdAt: string;
    }>;
    auditLogs: Array<{
        id: string;
        action: string;
        ip?: string | null;
        userAgent?: string | null;
        timestamp: string;
    }>;
    pageBreakdown: Array<{
        pagePath: string;
        pageTitle?: string | null;
        visits: number;
        lastVisitedAt: string;
    }>;
    ctaBreakdown: Array<{
        ctaTag: string;
        label?: string | null;
        intent?: string | null;
        pagePath?: string | null;
        clicks: number;
        lastClickedAt: string;
    }>;
    emailLogs: Array<{
        id: string;
        template: string;
        subject?: string | null;
        sentAt: string;
        openedAt?: string | null;
        openCount: number;
        firstClickedAt?: string | null;
        clickCount: number;
        lastCtaTag?: string | null;
    }>;
    timeline: Array<{
        id: string;
        category: 'navigation' | 'click' | 'import' | 'auth' | 'billing' | 'email' | 'conversion';
        title: string;
        detail?: string | null;
        path?: string | null;
        timestamp: string;
    }>;
}

const formatDateShort = (iso?: string | null) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const formatDateTime = (iso?: string | null) => {
    if (!iso) return 'Nunca';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return 'Nunca';
    return d.toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' });
};

const formatRelative = (iso?: string | null) => {
    if (!iso) return 'Sem registo';
    const ts = new Date(iso).getTime();
    if (isNaN(ts)) return 'Sem registo';
    const diffMin = Math.floor((Date.now() - ts) / 60000);
    if (diffMin < 1) return 'Agora mesmo';
    if (diffMin < 60) return `Há ${diffMin}m`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `Há ${diffHours}h`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return `Há ${diffDays}d`;
    const diffMonths = Math.floor(diffDays / 30);
    return `Há ${diffMonths} mês(es)`;
};

const sanitizePhoneForWa = (raw?: string | null) => {
    if (!raw) return '';
    return raw.replace(/[^\d]/g, '');
};

const originPillClass = (channelKey: string) => {
    switch (channelKey) {
        case 'instagram':
            return 'bg-fuchsia-500/10 text-fuchsia-500 border-fuchsia-500/25';
        case 'facebook':
            return 'bg-blue-500/10 text-blue-500 border-blue-500/25';
        case 'meta_ads':
            return 'bg-indigo-500/10 text-indigo-500 border-indigo-500/25';
        case 'tiktok':
            return 'bg-pink-500/10 text-pink-500 border-pink-500/25';
        case 'youtube':
            return 'bg-red-500/10 text-red-500 border-red-500/25';
        case 'google_ads':
        case 'google_organic':
            return 'bg-amber-500/10 text-amber-500 border-amber-500/25';
        case 'whatsapp':
        case 'telegram':
            return 'bg-emerald-500/10 text-accent-fg border-emerald-500/25';
        default:
            return 'bg-surface-2 text-fg-muted border-line-strong';
    }
};

export const AdminUsers = () => {
    const [searchParams, setSearchParams] = useSearchParams();

    const [users, setUsers] = useState<AdminUserRow[]>([]);
    const [summary, setSummary] = useState<UsersSummary | null>(null);
    const [originBreakdown, setOriginBreakdown] = useState<OriginPerformanceMetric[]>([]);
    const [total, setTotal] = useState(0);
    const [totalPages, setTotalPages] = useState(1);

    const [searchInput, setSearchInput] = useState(() => searchParams.get('search') || '');
    const [debouncedSearch, setDebouncedSearch] = useState(() => searchParams.get('search') || '');
    const [sourceFilter, setSourceFilter] = useState(() => searchParams.get('source') || 'ALL');
    const [planFilter, setPlanFilter] = useState(() => searchParams.get('planStatus') || 'ALL');
    const [activityFilter, setActivityFilter] = useState(() => searchParams.get('activityFilter') || 'ALL');
    const [sortBy, setSortBy] = useState(() => searchParams.get('sortBy') || 'createdAt');
    const [page, setPage] = useState(() => Math.max(1, Number(searchParams.get('page')) || 1));

    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [banner, setBanner] = useState<{ tone: 'success' | 'warning' | 'danger' | 'info'; message: string } | null>(null);

    // 360 Intelligence Modal
    const [inspectUserId, setInspectUserId] = useState<string | null>(() => searchParams.get('inspect'));
    const [intelData, setIntelData] = useState<User360Intelligence | null>(null);
    const [loadingIntel, setLoadingIntel] = useState(false);
    const [intelTab, setIntelTab] = useState<'overview' | 'behavior' | 'timeline' | 'billing'>('overview');
    const [timelineCategory, setTimelineCategory] = useState<string>('ALL');

    // History Modal State
    const [historyUser, setHistoryUser] = useState<AdminUserRow | null>(null);
    const [history, setHistory] = useState<any[]>([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);

    // Plan Management Modal State
    const [planModalUser, setPlanModalUser] = useState<AdminUserRow | null>(null);
    const [availablePlans, setAvailablePlans] = useState<any[]>([]);
    const [actionType, setActionType] = useState<'ASSIGN' | 'EXTEND' | 'CANCEL'>('ASSIGN');
    const [selectedTier, setSelectedTier] = useState<string>('PRO');
    const [selectedPlanConfigId, setSelectedPlanConfigId] = useState<string>('');
    const [selectedDays, setSelectedDays] = useState<number>(30);
    const [customDays, setCustomDays] = useState<string>('');
    const [customDate, setCustomDate] = useState<string>('');
    const [reason, setReason] = useState<string>('');
    const [confirmCancel, setConfirmCancel] = useState(false);
    const [isSubmittingPlan, setIsSubmittingPlan] = useState(false);
    const [planMessage, setPlanMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    // Debounce search input
    useEffect(() => {
        const timer = window.setTimeout(() => {
            setDebouncedSearch(searchInput);
            setPage(1);
        }, 300);
        return () => window.clearTimeout(timer);
    }, [searchInput]);

    // Sync inspect param from URL when navigating from dashboard
    useEffect(() => {
        const paramInspect = searchParams.get('inspect');
        if (paramInspect && paramInspect !== inspectUserId) {
            setInspectUserId(paramInspect);
        }
    }, [searchParams, inspectUserId]);

    // Push filter state to URL query params cleanly
    const updateUrlParams = useCallback(
        (overrides?: Record<string, string | number | null>) => {
            const next = new URLSearchParams();
            const vals: Record<string, string> = {
                search: debouncedSearch,
                source: sourceFilter,
                planStatus: planFilter,
                activityFilter,
                sortBy,
                page: page > 1 ? String(page) : '',
                inspect: inspectUserId || '',
            };
            if (overrides) {
                for (const [k, v] of Object.entries(overrides)) {
                    vals[k] = v === null || v === undefined ? '' : String(v);
                }
            }
            if (vals.search) next.set('search', vals.search);
            if (vals.source && vals.source !== 'ALL') next.set('source', vals.source);
            if (vals.planStatus && vals.planStatus !== 'ALL') next.set('planStatus', vals.planStatus);
            if (vals.activityFilter && vals.activityFilter !== 'ALL') next.set('activityFilter', vals.activityFilter);
            if (vals.sortBy && vals.sortBy !== 'createdAt') next.set('sortBy', vals.sortBy);
            if (vals.page && Number(vals.page) > 1) next.set('page', vals.page);
            if (vals.inspect) next.set('inspect', vals.inspect);
            setSearchParams(next, { replace: true });
        },
        [debouncedSearch, sourceFilter, planFilter, activityFilter, sortBy, page, inspectUserId, setSearchParams],
    );

    const fetchUsers = useCallback(
        async (silent = false) => {
            if (silent) setIsRefreshing(true);
            try {
                const { data } = await api.get('/admin/users', {
                    params: {
                        page,
                        limit: 50,
                        search: debouncedSearch || undefined,
                        source: sourceFilter !== 'ALL' ? sourceFilter : undefined,
                        planStatus: planFilter !== 'ALL' ? planFilter : undefined,
                        activityFilter: activityFilter !== 'ALL' ? activityFilter : undefined,
                        sortBy,
                        sortDir: 'desc',
                    },
                });
                setUsers(Array.isArray(data) ? data : data?.items || []);
                setTotal(Number(data?.total ?? data?.items?.length ?? 0));
                setTotalPages(Number(data?.totalPages ?? 1));
                if (data?.summary) setSummary(data.summary);
                if (Array.isArray(data?.originBreakdown)) setOriginBreakdown(data.originBreakdown);
            } catch (err: any) {
                setBanner({
                    tone: 'danger',
                    message: err?.response?.data?.message || 'Falha ao carregar inteligência de usuários.',
                });
            } finally {
                setIsLoading(false);
                setIsRefreshing(false);
            }
        },
        [page, debouncedSearch, sourceFilter, planFilter, activityFilter, sortBy],
    );

    const fetchPlans = useCallback(async () => {
        try {
            const { data } = await api.get('/admin/plans');
            setAvailablePlans(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error('Failed to load plans:', err);
        }
    }, []);

    useEffect(() => {
        void fetchUsers();
    }, [fetchUsers]);

    useEffect(() => {
        void fetchPlans();
    }, [fetchPlans]);

    const loadUser360 = useCallback(async (userId: string) => {
        setLoadingIntel(true);
        try {
            const { data } = await api.get(`/admin/users/${userId}/intelligence`);
            setIntelData(data);
        } catch (err: any) {
            setBanner({
                tone: 'danger',
                message: err?.response?.data?.message || 'Erro ao carregar Raio-X 360° do usuário.',
            });
            setInspectUserId(null);
            updateUrlParams({ inspect: null });
        } finally {
            setLoadingIntel(false);
        }
    }, [updateUrlParams]);

    useEffect(() => {
        if (inspectUserId) {
            setIntelTab('overview');
            setTimelineCategory('ALL');
            void loadUser360(inspectUserId);
        } else {
            setIntelData(null);
        }
    }, [inspectUserId, loadUser360]);

    const open360Modal = (userId: string) => {
        setInspectUserId(userId);
        updateUrlParams({ inspect: userId });
    };

    const close360Modal = () => {
        setInspectUserId(null);
        setIntelData(null);
        updateUrlParams({ inspect: null });
    };

    const fetchHistory = async (user: AdminUserRow) => {
        setIsLoadingHistory(true);
        setHistoryUser(user);
        try {
            const { data } = await api.get(`/admin/users/${user.id}/subscriptions`);
            setHistory(Array.isArray(data) ? data : []);
        } catch (err: any) {
            setBanner({
                tone: 'danger',
                message: err?.response?.data?.message || 'Erro ao carregar histórico de assinaturas.',
            });
        } finally {
            setIsLoadingHistory(false);
        }
    };

    const openPlanModal = (user: AdminUserRow, preferredAction?: 'ASSIGN' | 'EXTEND') => {
        setPlanModalUser(user);
        setPlanMessage(null);
        setReason('');
        setCustomDays('');
        setCustomDate('');
        setConfirmCancel(false);

        if (user.plan.isActivePlan) {
            setActionType(preferredAction || 'EXTEND');
            setSelectedTier(user.plan.planTier || 'PRO');
            const matchedPlan = availablePlans.find((p) => p.tier === user.plan.planTier);
            setSelectedPlanConfigId(matchedPlan?.id || '');
            setSelectedDays(30);
        } else {
            setActionType('ASSIGN');
            const defaultPlan =
                availablePlans.find((p) => p.tier === 'PRO' || p.tier === 'PREMIUM') || availablePlans[0];
            setSelectedTier(defaultPlan?.tier || 'PRO');
            setSelectedPlanConfigId(defaultPlan?.id || '');
            setSelectedDays(30);
        }
    };

    const handlePlanSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!planModalUser) return;
        if (actionType === 'CANCEL' && !confirmCancel) {
            setConfirmCancel(true);
            return;
        }

        setIsSubmittingPlan(true);
        setPlanMessage(null);

        try {
            const daysToUse = customDays ? parseInt(customDays, 10) : selectedDays;
            const payload: any = {
                action: actionType,
                reason: reason.trim() || undefined,
            };

            if (actionType === 'ASSIGN') {
                payload.tier = selectedTier;
                payload.planConfigId = selectedPlanConfigId || undefined;
                if (customDate) {
                    payload.customExpiryDate = new Date(customDate).toISOString();
                } else {
                    payload.days = daysToUse;
                }
            } else if (actionType === 'EXTEND') {
                if (customDate) {
                    payload.customExpiryDate = new Date(customDate).toISOString();
                } else {
                    payload.days = daysToUse;
                }
            }

            const { data } = await api.post(`/admin/users/${planModalUser.id}/subscription`, payload);
            setPlanMessage({
                type: 'success',
                text: data?.message || 'Assinatura atualizada com sucesso!',
            });

            await fetchUsers(true);
            if (inspectUserId === planModalUser.id) {
                void loadUser360(planModalUser.id);
            }

            window.setTimeout(() => {
                setPlanModalUser(null);
                setPlanMessage(null);
                setConfirmCancel(false);
            }, 1400);
        } catch (err: any) {
            setPlanMessage({
                type: 'error',
                text: err?.response?.data?.message || 'Falha ao processar alteração de plano.',
            });
        } finally {
            setIsSubmittingPlan(false);
        }
    };

    const calculateProjectedDate = () => {
        if (!planModalUser) return null;
        const now = new Date();
        if (customDate) return new Date(customDate);
        const days = customDays ? parseInt(customDays, 10) || 0 : selectedDays;
        if (actionType === 'EXTEND' && planModalUser.plan.isActivePlan && planModalUser.plan.expiresAt) {
            const cur = new Date(planModalUser.plan.expiresAt);
            const base = cur > now ? cur : now;
            return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
        }
        return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    };

    const handleExportCsv = () => {
        const headers = [
            'Nome',
            'Email',
            'WhatsApp',
            'Plano_Status',
            'Plano_Tier',
            'Expira_Em',
            'Origem',
            'Campanha',
            'Taxa_Conv_Canal_Pct',
            'Ultimo_Login',
            'Ultima_Acao',
            'Ultima_Acao_Data',
            'Trades_Importados',
            'Score',
            'Criado_Em',
        ];
        const escapeCell = (val: any) => `"${String(val ?? '').replace(/"/g, '""')}"`;
        const rows = users.map((u) => [
            u.name || u.username || '',
            u.email,
            u.whatsapp || '',
            u.plan.statusLabel,
            u.plan.planTier || 'FREE',
            u.plan.expiresAt || '',
            u.origin.channelLabel,
            u.origin.campaign || '',
            u.originStats?.channelConversionRatePct ?? 0,
            u.lastLoginAt || '',
            u.lastActionLabel || '',
            u.lastActionAt || '',
            u.behavior.importedTradesCount,
            u.journey.engagementScore,
            u.createdAt || '',
        ]);
        const csv = [headers.join(','), ...rows.map((r) => r.map(escapeCell).join(','))].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `torex_usuarios_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleQuickFilterSource = (channelKey: string) => {
        const next = sourceFilter === channelKey ? 'ALL' : channelKey;
        setSourceFilter(next);
        setPage(1);
        updateUrlParams({ source: next, page: 1 });
    };

    const handleQuickFilterPlan = (status: string) => {
        const next = planFilter === status ? 'ALL' : status;
        setPlanFilter(next);
        setPage(1);
        updateUrlParams({ planStatus: next, page: 1 });
    };

    const filteredTimeline = useMemo(() => {
        const list = intelData?.timeline || [];
        if (timelineCategory === 'ALL') return list;
        return list.filter((item) => item.category === timelineCategory);
    }, [intelData, timelineCategory]);

    if (isLoading) {
        return <AdminLoadingState label="Calculando inteligência de contas, origens e jornadas..." />;
    }

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            <AdminPageHeader
                badge="Clientes & Inteligência"
                title="Usuários, Planos & Atribuição"
                subtitle="Contacto integrado, status real de assinatura (Ativo vs Já Expirado), conversão por rede social e Raio-X comportamental 360°."
                icon={<Users className="h-5 w-5" />}
                actions={
                    <>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleExportCsv}
                            icon={<Download className="h-3.5 w-3.5" />}
                        >
                            Exportar CSV
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => fetchUsers(true)}
                            isLoading={isRefreshing}
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

            {/* Top Executive Metrics */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <AdminStatCard
                    label="Total de Usuários"
                    value={(summary?.totalUsers ?? total).toLocaleString('pt-PT')}
                    hint={`${summary?.verifiedUsers ?? 0} contas verificadas`}
                    icon={<Users className="h-4 w-4" />}
                    tone="info"
                    onClick={() => handleQuickFilterPlan('ALL')}
                />
                <AdminStatCard
                    label="Planos Ativos"
                    value={(summary?.activeSubscribers ?? 0).toLocaleString('pt-PT')}
                    hint="Assinaturas em vigor agora"
                    icon={<CheckCircle2 className="h-4 w-4" />}
                    tone="accent"
                    onClick={() => handleQuickFilterPlan('ACTIVE')}
                />
                <AdminStatCard
                    label="Já Expirados"
                    value={(summary?.expiredSubscribers ?? 0).toLocaleString('pt-PT')}
                    hint="Clique para filtrar win-back"
                    icon={<AlertTriangle className="h-4 w-4" />}
                    tone={(summary?.expiredSubscribers ?? 0) > 0 ? 'danger' : 'default'}
                    onClick={() => handleQuickFilterPlan('EXPIRED')}
                />
                <AdminStatCard
                    label="Taxa de Conversão"
                    value={`${summary?.overallConversionRatePct ?? 0}%`}
                    hint={`${summary?.pendingCheckouts ?? 0} checkout(s) pendente(s)`}
                    icon={<TrendingUp className="h-4 w-4" />}
                    tone="accent"
                    onClick={() => handleQuickFilterPlan('PENDING')}
                />
                <AdminStatCard
                    label="Ativação (Trades)"
                    value={`${summary?.activationRatePct ?? 0}%`}
                    hint={`${summary?.importedUsers ?? 0} contas importaram trades`}
                    icon={<UploadCloud className="h-4 w-4" />}
                    tone="warning"
                />
            </div>

            {/* Origin & Conversion Breakdown Matrix */}
            <AdminSectionCard
                title="Origem & Taxa de Conversão por Canal / Rede Social"
                subtitle="Clique em qualquer canal para filtrar a tabela de usuários abaixo (Facebook e Instagram separados)."
                icon={<Compass className="h-5 w-5" />}
                actions={
                    sourceFilter !== 'ALL' ? (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleQuickFilterSource('ALL')}
                        >
                            Limpar filtro ({sourceFilter})
                        </Button>
                    ) : null
                }
            >
                {originBreakdown.length === 0 ? (
                    <p className="text-xs text-fg-muted">Nenhuma origem registada ainda.</p>
                ) : (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
                        {originBreakdown.slice(0, 10).map((ch) => {
                            const selected = sourceFilter === ch.channelKey;
                            return (
                                <button
                                    key={ch.channelKey}
                                    type="button"
                                    onClick={() => handleQuickFilterSource(ch.channelKey)}
                                    className={cn(
                                        'rounded-xl border p-3.5 text-left transition-all',
                                        selected
                                            ? 'border-accent bg-accent/10 ring-1 ring-accent/40'
                                            : 'border-line bg-surface-2/40 hover:border-line-strong hover:bg-surface-2',
                                    )}
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <span
                                            className={cn(
                                                'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold truncate',
                                                originPillClass(ch.channelKey),
                                            )}
                                        >
                                            {ch.channelLabel}
                                        </span>
                                        <span className="text-xs font-bold text-accent-fg tabular-nums">
                                            {ch.conversionRatePct}% conv.
                                        </span>
                                    </div>
                                    <div className="mt-2.5 flex items-baseline justify-between">
                                        <span className="text-lg font-bold text-fg tabular-nums">
                                            {ch.users} <span className="text-[11px] font-normal text-fg-muted">leads</span>
                                        </span>
                                        <span className="text-xs text-fg-muted tabular-nums">
                                            {ch.converted} pagantes
                                        </span>
                                    </div>
                                    <div className="mt-1.5 h-1.5 w-full rounded-full bg-surface overflow-hidden border border-line/60">
                                        <div
                                            className="h-full bg-accent transition-all"
                                            style={{ width: `${Math.min(100, Math.max(ch.converted > 0 ? 4 : 0, ch.conversionRatePct))}%` }}
                                        />
                                    </div>
                                    <div className="mt-1.5 flex items-center justify-between text-[11px] text-fg-subtle">
                                        <span>Ativ.: {ch.activationRatePct}%</span>
                                        <span>
                                            {ch.revenue > 0 ? `${ch.revenue.toLocaleString('pt-MZ')} MT` : `${ch.activePlans} ativos`}
                                        </span>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}
            </AdminSectionCard>

            {/* Filter Toolbar + Table */}
            <AdminSectionCard
                title={`Diretório de Contas (${total})`}
                subtitle="Clique em qualquer linha para abrir o Raio-X 360° (verificação, cliques, páginas, importações e linha temporal)."
                noPadding
            >
                <div className="border-b border-line p-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between bg-surface-2/30">
                    <div className="relative flex-1 min-w-[220px]">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-fg-subtle" />
                        <input
                            type="text"
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            placeholder="Buscar por nome, e-mail, WhatsApp, campanha ou última ação..."
                            className="w-full rounded-xl border border-line bg-surface pl-9 pr-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent"
                        />
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <select
                            value={planFilter}
                            onChange={(e) => {
                                setPlanFilter(e.target.value);
                                setPage(1);
                                updateUrlParams({ planStatus: e.target.value, page: 1 });
                            }}
                            className="rounded-xl border border-line bg-surface px-3 py-2 text-xs font-medium text-fg focus:outline-none focus:border-accent"
                        >
                            <option value="ALL">Plano: Todos</option>
                            <option value="ACTIVE">Plano Ativo</option>
                            <option value="EXPIRED">Já Expirado</option>
                            <option value="PENDING">Checkout Pendente</option>
                            <option value="FREE">Gratuito (Free)</option>
                        </select>

                        <select
                            value={sourceFilter}
                            onChange={(e) => {
                                setSourceFilter(e.target.value);
                                setPage(1);
                                updateUrlParams({ source: e.target.value, page: 1 });
                            }}
                            className="rounded-xl border border-line bg-surface px-3 py-2 text-xs font-medium text-fg focus:outline-none focus:border-accent"
                        >
                            <option value="ALL">Origem: Todas</option>
                            <option value="social">Todas Redes Sociais</option>
                            {originBreakdown.map((o) => (
                                <option key={o.channelKey} value={o.channelKey}>
                                    {o.channelLabel} ({o.users} · {o.conversionRatePct}%)
                                </option>
                            ))}
                        </select>

                        <select
                            value={activityFilter}
                            onChange={(e) => {
                                setActivityFilter(e.target.value);
                                setPage(1);
                                updateUrlParams({ activityFilter: e.target.value, page: 1 });
                            }}
                            className="rounded-xl border border-line bg-surface px-3 py-2 text-xs font-medium text-fg focus:outline-none focus:border-accent"
                        >
                            <option value="ALL">Comportamento: Todos</option>
                            <option value="IMPORTED">Já Importou Trades</option>
                            <option value="NO_IMPORTS">Nunca Importou</option>
                            <option value="CHECKOUT_INTENT">Visitou Preços/Checkout (Não Pago)</option>
                            <option value="IMPORT_FAILED">Com Falha de Importação</option>
                            <option value="ACTIVE_TODAY">Ativo Últimas 24h</option>
                        </select>

                        <div className="flex items-center gap-1 rounded-xl border border-line bg-surface px-2.5 py-2">
                            <ArrowDownUp className="h-3.5 w-3.5 text-fg-subtle" />
                            <select
                                value={sortBy}
                                onChange={(e) => {
                                    setSortBy(e.target.value);
                                    updateUrlParams({ sortBy: e.target.value });
                                }}
                                className="bg-transparent text-xs font-medium text-fg focus:outline-none"
                            >
                                <option value="createdAt">Cadastro mais recente</option>
                                <option value="lastActionAt">Última ação mais recente</option>
                                <option value="lastLoginAt">Último login mais recente</option>
                                <option value="engagementScore">Maior engajamento</option>
                                <option value="tradesCount">Mais trades</option>
                            </select>
                        </div>
                    </div>
                </div>

                {users.length === 0 ? (
                    <div className="p-6">
                        <AdminEmptyState
                            icon={<Users className="h-5 w-5" />}
                            title="Nenhum usuário encontrado com os filtros atuais"
                            description="Ajuste a busca, filtro de origem ou status do plano para visualizar mais contas."
                        />
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="border-b border-line bg-surface-2/50 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                                    <th className="px-4 py-3">Usuário & Contacto</th>
                                    <th className="px-4 py-3">Plano & Expiração</th>
                                    <th className="px-4 py-3">Origem & Taxa Conv.</th>
                                    <th className="px-4 py-3">Último Login</th>
                                    <th className="px-4 py-3">Última Ação Capturada</th>
                                    <th className="px-4 py-3 text-right">Ações</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-line text-sm">
                                {users.map((u) => {
                                    const waDigits = sanitizePhoneForWa(u.whatsapp);
                                    const displayName = u.name || u.username || u.email.split('@')[0];
                                    const initials = displayName.slice(0, 2).toUpperCase();

                                    return (
                                        <tr
                                            key={u.id}
                                            onClick={() => open360Modal(u.id)}
                                            className="cursor-pointer transition-colors hover:bg-surface-2/60 group"
                                        >
                                            {/* 1. Usuário & Contacto (merged) */}
                                            <td className="px-4 py-3.5 align-top min-w-[230px]">
                                                <div className="flex items-start gap-3">
                                                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line-strong bg-surface-2 text-xs font-bold text-accent-fg">
                                                        {initials}
                                                    </div>
                                                    <div className="min-w-0 space-y-1">
                                                        <div className="flex items-center gap-1.5 flex-wrap">
                                                            <span className="font-semibold text-fg truncate max-w-[160px]">
                                                                {displayName}
                                                            </span>
                                                            {u.emailVerified ? (
                                                                <span
                                                                    title="Conta verificada"
                                                                    className="inline-flex items-center text-accent-fg"
                                                                >
                                                                    <ShieldCheck className="h-3.5 w-3.5" />
                                                                </span>
                                                            ) : (
                                                                <span
                                                                    title="E-mail ainda não confirmado"
                                                                    className="inline-flex items-center text-amber-500"
                                                                >
                                                                    <ShieldAlert className="h-3.5 w-3.5" />
                                                                </span>
                                                            )}
                                                            {u.isBlocked && (
                                                                <AdminBadge tone="danger">Bloqueado</AdminBadge>
                                                            )}
                                                        </div>
                                                        <div className="text-xs text-fg-muted truncate max-w-[210px]">
                                                            {u.email}
                                                        </div>
                                                        <div className="flex items-center gap-2 flex-wrap pt-0.5">
                                                            {waDigits ? (
                                                                <a
                                                                    href={`https://wa.me/${waDigits}`}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    onClick={(e) => e.stopPropagation()}
                                                                    className="inline-flex items-center gap-1 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium text-accent-fg hover:bg-emerald-500/20"
                                                                >
                                                                    <MessageCircle className="h-3 w-3" />
                                                                    {u.whatsapp}
                                                                </a>
                                                            ) : (
                                                                <span className="text-[11px] text-fg-subtle">
                                                                    Sem WhatsApp
                                                                </span>
                                                            )}
                                                            <span className="text-[10px] uppercase text-fg-subtle font-mono">
                                                                via {u.authProvider}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>

                                            {/* 2. Plano & Expiração */}
                                            <td className="px-4 py-3.5 align-top min-w-[175px]">
                                                {u.plan.planStatus === 'ACTIVE' && (
                                                    <div className="space-y-1">
                                                        <AdminBadge tone="success" dot>
                                                            ATIVO · {u.plan.planTier || 'PRO'}
                                                        </AdminBadge>
                                                        <div className="text-xs text-fg font-medium">
                                                            Expira {formatDateShort(u.plan.expiresAt)}
                                                        </div>
                                                        <div
                                                            className={cn(
                                                                'text-[11px]',
                                                                u.plan.daysLeft !== null && u.plan.daysLeft <= 7
                                                                    ? 'text-amber-500 font-semibold'
                                                                    : 'text-fg-subtle',
                                                            )}
                                                        >
                                                            {u.plan.daysLeft !== null
                                                                ? `${u.plan.daysLeft}d restantes`
                                                                : 'Vitalício / Sem termo'}
                                                        </div>
                                                    </div>
                                                )}
                                                {u.plan.planStatus === 'EXPIRED' && (
                                                    <div className="space-y-1">
                                                        <AdminBadge tone="danger" dot>
                                                            JÁ EXPIRADO · {u.plan.planTier || 'PLANO'}
                                                        </AdminBadge>
                                                        <div className="text-xs text-danger-fg font-medium">
                                                            Expirou {formatDateShort(u.plan.expiresAt)}
                                                        </div>
                                                        <div className="text-[11px] text-fg-subtle">
                                                            Há {u.plan.expiredDaysAgo ?? 0} dia(s)
                                                        </div>
                                                    </div>
                                                )}
                                                {u.plan.planStatus === 'PENDING' && (
                                                    <div className="space-y-1">
                                                        <AdminBadge tone="warning" dot>
                                                            CHECKOUT PENDENTE
                                                        </AdminBadge>
                                                        <div className="text-[11px] text-fg-muted">
                                                            {u.plan.planTier || 'Plano'} ({u.plan.paymentMethod || 'N/A'})
                                                        </div>
                                                    </div>
                                                )}
                                                {u.plan.planStatus === 'FREE' && (
                                                    <div className="space-y-1">
                                                        <AdminBadge tone="neutral">SEM PLANO (FREE)</AdminBadge>
                                                        <div className="text-[11px] text-fg-subtle">
                                                            {u.hasUsedTrial ? 'Trial já utilizado' : 'Nunca assinou'}
                                                        </div>
                                                    </div>
                                                )}
                                            </td>

                                            {/* 3. Origem & Taxa de Conversão */}
                                            <td className="px-4 py-3.5 align-top min-w-[185px]">
                                                <div className="space-y-1">
                                                    <div className="flex items-center gap-1.5 flex-wrap">
                                                        <span
                                                            className={cn(
                                                                'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                                                                originPillClass(u.origin.channelKey),
                                                            )}
                                                        >
                                                            {u.origin.channelLabel}
                                                        </span>
                                                    </div>
                                                    <div className="text-xs font-semibold text-accent-fg tabular-nums">
                                                        {u.originStats?.channelConversionRatePct ?? 0}% conv. do canal
                                                        <span className="ml-1 text-[11px] font-normal text-fg-subtle">
                                                            ({u.originStats?.channelConverted ?? 0}/{u.originStats?.channelUsers ?? 1})
                                                        </span>
                                                    </div>
                                                    <div className="text-[11px] text-fg-subtle truncate max-w-[190px]" title={u.origin.utmSummary || u.origin.referrerHost || undefined}>
                                                        {u.origin.campaign
                                                            ? `Camp: ${u.origin.campaign}`
                                                            : u.origin.referrerHost
                                                              ? `Ref: ${u.origin.referrerHost}`
                                                              : u.origin.clickIdType
                                                                ? `ClickID: ${u.origin.clickIdType}`
                                                                : u.origin.landingPath
                                                                  ? `Landing: ${u.origin.landingPath}`
                                                                  : 'Sem parâmetros UTM'}
                                                    </div>
                                                </div>
                                            </td>

                                            {/* 4. Último Login */}
                                            <td className="px-4 py-3.5 align-top min-w-[140px]">
                                                {u.lastLoginAt ? (
                                                    <div className="space-y-0.5">
                                                        <div className="text-xs font-semibold text-fg">
                                                            {formatRelative(u.lastLoginAt)}
                                                        </div>
                                                        <div className="text-[11px] text-fg-muted">
                                                            {formatDateTime(u.lastLoginAt)}
                                                        </div>
                                                        <div className="text-[11px] text-fg-subtle">
                                                            {u.behavior.sessionsCount} sessões · {u.behavior.loginCount} logins
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="space-y-0.5">
                                                        <span className="text-xs text-fg-subtle">Nunca fez login</span>
                                                        <div className="text-[11px] text-fg-subtle">
                                                            Criado {formatDateShort(u.createdAt)}
                                                        </div>
                                                    </div>
                                                )}
                                            </td>

                                            {/* 5. Última Ação Capturada */}
                                            <td className="px-4 py-3.5 align-top min-w-[235px]">
                                                <div className="space-y-1">
                                                    <div className="text-xs font-semibold text-fg line-clamp-1" title={u.lastActionLabel || undefined}>
                                                        {u.lastActionLabel || 'Sem ação rastreada ainda'}
                                                    </div>
                                                    <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-fg-subtle">
                                                        {u.lastActionAt && <span>{formatRelative(u.lastActionAt)}</span>}
                                                        {u.lastActionPath && (
                                                            <span className="rounded bg-surface-2 border border-line px-1.5 py-0.2 font-mono text-[10px] text-fg-muted truncate max-w-[130px]">
                                                                {u.lastActionPath}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-2 pt-0.5 text-[11px] tabular-nums">
                                                        <span
                                                            className={cn(
                                                                'font-medium',
                                                                u.behavior.importedTradesCount > 0
                                                                    ? 'text-accent-fg'
                                                                    : 'text-fg-subtle',
                                                            )}
                                                        >
                                                            {u.behavior.importedTradesCount} trades
                                                        </span>
                                                        <span className="text-fg-subtle">·</span>
                                                        <span className="text-fg-muted">
                                                            {u.behavior.clicksCount} cliques
                                                        </span>
                                                        <span className="text-fg-subtle">·</span>
                                                        <span className="font-semibold text-fg">
                                                            Score {u.journey.engagementScore}%
                                                        </span>
                                                    </div>
                                                </div>
                                            </td>

                                            {/* 6. Ações */}
                                            <td
                                                className="px-4 py-3.5 align-top text-right whitespace-nowrap"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <div className="inline-flex items-center gap-1.5">
                                                    <Button
                                                        variant="subtle"
                                                        size="sm"
                                                        onClick={() => open360Modal(u.id)}
                                                        icon={<Eye className="h-3.5 w-3.5" />}
                                                    >
                                                        360°
                                                    </Button>
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => openPlanModal(u)}
                                                        icon={<CreditCard className="h-3.5 w-3.5" />}
                                                    >
                                                        Plano
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => fetchHistory(u)}
                                                        title="Histórico de assinaturas"
                                                        icon={<History className="h-3.5 w-3.5" />}
                                                    />
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="flex items-center justify-between border-t border-line px-4 py-3 text-xs text-fg-muted bg-surface-2/30">
                        <span>
                            Página {page} de {totalPages} · {total} usuário(s)
                        </span>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={page <= 1}
                                onClick={() => {
                                    const next = Math.max(1, page - 1);
                                    setPage(next);
                                    updateUrlParams({ page: next });
                                }}
                                icon={<ChevronLeft className="h-3.5 w-3.5" />}
                            >
                                Anterior
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={page >= totalPages}
                                onClick={() => {
                                    const next = Math.min(totalPages, page + 1);
                                    setPage(next);
                                    updateUrlParams({ page: next });
                                }}
                                iconRight={<ChevronRight className="h-3.5 w-3.5" />}
                            >
                                Próxima
                            </Button>
                        </div>
                    </div>
                )}
            </AdminSectionCard>

            {/* ==================== 360 USER INTELLIGENCE MODAL ==================== */}
            <Modal
                isOpen={Boolean(inspectUserId)}
                onClose={close360Modal}
                size="full"
                title={
                    intelData?.user
                        ? `Raio-X 360° · ${intelData.user.name || intelData.user.username || intelData.user.email}`
                        : 'Carregando Raio-X 360°...'
                }
                subtitle={intelData?.user ? `${intelData.user.email} · ID: ${intelData.user.id}` : undefined}
            >
                {loadingIntel || !intelData ? (
                    <AdminLoadingState label="Calculando jornada completa, cliques, páginas, importações e histórico financeiro..." />
                ) : (
                    <div className="space-y-5">
                        {/* Top Summary Header */}
                        <div className="rounded-xl border border-line bg-surface-2/40 p-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                            <div className="space-y-2 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    {intelData.user.plan.planStatus === 'ACTIVE' && (
                                        <AdminBadge tone="success" dot>
                                            PLANO ATIVO · {intelData.user.plan.planTier} ({intelData.user.plan.daysLeft ?? '∞'}d restantes)
                                        </AdminBadge>
                                    )}
                                    {intelData.user.plan.planStatus === 'EXPIRED' && (
                                        <AdminBadge tone="danger" dot>
                                            PLANO JÁ EXPIRADO · {intelData.user.plan.planTier} (há {intelData.user.plan.expiredDaysAgo}d)
                                        </AdminBadge>
                                    )}
                                    {intelData.user.plan.planStatus === 'PENDING' && (
                                        <AdminBadge tone="warning" dot>
                                            CHECKOUT PENDENTE
                                        </AdminBadge>
                                    )}
                                    {intelData.user.plan.planStatus === 'FREE' && (
                                        <AdminBadge tone="neutral">SEM PLANO (FREE)</AdminBadge>
                                    )}
                                    <span
                                        className={cn(
                                            'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold',
                                            originPillClass(intelData.user.origin.channelKey),
                                        )}
                                    >
                                        Origem: {intelData.user.origin.channelLabel} ({intelData.user.originStats?.channelConversionRatePct ?? 0}% conv. canal)
                                    </span>
                                    <AdminBadge tone="info">{intelData.user.journey.funnelLabel}</AdminBadge>
                                </div>
                                <div className="flex flex-wrap items-center gap-4 text-xs text-fg-muted">
                                    <span>
                                        Score Engajamento:{' '}
                                        <strong className="text-fg">{intelData.user.journey.engagementScore}/100</strong>
                                    </span>
                                    <span>
                                        Último Login:{' '}
                                        <strong className="text-fg">{formatDateTime(intelData.user.lastLoginAt)}</strong>
                                    </span>
                                    <span>
                                        Última Ação:{' '}
                                        <strong className="text-fg">
                                            {intelData.user.lastActionLabel || 'Nenhuma'}
                                        </strong>
                                    </span>
                                    <span>
                                        LTV:{' '}
                                        <strong className="text-accent-fg">
                                            {intelData.user.behavior.totalRevenue.toLocaleString('pt-MZ')} MZN
                                        </strong>
                                    </span>
                                </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-2 shrink-0">
                                {sanitizePhoneForWa(intelData.user.whatsapp) && (
                                    <a
                                        href={`https://wa.me/${sanitizePhoneForWa(intelData.user.whatsapp)}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-accent-fg hover:bg-emerald-500/20"
                                    >
                                        <MessageCircle className="h-3.5 w-3.5" />
                                        WhatsApp ({intelData.user.whatsapp})
                                    </a>
                                )}
                                <a
                                    href={`mailto:${intelData.user.email}`}
                                    className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-fg hover:bg-surface-2"
                                >
                                    <Mail className="h-3.5 w-3.5" />
                                    E-mail
                                </a>
                                <Button
                                    variant="brand"
                                    size="sm"
                                    onClick={() => openPlanModal(intelData.user)}
                                    icon={<CreditCard className="h-3.5 w-3.5" />}
                                >
                                    Gerir Plano
                                </Button>
                            </div>
                        </div>

                        {/* 8-Point Journey Verification Checklist */}
                        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                            {[
                                {
                                    ok: intelData.user.journey.checklist.emailVerified,
                                    label: 'Conta Verificada',
                                    detail: intelData.user.emailVerified
                                        ? `${intelData.user.authProvider.toUpperCase()} · ${formatDateShort(intelData.user.emailVerifiedAt || intelData.user.createdAt)}`
                                        : 'Sem confirmação registada',
                                },
                                {
                                    ok: intelData.user.journey.checklist.hasLoggedIn,
                                    label: 'Fez Login',
                                    detail: `${intelData.user.behavior.loginCount} logins · ${intelData.user.behavior.sessionsCount} sessões`,
                                },
                                {
                                    ok: intelData.user.journey.checklist.completedOnboarding,
                                    label: 'Onboarding',
                                    detail: intelData.user.onboardingCompleted ? 'Questionário respondido' : 'Não concluído',
                                },
                                {
                                    ok: intelData.user.behavior.pageviewsCount > 0,
                                    label: 'Visitou Páginas',
                                    detail: `${intelData.user.behavior.pageviewsCount} views (${intelData.user.behavior.distinctPagesCount} rotas)`,
                                },
                                {
                                    ok: intelData.user.journey.checklist.clickedCta,
                                    label: 'Clicou em Botões/CTA',
                                    detail: `${intelData.user.behavior.clicksCount} clique(s) capturado(s)`,
                                },
                                {
                                    ok: intelData.user.journey.checklist.visitedPricingOrCheckout,
                                    label: 'Viu Planos/Checkout',
                                    detail: intelData.user.journey.checklist.visitedPricingOrCheckout
                                        ? 'Demonstrou intenção'
                                        : 'Ainda não visitou preços',
                                },
                                {
                                    ok: intelData.user.journey.checklist.importedTrades,
                                    label: 'Importou Trades',
                                    detail: `${intelData.user.behavior.importedTradesCount} trades · ${intelData.user.behavior.accountsCount} conta(s)`,
                                },
                                {
                                    ok: intelData.user.journey.checklist.convertedPaid,
                                    label: 'Converteu em Plano',
                                    detail: `${intelData.user.behavior.paymentsCount} pagamento(s) aprovado(s)`,
                                },
                            ].map((step) => (
                                <div
                                    key={step.label}
                                    className={cn(
                                        'rounded-xl border p-3 transition-colors',
                                        step.ok
                                            ? 'border-emerald-500/25 bg-emerald-500/5'
                                            : 'border-line bg-surface-2/30',
                                    )}
                                >
                                    <div className="flex items-center gap-1.5 text-xs font-semibold text-fg">
                                        {step.ok ? (
                                            <CheckCircle2 className="h-4 w-4 text-accent-fg shrink-0" />
                                        ) : (
                                            <XCircle className="h-4 w-4 text-fg-subtle shrink-0" />
                                        )}
                                        <span className="truncate">{step.label}</span>
                                    </div>
                                    <div className="mt-1 text-[11px] text-fg-muted truncate">{step.detail}</div>
                                </div>
                            ))}
                        </div>

                        {/* Actionable Recommendations for this User */}
                        {intelData.user.journey.recommendations.length > 0 && (
                            <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3.5 space-y-1.5">
                                <div className="flex items-center gap-2 text-xs font-bold text-amber-500 uppercase tracking-wider">
                                    <Sparkles className="h-3.5 w-3.5" /> Sugestões de Suporte & Ação Imediata
                                </div>
                                <ul className="space-y-1 text-xs text-fg">
                                    {intelData.user.journey.recommendations.map((rec, idx) => (
                                        <li key={idx} className="flex items-start gap-2">
                                            <span className="text-amber-500 mt-0.5">•</span>
                                            <span>{rec}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {/* Modal Inner Tabs */}
                        <div className="flex flex-wrap items-center gap-2 border-b border-line pb-3">
                            {[
                                { id: 'overview', label: 'Visão Geral, Origem & Importações', icon: Globe },
                                { id: 'behavior', label: 'Páginas, Cliques & E-mails', icon: MousePointerClick },
                                { id: 'timeline', label: `Linha Temporal (${intelData.timeline.length})`, icon: Activity },
                                { id: 'billing', label: 'Assinaturas, Pagamentos & Sessões', icon: KeyRound },
                            ].map((tab) => {
                                const Icon = tab.icon;
                                const active = intelTab === tab.id;
                                return (
                                    <button
                                        key={tab.id}
                                        type="button"
                                        onClick={() => setIntelTab(tab.id as any)}
                                        className={cn(
                                            'inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all',
                                            active
                                                ? 'border-accent bg-accent/15 text-accent-fg'
                                                : 'border-line bg-surface-2/40 text-fg-muted hover:text-fg hover:border-line-strong',
                                        )}
                                    >
                                        <Icon className="h-3.5 w-3.5" />
                                        {tab.label}
                                    </button>
                                );
                            })}
                        </div>

                        {/* TAB 1: OVERVIEW, ORIGIN & IMPORTS */}
                        {intelTab === 'overview' && (
                            <div className="space-y-5">
                                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                                    {/* Full Origin Card */}
                                    <div className="rounded-xl border border-line bg-surface-2/30 p-4 space-y-3">
                                        <h4 className="text-xs font-bold uppercase tracking-wider text-fg-muted flex items-center gap-2">
                                            <Compass className="h-4 w-4 text-accent-fg" /> Dados Completos de Origem & UTMs
                                        </h4>
                                        <div className="grid grid-cols-2 gap-2.5 text-xs">
                                            {[
                                                { k: 'Canal Classificado', v: intelData.user.origin.channelLabel },
                                                {
                                                    k: 'Taxa de Conversão do Canal',
                                                    v: `${intelData.user.originStats?.channelConversionRatePct ?? 0}% (${intelData.user.originStats?.channelConverted ?? 0}/${intelData.user.originStats?.channelUsers ?? 1})`,
                                                },
                                                { k: 'utm_source bruto', v: intelData.user.origin.rawSource || '—' },
                                                { k: 'utm_medium', v: intelData.user.origin.medium || '—' },
                                                { k: 'utm_campaign', v: intelData.user.origin.campaign || '—' },
                                                { k: 'utm_content / Criativo', v: intelData.user.origin.content || '—' },
                                                { k: 'utm_term / Intent', v: intelData.user.origin.term || '—' },
                                                {
                                                    k: 'Click ID',
                                                    v: intelData.user.origin.clickIdType
                                                        ? `${intelData.user.origin.clickIdType}: ${intelData.user.origin.clickId}`
                                                        : '—',
                                                },
                                                { k: 'Landing Path', v: intelData.user.origin.landingPath || '—' },
                                                { k: 'Referrer Host', v: intelData.user.origin.referrerHost || 'Direto' },
                                                { k: 'Visitor ID', v: intelData.user.visitorId || '—' },
                                                {
                                                    k: 'Uso de Ferramentas',
                                                    v: `Diário (${intelData.user.behavior.journalEntriesCount}) · Backtest (${intelData.user.behavior.backtestSessionsCount}) · IA (${intelData.user.behavior.aiSessionsCount})`,
                                                },
                                            ].map((row) => (
                                                <div key={row.k} className="rounded-lg border border-line bg-surface px-3 py-2">
                                                    <div className="text-[10px] text-fg-subtle uppercase">{row.k}</div>
                                                    <div className="mt-0.5 font-medium text-fg break-all">{row.v}</div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Accounts & Onboarding Survey */}
                                    <div className="space-y-4">
                                        <div className="rounded-xl border border-line bg-surface-2/30 p-4 space-y-3">
                                            <h4 className="text-xs font-bold uppercase tracking-wider text-fg-muted flex items-center gap-2">
                                                <Layers className="h-4 w-4 text-accent-fg" /> Contas de Trading ({intelData.accounts.length})
                                            </h4>
                                            {intelData.accounts.length === 0 ? (
                                                <p className="text-xs text-fg-subtle">Nenhuma conta MT5/Deriv configurada ainda.</p>
                                            ) : (
                                                <div className="space-y-2 max-h-[210px] overflow-y-auto">
                                                    {intelData.accounts.map((acc) => (
                                                        <div
                                                            key={acc.id}
                                                            className="flex items-center justify-between rounded-lg border border-line bg-surface px-3 py-2 text-xs"
                                                        >
                                                            <div>
                                                                <div className="font-semibold text-fg">
                                                                    {acc.name} · {acc.broker} ({acc.type})
                                                                </div>
                                                                <div className="text-[11px] text-fg-subtle">
                                                                    MT5: {acc.mt5Id || '—'} · Saldo: {Number(acc.balance || 0).toFixed(2)} {acc.currency}
                                                                </div>
                                                            </div>
                                                            <div className="text-right">
                                                                <AdminBadge tone={acc.isConnected ? 'success' : 'neutral'}>
                                                                    {acc.isConnected ? 'Conectada' : `${acc.tradesCount} trades`}
                                                                </AdminBadge>
                                                                <div className="text-[10px] text-fg-subtle mt-0.5">
                                                                    Visto {formatRelative(acc.lastSeen)}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>

                                        {intelData.user.surveyAnswers && (
                                            <div className="rounded-xl border border-line bg-surface-2/30 p-4 space-y-2">
                                                <h4 className="text-xs font-bold uppercase tracking-wider text-fg-muted flex items-center gap-2">
                                                    <UserCheck className="h-4 w-4 text-accent-fg" /> Respostas de Onboarding
                                                </h4>
                                                <pre className="rounded-lg border border-line bg-surface p-2.5 text-[11px] text-fg-muted overflow-x-auto max-h-[140px]">
                                                    {JSON.stringify(intelData.user.surveyAnswers, null, 2)}
                                                </pre>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Import Logs */}
                                <div className="rounded-xl border border-line bg-surface-2/30 p-4 space-y-3">
                                    <h4 className="text-xs font-bold uppercase tracking-wider text-fg-muted flex items-center gap-2">
                                        <FileSpreadsheet className="h-4 w-4 text-accent-fg" /> Registos de Importação de Trades ({intelData.importLogs.length})
                                    </h4>
                                    {intelData.importLogs.length === 0 ? (
                                        <p className="text-xs text-fg-subtle">Nenhuma tentativa de importação registada para esta conta.</p>
                                    ) : (
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-left text-xs">
                                                <thead>
                                                    <tr className="border-b border-line text-fg-subtle uppercase text-[10px]">
                                                        <th className="py-2 pr-3">Data</th>
                                                        <th className="py-2 pr-3">Método</th>
                                                        <th className="py-2 pr-3">Status</th>
                                                        <th className="py-2 pr-3">Trades</th>
                                                        <th className="py-2">Detalhes</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-line">
                                                    {intelData.importLogs.map((imp) => (
                                                        <tr key={imp.id}>
                                                            <td className="py-2 pr-3 whitespace-nowrap text-fg-muted">
                                                                {formatDateTime(imp.createdAt)}
                                                            </td>
                                                            <td className="py-2 pr-3 font-mono font-semibold text-fg">
                                                                {imp.method}
                                                            </td>
                                                            <td className="py-2 pr-3">
                                                                <AdminBadge
                                                                    tone={
                                                                        imp.status === 'SUCCESS'
                                                                            ? 'success'
                                                                            : imp.status === 'FAILED'
                                                                              ? 'danger'
                                                                              : 'warning'
                                                                    }
                                                                >
                                                                    {imp.status}
                                                                </AdminBadge>
                                                            </td>
                                                            <td className="py-2 pr-3 font-semibold tabular-nums text-fg">
                                                                {imp.tradesCount}
                                                            </td>
                                                            <td className="py-2 text-fg-muted truncate max-w-[300px]">
                                                                {imp.details || '—'}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* TAB 2: PAGES, CLICKS & EMAILS */}
                        {intelTab === 'behavior' && (
                            <div className="space-y-5">
                                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                                    <div className="rounded-xl border border-line bg-surface-2/30 p-4 space-y-3">
                                        <h4 className="text-xs font-bold uppercase tracking-wider text-fg-muted flex items-center gap-2">
                                            <BarChart3 className="h-4 w-4 text-accent-fg" /> Páginas Visitadas ({intelData.pageBreakdown.length})
                                        </h4>
                                        {intelData.pageBreakdown.length === 0 ? (
                                            <p className="text-xs text-fg-subtle">Nenhuma visualização de página associada ainda.</p>
                                        ) : (
                                            <div className="space-y-2 max-h-[280px] overflow-y-auto">
                                                {intelData.pageBreakdown.map((pg, idx) => (
                                                    <div
                                                        key={`${pg.pagePath}-${idx}`}
                                                        className="flex items-center justify-between rounded-lg border border-line bg-surface px-3 py-2 text-xs"
                                                    >
                                                        <div className="min-w-0">
                                                            <div className="font-mono font-semibold text-fg truncate">
                                                                {pg.pagePath}
                                                            </div>
                                                            {pg.pageTitle && (
                                                                <div className="text-[11px] text-fg-subtle truncate">
                                                                    {pg.pageTitle}
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div className="text-right shrink-0 ml-3">
                                                            <div className="font-bold text-accent-fg tabular-nums">
                                                                {pg.visits}x
                                                            </div>
                                                            <div className="text-[10px] text-fg-subtle">
                                                                {formatRelative(pg.lastVisitedAt)}
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    <div className="rounded-xl border border-line bg-surface-2/30 p-4 space-y-3">
                                        <h4 className="text-xs font-bold uppercase tracking-wider text-fg-muted flex items-center gap-2">
                                            <MousePointerClick className="h-4 w-4 text-accent-fg" /> Cliques em Botões & CTAs ({intelData.ctaBreakdown.length})
                                        </h4>
                                        {intelData.ctaBreakdown.length === 0 ? (
                                            <p className="text-xs text-fg-subtle">Nenhum clique de botão registado ainda.</p>
                                        ) : (
                                            <div className="space-y-2 max-h-[280px] overflow-y-auto">
                                                {intelData.ctaBreakdown.map((cta, idx) => (
                                                    <div
                                                        key={`${cta.ctaTag}-${idx}`}
                                                        className="flex items-center justify-between rounded-lg border border-line bg-surface px-3 py-2 text-xs"
                                                    >
                                                        <div className="min-w-0">
                                                            <div className="font-semibold text-fg truncate">
                                                                {cta.label || cta.ctaTag}
                                                            </div>
                                                            <div className="text-[11px] text-fg-subtle truncate">
                                                                {cta.pagePath || '—'} · tag: {cta.ctaTag}
                                                            </div>
                                                        </div>
                                                        <div className="text-right shrink-0 ml-3">
                                                            <div className="font-bold text-fg tabular-nums">
                                                                {cta.clicks} clique(s)
                                                            </div>
                                                            <div className="text-[10px] text-fg-subtle">
                                                                {formatRelative(cta.lastClickedAt)}
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="rounded-xl border border-line bg-surface-2/30 p-4 space-y-3">
                                    <h4 className="text-xs font-bold uppercase tracking-wider text-fg-muted flex items-center gap-2">
                                        <Mail className="h-4 w-4 text-accent-fg" /> E-mails Enviados & Taxa de Abertura ({intelData.emailLogs.length})
                                    </h4>
                                    {intelData.emailLogs.length === 0 ? (
                                        <p className="text-xs text-fg-subtle">Nenhum e-mail rastreado para este endereço.</p>
                                    ) : (
                                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                            {intelData.emailLogs.map((em) => (
                                                <div
                                                    key={em.id}
                                                    className="flex items-center justify-between rounded-lg border border-line bg-surface px-3 py-2 text-xs"
                                                >
                                                    <div className="min-w-0">
                                                        <div className="font-semibold text-fg truncate">
                                                            {em.subject || em.template}
                                                        </div>
                                                        <div className="text-[11px] text-fg-subtle">
                                                            Enviado {formatDateTime(em.sentAt)}
                                                        </div>
                                                    </div>
                                                    <div className="text-right shrink-0 ml-2">
                                                        <AdminBadge tone={em.openCount > 0 ? 'success' : 'neutral'}>
                                                            {em.openCount} abert. · {em.clickCount} cliq.
                                                        </AdminBadge>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* TAB 3: UNIFIED TIMELINE */}
                        {intelTab === 'timeline' && (
                            <div className="space-y-4">
                                <div className="flex flex-wrap items-center gap-1.5">
                                    {[
                                        { id: 'ALL', label: 'Todos' },
                                        { id: 'navigation', label: 'Páginas' },
                                        { id: 'click', label: 'Cliques' },
                                        { id: 'import', label: 'Importações' },
                                        { id: 'billing', label: 'Billing' },
                                        { id: 'auth', label: 'Auth/Segurança' },
                                        { id: 'email', label: 'E-mail' },
                                    ].map((cat) => (
                                        <button
                                            key={cat.id}
                                            type="button"
                                            onClick={() => setTimelineCategory(cat.id)}
                                            className={cn(
                                                'rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors',
                                                timelineCategory === cat.id
                                                    ? 'border-accent bg-accent/15 text-accent-fg'
                                                    : 'border-line bg-surface-2/40 text-fg-muted hover:text-fg',
                                            )}
                                        >
                                            {cat.label}
                                        </button>
                                    ))}
                                </div>

                                {filteredTimeline.length === 0 ? (
                                    <p className="text-xs text-fg-subtle py-4">Nenhum evento registado nesta categoria.</p>
                                ) : (
                                    <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
                                        {filteredTimeline.map((ev) => (
                                            <div
                                                key={ev.id}
                                                className="flex items-start justify-between gap-3 rounded-xl border border-line bg-surface-2/30 px-3.5 py-2.5 text-xs"
                                            >
                                                <div className="min-w-0 space-y-0.5">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <AdminBadge
                                                            tone={
                                                                ev.category === 'conversion' || ev.category === 'billing'
                                                                    ? 'success'
                                                                    : ev.category === 'import'
                                                                      ? 'info'
                                                                      : ev.category === 'click'
                                                                        ? 'accent'
                                                                        : 'neutral'
                                                            }
                                                        >
                                                            {ev.category}
                                                        </AdminBadge>
                                                        <span className="font-semibold text-fg">{ev.title}</span>
                                                    </div>
                                                    {(ev.detail || ev.path) && (
                                                        <div className="text-[11px] text-fg-subtle">
                                                            {ev.path && <span className="font-mono mr-2">{ev.path}</span>}
                                                            {ev.detail}
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="text-[11px] text-fg-muted whitespace-nowrap shrink-0">
                                                    {formatDateTime(ev.timestamp)}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* TAB 4: BILLING, SESSIONS & AUDIT */}
                        {intelTab === 'billing' && (
                            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                                <div className="rounded-xl border border-line bg-surface-2/30 p-4 space-y-3">
                                    <h4 className="text-xs font-bold uppercase tracking-wider text-fg-muted">
                                        Assinaturas & Pagamentos
                                    </h4>
                                    {intelData.payments.length === 0 && (intelData.user.subscriptions || []).length === 0 ? (
                                        <p className="text-xs text-fg-subtle">Nenhum movimento financeiro encontrado.</p>
                                    ) : (
                                        <div className="space-y-2 max-h-[300px] overflow-y-auto">
                                            {(intelData.user.subscriptions || []).map((s: any) => (
                                                <div
                                                    key={s.id}
                                                    className="flex items-center justify-between rounded-lg border border-line bg-surface px-3 py-2 text-xs"
                                                >
                                                    <div>
                                                        <div className="font-semibold text-fg">
                                                            Assinatura {s.planConfig?.tier || 'PLANO'} ({s.cycle})
                                                        </div>
                                                        <div className="text-[11px] text-fg-subtle">
                                                            Criada {formatDateShort(s.createdAt)} · Termo {formatDateShort(s.currentPeriodEnd)}
                                                        </div>
                                                    </div>
                                                    <AdminBadge
                                                        tone={
                                                            s.status === 'ACTIVE' || s.status === 'APPROVED'
                                                                ? 'success'
                                                                : s.status === 'EXPIRED' || s.status === 'CANCELLED'
                                                                  ? 'danger'
                                                                  : 'warning'
                                                        }
                                                    >
                                                        {s.status}
                                                    </AdminBadge>
                                                </div>
                                            ))}
                                            {intelData.payments.map((p) => (
                                                <div
                                                    key={p.id}
                                                    className="flex items-center justify-between rounded-lg border border-line bg-surface px-3 py-2 text-xs"
                                                >
                                                    <div>
                                                        <div className="font-semibold text-fg">
                                                            {p.produto} · {Number(p.preco || 0).toLocaleString('pt-MZ')} MZN
                                                        </div>
                                                        <div className="text-[11px] text-fg-subtle">
                                                            {p.vendaId} · {formatDateTime(p.dataHora || p.createdAt)}
                                                        </div>
                                                    </div>
                                                    <AdminBadge tone="info">{p.status}</AdminBadge>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div className="rounded-xl border border-line bg-surface-2/30 p-4 space-y-3">
                                    <h4 className="text-xs font-bold uppercase tracking-wider text-fg-muted">
                                        Sessões & Logins ({intelData.sessions.length})
                                    </h4>
                                    {intelData.sessions.length === 0 && intelData.auditLogs.length === 0 ? (
                                        <p className="text-xs text-fg-subtle">Nenhuma sessão ou log registado.</p>
                                    ) : (
                                        <div className="space-y-2 max-h-[300px] overflow-y-auto">
                                            {intelData.sessions.map((sess) => (
                                                <div
                                                    key={sess.id}
                                                    className="rounded-lg border border-line bg-surface px-3 py-2 text-xs space-y-0.5"
                                                >
                                                    <div className="flex items-center justify-between">
                                                        <span className="font-mono font-semibold text-fg">
                                                            IP: {sess.ipAddress || '—'}
                                                        </span>
                                                        <AdminBadge tone={sess.isActive ? 'success' : 'neutral'}>
                                                            {sess.isActive ? 'Sessão Ativa' : 'Encerrada'}
                                                        </AdminBadge>
                                                    </div>
                                                    <div className="text-[11px] text-fg-subtle truncate">
                                                        {sess.userAgent || 'Navegador não identificado'}
                                                    </div>
                                                    <div className="text-[10px] text-fg-muted">
                                                        Criada: {formatDateTime(sess.createdAt)}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </Modal>

            {/* ==================== PLAN MANAGEMENT MODAL ==================== */}
            <Modal
                isOpen={Boolean(planModalUser)}
                onClose={() => {
                    setPlanModalUser(null);
                    setPlanMessage(null);
                    setConfirmCancel(false);
                }}
                size="lg"
                title={`Gerir Plano · ${planModalUser?.name || planModalUser?.email || ''}`}
                subtitle={
                    planModalUser
                        ? `Status atual: ${planModalUser.plan.statusLabel}${planModalUser.plan.planTier ? ` (${planModalUser.plan.planTier})` : ''}`
                        : undefined
                }
            >
                {planModalUser && (
                    <form onSubmit={handlePlanSubmit} className="space-y-4">
                        {planMessage && (
                            <AdminBanner
                                tone={planMessage.type === 'success' ? 'success' : 'danger'}
                                message={planMessage.text}
                            />
                        )}

                        <div className="grid grid-cols-3 gap-2">
                            {(['ASSIGN', 'EXTEND', 'CANCEL'] as const).map((act) => (
                                <button
                                    key={act}
                                    type="button"
                                    onClick={() => {
                                        setActionType(act);
                                        setConfirmCancel(false);
                                    }}
                                    className={cn(
                                        'rounded-xl border px-3 py-2 text-xs font-semibold transition-all',
                                        actionType === act
                                            ? act === 'CANCEL'
                                                ? 'border-rose-500/40 bg-rose-500/15 text-danger-fg'
                                                : 'border-accent bg-accent/15 text-accent-fg'
                                            : 'border-line bg-surface-2/40 text-fg-muted hover:text-fg',
                                    )}
                                >
                                    {act === 'ASSIGN'
                                        ? 'Atribuir / Novo Plano'
                                        : act === 'EXTEND'
                                          ? 'Estender Dias'
                                          : 'Cancelar Plano'}
                                </button>
                            ))}
                        </div>

                        {actionType === 'ASSIGN' && (
                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-fg-muted block">
                                    Selecionar Plano
                                </label>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                    {availablePlans.map((p) => {
                                        const isSel = selectedPlanConfigId === p.id || selectedTier === p.tier;
                                        return (
                                            <button
                                                key={p.id}
                                                type="button"
                                                onClick={() => {
                                                    setSelectedPlanConfigId(p.id);
                                                    setSelectedTier(p.tier);
                                                }}
                                                className={cn(
                                                    'rounded-xl border px-3 py-2 text-left text-xs transition-all',
                                                    isSel
                                                        ? 'border-accent bg-accent/15 text-accent-fg'
                                                        : 'border-line bg-surface-2/40 text-fg-muted hover:text-fg',
                                                )}
                                            >
                                                <div className="font-bold">{p.tier}</div>
                                                <div className="text-[11px] opacity-80">
                                                    {Number(p.monthlyPrice || 0).toLocaleString('pt-MZ')} MT/mês
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {actionType !== 'CANCEL' && (
                            <div className="space-y-3">
                                <label className="text-xs font-semibold text-fg-muted block">
                                    Duração / Validade
                                </label>
                                <div className="flex flex-wrap gap-2">
                                    {[7, 15, 30, 90, 365].map((d) => (
                                        <button
                                            key={d}
                                            type="button"
                                            onClick={() => {
                                                setSelectedDays(d);
                                                setCustomDays('');
                                                setCustomDate('');
                                            }}
                                            className={cn(
                                                'rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors',
                                                !customDays && !customDate && selectedDays === d
                                                    ? 'border-accent bg-accent/15 text-accent-fg'
                                                    : 'border-line bg-surface-2/40 text-fg-muted hover:text-fg',
                                            )}
                                        >
                                            {d} dias
                                        </button>
                                    ))}
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-[11px] text-fg-subtle block mb-1">
                                            Dias personalizados
                                        </label>
                                        <input
                                            type="number"
                                            min={1}
                                            max={3650}
                                            value={customDays}
                                            onChange={(e) => {
                                                setCustomDays(e.target.value);
                                                if (e.target.value) setCustomDate('');
                                            }}
                                            placeholder="Ex: 45"
                                            className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-xs text-fg focus:outline-none focus:border-accent"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[11px] text-fg-subtle block mb-1">
                                            Ou data exata de término
                                        </label>
                                        <input
                                            type="date"
                                            value={customDate}
                                            onChange={(e) => {
                                                setCustomDate(e.target.value);
                                                if (e.target.value) setCustomDays('');
                                            }}
                                            className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-xs text-fg focus:outline-none focus:border-accent"
                                        />
                                    </div>
                                </div>

                                <div className="rounded-xl border border-line bg-surface-2/40 px-3 py-2 text-xs text-fg-muted flex items-center gap-2">
                                    <Calendar className="h-4 w-4 text-accent-fg shrink-0" />
                                    Nova validade projetada:{' '}
                                    <strong className="text-fg">
                                        {calculateProjectedDate()?.toLocaleDateString('pt-PT')}
                                    </strong>
                                </div>
                            </div>
                        )}

                        {actionType === 'CANCEL' && (
                            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-danger-fg space-y-2">
                                <div className="font-semibold">
                                    Atenção: cancelar removerá o acesso pago imediatamente e marcará o plano como encerrado.
                                </div>
                                {confirmCancel && (
                                    <div className="font-bold">
                                        Clique novamente em "Confirmar Cancelamento" para aplicar.
                                    </div>
                                )}
                            </div>
                        )}

                        <div>
                            <label className="text-xs font-semibold text-fg-muted block mb-1">
                                Motivo / Observação Administrativa
                            </label>
                            <input
                                type="text"
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                placeholder="Ex: Bónus suporte, renovação manual via M-Pesa..."
                                className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-xs text-fg focus:outline-none focus:border-accent"
                            />
                        </div>

                        <div className="flex justify-end gap-2 pt-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setPlanModalUser(null)}
                            >
                                Fechar
                            </Button>
                            <Button
                                type="submit"
                                variant={actionType === 'CANCEL' ? 'danger' : 'brand'}
                                size="sm"
                                isLoading={isSubmittingPlan}
                            >
                                {actionType === 'CANCEL'
                                    ? confirmCancel
                                        ? 'Confirmar Cancelamento'
                                        : 'Cancelar Plano'
                                    : actionType === 'EXTEND'
                                      ? 'Estender Prazo'
                                      : 'Atribuir Plano'}
                            </Button>
                        </div>
                    </form>
                )}
            </Modal>

            {/* ==================== SUBSCRIPTION HISTORY MODAL ==================== */}
            <Modal
                isOpen={Boolean(historyUser)}
                onClose={() => setHistoryUser(null)}
                size="lg"
                title={`Histórico de Assinaturas · ${historyUser?.name || historyUser?.email || ''}`}
            >
                {isLoadingHistory ? (
                    <AdminLoadingState label="Carregando assinaturas..." />
                ) : history.length === 0 ? (
                    <p className="text-xs text-fg-muted py-4 text-center">
                        Este usuário ainda não possui registos de assinatura.
                    </p>
                ) : (
                    <div className="space-y-2.5">
                        {history.map((sub: any) => (
                            <div
                                key={sub.id}
                                className="flex items-center justify-between rounded-xl border border-line bg-surface-2/40 px-4 py-3 text-xs"
                            >
                                <div className="space-y-0.5">
                                    <div className="font-bold text-fg">
                                        {sub.planConfig?.tier || 'PLANO'} · {sub.cycle}
                                    </div>
                                    <div className="text-fg-subtle">
                                        Início: {formatDateShort(sub.createdAt)} · Término:{' '}
                                        {formatDateShort(sub.currentPeriodEnd)} · Via {sub.paymentMethod || 'Manual'}
                                    </div>
                                </div>
                                <AdminBadge
                                    tone={
                                        sub.status === 'ACTIVE' || sub.status === 'APPROVED'
                                            ? 'success'
                                            : sub.status === 'EXPIRED' || sub.status === 'CANCELLED'
                                              ? 'danger'
                                              : 'warning'
                                    }
                                >
                                    {sub.status}
                                </AdminBadge>
                            </div>
                        ))}
                    </div>
                )}
            </Modal>
        </div>
    );
};
