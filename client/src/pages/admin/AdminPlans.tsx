import { useState, useEffect } from 'react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Edit, Check, Gift, Sparkles, Power, Users, Clock, ShieldCheck, CreditCard, Plus } from 'lucide-react';
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
    const [isTogglingTrial, setIsTogglingTrial] = useState(false);
    const [banner, setBanner] = useState<{ tone: 'success' | 'warning' | 'danger' | 'info'; message: string } | null>(null);

    // Modal State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [newPlan, setNewPlan] = useState<any>({
        tier: '',
        description: '',
        features: '', // comma separated string for input
        monthlyPrice: '',
        annualDiscountPercent: '20',
        trialDays: '0',
        aiDailyCredits: '100'
    });
    const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
    const [isCreating, setIsCreating] = useState(false);

    useEffect(() => {
        fetchPlans();
        fetchTrialCampaign();
    }, []);

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
                annualDiscountPercent: parseInt(newPlan.annualDiscountPercent),
                trialEnabled: parseInt(newPlan.trialDays) > 0,
                trialDays: parseInt(newPlan.trialDays),
                aiDailyCredits: parseInt(newPlan.aiDailyCredits) || 100,
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
            setNewPlan({ tier: '', description: '', features: '', monthlyPrice: '', annualDiscountPercent: '20', trialDays: '0', aiDailyCredits: '100' });
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
            plan.tier === 'PREMIUM' ? 20000 : plan.tier === 'PRO' ? 2000 : 100;
        setEditingPlanId(plan.id);
        setNewPlan({
            tier: plan.tier,
            description: plan.description || '',
            features: plan.features?.join(', ') || '',
            monthlyPrice: plan.monthlyPrice.toString(),
            annualDiscountPercent: plan.annualDiscountPercent.toString(),
            trialDays: plan.trialDays.toString(),
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
                    label="Campanha Trial"
                    value={trialCampaign?.active ? 'Ativa' : 'Pausada'}
                    hint={`${trialCampaign?.trialDays || 30} dias Premium`}
                    icon={<Gift className="h-4 w-4" />}
                    tone={trialCampaign?.active ? 'accent' : 'default'}
                />
                <AdminStatCard
                    label="Trials Concedidos"
                    value={trialCampaign?.totalTrialsGranted ?? 0}
                    hint="Total de onboarding"
                    icon={<Users className="h-4 w-4" />}
                    tone="warning"
                />
                <AdminStatCard
                    label="Plano do Trial"
                    value={trialCampaign?.tier || 'PREMIUM'}
                    hint="Tier automático"
                    icon={<ShieldCheck className="h-4 w-4" />}
                />
            </div>

            {/* CARD INSTITUCIONAL: CAMPANHA DE PERÍODO DE TESTE (TRIAL 30 DIAS) */}
            <div className="bg-surface border border-line rounded-2xl p-6 sm:p-7 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-80 h-80 bg-accent/5 rounded-full blur-3xl pointer-events-none" />

                <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 relative z-10">
                    <div className="space-y-3 max-w-2xl">
                        <div className="flex flex-wrap items-center gap-2.5">
                            <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-500">
                                <Gift size={18} />
                            </div>
                            <span className="text-xs font-bold uppercase tracking-widest text-fg-muted">
                                Campanha Global de Onboarding
                            </span>
                            <AdminBadge tone={trialCampaign?.active ? 'success' : 'neutral'} dot>
                                {trialCampaign?.active ? 'Campanha Ativa' : 'Pausada'}
                            </AdminBadge>
                        </div>

                        <h2 className="text-xl sm:text-2xl font-bold text-fg tracking-tight">
                            Período de Teste Gratuito (Trial de 30 Dias Premium)
                        </h2>

                        <p className="text-xs sm:text-sm text-fg-muted leading-relaxed">
                            Quando ativada, qualquer novo trader que acessar o sistema sem um plano ativo recebe
                            automaticamente <strong className="text-fg font-semibold">30 dias de Plano Premium grátis</strong> de forma instantânea, com disparo de e-mail formal de boas-vindas. Usuários que já usufruíram do teste uma vez são bloqueados de receber novamente.
                        </p>

                        <div className="flex flex-wrap items-center gap-3 pt-1 text-xs text-fg-muted">
                            <div className="flex items-center gap-1.5 bg-surface-2 px-3 py-1.5 rounded-xl border border-line">
                                <ShieldCheck size={14} className="text-accent-fg" />
                                <span>Plano Concedido: <strong className="text-fg">PREMIUM (PRO)</strong></span>
                            </div>

                            <div className="flex items-center gap-1.5 bg-surface-2 px-3 py-1.5 rounded-xl border border-line">
                                <Clock size={14} className="text-amber-500" />
                                <span>Duração: <strong className="text-fg">{trialCampaign?.trialDays || 30} Dias</strong></span>
                            </div>

                            <div className="flex items-center gap-1.5 bg-surface-2 px-3 py-1.5 rounded-xl border border-line">
                                <Users size={14} className="text-sky-500" />
                                <span>Total Beneficiados: <strong className="text-accent-fg font-bold">{trialCampaign?.totalTrialsGranted ?? 0} traders</strong></span>
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
                            {trialCampaign?.active ? 'Pausar Período de Teste' : 'Ativar Período de Teste (30 Dias)'}
                        </Button>
                        <span className="text-[11px] text-fg-subtle text-center lg:text-right">
                            {trialCampaign?.active
                                ? 'Novos usuários recebem 30 dias automaticamente'
                                : 'Novos trials suspensos até nova ativação'}
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
                                <span className="text-fg-muted">Preço Mensal</span>
                                <span className="text-fg font-medium">$ {plan.monthlyPrice} USD</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-fg-muted">Preço Anual (Equiv.)</span>
                                <span className="text-accent-fg font-medium">
                                    $ {(Number(plan.monthlyPrice) * 12 * (1 - Number(plan.annualDiscountPercent) / 100)).toFixed(2)} USD
                                </span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-fg-muted">Desconto Anual</span>
                                <span className="text-accent-fg font-medium">{plan.annualDiscountPercent}%</span>
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
                    <div>
                        <label className="block text-sm font-medium text-fg-muted mb-1">Preço Mensal (USD)</label>
                        <input
                            type="number"
                            step="0.01"
                            value={newPlan.monthlyPrice}
                            onChange={(e) => setNewPlan({ ...newPlan, monthlyPrice: e.target.value })}
                            className="w-full bg-canvas border border-line rounded-lg px-4 py-2.5 text-fg focus:outline-none focus:border-indigo-500 transition-colors"
                            placeholder="19"
                            required
                        />
                        <p className="text-[11px] text-fg-subtle mt-1">
                            Equivalente estimado em MZN: {(Number(newPlan.monthlyPrice || 0) * 65).toLocaleString('pt-MZ')} MZN
                        </p>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-fg-muted mb-1">Desc. Anual (%)</label>
                            <input
                                type="number"
                                value={newPlan.annualDiscountPercent}
                                onChange={(e) => setNewPlan({ ...newPlan, annualDiscountPercent: e.target.value })}
                                className="w-full bg-canvas border border-line rounded-lg px-4 py-2.5 text-fg focus:outline-none focus:border-indigo-500 transition-colors"
                                placeholder="20"
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
                            Créditos Diários de IA (reseta a cada dia)
                        </label>
                        <input
                            type="number"
                            min={0}
                            value={newPlan.aiDailyCredits}
                            onChange={(e) => setNewPlan({ ...newPlan, aiDailyCredits: e.target.value })}
                            className="w-full bg-canvas border border-line rounded-lg px-4 py-2.5 text-fg focus:outline-none focus:border-indigo-500 transition-colors"
                            placeholder="Ex: 100 (BASIC), 2000 (PRO), 20000 (PREMIUM)"
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
