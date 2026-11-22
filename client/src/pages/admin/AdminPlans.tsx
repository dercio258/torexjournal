import { useState, useEffect } from 'react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Edit, Check, Gift, Sparkles, Power, Users, Clock, ShieldCheck, CreditCard, Plus, TrendingUp, Lock, BarChart3, RefreshCw } from 'lucide-react';
import {
    AdminBadge,
    AdminBanner,
    AdminLoadingState,
    AdminPageHeader,
    AdminStatCard,
} from './components/AdminPrimitives';
import api from '../../api';

export const AdminPlans = () => {
    const [plans, setPlans] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Trial Campaign Global State
    const [trialCampaign, setTrialCampaign] = useState<{
        active: boolean;
        trialDays: number;
        tier: string;
        totalTrialsGranted: number;
    } | null>(null);
    const [conversionInsights, setConversionInsights] = useState<{
        windowDays: number;
        funnel: {
            totalUsers: number;
            trialUsedUsers: number;
            activeTrialSubs: number;
            activePaidSubs: number;
            estimatedMrrUsd: number;
            totalTrialsActivated: number;
            totalTrialsConverted: number;
            trialToPaidRatePct: number;
            recurringRenewedUsers: number;
            paidUsersTotal: number;
            renewalRatePct: number;
            expiringSoonTotal: number;
            expiringSoonPaid: number;
            expiringSoonTrial: number;
            trialStartEvents: number;
            checkoutStartEvents: number;
            purchaseEvents: number;
        };
        trialBreakdown: Array<{
            tier: string;
            trialDays: number;
            activated: number;
            convertedToPaid: number;
            conversionRatePct: number;
        }>;
        modalBehavior: {
            pricingModalOpens: number;
            renewalModalImpressions: number;
            renewalModalClicks: number;
            renewalModalDismisses: number;
            renewalBannerClicks: number;
            headerExpiryClicks: number;
            renewalCtrPct: number;
        };
        lockedFeatureDemand: Array<{
            feature: string;
            clicks: number;
            uniqueUsers: number;
        }>;
    } | null>(null);
    const [isLoadingInsights, setIsLoadingInsights] = useState(false);
    const [isTogglingTrial, setIsTogglingTrial] = useState(false);
    const [banner, setBanner] = useState<{ tone: 'success' | 'warning' | 'danger' | 'info'; message: string } | null>(null);

    // Modal State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [newPlan, setNewPlan] = useState<any>({
        tier: '',
        description: '',
        features: '', // comma separated string for input
        monthlyPrice: '',
        annualMonthlyPrice: '',
        compareAtPrice: '',
        promoDiscountPercent: '25',
        monthlyDiscountPercent: '20',
        quarterlyDiscountPercent: '5',
        annualDiscountPercent: '25',
        biennialDiscountPercent: '29',
        usdToMznRate: '74',
        monthlyPriceMzn: '',
        maxTradingAccounts: '1',
        monthlyBacktestsLimit: '0',
        trialDays: '0',
        aiDailyCredits: '0'
    });
    const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
    const [isCreating, setIsCreating] = useState(false);

    useEffect(() => {
        fetchPlans();
        fetchTrialCampaign();
        fetchConversionInsights();
    }, []);

    const fetchConversionInsights = async () => {
        setIsLoadingInsights(true);
        try {
            const { data } = await api.get('/admin/subscription-conversion-insights?days=30');
            setConversionInsights(data);
        } catch (error) {
            console.error('Failed to load conversion insights:', error);
        } finally {
            setIsLoadingInsights(false);
        }
    };

    const fetchPlans = async () => {
        try {
            const { data } = await api.get('/admin/plans');
            setPlans(data);
        } catch (error) {
            console.error(error);
        } finally {
            setIsLoading(false);
        }
    };

    const fetchTrialCampaign = async () => {
        try {
            const { data } = await api.get('/admin/trial-campaign');
            setTrialCampaign(data);
        } catch (error) {
            console.error('Failed to load trial campaign status:', error);
        }
    };

    const handleToggleTrial = async () => {
        if (!trialCampaign) return;
        setIsTogglingTrial(true);
        setBanner(null);
        try {
            const nextState = !trialCampaign.active;
            const { data } = await api.post('/admin/trial-campaign/toggle', {
                enabled: nextState,
                days: 30
            });
            setTrialCampaign(data);
            setBanner({
                tone: nextState ? 'success' : 'info',
                message: nextState
                    ? 'Campanha de Trial ATIVADA com sucesso! Novos traders recebem 30 dias de Plano Premium grátis ao acessar o painel.'
                    : 'Campanha de Trial PAUSADA. Novos trials não serão concedidos automaticamente.',
            });
            fetchPlans();
        } catch (error) {
            console.error('Error toggling trial:', error);
            setBanner({ tone: 'danger', message: 'Falha ao alternar status do período de teste.' });
        } finally {
            setIsTogglingTrial(false);
        }
    };

    const handleCreateOrUpdatePlan = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsCreating(true);
        setBanner(null);
        try {
            const planData = {
                tier: newPlan.tier.toUpperCase(),
                description: newPlan.description,
                features: newPlan.features.split(',').map((f: string) => f.trim()).filter((f: string) => f),
                monthlyPrice: parseFloat(newPlan.monthlyPrice),
                annualMonthlyPrice: newPlan.annualMonthlyPrice ? parseFloat(newPlan.annualMonthlyPrice) : null,
                compareAtPrice: newPlan.compareAtPrice ? parseFloat(newPlan.compareAtPrice) : null,
                promoDiscountPercent: parseInt(newPlan.promoDiscountPercent) || 0,
                monthlyDiscountPercent: parseInt(newPlan.monthlyDiscountPercent) || 20,
                quarterlyDiscountPercent: parseInt(newPlan.quarterlyDiscountPercent) || 0,
                annualDiscountPercent: parseInt(newPlan.annualDiscountPercent) || 25,
                biennialDiscountPercent: parseInt(newPlan.biennialDiscountPercent) || 29,
                usdToMznRate: parseFloat(newPlan.usdToMznRate) || 74,
                monthlyPriceMzn: newPlan.monthlyPriceMzn ? parseFloat(newPlan.monthlyPriceMzn) : null,
                maxTradingAccounts: parseInt(newPlan.maxTradingAccounts) || 1,
                monthlyBacktestsLimit: parseInt(newPlan.monthlyBacktestsLimit) || 0,
                trialEnabled: parseInt(newPlan.trialDays) > 0,
                trialDays: parseInt(newPlan.trialDays) || 0,
                aiDailyCredits: Math.max(0, parseInt(newPlan.aiDailyCredits) || 0),
                isActive: true
            };

            if (editingPlanId) {
                await api.patch(`/admin/plans/${editingPlanId}`, planData);
                setBanner({ tone: 'success', message: `Plano ${planData.tier} atualizado com sucesso.` });
            } else {
                await api.post('/admin/plans', planData);
                setBanner({ tone: 'success', message: `Plano ${planData.tier} criado com sucesso.` });
            }

            setIsModalOpen(false);
            setEditingPlanId(null);
            setNewPlan({
                tier: '',
                description: '',
                features: '',
                monthlyPrice: '',
                annualMonthlyPrice: '',
                compareAtPrice: '',
                promoDiscountPercent: '25',
                monthlyDiscountPercent: '20',
                quarterlyDiscountPercent: '5',
                annualDiscountPercent: '25',
                biennialDiscountPercent: '29',
                usdToMznRate: '74',
                monthlyPriceMzn: '',
                maxTradingAccounts: '1',
                monthlyBacktestsLimit: '0',
                trialDays: '0',
                aiDailyCredits: '0',
            });
            fetchPlans();
        } catch (error: any) {
            console.error(error);
            setBanner({
                tone: 'danger',
                message: error.response?.data?.message || `Erro ao ${editingPlanId ? 'atualizar' : 'criar'} plano.`,
            });
        } finally {
            setIsCreating(false);
        }
    };

    const openEditModal = (plan: any) => {
        const defaultCredits =
            plan.tier === 'PREMIUM' ? 4000 : plan.tier === 'PRO' ? 1500 : 0;
        setEditingPlanId(plan.id);
        setNewPlan({
            tier: plan.tier,
            description: plan.description || '',
            features: plan.features?.join(', ') || '',
            monthlyPrice: plan.monthlyPrice?.toString() || '',
            annualMonthlyPrice: plan.annualMonthlyPrice?.toString() || '',
            compareAtPrice: plan.compareAtPrice?.toString() || '',
            promoDiscountPercent: (plan.promoDiscountPercent ?? 25).toString(),
            monthlyDiscountPercent: (plan.monthlyDiscountPercent ?? 20).toString(),
            quarterlyDiscountPercent: (plan.quarterlyDiscountPercent ?? 5).toString(),
            annualDiscountPercent: (plan.annualDiscountPercent ?? 25).toString(),
            biennialDiscountPercent: (plan.biennialDiscountPercent ?? 29).toString(),
            usdToMznRate: (plan.usdToMznRate ?? 74).toString(),
            monthlyPriceMzn: plan.monthlyPriceMzn?.toString() || '',
            maxTradingAccounts: (plan.maxTradingAccounts ?? (plan.tier === 'BASIC' ? 1 : -1)).toString(),
            monthlyBacktestsLimit: (plan.monthlyBacktestsLimit ?? (plan.tier === 'PREMIUM' ? 100 : plan.tier === 'PRO' ? 10 : 0)).toString(),
            trialDays: (plan.trialDays ?? 0).toString(),
            aiDailyCredits: (plan.aiDailyCredits ?? defaultCredits).toString()
        });
        setIsModalOpen(true);
    };

    if (isLoading) return <AdminLoadingState label="Carregando catálogo de planos e campanha de trial..." />;

    const activePlansCount = plans.filter((p) => p.isActive !== false).length;

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            <AdminPageHeader
                badge="Clientes & Receita"
                title="Planos & Campanha de Trial"
                subtitle="Configure tiers de assinatura, limites diários de IA, descontos anuais e onboarding gratuito."
                icon={<CreditCard className="h-5 w-5" />}
                actions={
                    <Button
                        variant="brand"
                        size="sm"
                        onClick={() => {
                            setEditingPlanId(null);
                            setNewPlan({ tier: '', description: '', features: '', monthlyPrice: '', annualDiscountPercent: '20', trialDays: '0', aiDailyCredits: '100' });
                            setIsModalOpen(true);
                        }}
                        icon={<Plus className="h-3.5 w-3.5" />}
                    >
                        Novo Plano
                    </Button>
                }
            />

            {banner && (
                <AdminBanner
                    tone={banner.tone}
                    message={banner.message}
                    onDismiss={() => setBanner(null)}
                />
            )}

            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <AdminStatCard
                    label="Planos Ativos"
                    value={`${activePlansCount} / ${plans.length}`}
                    hint="Visíveis para checkout"
                    icon={<CreditCard className="h-4 w-4" />}
                    tone="info"
                />
                <AdminStatCard
                    label="Política de Trials"
                    value="30d / 14d / 7d"
                    hint="Básico · Pro · Premium (1x)"
                    icon={<Gift className="h-4 w-4" />}
                    tone={trialCampaign?.active ? 'accent' : 'default'}
                />
                <AdminStatCard
                    label="Trials Concedidos"
                    value={trialCampaign?.totalTrialsGranted ?? 0}
                    hint="Histórico total na base"
                    icon={<Users className="h-4 w-4" />}
                    tone="warning"
                />
                <AdminStatCard
                    label="Conversão Trial → Pago"
                    value={`${conversionInsights?.funnel?.trialToPaidRatePct ?? 0}%`}
                    hint={`${conversionInsights?.funnel?.totalTrialsConverted ?? 0} de ${conversionInsights?.funnel?.totalTrialsActivated ?? 0} nos últimos 30d`}
                    icon={<TrendingUp className="h-4 w-4" />}
                />
            </div>

            {/* CARD INSTITUCIONAL: ESTRUTURA DE TRIAL POR TIER */}
            <div className="bg-surface border border-line rounded-2xl p-6 sm:p-7 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-80 h-80 bg-accent/5 rounded-full blur-3xl pointer-events-none" />

                <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 relative z-10">
                    <div className="space-y-3 max-w-2xl">
                        <div className="flex flex-wrap items-center gap-2.5">
                            <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-500">
                                <Gift size={18} />
                            </div>
                            <span className="text-xs font-bold uppercase tracking-widest text-fg-muted">
                                Política Escalonada de Trials
                            </span>
                            <AdminBadge tone={trialCampaign?.active ? 'success' : 'neutral'} dot>
                                {trialCampaign?.active ? 'Auto-Onboarding Ativo' : 'Seleção no Modal de Planos'}
                            </AdminBadge>
                        </div>

                        <h2 className="text-xl sm:text-2xl font-bold text-fg tracking-tight">
                            Período de Teste Gratuito por Plano (Básico 30d · Pro 14d · Premium 7d)
                        </h2>

                        <p className="text-xs sm:text-sm text-fg-muted leading-relaxed">
                            Cada nova conta elegível pode ativar <strong className="text-fg font-semibold">1 único período gratuito</strong> escolhendo no seletor do plano: <strong className="text-fg">Básico (30 dias)</strong>, <strong className="text-fg">Pro (14 dias)</strong> ou <strong className="text-fg">Premium (7 dias)</strong>. A elegibilidade é validada no backend com trava transacional para impedir reutilização.
                        </p>

                        <div className="flex flex-wrap items-center gap-3 pt-1 text-xs text-fg-muted">
                            <div className="flex items-center gap-1.5 bg-surface-2 px-3 py-1.5 rounded-xl border border-line">
                                <ShieldCheck size={14} className="text-accent-fg" />
                                <span>Básico: <strong className="text-fg">30 dias</strong> · Pro: <strong className="text-fg">14 dias</strong> · Premium: <strong className="text-fg">7 dias</strong></span>
                            </div>

                            <div className="flex items-center gap-1.5 bg-surface-2 px-3 py-1.5 rounded-xl border border-line">
                                <Clock size={14} className="text-amber-500" />
                                <span>Alertas de Renovação: <strong className="text-fg">Últimos 5 dias</strong></span>
                            </div>

                            <div className="flex items-center gap-1.5 bg-surface-2 px-3 py-1.5 rounded-xl border border-line">
                                <Users size={14} className="text-sky-500" />
                                <span>Contas com Trial Usado: <strong className="text-accent-fg font-bold">{conversionInsights?.funnel?.trialUsedUsers ?? trialCampaign?.totalTrialsGranted ?? 0}</strong></span>
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-col sm:flex-row lg:flex-col items-stretch sm:items-center lg:items-end gap-3 w-full lg:w-auto shrink-0">
                        <Button
                            variant={trialCampaign?.active ? 'danger' : 'brand'}
                            size="lg"
                            onClick={handleToggleTrial}
                            isLoading={isTogglingTrial}
                            icon={trialCampaign?.active ? <Power size={16} /> : <Sparkles size={16} />}
                        >
                            {trialCampaign?.active ? 'Pausar Auto-Trial Global' : 'Ativar Auto-Trial Global'}
                        </Button>
                        <span className="text-[11px] text-fg-subtle text-center lg:text-right">
                            O seletor de trial no modal permanece exclusivo para 1ª ativação por conta.
                        </span>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {plans.map((plan) => (
                    <Card key={plan.id} className="p-6 border-line bg-surface/50">
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <h3 className="text-xl font-bold text-fg">{plan.tier}</h3>
                                <p className="text-fg-muted text-sm">ID: ...{plan.id.slice(-6)}</p>
                            </div>
                            {plan.isActive && (
                                <span className="bg-green-500/10 text-green-500 p-1 rounded-full">
                                    <Check size={16} />
                                </span>
                            )}
                        </div>

                        <div className="space-y-3 mb-6">
                            <p className="text-sm text-fg-muted italic">{plan.description}</p>

                            {plan.features && plan.features.length > 0 && (
                                <ul className="text-xs text-fg/80 space-y-1 mb-2">
                                    {plan.features.map((f: string, i: number) => (
                                        <li key={i} className="flex gap-2">
                                            <Check size={12} className="text-emerald-500 mt-0.5" /> {f}
                                        </li>
                                    ))}
                                </ul>
                            )}

                            <div className="flex justify-between text-sm pt-2 border-t border-line">
                                <span className="text-fg-muted">Preço Base / Mensal (BF)</span>
                                <span className="text-fg font-medium">
                                    $ {plan.monthlyPrice} → $ {(Number(plan.monthlyPrice) * (1 - Number(plan.monthlyDiscountPercent ?? 20) / 100)).toFixed(2)} USD (-{plan.monthlyDiscountPercent ?? 20}%)
                                </span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-fg-muted">Descontos (Trim / Anual / Bi)</span>
                                <span className="text-accent-fg font-medium">
                                    -{plan.quarterlyDiscountPercent ?? 5}% / -{plan.annualDiscountPercent ?? 25}% / -{plan.biennialDiscountPercent ?? 29}%
                                </span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-fg-muted">Câmbio DB (MZN)</span>
                                <span className="text-fg font-mono text-xs">
                                    1 USD = {plan.usdToMznRate ?? 74} MZN ({plan.monthlyPriceMzn ?? Math.round(Number(plan.monthlyPrice) * (1 - Number(plan.monthlyDiscountPercent ?? 20) / 100) * 74)} MZN/mês)
                                </span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-fg-muted">Dias de Teste</span>
                                <span className="text-fg font-medium">{plan.trialDays} dias</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-fg-muted">Créditos IA / Dia</span>
                                <span className="text-accent-fg font-bold">
                                    {(
                                        plan.aiDailyCredits ??
                                        (plan.tier === 'PREMIUM'
                                            ? 20000
                                            : plan.tier === 'PRO'
                                              ? 2000
                                              : 100)
                                    ).toLocaleString('pt-BR')}
                                </span>
                            </div>
                        </div>

                        <Button 
                            variant="secondary" 
                            className="w-full"
                            onClick={() => openEditModal(plan)}
                        >
                            <Edit className="w-4 h-4 mr-2" />
                            Editar Plano
                        </Button>
                    </Card>
                ))}
            </div>

            {/* TELEMETRIA DE CONVERSÃO, TRIALS, RENOVAÇÃO & GATES PRO */}
            <div className="bg-surface border border-line rounded-2xl p-6 space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                        <div className="flex items-center gap-2">
                            <BarChart3 size={18} className="text-accent-fg" />
                            <h2 className="text-lg font-bold text-fg">
                                Comportamento de Conversão, Trials &amp; Renovação (30d)
                            </h2>
                        </div>
                        <p className="text-xs text-fg-muted">
                            Acompanhamento em tempo real de trials por tier, renovações, interação nos alertas de vencimento (5 dias) e cliques em recursos bloqueados.
                        </p>
                    </div>
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={fetchConversionInsights}
                        isLoading={isLoadingInsights}
                        icon={<RefreshCw size={13} />}
                    >
                        Atualizar Telemetria
                    </Button>
                </div>

                {conversionInsights && (
                    <>
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                            <div className="rounded-xl border border-line bg-canvas-subtle p-4 space-y-1">
                                <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                                    Conversão Trial → Pago
                                </span>
                                <div className="text-2xl font-bold text-emerald-400 tabular-nums">
                                    {conversionInsights.funnel.trialToPaidRatePct}%
                                </div>
                                <p className="text-[11px] text-fg-subtle">
                                    {conversionInsights.funnel.totalTrialsConverted} convertidos de {conversionInsights.funnel.totalTrialsActivated} trials (30d)
                                </p>
                            </div>
                            <div className="rounded-xl border border-line bg-canvas-subtle p-4 space-y-1">
                                <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                                    Taxa de Renovação
                                </span>
                                <div className="text-2xl font-bold text-fg tabular-nums">
                                    {conversionInsights.funnel.renewalRatePct}%
                                </div>
                                <p className="text-[11px] text-fg-subtle">
                                    {conversionInsights.funnel.recurringRenewedUsers} de {conversionInsights.funnel.paidUsersTotal} pagantes recorrentes
                                </p>
                            </div>
                            <div className="rounded-xl border border-line bg-canvas-subtle p-4 space-y-1">
                                <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                                    MRR Pago Estimado
                                </span>
                                <div className="text-2xl font-bold text-accent-fg tabular-nums font-mono">
                                    ${conversionInsights.funnel.estimatedMrrUsd.toFixed(2)}
                                </div>
                                <p className="text-[11px] text-fg-subtle">
                                    {conversionInsights.funnel.activePaidSubs} assinaturas pagas · {conversionInsights.funnel.activeTrialSubs} em trial
                                </p>
                            </div>
                            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-1">
                                <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-400">
                                    Expiram em até 5 dias
                                </span>
                                <div className="text-2xl font-bold text-amber-300 tabular-nums">
                                    {conversionInsights.funnel.expiringSoonTotal}
                                </div>
                                <p className="text-[11px] text-fg-subtle">
                                    {conversionInsights.funnel.expiringSoonTrial} trials · {conversionInsights.funnel.expiringSoonPaid} pagos
                                </p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                            {/* Tabela Breakdown Trials por Tier */}
                            <div className="rounded-xl border border-line bg-canvas-subtle p-4 space-y-3">
                                <h3 className="text-xs font-bold uppercase tracking-wider text-fg-muted">
                                    Performance de Trial por Plano
                                </h3>
                                <div className="space-y-2">
                                    {conversionInsights.trialBreakdown.map((row) => (
                                        <div
                                            key={row.tier}
                                            className="flex items-center justify-between rounded-lg border border-line-subtle bg-surface px-3 py-2 text-xs"
                                        >
                                            <div>
                                                <div className="font-bold text-fg">
                                                    {row.tier} <span className="text-[10px] font-normal text-fg-muted">({row.trialDays}d)</span>
                                                </div>
                                                <div className="text-[11px] text-fg-subtle">
                                                    {row.activated} ativados · {row.convertedToPaid} pagos
                                                </div>
                                            </div>
                                            <span className="font-mono font-bold text-emerald-400">
                                                {row.conversionRatePct}%
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Funil de Modais e Alertas de Renovação */}
                            <div className="rounded-xl border border-line bg-canvas-subtle p-4 space-y-3">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-xs font-bold uppercase tracking-wider text-fg-muted">
                                        Modais de Renovação (5d) &amp; Funil
                                    </h3>
                                    <span className="text-[11px] font-bold text-accent-fg">
                                        CTR {conversionInsights.modalBehavior.renewalCtrPct}%
                                    </span>
                                </div>
                                <div className="grid grid-cols-2 gap-2 text-xs">
                                    <div className="rounded-lg bg-surface border border-line-subtle p-2.5">
                                        <div className="text-fg-subtle text-[10px]">Impressões Modal 5d</div>
                                        <div className="font-bold text-fg text-base tabular-nums">
                                            {conversionInsights.modalBehavior.renewalModalImpressions}
                                        </div>
                                    </div>
                                    <div className="rounded-lg bg-surface border border-line-subtle p-2.5">
                                        <div className="text-fg-subtle text-[10px]">Cliques Renovar Modal</div>
                                        <div className="font-bold text-emerald-400 text-base tabular-nums">
                                            {conversionInsights.modalBehavior.renewalModalClicks}
                                        </div>
                                    </div>
                                    <div className="rounded-lg bg-surface border border-line-subtle p-2.5">
                                        <div className="text-fg-subtle text-[10px]">Cliques Card Dashboard</div>
                                        <div className="font-bold text-fg text-base tabular-nums">
                                            {conversionInsights.modalBehavior.renewalBannerClicks}
                                        </div>
                                    </div>
                                    <div className="rounded-lg bg-surface border border-line-subtle p-2.5">
                                        <div className="text-fg-subtle text-[10px]">Cliques Pill Header</div>
                                        <div className="font-bold text-fg text-base tabular-nums">
                                            {conversionInsights.modalBehavior.headerExpiryClicks}
                                        </div>
                                    </div>
                                    <div className="rounded-lg bg-surface border border-line-subtle p-2.5">
                                        <div className="text-fg-subtle text-[10px]">Checkouts Iniciados</div>
                                        <div className="font-bold text-fg text-base tabular-nums">
                                            {conversionInsights.funnel.checkoutStartEvents}
                                        </div>
                                    </div>
                                    <div className="rounded-lg bg-surface border border-line-subtle p-2.5">
                                        <div className="text-fg-subtle text-[10px]">Compras Confirmadas</div>
                                        <div className="font-bold text-accent-fg text-base tabular-nums">
                                            {conversionInsights.funnel.purchaseEvents}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Demanda por Cadeados / Recursos PRO */}
                            <div className="rounded-xl border border-line bg-canvas-subtle p-4 space-y-3">
                                <div className="flex items-center gap-1.5">
                                    <Lock size={13} className="text-amber-400" />
                                    <h3 className="text-xs font-bold uppercase tracking-wider text-fg-muted">
                                        Gatilhos de Upgrade (Cadeados)
                                    </h3>
                                </div>
                                {conversionInsights.lockedFeatureDemand.length === 0 ? (
                                    <p className="text-xs text-fg-subtle py-4 text-center">
                                        Ainda sem cliques registados em cadeados nos últimos 30 dias.
                                    </p>
                                ) : (
                                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                                        {conversionInsights.lockedFeatureDemand.map((item) => (
                                            <div
                                                key={item.feature}
                                                className="flex items-center justify-between rounded-lg border border-line-subtle bg-surface px-3 py-1.5 text-xs"
                                            >
                                                <span className="font-mono text-[11px] text-fg truncate max-w-[160px]" title={item.feature}>
                                                    {item.feature}
                                                </span>
                                                <span className="text-[11px] font-semibold text-amber-400 tabular-nums shrink-0">
                                                    {item.clicks} cliques ({item.uniqueUsers} u.)
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </>
                )}
            </div>

            <Modal
                isOpen={isModalOpen}
                onClose={() => {
                    setIsModalOpen(false);
                    setEditingPlanId(null);
                    setNewPlan({ tier: '', description: '', features: '', monthlyPrice: '', annualDiscountPercent: '20', trialDays: '0', aiDailyCredits: '100' });
                }}
                title={editingPlanId ? "Editar Plano" : "Novo Plano de Assinatura"}
            >
                <form onSubmit={handleCreateOrUpdatePlan} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-fg-muted mb-1">Nome do Plano (Tier)</label>
                        <input
                            type="text"
                            value={newPlan.tier}
                            onChange={(e) => setNewPlan({ ...newPlan, tier: e.target.value })}
                            className="w-full bg-canvas border border-line rounded-lg px-4 py-2.5 text-fg focus:outline-none focus:border-indigo-500 transition-colors"
                            placeholder="Ex: GOLD, VIP, ENTERPRISE"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-fg-muted mb-1">Descrição</label>
                        <input
                            type="text"
                            value={newPlan.description}
                            onChange={(e) => setNewPlan({ ...newPlan, description: e.target.value })}
                            className="w-full bg-canvas border border-line rounded-lg px-4 py-2.5 text-fg focus:outline-none focus:border-indigo-500 transition-colors"
                            placeholder="Descrição curta (ex: Para iniciantes)"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-fg-muted mb-1">Funcionalidades (separadas por vírgula)</label>
                        <textarea
                            value={newPlan.features}
                            onChange={(e) => setNewPlan({ ...newPlan, features: e.target.value })}
                            className="w-full bg-canvas border border-line rounded-lg px-4 py-2.5 text-fg focus:outline-none focus:border-indigo-500 transition-colors h-20"
                            placeholder="Ex: Acesso VIP, Sinais Diários, Suporte 24h"
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-fg-muted mb-1">Preço Mensal (USD)</label>
                            <input
                                type="number"
                                step="0.01"
                                value={newPlan.monthlyPrice}
                                onChange={(e) => setNewPlan({ ...newPlan, monthlyPrice: e.target.value })}
                                className="w-full bg-canvas border border-line rounded-lg px-4 py-2.5 text-fg focus:outline-none focus:border-indigo-500 transition-colors"
                                placeholder="Ex: 2.69 / 13.49 / 40.49"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-fg-muted mb-1">Preço Anual/mês (USD)</label>
                            <input
                                type="number"
                                step="0.01"
                                value={newPlan.annualMonthlyPrice}
                                onChange={(e) => setNewPlan({ ...newPlan, annualMonthlyPrice: e.target.value })}
                                className="w-full bg-canvas border border-line rounded-lg px-4 py-2.5 text-fg focus:outline-none focus:border-indigo-500 transition-colors"
                                placeholder="Ex: 1.99 / 9.99 / 29.99"
                            />
                        </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                        <div>
                            <label className="block text-sm font-medium text-fg-muted mb-1">Preço Antigo (USD)</label>
                            <input
                                type="number"
                                step="0.01"
                                value={newPlan.compareAtPrice}
                                onChange={(e) => setNewPlan({ ...newPlan, compareAtPrice: e.target.value })}
                                className="w-full bg-canvas border border-line rounded-lg px-4 py-2.5 text-fg focus:outline-none focus:border-indigo-500 transition-colors"
                                placeholder="Ex: 10 / 29 / 49.99"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-fg-muted mb-1">Desconto Badge (%)</label>
                            <input
                                type="number"
                                value={newPlan.promoDiscountPercent}
                                onChange={(e) => setNewPlan({ ...newPlan, promoDiscountPercent: e.target.value })}
                                className="w-full bg-canvas border border-line rounded-lg px-4 py-2.5 text-fg focus:outline-none focus:border-indigo-500 transition-colors"
                                placeholder="35 / 51 / 59"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-fg-muted mb-1">Câmbio DB (MZN por $1)</label>
                            <input
                                type="number"
                                step="0.01"
                                value={newPlan.usdToMznRate}
                                onChange={(e) => setNewPlan({ ...newPlan, usdToMznRate: e.target.value })}
                                className="w-full bg-canvas border border-line rounded-lg px-4 py-2.5 text-fg focus:outline-none focus:border-indigo-500 transition-colors"
                                placeholder="74"
                            />
                        </div>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                        <div>
                            <label className="block text-xs font-medium text-fg-muted mb-1">BF Mensal (%)</label>
                            <input
                                type="number"
                                value={newPlan.monthlyDiscountPercent}
                                onChange={(e) => setNewPlan({ ...newPlan, monthlyDiscountPercent: e.target.value })}
                                className="w-full bg-canvas border border-line rounded-lg px-3 py-2 text-xs text-fg focus:outline-none focus:border-indigo-500"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-fg-muted mb-1">Trimestre (%)</label>
                            <input
                                type="number"
                                value={newPlan.quarterlyDiscountPercent}
                                onChange={(e) => setNewPlan({ ...newPlan, quarterlyDiscountPercent: e.target.value })}
                                className="w-full bg-canvas border border-line rounded-lg px-3 py-2 text-xs text-fg focus:outline-none focus:border-indigo-500"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-fg-muted mb-1">Anual (%)</label>
                            <input
                                type="number"
                                value={newPlan.annualDiscountPercent}
                                onChange={(e) => setNewPlan({ ...newPlan, annualDiscountPercent: e.target.value })}
                                className="w-full bg-canvas border border-line rounded-lg px-3 py-2 text-xs text-fg focus:outline-none focus:border-indigo-500"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-fg-muted mb-1">Bianual (%)</label>
                            <input
                                type="number"
                                value={newPlan.biennialDiscountPercent}
                                onChange={(e) => setNewPlan({ ...newPlan, biennialDiscountPercent: e.target.value })}
                                className="w-full bg-canvas border border-line rounded-lg px-3 py-2 text-xs text-fg focus:outline-none focus:border-indigo-500"
                            />
                        </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                        <div>
                            <label className="block text-sm font-medium text-fg-muted mb-1">Contas Trading</label>
                            <input
                                type="number"
                                value={newPlan.maxTradingAccounts}
                                onChange={(e) => setNewPlan({ ...newPlan, maxTradingAccounts: e.target.value })}
                                className="w-full bg-canvas border border-line rounded-lg px-4 py-2.5 text-fg focus:outline-none focus:border-indigo-500 transition-colors"
                                placeholder="1 ou -1 (ilimitado)"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-fg-muted mb-1">Backtests / mês</label>
                            <input
                                type="number"
                                min={0}
                                value={newPlan.monthlyBacktestsLimit}
                                onChange={(e) => setNewPlan({ ...newPlan, monthlyBacktestsLimit: e.target.value })}
                                className="w-full bg-canvas border border-line rounded-lg px-4 py-2.5 text-fg focus:outline-none focus:border-indigo-500 transition-colors"
                                placeholder="0 / 10 / 100"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-fg-muted mb-1">Dias de Teste</label>
                            <input
                                type="number"
                                value={newPlan.trialDays}
                                onChange={(e) => setNewPlan({ ...newPlan, trialDays: e.target.value })}
                                className="w-full bg-canvas border border-line rounded-lg px-4 py-2.5 text-fg focus:outline-none focus:border-indigo-500 transition-colors"
                                placeholder="0"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-fg-muted mb-1">
                            Créditos AI Mensais
                        </label>
                        <input
                            type="number"
                            min={0}
                            value={newPlan.aiDailyCredits}
                            onChange={(e) => setNewPlan({ ...newPlan, aiDailyCredits: e.target.value })}
                            className="w-full bg-canvas border border-line rounded-lg px-4 py-2.5 text-fg focus:outline-none focus:border-indigo-500 transition-colors"
                            placeholder="Ex: 0 (BASIC), 1500 (PRO), 4000 (PREMIUM)"
                            required
                        />
                    </div>

                    <Button
                        variant="primary"
                        type="submit"
                        isLoading={isCreating}
                        className="w-full mt-4"
                    >
                        {editingPlanId ? "Salvar Alterações" : "Criar Plano"}
                    </Button>
                </form>
            </Modal>
        </div>
    );
};
