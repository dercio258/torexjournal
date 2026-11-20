import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    BarElement,
    ArcElement,
    Title,
    Tooltip,
    Legend,
    Filler,
} from 'chart.js';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import {
    Activity,
    BarChart3,
    Bell,
    CheckCircle2,
    Database,
    Download,
    Eye,
    Filter,
    Gift,
    Globe,
    Mail,
    MousePointerClick,
    Radio,
    RefreshCw,
    Save,
    Search,
    ShieldCheck,
    Sparkles,
    Target,
    ThumbsDown,
    ThumbsUp,
    TrendingUp,
    UserCheck,
    Users,
} from 'lucide-react';
import api from '../../api';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { useChartTheme } from '../../hooks/useChartTheme';
import { AdminPageHeader } from './components/AdminPrimitives';
import { AiRejectedRepliesCard } from './components/AiRejectedRepliesCard';

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    BarElement,
    ArcElement,
    Title,
    Tooltip,
    Legend,
    Filler,
);

type TabKey =
    | 'overview'
    | 'sources'
    | 'pages'
    | 'buttons'
    | 'emails'
    | 'push_ctr'
    | 'referrals'
    | 'pixels'
    | 'torex_ai';

interface PushInsightsResponse {
    windowDays: number;
    summary: {
        activeSubscriptions: number;
        activeSubscribers: number;
        standaloneDevices: number;
        sent: number;
        clicked: number;
        dismissed: number;
        ignored: number;
        ctrPct: number;
        dismissRatePct: number;
        engagedDispatches: number;
        moderatedDispatches: number;
        fatiguePausedDispatches: number;
    };
    moderationUsers: {
        engaged: number;
        moderated: number;
        fatiguePaused: number;
    };
    byCategory: Array<{
        category: string;
        sent: number;
        clicked: number;
        dismissed: number;
        ignored: number;
        ctrPct: number;
    }>;
    timeline: Array<{
        day: string;
        sent: number;
        clicked: number;
        dismissed: number;
    }>;
}

interface ReferralAnalyticsResponse {
    windowDays: number;
    summary: {
        totalReferrals: number;
        verifiedReferrals: number;
        paidReferrals: number;
        conversionToPaidPct: number;
        totalCreditsIssuedUsd: number;
        tierBoostsUnlocked: number;
    };
    topAffiliates: Array<{
        userId: string;
        username: string;
        referralCode: string | null;
        creditsUsd: number;
        tierBoostUnlocked: boolean;
        totalInvited: number;
        verifiedCount: number;
        paidCount: number;
    }>;
    recentReferrals: Array<{
        id: string;
        referrerUsername: string;
        referredUsername: string;
        status: string;
        rewardCreditsUsd: number;
        tierBoostAwarded: boolean;
        createdAt: string;
    }>;
}

interface AiTrainingReportResponse {
    executiveSummary: {
        windowDays: number;
        generatedAtIso: string;
        totalAssistantMessages: number;
        layerBreakdown: Record<string, number>;
        zeroLlmResolutionRatePct: number;
        routerBypassRatePct: number;
        totalTokensUsed: number;
        estimatedTokensSaved: number;
        latencyMs: {
            routerP50: number;
            routerP95: number;
            analystP50: number;
            analystP95: number;
        };
    };
    feedbackSummary: {
        totalVotes: number;
        thumbsUp: number;
        thumbsDown: number;
        approvalRatePct: number;
        negativeReasons: Array<{ reasonCode: string; count: number }>;
    };
    blindSpots: Array<{
        sanitizedQuestion: string;
        locale: string;
        occurrences: number;
        thumbsDownCount: number;
        lowConfidenceCount: number;
        currentIntent: string;
        suggestedAction: string;
    }>;
    memoryAndSynonyms: {
        totalMemoryHits: number;
        totalLlmTokensSaved: number;
        activeSynonymsCount: number;
        topSynonyms: Array<{
            surfaceTerm: string;
            canonicalTerm: string;
            locale: string;
            coOccurrenceCount: number;
        }>;
    };
    securityAudit: {
        layer0BlocksCount: number;
        globalRowsWithUserIdCount: number;
        intentPatternsWithCachedReplyCount: number;
        quarantinedMemoriesCount: number;
        piiRedactionsInReport: number;
        dlpGuaranteeStatus: 'PASS' | 'WARN';
    };
    datasetsSummary: {
        sftRecords: number;
        ragQaRecords: number;
        dpoRecords: number;
        evalRecords: number;
    };
    recommendations: string[];
}

interface AiSemanticMemoryAdminItem {
    id: string;
    scopeLevel: string;
    status: 'CANDIDATE' | 'ACTIVE' | 'QUARANTINED' | 'RETIRED';
    domainCategory: string;
    locale: string;
    canonicalQuestion: string;
    hitCount: number;
    distinctPositiveUsers: number;
    positiveCount: number;
    negativeCount: number;
    trustScore: number;
}

interface OverviewResponse {
    windowDays: number;
    summary: {
        totalPageViews: number;
        uniqueVisitors: number;
        totalButtonClicks: number;
        registeredUsers: number;
        trackedSignups: number;
        checkoutStarted: number;
        trialsStarted: number;
        totalPurchases: number;
        totalRevenue: number;
        conversionRate: number;
        emailsSent: number;
        emailsOpened: number;
        totalOpens: number;
        emailOpenRate: number;
        emailsClicked: number;
        totalEmailClicks: number;
        emailCtr: number;
    };
    funnel: Array<{ step: string; count: number }>;
    timeline: Array<{
        date: string;
        pageViews: number;
        buttonClicks: number;
        signups: number;
        purchases: number;
        emailsSent: number;
        emailsOpened: number;
        emailsClicked: number;
    }>;
    topPages: Array<{
        pagePath: string;
        views: number;
        uniqueVisitors: number;
        buttonClicks: number;
        signups: number;
    }>;
    topButtons: Array<{
        ctaTag: string;
        elementLabel: string;
        intent: string | null;
        topPage: string;
        clicks: number;
        uniqueVisitors: number;
        attributedSignups: number;
    }>;
    topIntents: Array<{
        intent: string;
        clicks: number;
        uniqueVisitors: number;
    }>;
    utmSources: Array<{
        source: string;
        medium: string;
        pageViews: number;
        uniqueVisitors: number;
        buttonClicks: number;
        signups: number;
        purchases: number;
    }>;
    utmCampaigns: Array<{
        campaign: string;
        source: string;
        medium: string;
        pageViews: number;
        uniqueVisitors: number;
        buttonClicks: number;
        signups: number;
    }>;
    deviceBreakdown: Array<{
        deviceType: string;
        visitors: number;
        events: number;
    }>;
    emailStats: {
        byTemplate: Array<{
            template: string;
            utmMedium: string;
            sent: number;
            uniqueOpens: number;
            totalOpens: number;
            openRate: number;
            uniqueClicks: number;
            totalClicks: number;
            ctr: number;
        }>;
        byBroadcast: Array<{
            broadcastId: string;
            subject: string;
            sent: number;
            uniqueOpens: number;
            openRate: number;
            uniqueClicks: number;
            ctr: number;
        }>;
    };
    recentEvents: Array<{
        id: string;
        event_name: string;
        event_type: string;
        visitor_id: string;
        user_id: string | null;
        page_path: string | null;
        element_label: string | null;
        cta_tag: string | null;
        intent: string | null;
        utm_source: string | null;
        utm_campaign: string | null;
        device_type: string | null;
        created_at: string;
    }>;
}

interface UserSourcesResponse {
    windowDays: number;
    bySource: Array<{
        source: string;
        usersCount: number;
        paidUsersCount: number;
        conversionRate: number;
    }>;
    byCampaign: Array<{
        campaign: string;
        source: string;
        medium: string;
        usersCount: number;
        paidUsersCount: number;
    }>;
    byCtaTag: Array<{
        ctaTag: string;
        intent: string;
        usersCount: number;
    }>;
    byLandingPath: Array<{
        landingPath: string;
        usersCount: number;
    }>;
    byReferrer: Array<{
        referrer: string;
        usersCount: number;
    }>;
    users: Array<{
        id: string;
        email: string;
        name: string | null;
        acquisition_source: string;
        acquisition_medium: string | null;
        acquisition_campaign: string | null;
        acquisition_content: string | null;
        acquisition_term: string | null;
        landing_path: string | null;
        referrer: string | null;
        preferred_locale: string;
        created_at: string;
        subscription_status: string | null;
    }>;
}

interface PixelConfigResponse {
    metaPixelId: string;
    hasMetaCapiAccessToken: boolean;
    metaCapiAccessTokenPreview: string;
    ga4MeasurementId: string;
    gtmContainerId: string;
    tiktokPixelId: string;
    utmifyPixelId: string;
    enableFirstPartyTracking: boolean;
    enableEmailTracking: boolean;
    enableCtaAutoTracking: boolean;
    customHeadScript: string;
    updatedAt?: string;
}

const TABS: Array<{ key: TabKey; label: string; icon: any }> = [
    { key: 'overview', label: 'Visão Geral & Funil', icon: BarChart3 },
    { key: 'sources', label: 'Origem dos Usuários', icon: Globe },
    { key: 'pages', label: 'Páginas Totais', icon: Eye },
    { key: 'buttons', label: 'Botões & Intenções', icon: MousePointerClick },
    { key: 'emails', label: 'E-mails & CTR', icon: Mail },
    { key: 'push_ctr', label: 'Push & Moderação CTR', icon: Bell },
    { key: 'referrals', label: 'Afiliados & Crescimento', icon: Gift },
    { key: 'pixels', label: 'Pixels & Eventos ao Vivo', icon: Radio },
    { key: 'torex_ai', label: 'Torex AI — Treino & Memória', icon: Sparkles },
];

export const AdminAnalytics = () => {
    const chartTheme = useChartTheme();
    const [activeTab, setActiveTab] = useState<TabKey>('overview');
    const [days, setDays] = useState<number>(30);
    const [utmSourceFilter, setUtmSourceFilter] = useState<string>('');
    const [deviceFilter, setDeviceFilter] = useState<string>('');
    const [userSearch, setUserSearch] = useState<string>('');

    const [overview, setOverview] = useState<OverviewResponse | null>(null);
    const [userSources, setUserSources] = useState<UserSourcesResponse | null>(null);
    const [pixelConfig, setPixelConfig] = useState<PixelConfigResponse | null>(null);
    const [metaCapiInput, setMetaCapiInput] = useState<string>('');

    const [loading, setLoading] = useState<boolean>(true);
    const [savingPixels, setSavingPixels] = useState<boolean>(false);
    const [pixelNotice, setPixelNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
    const [aiReport, setAiReport] = useState<AiTrainingReportResponse | null>(null);
    const [aiMemories, setAiMemories] = useState<AiSemanticMemoryAdminItem[]>([]);
    const [aiLoading, setAiLoading] = useState<boolean>(false);
    const [exportingFormat, setExportingFormat] = useState<string | null>(null);
    const [reviewingMemId, setReviewingMemId] = useState<string | null>(null);
    const [pushInsights, setPushInsights] = useState<PushInsightsResponse | null>(null);
    const [referralInsights, setReferralInsights] = useState<ReferralAnalyticsResponse | null>(null);
    const [growthLoading, setGrowthLoading] = useState<boolean>(false);

    const fetchAll = useCallback(async () => {
        setLoading(true);
        try {
            const [ovRes, usRes, pxRes] = await Promise.all([
                api.get<OverviewResponse>('/admin/analytics/overview', {
                    params: {
                        days,
                        ...(utmSourceFilter ? { utmSource: utmSourceFilter } : {}),
                        ...(deviceFilter ? { deviceType: deviceFilter } : {}),
                    },
                }),
                api.get<UserSourcesResponse>('/admin/analytics/users-sources', {
                    params: {
                        days,
                        ...(utmSourceFilter ? { source: utmSourceFilter } : {}),
                        ...(userSearch ? { search: userSearch } : {}),
                    },
                }),
                api.get<PixelConfigResponse>('/admin/analytics/pixels'),
            ]);
            setOverview(ovRes.data);
            setUserSources(usRes.data);
            setPixelConfig(pxRes.data);
        } catch (err) {
            console.error('Failed to load analytics:', err);
        } finally {
            setLoading(false);
        }
    }, [days, utmSourceFilter, deviceFilter, userSearch]);

    useEffect(() => {
        void fetchAll();
    }, [fetchAll]);

    const fetchAiTrainingData = useCallback(async () => {
        setAiLoading(true);
        try {
            const [repRes, memRes] = await Promise.all([
                api.get<AiTrainingReportResponse>('/admin/ai/training-report', {
                    params: { days },
                }),
                api.get<{ items: AiSemanticMemoryAdminItem[] }>('/admin/ai/semantic-memory', {
                    params: { limit: 40 },
                }),
            ]);
            setAiReport(repRes.data);
            setAiMemories(memRes.data?.items || []);
        } catch (err) {
            console.error('Failed to load Torex AI training report:', err);
        } finally {
            setAiLoading(false);
        }
    }, [days]);

    useEffect(() => {
        if (activeTab === 'torex_ai') {
            void fetchAiTrainingData();
        }
    }, [activeTab, fetchAiTrainingData]);

    const fetchPushAndReferrals = useCallback(async () => {
        setGrowthLoading(true);
        try {
            const [pushRes, refRes] = await Promise.all([
                api.get<PushInsightsResponse>('/admin/analytics/push-insights', { params: { days } }),
                api.get<ReferralAnalyticsResponse>('/admin/analytics/referrals', { params: { days } }),
            ]);
            setPushInsights(pushRes.data);
            setReferralInsights(refRes.data);
        } catch (err) {
            console.error('Failed to load push/referral insights:', err);
        } finally {
            setGrowthLoading(false);
        }
    }, [days]);

    useEffect(() => {
        if (activeTab === 'push_ctr' || activeTab === 'referrals') {
            void fetchPushAndReferrals();
        }
    }, [activeTab, fetchPushAndReferrals]);

    const handleDownloadAiArtifact = async (
        format: 'markdown' | 'json' | 'sft_jsonl' | 'rag_qa_jsonl' | 'dpo_jsonl' | 'eval_jsonl',
    ) => {
        setExportingFormat(format);
        try {
            const res = await api.get<{
                filename: string;
                mimeType: string;
                content: string;
            }>('/admin/ai/training-report/export', {
                params: { format, days },
            });
            const blob = new Blob([res.data.content || ''], {
                type: res.data.mimeType || 'text/plain;charset=utf-8',
            });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = res.data.filename || `torex-ai-${format}.txt`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Failed to export Torex AI artifact:', err);
        } finally {
            setExportingFormat(null);
        }
    };

    const handleReviewMemory = async (
        id: string,
        action: 'APPROVE' | 'QUARANTINE' | 'RETIRE',
    ) => {
        setReviewingMemId(id);
        try {
            await api.post(`/admin/ai/semantic-memory/${id}/review`, { action });
            await fetchAiTrainingData();
        } catch (err) {
            console.error('Failed to review memory:', err);
        } finally {
            setReviewingMemId(null);
        }
    };

    const handleSavePixels = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!pixelConfig) return;
        setSavingPixels(true);
        setPixelNotice(null);
        try {
            const payload: Record<string, any> = {
                metaPixelId: pixelConfig.metaPixelId,
                ga4MeasurementId: pixelConfig.ga4MeasurementId,
                gtmContainerId: pixelConfig.gtmContainerId,
                tiktokPixelId: pixelConfig.tiktokPixelId,
                utmifyPixelId: pixelConfig.utmifyPixelId,
                enableFirstPartyTracking: pixelConfig.enableFirstPartyTracking,
                enableEmailTracking: pixelConfig.enableEmailTracking,
                enableCtaAutoTracking: pixelConfig.enableCtaAutoTracking,
                customHeadScript: pixelConfig.customHeadScript,
            };
            if (metaCapiInput.trim()) {
                payload.metaCapiAccessToken = metaCapiInput.trim();
            }
            const res = await api.put<PixelConfigResponse>('/admin/analytics/pixels', payload);
            setPixelConfig(res.data);
            setMetaCapiInput('');
            setPixelNotice({ type: 'ok', text: 'Pixels e configurações de rastreamento salvos com sucesso!' });
        } catch {
            setPixelNotice({ type: 'err', text: 'Erro ao salvar configuração de pixels.' });
        } finally {
            setSavingPixels(false);
        }
    };

    const commonChartOptions = useMemo(
        () => ({
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: {
                        color: chartTheme.label,
                        boxWidth: 12,
                        font: { size: 11 },
                    },
                },
                tooltip: {
                    backgroundColor: chartTheme.tooltipBg,
                    borderColor: chartTheme.tooltipBorder,
                    borderWidth: 1,
                    titleColor: chartTheme.tooltipTitle,
                    bodyColor: chartTheme.tooltipBody,
                },
            },
            scales: {
                x: {
                    ticks: { color: chartTheme.tick, font: { size: 11 } },
                    grid: { color: chartTheme.grid },
                },
                y: {
                    beginAtZero: true,
                    ticks: { color: chartTheme.tick, font: { size: 11 } },
                    grid: { color: chartTheme.grid },
                },
            },
        }),
        [chartTheme],
    );

    const timelineChartData = useMemo(() => {
        const rows = overview?.timeline || [];
        return {
            labels: rows.map((r) => r.date),
            datasets: [
                {
                    label: 'Pageviews',
                    data: rows.map((r) => r.pageViews),
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.14)',
                    tension: 0.35,
                    fill: true,
                },
                {
                    label: 'Cliques em Botões',
                    data: rows.map((r) => r.buttonClicks),
                    borderColor: '#6366f1',
                    backgroundColor: 'rgba(99, 102, 241, 0.10)',
                    tension: 0.35,
                    fill: false,
                },
                {
                    label: 'Cadastros',
                    data: rows.map((r) => r.signups),
                    borderColor: '#f59e0b',
                    backgroundColor: 'rgba(245, 158, 11, 0.12)',
                    tension: 0.35,
                    fill: false,
                },
                {
                    label: 'Aberturas Email',
                    data: rows.map((r) => r.emailsOpened),
                    borderColor: '#06b6d4',
                    backgroundColor: 'rgba(6, 182, 212, 0.10)',
                    tension: 0.35,
                    fill: false,
                },
            ],
        };
    }, [overview]);

    const funnelChartData = useMemo(() => {
        const rows = overview?.funnel || [];
        return {
            labels: rows.map((r) => r.step),
            datasets: [
                {
                    label: 'Volume no Funil',
                    data: rows.map((r) => r.count),
                    backgroundColor: ['#10b981', '#6366f1', '#f59e0b', '#06b6d4', '#ec4899'],
                    borderRadius: 8,
                },
            ],
        };
    }, [overview]);

    const devicesChartData = useMemo(() => {
        const rows = overview?.deviceBreakdown || [];
        return {
            labels: rows.map((r) => r.deviceType),
            datasets: [
                {
                    data: rows.map((r) => r.visitors),
                    backgroundColor: ['#10b981', '#6366f1', '#f59e0b', '#64748b'],
                    borderWidth: 0,
                },
            ],
        };
    }, [overview]);

    const userSourcesChartData = useMemo(() => {
        const rows = (userSources?.bySource || []).slice(0, 10);
        return {
            labels: rows.map((r) => r.source),
            datasets: [
                {
                    label: 'Usuários Cadastrados',
                    data: rows.map((r) => r.usersCount),
                    backgroundColor: '#6366f1',
                    borderRadius: 6,
                },
                {
                    label: 'Assinantes Pagos',
                    data: rows.map((r) => r.paidUsersCount),
                    backgroundColor: '#10b981',
                    borderRadius: 6,
                },
            ],
        };
    }, [userSources]);

    const topPagesChartData = useMemo(() => {
        const rows = (overview?.topPages || []).slice(0, 10);
        return {
            labels: rows.map((r) => r.pagePath),
            datasets: [
                {
                    label: 'Visualizações',
                    data: rows.map((r) => r.views),
                    backgroundColor: '#10b981',
                    borderRadius: 6,
                },
                {
                    label: 'Cliques em CTAs',
                    data: rows.map((r) => r.buttonClicks),
                    backgroundColor: '#6366f1',
                    borderRadius: 6,
                },
            ],
        };
    }, [overview]);

    const topButtonsChartData = useMemo(() => {
        const rows = (overview?.topButtons || []).slice(0, 10);
        return {
            labels: rows.map((r) => r.ctaTag),
            datasets: [
                {
                    label: 'Cliques Totais',
                    data: rows.map((r) => r.clicks),
                    backgroundColor: '#6366f1',
                    borderRadius: 6,
                },
                {
                    label: 'Cadastros Atribuídos',
                    data: rows.map((r) => r.attributedSignups),
                    backgroundColor: '#10b981',
                    borderRadius: 6,
                },
            ],
        };
    }, [overview]);

    const emailTimelineChartData = useMemo(() => {
        const rows = overview?.timeline || [];
        return {
            labels: rows.map((r) => r.date),
            datasets: [
                {
                    label: 'Enviados',
                    data: rows.map((r) => r.emailsSent),
                    borderColor: '#64748b',
                    backgroundColor: 'rgba(100,116,139,0.12)',
                    tension: 0.3,
                },
                {
                    label: 'Abertos',
                    data: rows.map((r) => r.emailsOpened),
                    borderColor: '#06b6d4',
                    backgroundColor: 'rgba(6,182,212,0.14)',
                    tension: 0.3,
                    fill: true,
                },
                {
                    label: 'Clicados',
                    data: rows.map((r) => r.emailsClicked),
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16,185,129,0.15)',
                    tension: 0.3,
                },
            ],
        };
    }, [overview]);

    const availableSourceOptions = useMemo(() => {
        const set = new Set<string>();
        overview?.utmSources?.forEach((s) => s.source && set.add(s.source));
        userSources?.bySource?.forEach((s) => s.source && set.add(s.source));
        return Array.from(set);
    }, [overview, userSources]);

    const s = overview?.summary;

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            <AdminPageHeader
                badge="Governança & Inteligência"
                title="Analytics, UTMs, Pixels & E-mails"
                subtitle="Rastreamento completo de tráfego, cliques em CTAs, atribuição dos cadastros e desempenho de e-mails."
                icon={<Activity className="h-5 w-5" />}
                actions={
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="flex items-center gap-1.5 bg-surface border border-line rounded-xl px-3 py-1.5 text-xs">
                            <Filter className="w-3.5 h-3.5 text-fg-subtle" />
                            <select
                                value={days}
                                onChange={(e) => setDays(Number(e.target.value))}
                                className="bg-transparent text-fg font-medium focus:outline-none"
                            >
                                <option value={7}>Últimos 7 dias</option>
                                <option value={14}>Últimos 14 dias</option>
                                <option value={30}>Últimos 30 dias</option>
                                <option value={90}>Últimos 90 dias</option>
                                <option value={365}>Último ano</option>
                            </select>
                        </div>

                        <select
                            value={utmSourceFilter}
                            onChange={(e) => setUtmSourceFilter(e.target.value)}
                            className="bg-surface border border-line rounded-xl px-3 py-1.5 text-xs text-fg focus:outline-none"
                        >
                            <option value="">Todas as fontes UTM</option>
                            {availableSourceOptions.map((src) => (
                                <option key={src} value={src}>
                                    Fonte: {src}
                                </option>
                            ))}
                        </select>

                        <select
                            value={deviceFilter}
                            onChange={(e) => setDeviceFilter(e.target.value)}
                            className="bg-surface border border-line rounded-xl px-3 py-1.5 text-xs text-fg focus:outline-none"
                        >
                            <option value="">Todos dispositivos</option>
                            <option value="desktop">Desktop</option>
                            <option value="mobile">Mobile</option>
                            <option value="tablet">Tablet</option>
                        </select>

                        <Button
                            variant="outline"
                            size="sm"
                            onClick={fetchAll}
                            isLoading={loading}
                            icon={<RefreshCw className="w-3.5 h-3.5" />}
                        >
                            Atualizar
                        </Button>
                    </div>
                }
            />

            {/* KPI Summary Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
                <Card className="p-4 border-line bg-surface/60">
                    <div className="text-[11px] text-fg-subtle font-medium">Pageviews</div>
                    <div className="text-xl font-bold text-fg mt-1">{(s?.totalPageViews ?? 0).toLocaleString()}</div>
                    <div className="text-[11px] text-accent-fg mt-0.5">{(s?.uniqueVisitors ?? 0).toLocaleString()} únicos</div>
                </Card>
                <Card className="p-4 border-line bg-surface/60">
                    <div className="text-[11px] text-fg-subtle font-medium">Cliques Botões/CTA</div>
                    <div className="text-xl font-bold text-indigo-400 mt-1">{(s?.totalButtonClicks ?? 0).toLocaleString()}</div>
                    <div className="text-[11px] text-fg-muted mt-0.5">{overview?.topButtons?.length ?? 0} tags ativas</div>
                </Card>
                <Card className="p-4 border-line bg-surface/60">
                    <div className="text-[11px] text-fg-subtle font-medium">Cadastros</div>
                    <div className="text-xl font-bold text-amber-400 mt-1">{(s?.registeredUsers ?? 0).toLocaleString()}</div>
                    <div className="text-[11px] text-fg-muted mt-0.5">Conv. {s?.conversionRate ?? 0}%</div>
                </Card>
                <Card className="p-4 border-line bg-surface/60">
                    <div className="text-[11px] text-fg-subtle font-medium">Checkouts / Trials</div>
                    <div className="text-xl font-bold text-cyan-400 mt-1">
                        {(s?.checkoutStarted ?? 0) + (s?.trialsStarted ?? 0)}
                    </div>
                    <div className="text-[11px] text-fg-muted mt-0.5">
                        {s?.trialsStarted ?? 0} trials · {s?.checkoutStarted ?? 0} checkouts
                    </div>
                </Card>
                <Card className="p-4 border-line bg-surface/60">
                    <div className="text-[11px] text-fg-subtle font-medium">Compras Pagas</div>
                    <div className="text-xl font-bold text-emerald-400 mt-1">{(s?.totalPurchases ?? 0).toLocaleString()}</div>
                    <div className="text-[11px] text-emerald-300 mt-0.5">
                        ${(s?.totalRevenue ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                </Card>
                <Card className="p-4 border-line bg-surface/60">
                    <div className="text-[11px] text-fg-subtle font-medium">E-mails Enviados</div>
                    <div className="text-xl font-bold text-fg mt-1">{(s?.emailsSent ?? 0).toLocaleString()}</div>
                    <div className="text-[11px] text-fg-muted mt-0.5">{s?.emailsOpened ?? 0} aberturas</div>
                </Card>
                <Card className="p-4 border-line bg-surface/60">
                    <div className="text-[11px] text-fg-subtle font-medium">Taxa Abertura Email</div>
                    <div className="text-xl font-bold text-sky-400 mt-1">{s?.emailOpenRate ?? 0}%</div>
                    <div className="text-[11px] text-fg-muted mt-0.5">{s?.totalOpens ?? 0} aberturas totais</div>
                </Card>
                <Card className="p-4 border-line bg-surface/60">
                    <div className="text-[11px] text-fg-subtle font-medium">Email CTR (Cliques)</div>
                    <div className="text-xl font-bold text-pink-400 mt-1">{s?.emailCtr ?? 0}%</div>
                    <div className="text-[11px] text-fg-muted mt-0.5">{s?.totalEmailClicks ?? 0} cliques totais</div>
                </Card>
            </div>

            {/* Sub-navigation Tabs */}
            <div className="flex flex-wrap gap-2 border-b border-line pb-3">
                {TABS.map((tab) => {
                    const Icon = tab.icon;
                    const active = activeTab === tab.key;
                    return (
                        <button
                            key={tab.key}
                            type="button"
                            onClick={() => setActiveTab(tab.key)}
                            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
                                active
                                    ? 'bg-accent text-accent-on shadow-sm'
                                    : 'bg-surface border border-line text-fg-muted hover:text-fg hover:bg-surface-2'
                            }`}
                        >
                            <Icon className="w-4 h-4" />
                            <span>{tab.label}</span>
                        </button>
                    );
                })}
            </div>

            {/* TAB 1: OVERVIEW & FUNNEL */}
            {activeTab === 'overview' && (
                <div className="space-y-6">
                    <div className="grid lg:grid-cols-3 gap-6">
                        <Card className="lg:col-span-2 p-6 border-line bg-surface/50">
                            <h3 className="text-base font-bold text-fg mb-4 flex items-center gap-2">
                                <TrendingUp className="w-4 h-4 text-accent-fg" />
                                Evolução Diária (Tráfego, Cliques CTA, Cadastros & E-mail)
                            </h3>
                            <div className="h-72">
                                <Line data={timelineChartData} options={commonChartOptions} />
                            </div>
                        </Card>

                        <Card className="p-6 border-line bg-surface/50">
                            <h3 className="text-base font-bold text-fg mb-4 flex items-center gap-2">
                                <Target className="w-4 h-4 text-indigo-400" />
                                Funil de Conversão Total
                            </h3>
                            <div className="h-72">
                                <Bar data={funnelChartData} options={commonChartOptions} />
                            </div>
                        </Card>
                    </div>

                    <div className="grid lg:grid-cols-3 gap-6">
                        <Card className="p-6 border-line bg-surface/50">
                            <h3 className="text-base font-bold text-fg mb-4">Dispositivos dos Visitantes</h3>
                            <div className="h-60 flex items-center justify-center">
                                {(overview?.deviceBreakdown?.length ?? 0) > 0 ? (
                                    <Doughnut
                                        data={devicesChartData}
                                        options={{
                                            responsive: true,
                                            maintainAspectRatio: false,
                                            plugins: { legend: { labels: { color: chartTheme.label } } },
                                        }}
                                    />
                                ) : (
                                    <p className="text-xs text-fg-subtle">Sem eventos registrados no período.</p>
                                )}
                            </div>
                        </Card>

                        <Card className="lg:col-span-2 p-6 border-line bg-surface/50 overflow-hidden">
                            <h3 className="text-base font-bold text-fg mb-4">Desempenho por Fonte & Meio (UTM)</h3>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-xs text-fg-muted">
                                    <thead className="border-b border-line text-fg uppercase">
                                        <tr>
                                            <th className="py-2.5 pr-4">utm_source</th>
                                            <th className="py-2.5 pr-4">utm_medium</th>
                                            <th className="py-2.5 pr-4">Visitantes</th>
                                            <th className="py-2.5 pr-4">Pageviews</th>
                                            <th className="py-2.5 pr-4">Cliques CTA</th>
                                            <th className="py-2.5 pr-4">Cadastros</th>
                                            <th className="py-2.5">Compras</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-line">
                                        {(overview?.utmSources || []).map((row, idx) => (
                                            <tr key={`${row.source}-${row.medium}-${idx}`}>
                                                <td className="py-2.5 pr-4 font-semibold text-fg">{row.source}</td>
                                                <td className="py-2.5 pr-4">{row.medium}</td>
                                                <td className="py-2.5 pr-4 font-mono">{row.uniqueVisitors}</td>
                                                <td className="py-2.5 pr-4 font-mono">{row.pageViews}</td>
                                                <td className="py-2.5 pr-4 font-mono text-indigo-400">{row.buttonClicks}</td>
                                                <td className="py-2.5 pr-4 font-mono text-amber-400">{row.signups}</td>
                                                <td className="py-2.5 font-mono text-emerald-400">{row.purchases}</td>
                                            </tr>
                                        ))}
                                        {(overview?.utmSources?.length ?? 0) === 0 && (
                                            <tr>
                                                <td colSpan={7} className="py-6 text-center text-fg-subtle">
                                                    Nenhum tráfego UTM registrado ainda.
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </Card>
                    </div>
                </div>
            )}

            {/* TAB 2: REGISTERED USER ACQUISITION SOURCES */}
            {activeTab === 'sources' && (
                <div className="space-y-6">
                    <div className="grid lg:grid-cols-2 gap-6">
                        <Card className="p-6 border-line bg-surface/50">
                            <h3 className="text-base font-bold text-fg mb-4 flex items-center gap-2">
                                <UserCheck className="w-4 h-4 text-accent-fg" />
                                Usuários Cadastrados por Origem ("De onde eles vêm")
                            </h3>
                            <div className="h-72">
                                <Bar data={userSourcesChartData} options={commonChartOptions} />
                            </div>
                        </Card>

                        <Card className="p-6 border-line bg-surface/50 overflow-hidden">
                            <h3 className="text-base font-bold text-fg mb-4">Top Campanhas & Botões que Geraram Cadastros</h3>
                            <div className="grid sm:grid-cols-2 gap-4">
                                <div>
                                    <div className="text-xs font-semibold text-fg-subtle uppercase mb-2">Campanhas</div>
                                    <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                                        {(userSources?.byCampaign || []).map((c, idx) => (
                                            <div key={idx} className="flex items-center justify-between text-xs p-2 rounded-lg bg-surface border border-line">
                                                <div className="truncate pr-2">
                                                    <div className="font-semibold text-fg truncate">{c.campaign}</div>
                                                    <div className="text-[11px] text-fg-subtle">{c.source} / {c.medium}</div>
                                                </div>
                                                <span className="font-mono font-bold text-accent-fg">{c.usersCount}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-xs font-semibold text-fg-subtle uppercase mb-2">Botão / Tag CTA de Entrada</div>
                                    <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                                        {(userSources?.byCtaTag || []).map((t, idx) => (
                                            <div key={idx} className="flex items-center justify-between text-xs p-2 rounded-lg bg-surface border border-line">
                                                <div className="truncate pr-2">
                                                    <div className="font-semibold text-fg truncate">{t.ctaTag}</div>
                                                    <div className="text-[11px] text-fg-subtle">Intenção: {t.intent}</div>
                                                </div>
                                                <span className="font-mono font-bold text-indigo-400">{t.usersCount}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </Card>
                    </div>

                    <Card className="p-6 border-line bg-surface/50">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                            <h3 className="text-base font-bold text-fg flex items-center gap-2">
                                <Users className="w-4 h-4 text-blue-400" />
                                Últimos Usuários Cadastrados com Atribuição UTM
                            </h3>
                            <div className="relative w-full sm:w-64">
                                <Search className="w-4 h-4 text-fg-subtle absolute left-3 top-1/2 -translate-y-1/2" />
                                <input
                                    type="text"
                                    placeholder="Filtrar email, nome ou campanha..."
                                    value={userSearch}
                                    onChange={(e) => setUserSearch(e.target.value)}
                                    className="w-full pl-9 pr-3 py-1.5 bg-surface border border-line rounded-xl text-xs text-fg focus:outline-none focus:border-accent"
                                />
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs text-fg-muted">
                                <thead className="border-b border-line text-fg uppercase">
                                    <tr>
                                        <th className="py-2.5 pr-4">Usuário</th>
                                        <th className="py-2.5 pr-4">Fonte (utm_source)</th>
                                        <th className="py-2.5 pr-4">Meio / Campanha</th>
                                        <th className="py-2.5 pr-4">Botão Clicado (CTA)</th>
                                        <th className="py-2.5 pr-4">Intenção</th>
                                        <th className="py-2.5 pr-4">Landing Page / Referrer</th>
                                        <th className="py-2.5">Data</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-line">
                                    {(userSources?.users || []).map((u) => (
                                        <tr key={u.id}>
                                            <td className="py-2.5 pr-4">
                                                <div className="font-semibold text-fg">{u.name || 'Sem nome'}</div>
                                                <div className="text-[11px] text-fg-subtle">{u.email}</div>
                                            </td>
                                            <td className="py-2.5 pr-4">
                                                <span className="inline-flex px-2 py-0.5 rounded-full bg-accent/10 border border-accent/25 text-accent-fg font-semibold">
                                                    {u.acquisition_source || 'direct'}
                                                </span>
                                            </td>
                                            <td className="py-2.5 pr-4">
                                                <div>{u.acquisition_campaign || '-'}</div>
                                                <div className="text-[11px] text-fg-subtle">{u.acquisition_medium || '-'}</div>
                                            </td>
                                            <td className="py-2.5 pr-4 font-mono text-indigo-400">
                                                {u.acquisition_content || '-'}
                                            </td>
                                            <td className="py-2.5 pr-4 text-amber-400">
                                                {u.acquisition_term || '-'}
                                            </td>
                                            <td className="py-2.5 pr-4 max-w-[200px] truncate">
                                                <div className="truncate">{u.landing_path || '/'}</div>
                                                <div className="text-[11px] text-fg-subtle truncate">{u.referrer || 'Direto'}</div>
                                            </td>
                                            <td className="py-2.5 whitespace-nowrap">
                                                {new Date(u.created_at).toLocaleDateString('pt-PT')}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </Card>
                </div>
            )}

            {/* TAB 3: TOTAL PAGES ANALYTICS */}
            {activeTab === 'pages' && (
                <div className="space-y-6">
                    <Card className="p-6 border-line bg-surface/50">
                        <h3 className="text-base font-bold text-fg mb-4">Top Páginas: Visualizações vs Cliques em Botões</h3>
                        <div className="h-72">
                            <Bar data={topPagesChartData} options={commonChartOptions} />
                        </div>
                    </Card>

                    <Card className="p-6 border-line bg-surface/50 overflow-hidden">
                        <h3 className="text-base font-bold text-fg mb-4">Análise Completa por Página</h3>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs text-fg-muted">
                                <thead className="border-b border-line text-fg uppercase">
                                    <tr>
                                        <th className="py-2.5 pr-4">Página (path)</th>
                                        <th className="py-2.5 pr-4">Visualizações Totais</th>
                                        <th className="py-2.5 pr-4">Visitantes Únicos</th>
                                        <th className="py-2.5 pr-4">Cliques em Botões</th>
                                        <th className="py-2.5 pr-4">Taxa Clique / View</th>
                                        <th className="py-2.5">Cadastros Originados</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-line">
                                    {(overview?.topPages || []).map((p) => {
                                        const clickRatio = p.views > 0 ? ((p.buttonClicks / p.views) * 100).toFixed(1) : '0.0';
                                        return (
                                            <tr key={p.pagePath}>
                                                <td className="py-2.5 pr-4 font-mono text-fg font-semibold">{p.pagePath}</td>
                                                <td className="py-2.5 pr-4 font-mono">{p.views}</td>
                                                <td className="py-2.5 pr-4 font-mono">{p.uniqueVisitors}</td>
                                                <td className="py-2.5 pr-4 font-mono text-indigo-400">{p.buttonClicks}</td>
                                                <td className="py-2.5 pr-4 font-mono">{clickRatio}%</td>
                                                <td className="py-2.5 font-mono text-emerald-400">{p.signups}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </Card>
                </div>
            )}

            {/* TAB 4: BUTTONS, CTAs & USER INTENTS */}
            {activeTab === 'buttons' && (
                <div className="space-y-6">
                    <div className="grid lg:grid-cols-3 gap-6">
                        <Card className="lg:col-span-2 p-6 border-line bg-surface/50">
                            <h3 className="text-base font-bold text-fg mb-4">Performance dos Botões / Tags UTM (`utm_content` / `cta_tag`)</h3>
                            <div className="h-72">
                                <Bar data={topButtonsChartData} options={commonChartOptions} />
                            </div>
                        </Card>

                        <Card className="p-6 border-line bg-surface/50">
                            <h3 className="text-base font-bold text-fg mb-4 flex items-center gap-2">
                                <Sparkles className="w-4 h-4 text-amber-400" />
                                O que os Usuários Querem (Intenções)
                            </h3>
                            <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                                {(overview?.topIntents || []).map((item) => (
                                    <div key={item.intent} className="p-3 rounded-xl bg-surface border border-line flex items-center justify-between">
                                        <div>
                                            <div className="text-xs font-bold text-fg">{item.intent}</div>
                                            <div className="text-[11px] text-fg-subtle">{item.uniqueVisitors} visitantes interessados</div>
                                        </div>
                                        <span className="font-mono text-xs font-bold text-accent-fg bg-accent/10 px-2.5 py-1 rounded-full">
                                            {item.clicks} cliques
                                        </span>
                                    </div>
                                ))}
                                {(overview?.topIntents?.length ?? 0) === 0 && (
                                    <p className="text-xs text-fg-subtle">Nenhuma intenção capturada ainda.</p>
                                )}
                            </div>
                        </Card>
                    </div>

                    <Card className="p-6 border-line bg-surface/50 overflow-hidden">
                        <h3 className="text-base font-bold text-fg mb-4">Análise Detalhada de Todos os Botões Rastreados</h3>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs text-fg-muted">
                                <thead className="border-b border-line text-fg uppercase">
                                    <tr>
                                        <th className="py-2.5 pr-4">Tag do Botão (utm_content / cta_tag)</th>
                                        <th className="py-2.5 pr-4">Rótulo Visível</th>
                                        <th className="py-2.5 pr-4">Intenção (utm_term)</th>
                                        <th className="py-2.5 pr-4">Página</th>
                                        <th className="py-2.5 pr-4">Cliques Totais</th>
                                        <th className="py-2.5 pr-4">Únicos</th>
                                        <th className="py-2.5">Cadastros Convertidos</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-line">
                                    {(overview?.topButtons || []).map((b, idx) => (
                                        <tr key={`${b.ctaTag}-${idx}`}>
                                            <td className="py-2.5 pr-4 font-mono font-semibold text-indigo-400">{b.ctaTag}</td>
                                            <td className="py-2.5 pr-4 text-fg">{b.elementLabel}</td>
                                            <td className="py-2.5 pr-4 text-amber-400">{b.intent || '-'}</td>
                                            <td className="py-2.5 pr-4 font-mono">{b.topPage}</td>
                                            <td className="py-2.5 pr-4 font-mono font-bold text-fg">{b.clicks}</td>
                                            <td className="py-2.5 pr-4 font-mono">{b.uniqueVisitors}</td>
                                            <td className="py-2.5 font-mono text-emerald-400 font-bold">{b.attributedSignups}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </Card>
                </div>
            )}

            {/* TAB 5: EMAIL OPEN, CLICKS & CTR */}
            {activeTab === 'emails' && (
                <div className="space-y-6">
                    <Card className="p-6 border-line bg-surface/50">
                        <h3 className="text-base font-bold text-fg mb-4">Envios, Aberturas (Pixel 1x1) & Cliques em E-mails</h3>
                        <div className="h-72">
                            <Line data={emailTimelineChartData} options={commonChartOptions} />
                        </div>
                    </Card>

                    <div className="grid lg:grid-cols-2 gap-6">
                        <Card className="p-6 border-line bg-surface/50 overflow-hidden">
                            <h3 className="text-base font-bold text-fg mb-4">Desempenho por Template de E-mail</h3>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-xs text-fg-muted">
                                    <thead className="border-b border-line text-fg uppercase">
                                        <tr>
                                            <th className="py-2.5 pr-3">Template / Campanha</th>
                                            <th className="py-2.5 pr-3">Enviados</th>
                                            <th className="py-2.5 pr-3">Abertos</th>
                                            <th className="py-2.5 pr-3">Open Rate</th>
                                            <th className="py-2.5 pr-3">Cliques</th>
                                            <th className="py-2.5">CTR</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-line">
                                        {(overview?.emailStats?.byTemplate || []).map((row, idx) => (
                                            <tr key={`${row.template}-${idx}`}>
                                                <td className="py-2.5 pr-3">
                                                    <div className="font-mono font-semibold text-fg">{row.template}</div>
                                                    <div className="text-[11px] text-fg-subtle">{row.utmMedium}</div>
                                                </td>
                                                <td className="py-2.5 pr-3 font-mono">{row.sent}</td>
                                                <td className="py-2.5 pr-3 font-mono text-sky-400">
                                                    {row.uniqueOpens} ({row.totalOpens})
                                                </td>
                                                <td className="py-2.5 pr-3 font-mono font-bold text-accent-fg">{row.openRate}%</td>
                                                <td className="py-2.5 pr-3 font-mono text-indigo-400">
                                                    {row.uniqueClicks} ({row.totalClicks})
                                                </td>
                                                <td className="py-2.5 font-mono font-bold text-pink-400">{row.ctr}%</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </Card>

                        <Card className="p-6 border-line bg-surface/50 overflow-hidden">
                            <h3 className="text-base font-bold text-fg mb-4">Campanhas Broadcast</h3>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-xs text-fg-muted">
                                    <thead className="border-b border-line text-fg uppercase">
                                        <tr>
                                            <th className="py-2.5 pr-3">Assunto</th>
                                            <th className="py-2.5 pr-3">Enviados</th>
                                            <th className="py-2.5 pr-3">Open Rate</th>
                                            <th className="py-2.5">CTR</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-line">
                                        {(overview?.emailStats?.byBroadcast || []).map((b) => (
                                            <tr key={b.broadcastId}>
                                                <td className="py-2.5 pr-3 font-semibold text-fg">{b.subject}</td>
                                                <td className="py-2.5 pr-3 font-mono">{b.sent}</td>
                                                <td className="py-2.5 pr-3 font-mono text-accent-fg">
                                                    {b.uniqueOpens} ({b.openRate}%)
                                                </td>
                                                <td className="py-2.5 font-mono text-pink-400">
                                                    {b.uniqueClicks} ({b.ctr}%)
                                                </td>
                                            </tr>
                                        ))}
                                        {(overview?.emailStats?.byBroadcast?.length ?? 0) === 0 && (
                                            <tr>
                                                <td colSpan={4} className="py-6 text-center text-fg-subtle">
                                                    Nenhum broadcast disparado no período.
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </Card>
                    </div>
                </div>
            )}

            {/* TAB 6: PIXEL CONFIG & LIVE EVENTS */}
            {activeTab === 'pixels' && pixelConfig && (
                <div className="grid lg:grid-cols-12 gap-6">
                    <Card className="lg:col-span-5 p-6 border-line bg-surface/50">
                        <h3 className="text-base font-bold text-fg mb-1">Integração de Pixels em Toda a Plataforma</h3>
                        <p className="text-xs text-fg-muted mb-5">
                            Configure IDs de Meta Pixel (+ Conversions API), GA4, Google Tag Manager, TikTok Pixel e UTMify.
                        </p>

                        <form onSubmit={handleSavePixels} className="space-y-4">
                            <div>
                                <label className="block text-xs font-semibold text-fg mb-1">Meta Pixel ID (Facebook/Instagram)</label>
                                <input
                                    type="text"
                                    value={pixelConfig.metaPixelId}
                                    onChange={(e) => setPixelConfig({ ...pixelConfig, metaPixelId: e.target.value })}
                                    placeholder="Ex: 123456789012345"
                                    className="w-full px-3 py-2 bg-canvas border border-line rounded-xl text-xs text-fg focus:outline-none focus:border-accent"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-fg mb-1">
                                    Meta CAPI Access Token (Server-Side Deduplicação)
                                    {pixelConfig.hasMetaCapiAccessToken && (
                                        <span className="ml-2 text-[11px] text-accent-fg font-mono">
                                            Configurado ({pixelConfig.metaCapiAccessTokenPreview})
                                        </span>
                                    )}
                                </label>
                                <input
                                    type="password"
                                    value={metaCapiInput}
                                    onChange={(e) => setMetaCapiInput(e.target.value)}
                                    placeholder="Cole um novo token para atualizar..."
                                    className="w-full px-3 py-2 bg-canvas border border-line rounded-xl text-xs text-fg focus:outline-none focus:border-accent"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-semibold text-fg mb-1">GA4 Measurement ID</label>
                                    <input
                                        type="text"
                                        value={pixelConfig.ga4MeasurementId}
                                        onChange={(e) => setPixelConfig({ ...pixelConfig, ga4MeasurementId: e.target.value })}
                                        placeholder="G-XXXXXXXXXX"
                                        className="w-full px-3 py-2 bg-canvas border border-line rounded-xl text-xs text-fg focus:outline-none focus:border-accent"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-fg mb-1">Google Tag Manager</label>
                                    <input
                                        type="text"
                                        value={pixelConfig.gtmContainerId}
                                        onChange={(e) => setPixelConfig({ ...pixelConfig, gtmContainerId: e.target.value })}
                                        placeholder="GTM-XXXXXXX"
                                        className="w-full px-3 py-2 bg-canvas border border-line rounded-xl text-xs text-fg focus:outline-none focus:border-accent"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-semibold text-fg mb-1">TikTok Pixel ID</label>
                                    <input
                                        type="text"
                                        value={pixelConfig.tiktokPixelId}
                                        onChange={(e) => setPixelConfig({ ...pixelConfig, tiktokPixelId: e.target.value })}
                                        placeholder="CXXXXXXXXXXXX"
                                        className="w-full px-3 py-2 bg-canvas border border-line rounded-xl text-xs text-fg focus:outline-none focus:border-accent"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-fg mb-1">UTMify Pixel ID</label>
                                    <input
                                        type="text"
                                        value={pixelConfig.utmifyPixelId}
                                        onChange={(e) => setPixelConfig({ ...pixelConfig, utmifyPixelId: e.target.value })}
                                        placeholder="ID UTMify"
                                        className="w-full px-3 py-2 bg-canvas border border-line rounded-xl text-xs text-fg focus:outline-none focus:border-accent"
                                    />
                                </div>
                            </div>

                            <div className="space-y-2 pt-2 border-t border-line text-xs">
                                <label className="flex items-center gap-2 text-fg cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={pixelConfig.enableFirstPartyTracking}
                                        onChange={(e) =>
                                            setPixelConfig({ ...pixelConfig, enableFirstPartyTracking: e.target.checked })
                                        }
                                    />
                                    <span>Ativar rastreamento próprio de páginas & UTMs em toda plataforma</span>
                                </label>
                                <label className="flex items-center gap-2 text-fg cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={pixelConfig.enableCtaAutoTracking}
                                        onChange={(e) =>
                                            setPixelConfig({ ...pixelConfig, enableCtaAutoTracking: e.target.checked })
                                        }
                                    />
                                    <span>Disparar eventos automáticos em botões & links globais</span>
                                </label>
                                <label className="flex items-center gap-2 text-fg cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={pixelConfig.enableEmailTracking}
                                        onChange={(e) =>
                                            setPixelConfig({ ...pixelConfig, enableEmailTracking: e.target.checked })
                                        }
                                    />
                                    <span>Rastrear aberturas (Pixel 1x1) & cliques/UTMs nos e-mails enviados</span>
                                </label>
                            </div>

                            {pixelNotice && (
                                <div
                                    className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                                        pixelNotice.type === 'ok'
                                            ? 'bg-emerald-500/10 text-accent-fg border border-emerald-500/20'
                                            : 'bg-rose-500/10 text-danger-fg border border-rose-500/20'
                                    }`}
                                >
                                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                                    <span>{pixelNotice.text}</span>
                                </div>
                            )}

                            <Button type="submit" variant="primary" disabled={savingPixels} className="w-full flex items-center justify-center gap-2">
                                <Save className="w-4 h-4" />
                                {savingPixels ? 'Salvando...' : 'Salvar Configurações de Pixel'}
                            </Button>
                        </form>
                    </Card>

                    <Card className="lg:col-span-7 p-6 border-line bg-surface/50 overflow-hidden">
                        <h3 className="text-base font-bold text-fg mb-4">Stream Recente de Eventos & Disparos de Pixel</h3>
                        <div className="overflow-x-auto max-h-[540px] overflow-y-auto">
                            <table className="w-full text-left text-xs text-fg-muted">
                                <thead className="border-b border-line text-fg uppercase sticky top-0 bg-surface">
                                    <tr>
                                        <th className="py-2 pr-3">Evento</th>
                                        <th className="py-2 pr-3">Página / Botão CTA</th>
                                        <th className="py-2 pr-3">UTM Source / Campaign</th>
                                        <th className="py-2 pr-3">Dispositivo</th>
                                        <th className="py-2">Hora</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-line">
                                    {(overview?.recentEvents || []).map((ev) => (
                                        <tr key={ev.id}>
                                            <td className="py-2 pr-3">
                                                <div className="font-mono font-semibold text-fg">{ev.event_name}</div>
                                                <div className="text-[10px] text-fg-subtle">{ev.event_type}</div>
                                            </td>
                                            <td className="py-2 pr-3">
                                                <div className="font-mono text-fg">{ev.page_path || '/'}</div>
                                                {ev.cta_tag && (
                                                    <div className="text-[11px] text-indigo-400">
                                                        CTA: {ev.cta_tag} {ev.intent ? `(${ev.intent})` : ''}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="py-2 pr-3">
                                                <div>{ev.utm_source || 'direct'}</div>
                                                <div className="text-[11px] text-fg-subtle">{ev.utm_campaign || '-'}</div>
                                            </td>
                                            <td className="py-2 pr-3 capitalize">{ev.device_type || '-'}</td>
                                            <td className="py-2 whitespace-nowrap font-mono text-[11px]">
                                                {new Date(ev.created_at).toLocaleString('pt-PT')}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </Card>
                </div>
            )}

            {/* TAB 7: TOREX AI — TREINO, FEEDBACK, MEMÓRIA & EXPORTAÇÃO */}
            {activeTab === 'torex_ai' && (
                <div className="space-y-6">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2 text-xs text-fg-muted">
                            <ShieldCheck className="w-4 h-4 text-emerald-400" />
                            <span>
                                Auditoria DLP &amp; Multi-Tenant:{' '}
                                <strong
                                    className={
                                        aiReport?.securityAudit?.dlpGuaranteeStatus === 'WARN'
                                            ? 'text-amber-400'
                                            : 'text-emerald-400'
                                    }
                                >
                                    {aiReport?.securityAudit?.dlpGuaranteeStatus || 'PASS'}
                                </strong>
                                {' · '}Redações PII no Relatório:{' '}
                                {aiReport?.securityAudit?.piiRedactionsInReport ?? 0}
                            </span>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void fetchAiTrainingData()}
                            isLoading={aiLoading}
                            icon={<RefreshCw className="w-3.5 h-3.5" />}
                        >
                            Recarregar Dados IA
                        </Button>
                    </div>

                    {/* KPI Cards Torex AI */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        <Card className="p-4 border-line bg-surface/60">
                            <div className="text-[11px] text-fg-subtle font-medium">
                                Resolução 0-LLM (Sem IA Externa)
                            </div>
                            <div className="text-2xl font-bold text-emerald-400 mt-1">
                                {aiReport?.executiveSummary?.zeroLlmResolutionRatePct ?? 0}%
                            </div>
                            <div className="text-[11px] text-fg-muted mt-0.5">
                                Bypass Roteador Qwen:{' '}
                                {aiReport?.executiveSummary?.routerBypassRatePct ?? 0}%
                            </div>
                        </Card>

                        <Card className="p-4 border-line bg-surface/60">
                            <div className="text-[11px] text-fg-subtle font-medium">
                                Tokens Poupados (Memória + Semântico)
                            </div>
                            <div className="text-2xl font-bold text-indigo-400 mt-1">
                                {(aiReport?.executiveSummary?.estimatedTokensSaved ?? 0).toLocaleString()}
                            </div>
                            <div className="text-[11px] text-fg-muted mt-0.5">
                                Hits em memória: {aiReport?.memoryAndSynonyms?.totalMemoryHits ?? 0}
                            </div>
                        </Card>

                        <Card className="p-4 border-line bg-surface/60">
                            <div className="text-[11px] text-fg-subtle font-medium">
                                Taxa de Aprovação (👍 / 👎)
                            </div>
                            <div className="text-2xl font-bold text-fg mt-1 flex items-center gap-2">
                                <span>{aiReport?.feedbackSummary?.approvalRatePct ?? 0}%</span>
                                <span className="text-xs font-normal text-emerald-400 flex items-center gap-0.5">
                                    <ThumbsUp className="w-3 h-3" />
                                    {aiReport?.feedbackSummary?.thumbsUp ?? 0}
                                </span>
                                <span className="text-xs font-normal text-amber-400 flex items-center gap-0.5">
                                    <ThumbsDown className="w-3 h-3" />
                                    {aiReport?.feedbackSummary?.thumbsDown ?? 0}
                                </span>
                            </div>
                            <div className="text-[11px] text-fg-muted mt-0.5">
                                Total de votos: {aiReport?.feedbackSummary?.totalVotes ?? 0}
                            </div>
                        </Card>

                        <Card className="p-4 border-line bg-surface/60">
                            <div className="text-[11px] text-fg-subtle font-medium">
                                Palavras Próximas &amp; Quarentena
                            </div>
                            <div className="text-2xl font-bold text-cyan-400 mt-1">
                                {aiReport?.memoryAndSynonyms?.activeSynonymsCount ?? 0} sinónimos
                            </div>
                            <div className="text-[11px] text-fg-muted mt-0.5">
                                Em quarentena: {aiReport?.securityAudit?.quarantinedMemoriesCount ?? 0} · Bloqueios L0:{' '}
                                {aiReport?.securityAudit?.layer0BlocksCount ?? 0}
                            </div>
                        </Card>
                    </div>

                    {/* Exportação de Ficheiros de Relatório e Treino */}
                    <Card className="p-6 border-line bg-surface/50 space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                                <h3 className="text-base font-bold text-fg flex items-center gap-2">
                                    <Database className="w-4 h-4 text-accent-fg" />
                                    Exportar Relatório Completo &amp; Datasets de Treino (PII-Scrubbed)
                                </h3>
                                <p className="text-xs text-fg-muted mt-0.5">
                                    Todos os ficheiros passam pelo sanitizador DLP antes da exportação (zero e-mails, valores financeiros ou logins de conta).
                                </p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                            {(
                                [
                                    {
                                        fmt: 'markdown',
                                        label: 'Relatório Completo (.md)',
                                        sub: 'Executivo, Blind Spots & Recomendações',
                                    },
                                    {
                                        fmt: 'json',
                                        label: 'Relatório Técnico (.json)',
                                        sub: 'Telemetria estruturada completa',
                                    },
                                    {
                                        fmt: 'sft_jsonl',
                                        label: 'Router SFT (.jsonl)',
                                        sub: `${aiReport?.datasetsSummary?.sftRecords ?? 0} exemplos`,
                                    },
                                    {
                                        fmt: 'rag_qa_jsonl',
                                        label: 'RAG Q&A Aprovado (.jsonl)',
                                        sub: `${aiReport?.datasetsSummary?.ragQaRecords ?? 0} registos`,
                                    },
                                    {
                                        fmt: 'dpo_jsonl',
                                        label: 'DPO Preference (.jsonl)',
                                        sub: `${aiReport?.datasetsSummary?.dpoRecords ?? 0} pares`,
                                    },
                                    {
                                        fmt: 'eval_jsonl',
                                        label: 'Eval Benchmark (.jsonl)',
                                        sub: `${aiReport?.datasetsSummary?.evalRecords ?? 0} casos`,
                                    },
                                ] as const
                            ).map((item) => (
                                <button
                                    key={item.fmt}
                                    type="button"
                                    disabled={exportingFormat === item.fmt}
                                    onClick={() => void handleDownloadAiArtifact(item.fmt)}
                                    className="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-canvas border border-line hover:border-accent/60 text-left transition-colors disabled:opacity-50 cursor-pointer"
                                >
                                    <div className="min-w-0">
                                        <div className="text-xs font-semibold text-fg truncate">
                                            {item.label}
                                        </div>
                                        <div className="text-[11px] text-fg-subtle truncate">
                                            {item.sub}
                                        </div>
                                    </div>
                                    <Download className="w-4 h-4 text-accent shrink-0" />
                                </button>
                            ))}
                        </div>
                    </Card>

                    {/* Blind Spots & Sinónimos */}
                    <div className="grid lg:grid-cols-12 gap-6">
                        <Card className="lg:col-span-7 p-6 border-line bg-surface/50 overflow-hidden">
                            <h3 className="text-base font-bold text-fg mb-3">
                                Blind Spots &amp; Perguntas com Baixa Confiança / 👎
                            </h3>
                            <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
                                <table className="w-full text-left text-xs text-fg-muted">
                                    <thead className="border-b border-line text-fg uppercase sticky top-0 bg-surface">
                                        <tr>
                                            <th className="py-2 pr-3">Pergunta (Sanitizada)</th>
                                            <th className="py-2 pr-3">Intent</th>
                                            <th className="py-2 pr-3">👎</th>
                                            <th className="py-2 pr-3">Low-Conf</th>
                                            <th className="py-2">Ação</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-line">
                                        {(aiReport?.blindSpots || []).length === 0 ? (
                                            <tr>
                                                <td colSpan={5} className="py-6 text-center text-fg-subtle">
                                                    Sem blind spots registados nesta janela.
                                                </td>
                                            </tr>
                                        ) : (
                                            (aiReport?.blindSpots || []).map((bs, idx) => (
                                                <tr key={`bs-${idx}`}>
                                                    <td className="py-2 pr-3 text-fg max-w-[260px] truncate">
                                                        {bs.sanitizedQuestion}
                                                    </td>
                                                    <td className="py-2 pr-3 font-mono text-[11px]">
                                                        {bs.currentIntent}
                                                    </td>
                                                    <td className="py-2 pr-3 text-amber-400 font-semibold">
                                                        {bs.thumbsDownCount}
                                                    </td>
                                                    <td className="py-2 pr-3">{bs.lowConfidenceCount}</td>
                                                    <td className="py-2">
                                                        <span className="px-2 py-0.5 rounded-full bg-surface-2 border border-line text-[10px] font-mono">
                                                            {bs.suggestedAction}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </Card>

                        <Card className="lg:col-span-5 p-6 border-line bg-surface/50">
                            <h3 className="text-base font-bold text-fg mb-3">
                                Top Palavras Próximas &amp; Recomendações
                            </h3>
                            <div className="space-y-4">
                                <div className="flex flex-wrap gap-1.5">
                                    {(aiReport?.memoryAndSynonyms?.topSynonyms || []).map((syn, idx) => (
                                        <span
                                            key={`syn-${idx}`}
                                            className="px-2.5 py-1 rounded-full bg-canvas border border-line text-[11px] text-fg-muted"
                                        >
                                            <span className="text-fg">{syn.surfaceTerm}</span> →{' '}
                                            <span className="text-accent-fg font-mono">{syn.canonicalTerm}</span>
                                        </span>
                                    ))}
                                </div>
                                <div className="border-t border-line pt-3 space-y-1.5">
                                    <div className="text-xs font-semibold text-fg">Recomendações</div>
                                    <ul className="space-y-1 text-xs text-fg-muted list-disc pl-4">
                                        {(aiReport?.recommendations || []).map((rec, idx) => (
                                            <li key={`rec-${idx}`}>{rec}</li>
                                        ))}
                                    </ul>
                                </div>
                            </div>
                        </Card>
                    </div>

                    {/* Curadoria de Memória Semântica Global */}
                    <Card className="p-6 border-line bg-surface/50 overflow-hidden">
                        <h3 className="text-base font-bold text-fg mb-4">
                            Curadoria de Memória Semântica Global (Quorum &amp; Reputação)
                        </h3>
                        <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                            <table className="w-full text-left text-xs text-fg-muted">
                                <thead className="border-b border-line text-fg uppercase sticky top-0 bg-surface">
                                    <tr>
                                        <th className="py-2 pr-3">Escopo</th>
                                        <th className="py-2 pr-3">Status</th>
                                        <th className="py-2 pr-3">Pergunta Canónica</th>
                                        <th className="py-2 pr-3">Quorum</th>
                                        <th className="py-2 pr-3">Trust</th>
                                        <th className="py-2 pr-3">Hits</th>
                                        <th className="py-2">Curadoria</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-line">
                                    {aiMemories.length === 0 ? (
                                        <tr>
                                            <td colSpan={7} className="py-6 text-center text-fg-subtle">
                                                Nenhuma memória semântica registada ainda. Os feedbacks 👍 promovem entradas automaticamente após quorum.
                                            </td>
                                        </tr>
                                    ) : (
                                        aiMemories.map((mem) => (
                                            <tr key={mem.id}>
                                                <td className="py-2 pr-3 font-mono text-[11px]">{mem.scopeLevel}</td>
                                                <td className="py-2 pr-3">
                                                    <span
                                                        className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                                            mem.status === 'ACTIVE'
                                                                ? 'bg-emerald-500/15 text-emerald-400'
                                                                : mem.status === 'QUARANTINED'
                                                                ? 'bg-rose-500/15 text-rose-400'
                                                                : mem.status === 'CANDIDATE'
                                                                ? 'bg-amber-500/15 text-amber-400'
                                                                : 'bg-surface-2 text-fg-subtle'
                                                        }`}
                                                    >
                                                        {mem.status}
                                                    </span>
                                                </td>
                                                <td className="py-2 pr-3 text-fg max-w-[260px] truncate">
                                                    {mem.canonicalQuestion}
                                                </td>
                                                <td className="py-2 pr-3 font-mono">{mem.distinctPositiveUsers}</td>
                                                <td className="py-2 pr-3 font-mono">{mem.trustScore.toFixed(2)}</td>
                                                <td className="py-2 pr-3 font-mono">{mem.hitCount}</td>
                                                <td className="py-2">
                                                    <div className="flex items-center gap-1.5">
                                                        <button
                                                            type="button"
                                                            disabled={reviewingMemId === mem.id}
                                                            onClick={() => void handleReviewMemory(mem.id, 'APPROVE')}
                                                            className="px-2 py-1 rounded-lg bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 text-[11px] cursor-pointer disabled:opacity-50"
                                                        >
                                                            Aprovar
                                                        </button>
                                                        <button
                                                            type="button"
                                                            disabled={reviewingMemId === mem.id}
                                                            onClick={() => void handleReviewMemory(mem.id, 'QUARANTINE')}
                                                            className="px-2 py-1 rounded-lg bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 text-[11px] cursor-pointer disabled:opacity-50"
                                                        >
                                                            Quarentena
                                                        </button>
                                                        <button
                                                            type="button"
                                                            disabled={reviewingMemId === mem.id}
                                                            onClick={() => void handleReviewMemory(mem.id, 'RETIRE')}
                                                            className="px-2 py-1 rounded-lg bg-surface-2 text-fg-subtle hover:text-fg text-[11px] cursor-pointer disabled:opacity-50"
                                                        >
                                                            Aposentar
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </Card>

                    {/* Fila de revisão: respostas rejeitadas pelos utilizadores */}
                    <AiRejectedRepliesCard />
                </div>
            )}

            {/* TAB PUSH & MODERAÇÃO CTR */}
            {activeTab === 'push_ctr' && (
                <div className="space-y-6">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <h3 className="text-base font-bold text-fg">Telemetria Web Push &amp; Moderação Comportamental</h3>
                            <p className="text-xs text-fg-muted">
                                Taxa de cliques (CTR), descartes e redução automática de frequência para evitar fadiga de utilizadores.
                            </p>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={fetchPushAndReferrals}
                            isLoading={growthLoading}
                            icon={<RefreshCw className="w-3.5 h-3.5" />}
                        >
                            Recarregar Push
                        </Button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-6 gap-3">
                        <Card className="p-4 border-line bg-surface/60">
                            <div className="text-[11px] text-fg-subtle">Subscrições Ativas</div>
                            <div className="text-xl font-bold text-fg mt-1">{pushInsights?.summary.activeSubscribers ?? 0}</div>
                            <div className="text-[11px] text-fg-muted mt-0.5">{pushInsights?.summary.standaloneDevices ?? 0} apps PWA</div>
                        </Card>
                        <Card className="p-4 border-line bg-surface/60">
                            <div className="text-[11px] text-fg-subtle">Push Enviados</div>
                            <div className="text-xl font-bold text-fg mt-1">{pushInsights?.summary.sent ?? 0}</div>
                            <div className="text-[11px] text-fg-muted mt-0.5">Últimos {days} dias</div>
                        </Card>
                        <Card className="p-4 border-line bg-surface/60">
                            <div className="text-[11px] text-fg-subtle">Cliques (CTR)</div>
                            <div className="text-xl font-bold text-emerald-400 mt-1">{pushInsights?.summary.ctrPct ?? 0}%</div>
                            <div className="text-[11px] text-fg-muted mt-0.5">{pushInsights?.summary.clicked ?? 0} cliques</div>
                        </Card>
                        <Card className="p-4 border-line bg-surface/60">
                            <div className="text-[11px] text-fg-subtle">Dispensados / Ignorados</div>
                            <div className="text-xl font-bold text-amber-400 mt-1">{pushInsights?.summary.dismissRatePct ?? 0}%</div>
                            <div className="text-[11px] text-fg-muted mt-0.5">
                                {pushInsights?.summary.dismissed ?? 0} fechados · {pushInsights?.summary.ignored ?? 0} sem clique
                            </div>
                        </Card>
                        <Card className="p-4 border-line bg-surface/60">
                            <div className="text-[11px] text-fg-subtle">Modo Moderado (24h)</div>
                            <div className="text-xl font-bold text-indigo-400 mt-1">{pushInsights?.moderationUsers.moderated ?? 0}</div>
                            <div className="text-[11px] text-fg-muted mt-0.5">Traders com &ge;3 ignoradas</div>
                        </Card>
                        <Card className="p-4 border-line bg-surface/60">
                            <div className="text-[11px] text-fg-subtle">Fadiga Pausada (72h)</div>
                            <div className="text-xl font-bold text-rose-400 mt-1">{pushInsights?.moderationUsers.fatiguePaused ?? 0}</div>
                            <div className="text-[11px] text-fg-muted mt-0.5">Traders com &ge;6 ignoradas</div>
                        </Card>
                    </div>

                    <Card className="p-6 border-line bg-surface/50 overflow-hidden">
                        <h4 className="text-sm font-bold text-fg mb-4">Desempenho por Categoria de Push</h4>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs text-fg-muted">
                                <thead className="border-b border-line text-fg uppercase">
                                    <tr>
                                        <th className="py-2 pr-3">Categoria</th>
                                        <th className="py-2 pr-3">Enviados</th>
                                        <th className="py-2 pr-3">Cliques</th>
                                        <th className="py-2 pr-3">Fechados</th>
                                        <th className="py-2 pr-3">Ignorados</th>
                                        <th className="py-2">CTR</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-line">
                                    {(pushInsights?.byCategory || []).length === 0 ? (
                                        <tr>
                                            <td colSpan={6} className="py-6 text-center text-fg-subtle">
                                                Nenhum envio Push registado nesta janela.
                                            </td>
                                        </tr>
                                    ) : (
                                        (pushInsights?.byCategory || []).map((cat) => (
                                            <tr key={cat.category}>
                                                <td className="py-2 pr-3 font-mono font-semibold text-fg">{cat.category}</td>
                                                <td className="py-2 pr-3">{cat.sent}</td>
                                                <td className="py-2 pr-3 text-emerald-400 font-semibold">{cat.clicked}</td>
                                                <td className="py-2 pr-3 text-amber-400">{cat.dismissed}</td>
                                                <td className="py-2 pr-3">{cat.ignored}</td>
                                                <td className="py-2 font-mono font-bold text-accent-fg">{cat.ctrPct}%</td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </Card>
                </div>
            )}

            {/* TAB AFILIADOS & CRESCIMENTO */}
            {activeTab === 'referrals' && (
                <div className="space-y-6">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <h3 className="text-base font-bold text-fg">Programa de Afiliados, Créditos &amp; Upgrade de Nível</h3>
                            <p className="text-xs text-fg-muted">
                                Recompensas híbridas: crédito por verificação + crédito por conversão paga + upgrade automático de tier.
                            </p>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={fetchPushAndReferrals}
                            isLoading={growthLoading}
                            icon={<RefreshCw className="w-3.5 h-3.5" />}
                        >
                            Recarregar Afiliados
                        </Button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
                        <Card className="p-4 border-line bg-surface/60">
                            <div className="text-[11px] text-fg-subtle">Total Convites</div>
                            <div className="text-xl font-bold text-fg mt-1">{referralInsights?.summary.totalReferrals ?? 0}</div>
                        </Card>
                        <Card className="p-4 border-line bg-surface/60">
                            <div className="text-[11px] text-fg-subtle">Contas Verificadas</div>
                            <div className="text-xl font-bold text-accent-fg mt-1">{referralInsights?.summary.verifiedReferrals ?? 0}</div>
                        </Card>
                        <Card className="p-4 border-line bg-surface/60">
                            <div className="text-[11px] text-fg-subtle">Conversões Pagas</div>
                            <div className="text-xl font-bold text-emerald-400 mt-1">{referralInsights?.summary.paidReferrals ?? 0}</div>
                        </Card>
                        <Card className="p-4 border-line bg-surface/60">
                            <div className="text-[11px] text-fg-subtle">Taxa Verif. → Pago</div>
                            <div className="text-xl font-bold text-cyan-400 mt-1">{referralInsights?.summary.conversionToPaidPct ?? 0}%</div>
                        </Card>
                        <Card className="p-4 border-line bg-surface/60">
                            <div className="text-[11px] text-fg-subtle">Créditos Emitidos</div>
                            <div className="text-xl font-bold text-emerald-300 mt-1">
                                ${(referralInsights?.summary.totalCreditsIssuedUsd ?? 0).toFixed(2)}
                            </div>
                        </Card>
                        <Card className="p-4 border-line bg-surface/60">
                            <div className="text-[11px] text-fg-subtle">Tier Boosts Ativos</div>
                            <div className="text-xl font-bold text-amber-400 mt-1">{referralInsights?.summary.tierBoostsUnlocked ?? 0}</div>
                        </Card>
                    </div>

                    <div className="grid lg:grid-cols-12 gap-6">
                        <Card className="lg:col-span-6 p-6 border-line bg-surface/50 overflow-hidden">
                            <h4 className="text-sm font-bold text-fg mb-4">Top Afiliados</h4>
                            <div className="overflow-x-auto max-h-[380px] overflow-y-auto">
                                <table className="w-full text-left text-xs text-fg-muted">
                                    <thead className="border-b border-line text-fg uppercase sticky top-0 bg-surface">
                                        <tr>
                                            <th className="py-2 pr-3">Trader</th>
                                            <th className="py-2 pr-3">Código</th>
                                            <th className="py-2 pr-3">Verif / Pagos</th>
                                            <th className="py-2 pr-3">Créditos</th>
                                            <th className="py-2">Boost</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-line">
                                        {(referralInsights?.topAffiliates || []).length === 0 ? (
                                            <tr>
                                                <td colSpan={5} className="py-6 text-center text-fg-subtle">
                                                    Nenhum afiliado registou indicações ainda.
                                                </td>
                                            </tr>
                                        ) : (
                                            (referralInsights?.topAffiliates || []).map((aff) => (
                                                <tr key={aff.userId}>
                                                    <td className="py-2 pr-3 font-semibold text-fg">@{aff.username}</td>
                                                    <td className="py-2 pr-3 font-mono text-[11px]">{aff.referralCode || '—'}</td>
                                                    <td className="py-2 pr-3">{aff.verifiedCount} / <span className="text-emerald-400 font-semibold">{aff.paidCount}</span></td>
                                                    <td className="py-2 pr-3 font-mono text-emerald-400">${aff.creditsUsd.toFixed(2)}</td>
                                                    <td className="py-2">
                                                        {aff.tierBoostUnlocked ? (
                                                            <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 text-[10px] font-bold">Desbloqueado</span>
                                                        ) : (
                                                            <span className="text-[11px] text-fg-subtle">—</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </Card>

                        <Card className="lg:col-span-6 p-6 border-line bg-surface/50 overflow-hidden">
                            <h4 className="text-sm font-bold text-fg mb-4">Indicações Recentes</h4>
                            <div className="overflow-x-auto max-h-[380px] overflow-y-auto">
                                <table className="w-full text-left text-xs text-fg-muted">
                                    <thead className="border-b border-line text-fg uppercase sticky top-0 bg-surface">
                                        <tr>
                                            <th className="py-2 pr-3">Embaixador</th>
                                            <th className="py-2 pr-3">Convidado</th>
                                            <th className="py-2 pr-3">Status</th>
                                            <th className="py-2">Recompensa</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-line">
                                        {(referralInsights?.recentReferrals || []).length === 0 ? (
                                            <tr>
                                                <td colSpan={4} className="py-6 text-center text-fg-subtle">
                                                    Sem indicações recentes.
                                                </td>
                                            </tr>
                                        ) : (
                                            (referralInsights?.recentReferrals || []).map((rec) => (
                                                <tr key={rec.id}>
                                                    <td className="py-2 pr-3 text-fg">@{rec.referrerUsername}</td>
                                                    <td className="py-2 pr-3">@{rec.referredUsername}</td>
                                                    <td className="py-2 pr-3">
                                                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${rec.status === 'PAID' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-accent/15 text-accent-fg'}`}>
                                                            {rec.status}
                                                        </span>
                                                    </td>
                                                    <td className="py-2 font-mono text-emerald-400">+${rec.rewardCreditsUsd.toFixed(2)}</td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </Card>
                    </div>
                </div>
            )}
        </div>
    );
};
