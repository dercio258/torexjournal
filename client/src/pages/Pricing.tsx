import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Check, CheckCircle, Crown, Sparkles, Zap } from 'lucide-react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { useLocale } from '../context/LocaleContext';
import { PricingSkeleton } from '../components/ui/Skeleton';
import { buildTaggedUrl, mergeSessionUtmsIntoSearch } from '../lib/attribution';
import { trackButtonClick, trackConversion } from '../lib/tracking';

interface PlanConfig {
    id: string;
    tier: 'BASIC' | 'PRO' | 'PREMIUM' | string;
    monthlyPrice: number;
    annualDiscountPercent: number;
    trialEnabled: boolean;
    trialDays: number;
    aiDailyCredits: number;
    description?: string;
    features?: string[];
}

function getDefaultCreditsForTier(tier: string): number {
    const t = String(tier || '').toUpperCase();
    if (t === 'PREMIUM') return 20000;
    if (t === 'PRO') return 2000;
    if (t === 'BASIC') return 100;
    return 100;
}

function getDefaultFeaturesForTier(tier: string, credits: number, isEn: boolean): string[] {
    const formattedCredits = credits.toLocaleString(isEn ? 'en-US' : 'pt-BR');
    const t = String(tier || '').toUpperCase();
    if (isEn) {
        if (t === 'BASIC') {
            return [
                `${formattedCredits} AI Credits / day (Torex AI)`,
                'Performance Analytics Desk',
                'Trading Journal (Calendar & Notes)',
                'Manual Import (CSV / XLSX / HTML)',
                'Trader Network (Read Access)',
                'Behavioral & Mindset Tracking',
            ];
        }
        if (t === 'PRO') {
            return [
                `${formattedCredits} AI Credits / day (Torex AI Pro)`,
                'Everything in Basic',
                'Auto-Sync (MT4, MT5 & Deriv)',
                'Unlimited Market Replay & Backtesting',
                'Institutional Performance Reports',
                'Full Trader Network Access',
            ];
        }
        return [
            `${formattedCredits} AI Credits / day (Torex AI Ultra)`,
            'Everything in Pro',
            'Deep AI Pattern Audits & Real-Time Guardrails',
            'Multi-Account & Prop Firm DD Monitoring',
            'Full High-Impact Economic Calendar',
            'Priority Desk & Dedicated Support',
        ];
    }
    if (t === 'BASIC') {
        return [
            `${formattedCredits} Créditos de IA / dia (Torex AI)`,
            'Painel de Performance',
            'Diário (Calendário & Notas)',
            'Importação Manual (CSV / HTML)',
            'Acesso à Network (Leitura)',
            'Gestão Emocional',
        ];
    }
    if (t === 'PRO') {
        return [
            `${formattedCredits} Créditos de IA / dia (Torex AI Pro)`,
            'Tudo do Plano Básico',
            'Auto-Sync (MT4, MT5, Deriv)',
            'Backtest & Replay Ilimitado',
            'Relatórios Avançados',
            'Interação na Network (Postar/Comentar)',
        ];
    }
    return [
        `${formattedCredits} Créditos de IA / dia (Torex AI Ultra)`,
        'Tudo do Plano Pro',
        'Análises Profundas de IA & Alertas em Tempo Real',
        'Gestão Multi-Contas & Prop Firm',
        'Calendário Econômico Completo',
        'Prioridade Máxima & Suporte VIP',
    ];
}

export const Pricing = () => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const [billingCycle, setBillingCycle] = useState<'MONTHLY' | 'YEARLY'>('MONTHLY');
    const [plans, setPlans] = useState<PlanConfig[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [pricingConfig, setPricingConfig] = useState<any>(null);

    useEffect(() => {
        const fetchPricingAndPlans = async () => {
            try {
                const [pricingRes, plansRes] = await Promise.all([
                    api.get('/payment/pricing-config'),
                    api.get('/subscription/plans'),
                ]);
                setPricingConfig(pricingRes.data);
                const mappedPlans: PlanConfig[] = plansRes.data.map((plan: any) => {
                    const aiDailyCredits =
                        plan.aiDailyCredits && Number(plan.aiDailyCredits) > 0
                            ? Number(plan.aiDailyCredits)
                            : getDefaultCreditsForTier(plan.tier);
                    const defaultFeatures = getDefaultFeaturesForTier(plan.tier, aiDailyCredits, isEn);
                    const existingFeatures: string[] =
                        !isEn && Array.isArray(plan.features) && plan.features.length > 0
                            ? plan.features
                            : defaultFeatures;
                    const hasCreditsMention = existingFeatures.some((f) =>
                        /cr[eé]ditos|credits/i.test(String(f))
                    );
                    const finalFeatures = hasCreditsMention
                        ? existingFeatures
                        : [
                              isEn
                                  ? `${aiDailyCredits.toLocaleString('en-US')} AI Credits / day (Torex AI)`
                                  : `${aiDailyCredits.toLocaleString('pt-BR')} Créditos de IA / dia (Torex AI)`,
                              ...existingFeatures,
                          ];

                    return {
                        id: plan.id,
                        tier: String(plan.tier || '').toUpperCase(),
                        monthlyPrice: Number(plan.monthlyPrice),
                        annualDiscountPercent: Number(plan.annualDiscountPercent),
                        trialEnabled: Boolean(plan.trialEnabled),
                        trialDays: Number(plan.trialDays || 0),
                        aiDailyCredits,
                        description: plan.description,
                        features: finalFeatures,
                    };
                });

                const orderRank: Record<string, number> = {
                    BASIC: 1,
                    PRO: 2,
                    PREMIUM: 3,
                };
                mappedPlans.sort(
                    (a, b) =>
                        (orderRank[a.tier] ?? 99) - (orderRank[b.tier] ?? 99) ||
                        a.monthlyPrice - b.monthlyPrice
                );

                setPlans(mappedPlans);
            } catch (error) {
                console.error('Failed to load pricing or plans config', error);
            } finally {
                setIsLoading(false);
            }
        };
        fetchPricingAndPlans();
    }, []);

    const handleSubscribe = (plan: PlanConfig) => {
        const tierKey = String(plan.tier || '').toLowerCase();
        trackButtonClick({
            ctaTag: `pricing_select_${tierKey}`,
            intent: `subscribe_${tierKey}_${billingCycle.toLowerCase()}`,
            label: `Subscribe ${plan.tier}`,
            metadata: { tier: plan.tier, billingCycle, price: plan.monthlyPrice },
        });

        if (!user) {
            const taggedRegister = buildTaggedUrl('/register?returnTo=%2Fpricing', {
                ctaTag: `pricing_select_${tierKey}`,
                intent: `subscribe_${tierKey}`,
            });
            navigate(taggedRegister);
            return;
        }

        trackConversion('checkout_started', {
            revenue: getPrice(plan),
            currency: 'USD',
            metadata: { tier: plan.tier, billingCycle },
        });

        const checkoutSearch = mergeSessionUtmsIntoSearch('');
        navigate(`/checkout${checkoutSearch}`, {
            state: {
                plan,
                billingCycle,
                pricingConfig,
            },
        });
    };

    const getPrice = (plan: PlanConfig) => {
        if (billingCycle === 'MONTHLY') return plan.monthlyPrice;
        const total = plan.monthlyPrice * 12;
        const discount = total * (plan.annualDiscountPercent / 100);
        return (total - discount) / 12;
    };

    if (isLoading) {
        return <PricingSkeleton />;
    }

    const exchangeRate = pricingConfig?.exchangeRate ? Number(pricingConfig.exchangeRate) : 65;

    const getPlanDisplayMeta = (tier: string) => {
        if (tier === 'BASIC') {
            return {
                title: isEn ? 'Basic' : 'Básico',
                subtitle: isEn ? 'For traders building consistency' : 'Para quem está começando no trading',
                accentText: 'text-emerald-600 dark:text-emerald-400',
                cardClass:
                    'p-7 sm:p-8 border-slate-200 dark:border-slate-700/50 bg-white dark:bg-slate-900/40 shadow-xl rounded-3xl transition-all hover:shadow-2xl flex flex-col justify-between',
                badge: null,
                creditBadgeClass:
                    'bg-emerald-500/10 border-emerald-500/25 text-emerald-600 dark:text-emerald-400',
                icon: Zap,
                checkIcon: Check,
                checkColor: 'text-emerald-500',
                btnVariant: 'primary' as const,
                btnLabel: isEn ? 'Start Basic' : 'Assinar Básico',
            };
        }
        if (tier === 'PRO') {
            return {
                title: 'Pro',
                subtitle: isEn ? 'For disciplined traders scaling edge' : 'Para traders consistentes em evolução',
                accentText: 'text-indigo-600 dark:text-indigo-400',
                cardClass:
                    'p-7 sm:p-8 border-2 border-indigo-500/60 bg-white dark:bg-slate-900/65 shadow-xl rounded-3xl relative overflow-hidden transition-all hover:shadow-2xl flex flex-col justify-between',
                badge: { text: isEn ? 'MOST POPULAR' : 'POPULAR', bg: 'bg-indigo-600 text-white' },
                creditBadgeClass:
                    'bg-indigo-500/10 border-indigo-500/25 text-indigo-600 dark:text-indigo-400',
                icon: Sparkles,
                checkIcon: CheckCircle,
                checkColor: 'text-indigo-500',
                btnVariant: 'gradient' as const,
                btnLabel: isEn ? 'Go Pro' : 'Assinar Pro',
            };
        }
        return {
            title: tier === 'PREMIUM' ? 'Premium' : tier,
            subtitle: isEn ? 'Desk-grade performance & AI telemetry' : 'Performance máxima & IA intensiva',
            accentText: 'text-amber-600 dark:text-amber-400',
            cardClass:
                'p-7 sm:p-8 border-2 border-amber-500/55 bg-white dark:bg-slate-900/75 shadow-xl rounded-3xl relative overflow-hidden transition-all hover:shadow-2xl flex flex-col justify-between',
            badge: {
                text: isEn ? 'FULL DESK POWER' : 'MÁXIMA POTÊNCIA',
                bg: 'bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950',
            },
            creditBadgeClass:
                'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400',
            icon: Crown,
            checkIcon: CheckCircle,
            checkColor: 'text-amber-500',
            btnVariant: 'gradient' as const,
            btnLabel: isEn ? `Upgrade ${tier === 'PREMIUM' ? 'Premium' : tier}` : `Assinar ${tier === 'PREMIUM' ? 'Premium' : tier}`,
        };
    };

    return (
        <div className="min-h-screen py-12 px-4 bg-canvas text-fg transition-colors duration-200">
            <div className="max-w-7xl mx-auto">
                <div className="text-center mb-12">
                    <h1 className="text-4xl md:text-5xl font-extrabold text-fg mb-4 tracking-tight">
                        {isEn ? 'Choose Your Workspace Plan' : 'Escolha seu Plano'}
                    </h1>
                    <p className="text-fg-muted text-lg max-w-2xl mx-auto mb-8">
                        {isEn
                            ? 'Unlock the full TOREX JOURNAL execution desk with daily Torex AI credits, advanced performance analytics, and broker auto-sync.'
                            : 'Desbloqueie todo o potencial do TOREX JOURNAL com créditos diários renováveis no Torex AI, análises avançadas e sincronização automática.'}
                    </p>

                    {/* Toggle */}
                    <div className="inline-flex bg-slate-200 dark:bg-slate-900 rounded-full p-1 border border-slate-300 dark:border-slate-800 relative shadow-inner">
                        <button
                            onClick={() => setBillingCycle('MONTHLY')}
                            className={`px-6 py-2 rounded-full text-sm font-bold transition-all ${
                                billingCycle === 'MONTHLY'
                                    ? 'bg-indigo-600 text-white shadow-md'
                                    : 'text-fg-muted hover:text-fg '
                            }`}
                        >
                            {isEn ? 'Monthly' : 'Mensal'}
                        </button>
                        <button
                            onClick={() => setBillingCycle('YEARLY')}
                            className={`px-6 py-2 rounded-full text-sm font-bold transition-all ${
                                billingCycle === 'YEARLY'
                                    ? 'bg-indigo-600 text-white shadow-md'
                                    : 'text-fg-muted hover:text-fg '
                            }`}
                        >
                            {isEn ? 'Annual' : 'Anual'}{' '}
                            <span className="text-xs text-emerald-500 dark:text-emerald-300 ml-1 font-extrabold">
                                -20%
                            </span>
                        </button>
                    </div>
                </div>

                <div
                    className={`grid grid-cols-1 ${
                        plans.length >= 3 ? 'lg:grid-cols-3' : 'md:grid-cols-2'
                    } gap-6 lg:gap-8 mb-12 items-stretch`}
                >
                    {plans.map((plan) => {
                        const meta = getPlanDisplayMeta(plan.tier);
                        const TierIcon = meta.icon;
                        const ItemCheck = meta.checkIcon;
                        const isCurrentTier = user?.tier === plan.tier;

                        return (
                            <Card key={plan.id} className={meta.cardClass}>
                                {meta.badge && (
                                    <div
                                        className={`absolute top-0 right-0 text-[11px] font-black px-4 py-1.5 rounded-bl-xl tracking-wider ${meta.badge.bg}`}
                                    >
                                        {meta.badge.text}
                                    </div>
                                )}

                                <div>
                                    <div className="text-center mb-6">
                                        <div className="inline-flex items-center gap-1.5 mb-2">
                                            <TierIcon className={`w-5 h-5 ${meta.accentText}`} />
                                            <h2 className={`text-2xl font-bold ${meta.accentText}`}>
                                                {meta.title}
                                            </h2>
                                        </div>

                                        <div className="flex items-baseline justify-center gap-1.5">
                                            <span className="text-2xl font-bold text-fg-subtle dark:text-slate-400 align-top mt-1">
                                                $
                                            </span>
                                            <span className="text-5xl font-extrabold text-fg font-mono">
                                                {getPrice(plan).toFixed(2)}
                                            </span>
                                            <span className="text-sm font-bold text-fg-subtle dark:text-slate-400 self-end mb-2">
                                                {isEn ? 'USD /mo' : 'USD /mês'}
                                            </span>
                                        </div>

                                        {!isEn && (
                                            <p className="text-xs text-fg-subtle dark:text-slate-400 mt-1 font-mono">
                                                ~ MT {(getPrice(plan) * exchangeRate).toFixed(0)} MZN (M-Pesa / e-Mola)
                                            </p>
                                        )}

                                        {/* Destaque dos Créditos Diários de IA */}
                                        <div className="mt-3 flex justify-center">
                                            <span
                                                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-bold ${meta.creditBadgeClass}`}
                                            >
                                                <Sparkles className="w-3.5 h-3.5" />
                                                <span>
                                                    {plan.aiDailyCredits.toLocaleString(isEn ? 'en-US' : 'pt-BR')}{' '}
                                                    {isEn ? 'AI credits / day' : 'créditos IA / dia'}
                                                </span>
                                            </span>
                                        </div>

                                        <p className="text-xs text-fg-subtle dark:text-slate-400 mt-2.5 font-medium">
                                            {isEn ? meta.subtitle : (plan.description || meta.subtitle)}
                                        </p>

                                        {billingCycle === 'YEARLY' && plan.annualDiscountPercent > 0 && (
                                            <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1.5 font-bold">
                                                {isEn
                                                    ? `Save ${plan.annualDiscountPercent}% on annual billing`
                                                    : `Economize ${plan.annualDiscountPercent}% no plano anual`}
                                            </p>
                                        )}
                                    </div>

                                    <ul className="space-y-3.5 mb-8">
                                        {plan.features?.map((item, i) => (
                                            <li key={i} className="flex items-start gap-3 text-fg-muted">
                                                <ItemCheck
                                                    className={`w-5 h-5 ${meta.checkColor} shrink-0 mt-0.5`}
                                                />
                                                <span className="text-sm font-medium">{item}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>

                                <Button
                                    variant={meta.btnVariant}
                                    className="w-full py-4 rounded-xl font-bold"
                                    onClick={() => handleSubscribe(plan)}
                                >
                                    {isCurrentTier
                                        ? isEn
                                            ? `Renew ${meta.title}`
                                            : `Renovar ${meta.title}`
                                        : meta.btnLabel}
                                </Button>
                            </Card>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};
