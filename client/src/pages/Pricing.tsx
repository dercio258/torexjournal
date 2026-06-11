import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Check, CheckCircle, Loader2 } from 'lucide-react';
import api from '../api';
import { useAuth } from '../context/AuthContext';

interface PlanConfig {
    id: string;
    tier: 'BASIC' | 'PRO';
    monthlyPrice: number;
    annualDiscountPercent: number;
    trialEnabled: boolean;
    trialDays: number;
    description?: string;
    features?: string[];
}

export const Pricing = () => {
    const navigate = useNavigate();
    const { token } = useAuth();
    const [user, setUser] = useState<any>(null);
    const [billingCycle, setBillingCycle] = useState<'MONTHLY' | 'YEARLY'>('MONTHLY');
    const [plans, setPlans] = useState<PlanConfig[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (token) {
            api.get('/auth/profile').then(res => setUser(res.data)).catch(console.error);
        }
    }, [token]);


    const [pricingConfig, setPricingConfig] = useState<any>(null);

    useEffect(() => {
        const fetchPricingAndPlans = async () => {
            try {
                const pricingRes = await api.get('/payment/pricing-config');
                setPricingConfig(pricingRes.data);

                const plansRes = await api.get('/subscription/plans');
                const mappedPlans = plansRes.data.map((plan: any) => {
                    const features = plan.tier === 'BASIC'
                        ? [
                            'Painel de Performance',
                            'Diário (Apenas Calendário)',
                            'Importação Manual (CSV)',
                            'Acesso à Network (Apenas Leitura)',
                            'Gestão Emocional',
                            'Configuração Telegram'
                          ]
                        : [
                            'Tudo do Plano Básico',
                            'Auto-Sync (MT4, MT5, Deriv)',
                            'Backtest Ilimitado',
                            'Relatórios Avançados',
                            'Calendário Econômico',
                            'IA Torex Analyst Pro',
                            'Interação na Network (Postar/Comentar)'
                          ];

                    return {
                        id: plan.id,
                        tier: plan.tier,
                        monthlyPrice: Number(plan.monthlyPrice),
                        annualDiscountPercent: Number(plan.annualDiscountPercent),
                        trialEnabled: plan.trialEnabled,
                        trialDays: plan.trialDays,
                        description: plan.description,
                        features: plan.features && plan.features.length > 0 ? plan.features : features
                    };
                });
                setPlans(mappedPlans);
            } catch (error) {
                console.error("Failed to load pricing or plans config", error);
            } finally {
                setIsLoading(false);
            }
        };
        fetchPricingAndPlans();
    }, []);

    const handleSubscribe = (plan: PlanConfig) => {
        if (!user) {
            navigate('/register');
            return;
        }

        // Navigate to checkout with plan details
        navigate('/checkout', {
            state: {
                plan,
                billingCycle,
                pricingConfig
            }
        });
    };

    const getPrice = (plan: PlanConfig) => {
        if (billingCycle === 'MONTHLY') return plan.monthlyPrice;
        const total = plan.monthlyPrice * 12;
        const discount = total * (plan.annualDiscountPercent / 100);
        return (total - discount) / 12; // Price per month equivalent
    };

    const getBasicPlan = () => plans.find(p => p.tier === 'BASIC');
    const getProPlan = () => plans.find(p => p.tier === 'PRO');

    if (isLoading) {
        return <div className="min-h-screen bg-slate-900 flex items-center justify-center"><Loader2 className="animate-spin text-emerald-500" /></div>;
    }

    const basicPlan = getBasicPlan();
    const proPlan = getProPlan();

    return (
        <div className="min-h-screen py-12 px-4 bg-slate-950">
            <div className="max-w-6xl mx-auto">
                <div className="text-center mb-12">
                    <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">Escolha seu Plano</h1>
                    <p className="text-slate-400 text-lg max-w-2xl mx-auto mb-8">
                        Desbloqueie todo o potencial do TOREX JOURNAL.
                    </p>

                    {/* Toggle */}
                    <div className="inline-flex bg-slate-900 rounded-full p-1 border border-slate-800 relative">
                        <button
                            onClick={() => setBillingCycle('MONTHLY')}
                            className={`px-6 py-2 rounded-full text-sm font-bold transition-all ${billingCycle === 'MONTHLY' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
                        >
                            Mensal
                        </button>
                        <button
                            onClick={() => setBillingCycle('YEARLY')}
                            className={`px-6 py-2 rounded-full text-sm font-bold transition-all ${billingCycle === 'YEARLY' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
                        >
                            Anual <span className="text-xs text-emerald-300 ml-1">-20%</span>
                        </button>
                    </div>
                </div>

                <div className="grid md:grid-cols-2 gap-8 mb-12">
                    {/* Basic Plan */}
                    {basicPlan && (
                        <Card className="p-8 border-slate-700/50 bg-slate-900/40">
                            <div className="text-center mb-6">
                                <h2 className="text-2xl font-bold text-emerald-400 mb-2">Básico</h2>
                                <div className="flex items-baseline justify-center gap-1">
                                    <span className="text-sm text-slate-400 align-top mt-2">MT</span>
                                    <span className="text-5xl font-bold text-white">{getPrice(basicPlan).toFixed(2)}</span>
                                    <span className="text-sm text-slate-500 self-end mb-2">/mês</span>
                                </div>
                                {pricingConfig && (
                                    <p className="text-xs text-slate-500 mt-1">
                                        ~ ${(getPrice(basicPlan) / pricingConfig.exchangeRate).toFixed(2)} USD
                                    </p>
                                )}
                                <p className="text-sm text-slate-500 mt-2">Para quem está começando</p>
                            </div>
                            <p className="text-sm text-slate-500 mt-2">{basicPlan.description}</p>

                            <ul className="space-y-4 mb-8">
                                {basicPlan.features?.map((item, i) => (
                                    <li key={i} className="flex items-center gap-3 text-slate-300">
                                        <Check className="w-5 h-5 text-emerald-500" />
                                        <span>{item}</span>
                                    </li>
                                ))}
                                {(!basicPlan.features || basicPlan.features.length === 0) && (
                                    <li className="text-slate-500 italic">Sem funcionalidades listadas</li>
                                )}
                            </ul>
                            <Button
                                variant="primary"
                                className="w-full py-4 rounded-xl"
                                onClick={() => handleSubscribe(basicPlan)}
                            >
                                Começar Agora
                            </Button>
                        </Card>
                    )}

                    {/* Pro Plan */}
                    {proPlan && (
                        <Card className="p-8 border-indigo-500/50 bg-slate-900/60 relative overflow-hidden">
                            <div className="absolute top-0 right-0 bg-indigo-600 text-white text-xs font-bold px-4 py-1 rounded-bl-xl">
                                RECOMENDADO
                            </div>
                            <div className="text-center mb-6">
                                <h2 className="text-2xl font-bold text-indigo-400 mb-2">Premium</h2>
                                <div className="flex items-baseline justify-center gap-1">
                                    <span className="text-sm text-slate-400 align-top mt-2">MT</span>
                                    <span className="text-5xl font-bold text-white">{getPrice(proPlan).toFixed(2)}</span>
                                    <span className="text-sm text-slate-500 self-end mb-2">/mês</span>
                                </div>
                                {pricingConfig && (
                                    <p className="text-xs text-slate-500 mt-1">
                                        ~ ${(getPrice(proPlan) / pricingConfig.exchangeRate).toFixed(2)} USD
                                    </p>
                                )}
                                {billingCycle === 'YEARLY' && (
                                    <p className="text-xs text-emerald-400 mt-2 font-bold">Economize 20% no plano anual</p>
                                )}
                            </div>
                            <ul className="space-y-4 mb-8">
                                {proPlan.features?.map((item, i) => (
                                    <li key={i} className="flex items-center gap-3 text-slate-300">
                                        <CheckCircle className="w-5 h-5 text-indigo-500" />
                                        <span>{item}</span>
                                    </li>
                                ))}
                                {(!proPlan.features || proPlan.features.length === 0) && (
                                    <li className="text-slate-500 italic">Sem funcionalidades listadas</li>
                                )}
                            </ul>
                            <Button
                                variant="gradient"
                                className="w-full py-4 rounded-xl"
                                onClick={() => handleSubscribe(proPlan)}
                            >
                                Assinar Premium
                            </Button>
                        </Card>
                    )}
                </div>
            </div>
        </div >
    );
};
