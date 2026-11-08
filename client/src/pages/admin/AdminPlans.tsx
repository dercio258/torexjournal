import { useState, useEffect } from 'react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Edit, Check, Gift, Sparkles, Power, Users, Clock, ShieldCheck, CheckCircle2 } from 'lucide-react';
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
    const [trialMessage, setTrialMessage] = useState<string | null>(null);

    // Modal State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [newPlan, setNewPlan] = useState<any>({
        tier: '',
        description: '',
        features: '', // comma separated string for input
        monthlyPrice: '',
        annualDiscountPercent: '20',
        trialDays: '0'
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
        setTrialMessage(null);
        try {
            const nextState = !trialCampaign.active;
            const { data } = await api.post('/admin/trial-campaign/toggle', {
                enabled: nextState,
                days: 30
            });
            setTrialCampaign(data);
            setTrialMessage(
                nextState
                    ? 'Campanha de Trial ATIVADA com sucesso! Todos os novos traders sem plano ativo receberão 30 dias de Plano Premium grátis ao acessar o painel.'
                    : 'Campanha de Trial PAUSADA. Novos trials não serão concedidos automaticamente.'
            );
            setTimeout(() => setTrialMessage(null), 7000);
            fetchPlans();
        } catch (error) {
            console.error('Error toggling trial:', error);
            alert('Falha ao alternar status do período de teste.');
        } finally {
            setIsTogglingTrial(false);
        }
    };

    const handleCreateOrUpdatePlan = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsCreating(true);
        try {
            const planData = {
                tier: newPlan.tier.toUpperCase(),
                description: newPlan.description,
                features: newPlan.features.split(',').map((f: string) => f.trim()).filter((f: string) => f),
                monthlyPrice: parseFloat(newPlan.monthlyPrice),
                annualDiscountPercent: parseInt(newPlan.annualDiscountPercent),
                trialEnabled: parseInt(newPlan.trialDays) > 0,
                trialDays: parseInt(newPlan.trialDays),
                isActive: true
            };

            if (editingPlanId) {
                await api.patch(`/admin/plans/${editingPlanId}`, planData);
                alert('Plano atualizado com sucesso!');
            } else {
                await api.post('/admin/plans', planData);
                alert('Plano criado com sucesso!');
            }

            setIsModalOpen(false);
            setEditingPlanId(null);
            setNewPlan({ tier: '', description: '', features: '', monthlyPrice: '', annualDiscountPercent: '20', trialDays: '0' });
            fetchPlans();
        } catch (error) {
            console.error(error);
            alert(`Erro ao ${editingPlanId ? 'atualizar' : 'criar'} plano.`);
        } finally {
            setIsCreating(false);
        }
    };

    const openEditModal = (plan: any) => {
        setEditingPlanId(plan.id);
        setNewPlan({
            tier: plan.tier,
            description: plan.description || '',
            features: plan.features?.join(', ') || '',
            monthlyPrice: plan.monthlyPrice.toString(),
            annualDiscountPercent: plan.annualDiscountPercent.toString(),
            trialDays: plan.trialDays.toString()
        });
        setIsModalOpen(true);
    };

    if (isLoading) return <div className="text-fg">Carregando...</div>;

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-3xl font-bold text-fg">Planos de Assinatura</h1>
            </div>

            {/* Notificação Toast de Alteração de Estado do Trial */}
            {trialMessage && (
                <div className="mb-6 p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-accent-fg flex items-center gap-3 animate-in fade-in slide-in-from-top-2 duration-200">
                    <CheckCircle2 size={20} className="shrink-0 text-accent-fg" />
                    <span className="text-sm font-medium">{trialMessage}</span>
                </div>
            )}

            {/* CARD INSTITUCIONAL: CAMPANHA DE PERÍODO DE TESTE (TRIAL 30 DIAS) */}
            <div className="mb-8 bg-gradient-to-r from-slate-900 via-slate-900 to-slate-950 border border-line rounded-3xl p-6 sm:p-7 relative overflow-hidden shadow-xl">
                <div className="absolute top-0 right-0 w-80 h-80 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />

                <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 relative z-10">
                    <div className="space-y-3 max-w-2xl">
                        <div className="flex items-center gap-2.5">
                            <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
                                <Gift size={20} />
                            </div>
                            <span className="text-xs font-black uppercase tracking-widest text-fg-muted">
                                Campanha Global de Onboarding
                            </span>
                            <span className={`text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-full border flex items-center gap-1.5 ${
                                trialCampaign?.active 
                                    ? 'bg-emerald-500/10 border-emerald-500/30 text-accent-fg' 
                                    : 'bg-surface-2 border-line-strong text-fg-muted'
                            }`}>
                                <span className={`w-2 h-2 rounded-full ${trialCampaign?.active ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
                                {trialCampaign?.active ? 'Campanha Ativa' : 'Pausada'}
                            </span>
                        </div>

                        <h2 className="text-xl sm:text-2xl font-black text-fg tracking-tight">
                            Período de Teste Gratuito (Trial de 30 Dias Premium)
                        </h2>

                        <p className="text-xs sm:text-sm text-fg-muted leading-relaxed">
                            Quando ativada, qualquer novo trader que acessar o sistema sem um plano ativo recebe 
                            automaticamente <strong className="text-fg font-bold">30 dias de Plano Premium grátis</strong> de forma instantânea, com disparo de e-mail formal de boas-vindas. Usuários que já usufruíram do teste uma vez são bloqueados de receber novamente e direcionados à página de preços.
                        </p>

                        <div className="flex flex-wrap items-center gap-3 sm:gap-4 pt-1 text-xs text-fg/80">
                            <div className="flex items-center gap-1.5 bg-canvas/60 px-3 py-1.5 rounded-xl border border-line">
                                <ShieldCheck size={14} className="text-accent-fg" />
                                <span>Plano Concedido: <strong className="text-fg">PREMIUM (PRO)</strong></span>
                            </div>

                            <div className="flex items-center gap-1.5 bg-canvas/60 px-3 py-1.5 rounded-xl border border-line">
                                <Clock size={14} className="text-amber-400" />
                                <span>Duração: <strong className="text-fg">{trialCampaign?.trialDays || 30} Dias</strong></span>
                            </div>

                            <div className="flex items-center gap-1.5 bg-canvas/60 px-3 py-1.5 rounded-xl border border-line">
                                <Users size={14} className="text-indigo-400" />
                                <span>Total Beneficiados: <strong className="text-accent-fg font-bold">{trialCampaign?.totalTrialsGranted ?? 0} traders</strong></span>
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-col sm:flex-row lg:flex-col items-stretch sm:items-center lg:items-end gap-3 w-full lg:w-auto shrink-0">
                        <Button
                            variant={trialCampaign?.active ? "secondary" : "primary"}
                            onClick={handleToggleTrial}
                            isLoading={isTogglingTrial}
                            className={`py-3.5 px-6 rounded-xl font-bold text-xs sm:text-sm shadow-lg transition-all flex items-center justify-center gap-2 ${
                                trialCampaign?.active 
                                    ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-500/10' 
                                    : 'bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 font-black shadow-emerald-500/20'
                            }`}
                        >
                            {trialCampaign?.active ? (
                                <>
                                    <Power size={16} />
                                    Pausar Período de Teste
                                </>
                            ) : (
                                <>
                                    <Sparkles size={16} />
                                    Ativar Período de Teste (30 Dias)
                                </>
                            )}
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
                    setNewPlan({ tier: '', description: '', features: '', monthlyPrice: '', annualDiscountPercent: '20', trialDays: '0' });
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
                        <label className="block text-sm font-medium text-fg-muted mb-1">Preço Mensal (MT)</label>
                        <input
                            type="number"
                            value={newPlan.monthlyPrice}
                            onChange={(e) => setNewPlan({ ...newPlan, monthlyPrice: e.target.value })}
                            className="w-full bg-canvas border border-line rounded-lg px-4 py-2.5 text-fg focus:outline-none focus:border-indigo-500 transition-colors"
                            placeholder="2000"
                            required
                        />
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
