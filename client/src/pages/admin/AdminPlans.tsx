import { useState, useEffect } from 'react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Edit, Check, Plus } from 'lucide-react';
import api from '../../api';

export const AdminPlans = () => {
    const [plans, setPlans] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Modal State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [newPlan, setNewPlan] = useState({
        tier: '',
        description: '',
        features: '', // comma separated string for input
        monthlyPrice: '',
        annualDiscountPercent: '20',
        trialDays: '0'
    });
    const [isCreating, setIsCreating] = useState(false);

    useEffect(() => {
        fetchPlans();
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

    const handleCreatePlan = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsCreating(true);
        try {
            await api.post('/admin/plans', {
                tier: newPlan.tier.toUpperCase(),
                description: newPlan.description,
                features: newPlan.features.split(',').map(f => f.trim()).filter(f => f),
                monthlyPrice: parseFloat(newPlan.monthlyPrice),
                annualDiscountPercent: parseInt(newPlan.annualDiscountPercent),
                trialEnabled: parseInt(newPlan.trialDays) > 0,
                trialDays: parseInt(newPlan.trialDays),
                isActive: true
            });
            alert('Plano criado com sucesso!');
            setIsModalOpen(false);
            setNewPlan({ tier: '', description: '', features: '', monthlyPrice: '', annualDiscountPercent: '20', trialDays: '0' });
            fetchPlans();
        } catch (error) {
            console.error(error);
            alert('Erro ao criar plano.');
        } finally {
            setIsCreating(false);
        }
    };

    if (isLoading) return <div className="text-white">Carregando...</div>;

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-3xl font-bold text-white">Planos de Assinatura</h1>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {plans.map((plan) => (
                    <Card key={plan.id} className="p-6 border-slate-800 bg-slate-900/50">
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <h3 className="text-xl font-bold text-white">{plan.tier}</h3>
                                <p className="text-slate-400 text-sm">ID: ...{plan.id.slice(-6)}</p>
                            </div>
                            {plan.isActive && (
                                <span className="bg-green-500/10 text-green-500 p-1 rounded-full">
                                    <Check size={16} />
                                </span>
                            )}
                        </div>

                        <div className="space-y-3 mb-6">
                            <p className="text-sm text-slate-400 italic">{plan.description}</p>

                            {plan.features && plan.features.length > 0 && (
                                <ul className="text-xs text-slate-300 space-y-1 mb-2">
                                    {plan.features.map((f: string, i: number) => (
                                        <li key={i} className="flex gap-2">
                                            <Check size={12} className="text-emerald-500 mt-0.5" /> {f}
                                        </li>
                                    ))}
                                </ul>
                            )}

                            <div className="flex justify-between text-sm pt-2 border-t border-slate-800">
                                <span className="text-slate-400">Preço Mensal</span>
                                <span className="text-white font-medium">MT {plan.monthlyPrice}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-slate-400">Desconto Anual</span>
                                <span className="text-emerald-400 font-medium">{plan.annualDiscountPercent}%</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-slate-400">Dias de Teste</span>
                                <span className="text-white font-medium">{plan.trialDays} dias</span>
                            </div>
                        </div>

                        <Button variant="secondary" className="w-full" disabled>
                            <Edit className="w-4 h-4 mr-2" />
                            Editar (Em Breve)
                        </Button>
                    </Card>
                ))}

                {/* Add New Plan Card */}
                <button
                    onClick={() => setIsModalOpen(true)}
                    className="p-6 border border-slate-800 bg-slate-900/20 border-dashed rounded-xl flex flex-col items-center justify-center text-slate-500 hover:bg-slate-900/40 hover:text-slate-300 hover:border-slate-700 transition-all cursor-pointer min-h-[300px]"
                >
                    <Plus className="w-12 h-12 mb-4 opacity-50" />
                    <span className="font-medium">Criar Novo Plano</span>
                </button>
            </div>

            <Modal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title="Novo Plano de Assinatura"
            >
                <form onSubmit={handleCreatePlan} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-400 mb-1">Nome do Plano (Tier)</label>
                        <input
                            type="text"
                            value={newPlan.tier}
                            onChange={(e) => setNewPlan({ ...newPlan, tier: e.target.value })}
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-indigo-500 transition-colors"
                            placeholder="Ex: GOLD, VIP, ENTERPRISE"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-400 mb-1">Descrição</label>
                        <input
                            type="text"
                            value={newPlan.description}
                            onChange={(e) => setNewPlan({ ...newPlan, description: e.target.value })}
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-indigo-500 transition-colors"
                            placeholder="Descrição curta (ex: Para iniciantes)"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-400 mb-1">Funcionalidades (separadas por vírgula)</label>
                        <textarea
                            value={newPlan.features}
                            onChange={(e) => setNewPlan({ ...newPlan, features: e.target.value })}
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-indigo-500 transition-colors h-20"
                            placeholder="Ex: Acesso VIP, Sinais Diários, Suporte 24h"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-400 mb-1">Preço Mensal (MT)</label>
                        <input
                            type="number"
                            value={newPlan.monthlyPrice}
                            onChange={(e) => setNewPlan({ ...newPlan, monthlyPrice: e.target.value })}
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-indigo-500 transition-colors"
                            placeholder="2000"
                            required
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-1">Desc. Anual (%)</label>
                            <input
                                type="number"
                                value={newPlan.annualDiscountPercent}
                                onChange={(e) => setNewPlan({ ...newPlan, annualDiscountPercent: e.target.value })}
                                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-indigo-500 transition-colors"
                                placeholder="20"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-1">Dias de Teste</label>
                            <input
                                type="number"
                                value={newPlan.trialDays}
                                onChange={(e) => setNewPlan({ ...newPlan, trialDays: e.target.value })}
                                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-indigo-500 transition-colors"
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
                        Criar Plano
                    </Button>
                </form>
            </Modal>
        </div>
    );
};
