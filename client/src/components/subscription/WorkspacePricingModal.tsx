import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
    ArrowLeft,
    Check,
    CheckCircle,
    Copy,
    Crown,
    Loader2,
    LogOut,
    Share2,
    Sparkles,
    Timer,
    X,
    Zap,
} from 'lucide-react';
import api from '../../api';
import { Button } from '../ui/Button';
import { useAuth } from '../../context/AuthContext';
import { useLocale } from '../../context/LocaleContext';
import { buildTaggedUrl, mergeSessionUtmsIntoSearch } from '../../lib/attribution';
import { TRIAL_DAYS_BY_TIER_CLIENT } from '../../lib/planGate';
import { trackButtonClick, trackConversion } from '../../lib/tracking';

export interface WorkspacePlanConfig {
    id: string;
    tier: 'BASIC' | 'PRO' | 'PREMIUM' | string;
    monthlyPrice: number;
    annualMonthlyPrice?: number | null;
    compareAtPrice?: number | null;
    promoDiscountPercent?: number;
    monthlyDiscountPercent: number;
    quarterlyDiscountPercent: number;
    annualDiscountPercent: number;
    biennialDiscountPercent: number;
    maxTradingAccounts?: number;
    monthlyBacktestsLimit?: number;
    trialEnabled: boolean;
    trialDays: number;
    aiDailyCredits: number;
    description?: string;
    features?: string[];
}

interface WorkspacePricingModalProps {
    isOpen: boolean;
    dismissible: boolean;
    onClose?: () => void;
    onActivated?: () => void;
    isExpired?: boolean;
    trialEligible?: boolean;
}

function getDefaultCreditsForTier(tier: string): number {
    const t = String(tier || '').toUpperCase();
    if (t === 'PREMIUM') return 4000;
    if (t === 'PRO') return 1500;
    return 0;
}

function getDefaultFeaturesForTier(tier: string, credits: number, isEn: boolean): string[] {
    const formattedCredits = credits.toLocaleString(isEn ? 'en-US' : 'pt-BR');
    const t = String(tier || '').toUpperCase();
    if (isEn) {
        if (t === 'BASIC') {
            return [
                '1 active trading account',
                `${formattedCredits} AI credits / month`,
                'Torex AI',
                'Automated Journal',
                'Community',
                'Website reports (view & download)',
            ];
        }
        if (t === 'PRO') {
            return [
                'Unlimited trading accounts',
                `${formattedCredits} AI credits / month`,
                '10 automated backtesting runs / month',
                'Test unlimited strategies',
                'Trade Replay',
                'Mentor Mode',
                'Monthly email performance report',
                'Offline Mode (except Trade Replay)',
            ];
        }
        return [
            'Everything in Pro',
            `${formattedCredits} AI credits / month`,
            '100 automated backtesting runs / month',
            'Mentor Mode: unlimited invites',
            'Weekly email performance report',
            'Priority support',
            'Full Offline Mode (including Replay)',
        ];
    }
    if (t === 'BASIC') {
        return [
            '1 Conta de Trading ativa',
            `${formattedCredits} Créditos AI / mês`,
            'Torex AI',
            'Diário Automatizado',
            'Comunidade',
            'Relatórios operacionais no site (visualizar e baixar)',
        ];
    }
    if (t === 'PRO') {
        return [
            'Contas de Trading ilimitadas',
            `${formattedCredits} Créditos AI / mês`,
            '10 Sessões de Backtest / mês',
            'Teste de Estratégias ilimitado',
            'Trade Replay',
            'Mentor Mode',
            'Relatório operacional mensal por e-mail',
            'Modo Offline (exceto Trade Replay)',
        ];
    }
    return [
        'Tudo do Plano Pro',
        `${formattedCredits} Créditos AI / mês`,
        '100 Automated Backtesting Runs / month',
        'Mentor Mode: unlimited invites',
        'Relatório operacional semanal por e-mail',
        'Suporte Prioritário',
        'Modo Offline completo (incluindo Replay)',
    ];
}

const FALLBACK_PLANS: WorkspacePlanConfig[] = [
    {
        id: 'fallback-basic',
        tier: 'BASIC',
        monthlyPrice: 2.99,
        annualMonthlyPrice: 2.24,
        compareAtPrice: 2.99,
        promoDiscountPercent: 25,
        monthlyDiscountPercent: 20,
        quarterlyDiscountPercent: 5,
        annualDiscountPercent: 25,
        biennialDiscountPercent: 29,
        maxTradingAccounts: 1,
        monthlyBacktestsLimit: 0,
        trialEnabled: true,
        trialDays: 30,
        aiDailyCredits: 0,
    },
    {
        id: 'fallback-pro',
        tier: 'PRO',
        monthlyPrice: 19.99,
        annualMonthlyPrice: 12.99,
        compareAtPrice: 19.99,
        promoDiscountPercent: 35,
        monthlyDiscountPercent: 20,
        quarterlyDiscountPercent: 9,
        annualDiscountPercent: 35,
        biennialDiscountPercent: 44,
        maxTradingAccounts: -1,
        monthlyBacktestsLimit: 10,
        trialEnabled: true,
        trialDays: 14,
        aiDailyCredits: 1500,
    },
    {
        id: 'fallback-premium',
        tier: 'PREMIUM',
        monthlyPrice: 39.99,
        annualMonthlyPrice: 20.39,
        compareAtPrice: 39.99,
        promoDiscountPercent: 49,
        monthlyDiscountPercent: 20,
        quarterlyDiscountPercent: 19,
        annualDiscountPercent: 49,
        biennialDiscountPercent: 51,
        maxTradingAccounts: -1,
        monthlyBacktestsLimit: 100,
        trialEnabled: true,
        trialDays: 7,
        aiDailyCredits: 4000,
    },
];

export const WorkspacePricingModal: React.FC<WorkspacePricingModalProps> = ({
    isOpen,
    dismissible,
    onClose,
    onActivated,
    isExpired = false,
    trialEligible = false,
}) => {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { user, logout, refreshProfile } = useAuth();
    const { locale } = useLocale();
    const isEn = locale === 'en';

    const [billingCycle, setBillingCycle] = useState<'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'BIENNIAL'>('YEARLY');
    const [plans, setPlans] = useState<WorkspacePlanConfig[]>(FALLBACK_PLANS);
    const [isFetchingPlans, setIsFetchingPlans] = useState(false);

    const canOfferTrial = Boolean(user && trialEligible);
    const [trialOptionByTier, setTrialOptionByTier] = useState<
        Record<'BASIC' | 'PRO' | 'PREMIUM', 'TRIAL' | 'PAID'>
    >(() => {
        const initialMode = canOfferTrial ? 'TRIAL' : 'PAID';
        return {
            BASIC: initialMode,
            PRO: initialMode,
            PREMIUM: initialMode,
        };
    });
    const [activatingTrialTier, setActivatingTrialTier] = useState<string | null>(null);
    const [trialError, setTrialError] = useState<string | null>(null);
    const [localTrialDisabled, setLocalTrialDisabled] = useState(false);

    // Affiliate Share Gate step for Free Trial activation (requires sharing + 30s wait)
    const [trialGatePlan, setTrialGatePlan] = useState<WorkspacePlanConfig | null>(null);
    const [referralShareUrl, setReferralShareUrl] = useState<string>(() =>
        typeof window !== 'undefined' ? `${window.location.origin}/register` : 'https://torexjournal.com/register',
    );
    const [hasSharedForTrial, setHasSharedForTrial] = useState(false);
    const [shareCooldownSeconds, setShareCooldownSeconds] = useState(30);
    const [isPreparingShare, setIsPreparingShare] = useState(false);
    const [copiedShareLink, setCopiedShareLink] = useState(false);

    const effectiveTrialAvailable = canOfferTrial && !localTrialDisabled;

    useEffect(() => {
        if (!isOpen) {
            setTrialGatePlan(null);
            setHasSharedForTrial(false);
            setShareCooldownSeconds(30);
            setCopiedShareLink(false);
        }
    }, [isOpen]);

    useEffect(() => {
        if (!trialGatePlan || !user) return;
        let active = true;
        api.get('/referrals/me', { params: { context: 'trial' } })
            .then((res) => {
                if (active && res.data?.shareUrl) {
                    setReferralShareUrl(String(res.data.shareUrl));
                }
            })
            .catch(() => {
                // keep fallback registration URL
            });
        return () => {
            active = false;
        };
    }, [trialGatePlan, user]);

    useEffect(() => {
        if (!trialGatePlan || !hasSharedForTrial || shareCooldownSeconds <= 0) return;
        const timer = window.setInterval(() => {
            setShareCooldownSeconds((prev) => (prev <= 1 ? 0 : prev - 1));
        }, 1000);
        return () => window.clearInterval(timer);
    }, [trialGatePlan, hasSharedForTrial, shareCooldownSeconds]);

    useEffect(() => {
        const nextMode = effectiveTrialAvailable ? 'TRIAL' : 'PAID';
        setTrialOptionByTier({
            BASIC: nextMode,
            PRO: nextMode,
            PREMIUM: nextMode,
        });
    }, [effectiveTrialAvailable]);

    useEffect(() => {
        if (!isOpen) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (dismissible && onClose) {
                    onClose();
                } else {
                    e.preventDefault();
                    e.stopPropagation();
                }
            }
        };
        window.addEventListener('keydown', onKeyDown, true);
        return () => window.removeEventListener('keydown', onKeyDown, true);
    }, [isOpen, dismissible, onClose]);

    useEffect(() => {
        if (!isOpen) return;
        let active = true;
        setIsFetchingPlans(true);
        api.get('/payment/plans')
            .then((plansRes) => {
                if (!active) return;
                const mapped: WorkspacePlanConfig[] = (plansRes.data || []).map((plan: any) => {
                    const aiCredits =
                        plan.aiDailyCredits !== null && plan.aiDailyCredits !== undefined
                            ? Number(plan.aiDailyCredits)
                            : getDefaultCreditsForTier(plan.tier);
                    const defaultFeatures = getDefaultFeaturesForTier(plan.tier, aiCredits, isEn);
                    const rawFeatures: string[] =
                        !isEn && Array.isArray(plan.features) && plan.features.length > 0
                            ? plan.features
                            : defaultFeatures;

                    return {
                        id: plan.id,
                        tier: String(plan.tier || '').toUpperCase(),
                        monthlyPrice: Number(plan.monthlyPrice),
                        annualMonthlyPrice:
                            plan.annualMonthlyPrice !== null && plan.annualMonthlyPrice !== undefined
                                ? Number(plan.annualMonthlyPrice)
                                : null,
                        compareAtPrice:
                            plan.compareAtPrice !== null && plan.compareAtPrice !== undefined
                                ? Number(plan.compareAtPrice)
                                : null,
                        promoDiscountPercent: Number(plan.promoDiscountPercent || 0),
                        monthlyDiscountPercent: Number(plan.monthlyDiscountPercent ?? 20),
                        quarterlyDiscountPercent: Number(
                            plan.quarterlyDiscountPercent ??
                                (String(plan.tier || '').toUpperCase() === 'PREMIUM'
                                    ? 19
                                    : String(plan.tier || '').toUpperCase() === 'PRO'
                                      ? 9
                                      : 5),
                        ),
                        annualDiscountPercent: Number(
                            plan.annualDiscountPercent ??
                                (String(plan.tier || '').toUpperCase() === 'PREMIUM'
                                    ? 49
                                    : String(plan.tier || '').toUpperCase() === 'PRO'
                                      ? 35
                                      : 25),
                        ),
                        biennialDiscountPercent: Number(
                            plan.biennialDiscountPercent ??
                                (String(plan.tier || '').toUpperCase() === 'PREMIUM'
                                    ? 51
                                    : String(plan.tier || '').toUpperCase() === 'PRO'
                                      ? 44
                                      : 29),
                        ),
                        maxTradingAccounts: Number(plan.maxTradingAccounts ?? 1),
                        monthlyBacktestsLimit: Number(plan.monthlyBacktestsLimit ?? 0),
                        trialEnabled: Boolean(plan.trialEnabled),
                        trialDays: Number(plan.trialDays || 0),
                        aiDailyCredits: aiCredits,
                        description: plan.description,
                        features: rawFeatures,
                    };
                });

                if (mapped.length > 0) {
                    const rank: Record<string, number> = { BASIC: 1, PRO: 2, PREMIUM: 3 };
                    mapped.sort((a, b) => (rank[a.tier] || 99) - (rank[b.tier] || 99));
                    setPlans(mapped);
                }
            })
            .catch(() => {
                // Keeps static fallback plans on transient error
            })
            .finally(() => {
                if (active) setIsFetchingPlans(false);
            });
        return () => {
            active = false;
        };
    }, [isOpen, isEn]);

    if (!isOpen) return null;

    const getCycleMonths = (cycle: 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'BIENNIAL') => {
        if (cycle === 'BIENNIAL') return 24;
        if (cycle === 'YEARLY') return 12;
        if (cycle === 'QUARTERLY') return 3;
        return 1;
    };

    const getDiscountPercent = (
        plan: WorkspacePlanConfig,
        cycle: 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'BIENNIAL' = billingCycle,
    ) => {
        const tierUpper = String(plan.tier || '').toUpperCase();
        if (cycle === 'MONTHLY') {
            return Number(plan.monthlyDiscountPercent ?? 20);
        }
        if (cycle === 'QUARTERLY') {
            return Number(
                plan.quarterlyDiscountPercent ??
                    (tierUpper === 'PREMIUM' ? 19 : tierUpper === 'PRO' ? 9 : 5),
            );
        }
        if (cycle === 'BIENNIAL') {
            return Number(
                plan.biennialDiscountPercent ??
                    (tierUpper === 'PREMIUM' ? 51 : tierUpper === 'PRO' ? 44 : 29),
            );
        }
        return Number(
            plan.annualDiscountPercent ??
                (tierUpper === 'PREMIUM' ? 49 : tierUpper === 'PRO' ? 35 : 25),
        );
    };

    const getPrice = (plan: WorkspacePlanConfig) => {
        const discountPct = getDiscountPercent(plan, billingCycle);
        return Number((plan.monthlyPrice * (1 - discountPct / 100)).toFixed(2));
    };

    const getCycleTotalUsd = (plan: WorkspacePlanConfig) => {
        return Number((getPrice(plan) * getCycleMonths(billingCycle)).toFixed(2));
    };

    const handleSelectPlan = async (plan: WorkspacePlanConfig) => {
        const tierKey = String(plan.tier || 'basic').toLowerCase();
        setTrialError(null);

        trackButtonClick({
            ctaTag: `modal_plan_select_${tierKey}`,
            intent: `subscribe_${tierKey}`,
            label: `Select ${plan.tier} (${billingCycle})`,
            metadata: { tier: plan.tier, billingCycle },
        });

        if (!user) {
            const taggedRegister = buildTaggedUrl('/register?returnTo=%2Fdashboard%3Fplans%3D1', {
                ctaTag: `modal_plan_select_${tierKey}`,
                intent: `subscribe_${tierKey}`,
            });
            navigate(taggedRegister);
            return;
        }

        const tierUpper = String(plan.tier || 'BASIC').toUpperCase() as 'BASIC' | 'PRO' | 'PREMIUM';
        const tierTrialDays = TRIAL_DAYS_BY_TIER_CLIENT[tierUpper] ?? 0;
        const selectedTrial =
            effectiveTrialAvailable &&
            tierTrialDays > 0 &&
            trialOptionByTier[tierUpper] === 'TRIAL';

        if (selectedTrial) {
            setHasSharedForTrial(false);
            setShareCooldownSeconds(30);
            setCopiedShareLink(false);
            setTrialGatePlan(plan);
            return;
        }

        trackConversion('checkout_started', {
            revenue: getCycleTotalUsd(plan),
            currency: 'USD',
            metadata: { tier: plan.tier, billingCycle },
        });

        const checkoutSearch = mergeSessionUtmsIntoSearch('');
        if (dismissible && onClose) onClose();
        navigate(`/checkout${checkoutSearch}`, {
            state: {
                plan,
                billingCycle,
            },
        });
    };

    const handleLogout = () => {
        logout();
        navigate('/login', { replace: true });
    };

    const formatPostTrialChargeDate = (days: number) => {
        const target = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
        return target.toLocaleDateString(isEn ? 'en-US' : 'pt-PT', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
        });
    };

    const handleTriggerTrialShare = async (
        channel: 'native' | 'whatsapp' | 'telegram' | 'x' | 'facebook' | 'copy',
    ) => {
        if (!trialGatePlan) return;
        const shareText = isEn
            ? 'Join me on Torex Journal — institutional trading analytics, AI Coach & journal:'
            : 'Vem operar comigo no Torex Journal — diário de trading automático, IA e análise institucional:';
        const encodedText = encodeURIComponent(shareText);
        const encodedUrl = encodeURIComponent(referralShareUrl);

        if (channel === 'native' && typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
            try {
                await navigator.share({ title: 'Torex Journal', text: shareText, url: referralShareUrl });
            } catch {
                // fallback handled cleanly below
            }
        } else if (channel === 'whatsapp') {
            window.open(`https://wa.me/?text=${encodedText}%20${encodedUrl}`, '_blank', 'noopener,noreferrer');
        } else if (channel === 'telegram') {
            window.open(`https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`, '_blank', 'noopener,noreferrer');
        } else if (channel === 'x') {
            window.open(`https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`, '_blank', 'noopener,noreferrer');
        } else if (channel === 'facebook') {
            window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`, '_blank', 'noopener,noreferrer');
        } else {
            try {
                await navigator.clipboard.writeText(referralShareUrl);
                setCopiedShareLink(true);
                window.setTimeout(() => setCopiedShareLink(false), 2500);
            } catch {
                // ignore clipboard failure
            }
        }

        setIsPreparingShare(true);
        setTrialError(null);
        try {
            await api.post('/subscription/prepare-trial-share', {
                tier: trialGatePlan.tier,
                channel,
            });
            if (!hasSharedForTrial) {
                setHasSharedForTrial(true);
                setShareCooldownSeconds(30);
            }
        } catch (err: any) {
            setTrialError(
                err?.response?.data?.message ||
                    (isEn
                        ? 'Unable to verify share right now. Try again.'
                        : 'Não foi possível validar o compartilhamento agora. Tente novamente.'),
            );
        } finally {
            setIsPreparingShare(false);
        }
    };

    const handleConfirmTrialActivation = async () => {
        if (!trialGatePlan || !hasSharedForTrial || shareCooldownSeconds > 0) return;
        const tierUpper = String(trialGatePlan.tier || 'BASIC').toUpperCase() as
            | 'BASIC'
            | 'PRO'
            | 'PREMIUM';
        setActivatingTrialTier(tierUpper);
        setTrialError(null);
        try {
            await api.post('/subscription/activate-trial', { tier: tierUpper });
            await refreshProfile();
            await queryClient.invalidateQueries({ queryKey: ['subscription-status'] });
            setTrialGatePlan(null);
            if (onActivated) onActivated();
            if (dismissible && onClose) onClose();
        } catch (err: any) {
            const msg =
                err?.response?.data?.message ||
                (isEn
                    ? 'Free trial is unavailable for this account.'
                    : 'Avaliação gratuita indisponível para esta conta.');
            setTrialError(msg);
            if (err?.response?.data?.code === 'TRIAL_NOT_ELIGIBLE') {
                setLocalTrialDisabled(true);
                setTrialOptionByTier({ BASIC: 'PAID', PRO: 'PAID', PREMIUM: 'PAID' });
                setTrialGatePlan(null);
            }
        } finally {
            setActivatingTrialTier(null);
        }
    };

    const getPlanDisplayMeta = (tier: string) => {
        if (tier === 'BASIC') {
            return {
                title: isEn ? 'Basic' : 'Básico',
                subtitle: isEn ? 'For traders building consistency' : 'Para quem está começando no trading',
                accentText: 'text-emerald-600 dark:text-emerald-400',
                cardClass:
                    'p-5 sm:p-6 border border-line-strong bg-surface/90 rounded-2xl transition-all hover:border-emerald-500/40 flex flex-col justify-between',
                badge: null,
                icon: Zap,
                checkIcon: Check,
                checkColor: 'text-emerald-500',
                btnVariant: 'primary' as const,
            };
        }
        if (tier === 'PRO') {
            return {
                title: 'Pro',
                subtitle: isEn ? 'For disciplined traders scaling edge' : 'Para traders consistentes em evolução',
                accentText: 'text-indigo-500 dark:text-indigo-400',
                cardClass:
                    'p-5 sm:p-6 border-2 border-indigo-500/70 bg-surface rounded-2xl relative overflow-hidden shadow-xl flex flex-col justify-between',
                badge: {
                    text: isEn ? 'MOST POPULAR' : 'MAIS POPULAR',
                    bg: 'bg-indigo-600 text-white',
                },
                icon: Sparkles,
                checkIcon: CheckCircle,
                checkColor: 'text-indigo-500',
                btnVariant: 'gradient' as const,
            };
        }
        return {
            title: tier === 'PREMIUM' ? 'Premium' : tier,
            subtitle: isEn ? 'Full desk power & deep backtesting' : 'Performance máxima & IA avançada',
            accentText: 'text-amber-500 dark:text-amber-400',
            cardClass:
                'p-5 sm:p-6 border-2 border-amber-500/60 bg-surface rounded-2xl relative overflow-hidden shadow-lg flex flex-col justify-between',
            badge: {
                text: isEn ? 'FULL POWER' : 'MÁXIMA POTÊNCIA',
                bg: 'bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950',
            },
            icon: Crown,
            checkIcon: CheckCircle,
            checkColor: 'text-amber-500',
            btnVariant: 'gradient' as const,
        };
    };

    return (
        <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6 bg-canvas/55 backdrop-blur-sm overflow-y-auto"
            onClick={() => {
                if (dismissible && onClose) onClose();
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                className="relative w-full max-w-5xl rounded-3xl border border-line-strong bg-surface/95 backdrop-blur-xl shadow-2xl p-5 sm:p-8 my-auto animate-in fade-in zoom-in-95 duration-200"
            >
                {/* Top bar controls */}
                <div className="flex items-center justify-between gap-2 mb-3">
                    <div>
                        {user && !dismissible && (
                            <button
                                type="button"
                                onClick={handleLogout}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 py-1 text-[11px] font-semibold text-fg-muted hover:text-fg transition-colors cursor-pointer"
                            >
                                <LogOut className="h-3.5 w-3.5" />
                                {isEn ? 'Sign out' : 'Terminar sessão'}
                            </button>
                        )}
                    </div>

                    {dismissible && onClose && (
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label={isEn ? 'Close' : 'Fechar'}
                            className="rounded-xl border border-line bg-surface-2 p-2 text-fg-muted hover:text-fg transition-colors cursor-pointer"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    )}
                </div>

                {/* Modal Header */}
                <div className="text-center mb-6">
                    {isExpired && (
                        <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-rose-500">
                            {isEn ? 'Plan Expired · Renew to Unlock' : 'Plano Expirado · Renove para Desbloquear'}
                        </div>
                    )}
                    <h2 className="text-2xl sm:text-3xl font-extrabold text-fg tracking-tight">
                        {trialGatePlan
                            ? isEn
                                ? 'Share with Friends to Unlock Your Free Trial'
                                : 'Compartilhe com Amigos para Liberar seu Teste Grátis'
                            : isEn
                              ? 'Find the plan that fits your trading'
                              : 'Escolha o plano ideal para o seu trading'}
                    </h2>
                    <p className="text-xs sm:text-sm text-fg-muted max-w-xl mx-auto mt-1.5 mb-5">
                        {trialGatePlan
                            ? isEn
                                ? 'Share your affiliate link on social media, wait 30 seconds, and unlock instant free access.'
                                : 'Partilhe seu link de afiliado nas redes sociais, aguarde 30 segundos e desbloqueie o acesso gratuito.'
                            : isEn
                              ? 'Unlock your full Torex Journal workspace with monthly Torex AI credits, automated journaling, and backtesting.'
                              : 'Desbloqueie todo o workspace do Torex Journal com créditos mensais no Torex AI, diário automatizado e backtesting.'}
                    </p>

                    {/* Billing Toggle (4 cycles: Monthly BF -20%, Quarterly, Annual, Biennial) */}
                    {!trialGatePlan && (
                        <div className="flex flex-col items-center gap-2">
                            <div className="inline-flex flex-wrap items-center justify-center gap-1 bg-surface-2 rounded-2xl sm:rounded-full p-1.5 border border-line shadow-inner">
                                {(
                                    [
                                        {
                                            id: 'MONTHLY',
                                            labelPt: 'Mensal',
                                            labelEn: 'Monthly',
                                            badge: '-20% BF',
                                            badgeClass: 'text-amber-300',
                                        },
                                        {
                                            id: 'QUARTERLY',
                                            labelPt: 'Trimestral',
                                            labelEn: 'Quarterly',
                                            badge: isEn ? 'up to -19%' : 'até -19%',
                                            badgeClass: 'text-emerald-400',
                                        },
                                        {
                                            id: 'YEARLY',
                                            labelPt: 'Anual',
                                            labelEn: 'Annual',
                                            badge: isEn ? 'up to -49%' : 'até -49%',
                                            badgeClass: 'text-emerald-400',
                                        },
                                        {
                                            id: 'BIENNIAL',
                                            labelPt: 'Bianual (2A)',
                                            labelEn: 'Biennial (2Y)',
                                            badge: isEn ? 'up to -51%' : 'até -51%',
                                            badgeClass: 'text-emerald-400',
                                        },
                                    ] as const
                                ).map((opt) => (
                                    <button
                                        key={opt.id}
                                        type="button"
                                        onClick={() => setBillingCycle(opt.id)}
                                        className={`px-3.5 sm:px-4 py-1.5 rounded-full text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                                            billingCycle === opt.id
                                                ? 'bg-indigo-600 text-white shadow-md'
                                                : 'text-fg-muted hover:text-fg'
                                        }`}
                                    >
                                        {isEn ? opt.labelEn : opt.labelPt}{' '}
                                        <span className={`text-[10.5px] ml-1 font-extrabold ${opt.badgeClass}`}>
                                            {opt.badge}
                                        </span>
                                    </button>
                                ))}
                            </div>
                            <p className="text-[11px] font-medium text-amber-300">
                                {billingCycle === 'MONTHLY'
                                    ? isEn
                                        ? 'Black Friday active: 20% OFF on monthly plans (USD).'
                                        : 'Black Friday ativo: 20% DE DESCONTO no pagamento mensal.'
                                    : isEn
                                      ? 'Black Friday multi-period discount already applied.'
                                      : 'Desconto promocional de Black Friday aplicado no período selecionado.'}
                            </p>
                        </div>
                    )}
                </div>

                {trialError && (
                    <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-center text-xs font-semibold text-rose-500">
                        {trialError}
                    </div>
                )}

                {trialGatePlan ? (
                    (() => {
                        const gateTier = String(trialGatePlan.tier || 'BASIC').toUpperCase() as
                            | 'BASIC'
                            | 'PRO'
                            | 'PREMIUM';
                        const gateDays = TRIAL_DAYS_BY_TIER_CLIENT[gateTier] ?? 30;
                        const renewalDateStr = formatPostTrialChargeDate(gateDays);
                        const recurringUsd = getPrice(trialGatePlan).toFixed(2);
                        const progressPct = hasSharedForTrial
                            ? Math.round(((30 - shareCooldownSeconds) / 30) * 100)
                            : 0;
                        const canActivateNow =
                            hasSharedForTrial && shareCooldownSeconds === 0 && !activatingTrialTier;

                        return (
                            <div className="max-w-2xl mx-auto rounded-2xl border border-line bg-surface p-5 sm:p-7 space-y-5 shadow-xl">
                                <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-4 text-xs sm:text-sm space-y-1.5">
                                    <div className="font-bold text-amber-300">
                                        {isEn
                                            ? `${gateTier} Plan · ${gateDays}-Day Free Trial Summary`
                                            : `Plano ${gateTier} · Resumo do Teste Grátis de ${gateDays} Dias`}
                                    </div>
                                    <p className="text-fg leading-relaxed">
                                        {isEn ? (
                                            <>
                                                Today you pay <strong>$0.00</strong>. After{' '}
                                                <strong>{renewalDateStr}</strong>,{' '}
                                                <strong>${recurringUsd}/mo</strong> will be charged to
                                                continue using the plan.
                                            </>
                                        ) : (
                                            <>
                                                Hoje o acesso é gratuito (<strong>$0.00</strong>). Após o dia{' '}
                                                <strong>{renewalDateStr}</strong>, será cobrado{' '}
                                                <strong>${recurringUsd}/mês</strong> para continuar a usar o
                                                plano.
                                            </>
                                        )}
                                    </p>
                                </div>

                                <div className="space-y-2.5">
                                    <label className="block text-[11px] font-bold uppercase tracking-wider text-fg-muted">
                                        {isEn
                                            ? 'Your Affiliate Invitation Link'
                                            : 'Seu Link de Afiliado para Partilha'}
                                    </label>
                                    <div className="flex flex-col sm:flex-row gap-2">
                                        <input
                                            type="text"
                                            readOnly
                                            value={referralShareUrl}
                                            className="flex-1 rounded-xl border border-line bg-canvas px-3 py-2.5 text-xs font-mono text-fg focus:outline-none"
                                        />
                                        <Button
                                            type="button"
                                            variant="secondary"
                                            onClick={() => void handleTriggerTrialShare('copy')}
                                            className="shrink-0"
                                        >
                                            <Copy size={14} className="mr-1.5" />
                                            {copiedShareLink
                                                ? isEn
                                                    ? 'Copied!'
                                                    : 'Copiado!'
                                                : isEn
                                                  ? 'Copy Link'
                                                  : 'Copiar Link'}
                                        </Button>
                                    </div>

                                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-1">
                                        <button
                                            type="button"
                                            onClick={() => void handleTriggerTrialShare('native')}
                                            className="col-span-2 sm:col-span-1 inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-xl bg-accent hover:bg-accent-hover text-accent-on text-xs font-bold cursor-pointer"
                                        >
                                            <Share2 size={13} />
                                            <span>{isEn ? 'Share' : 'Partilhar'}</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => void handleTriggerTrialShare('whatsapp')}
                                            className="inline-flex items-center justify-center h-9 px-3 rounded-xl border border-emerald-500/35 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-xs font-bold cursor-pointer"
                                        >
                                            WhatsApp
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => void handleTriggerTrialShare('telegram')}
                                            className="inline-flex items-center justify-center h-9 px-3 rounded-xl border border-sky-500/35 bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 text-xs font-bold cursor-pointer"
                                        >
                                            Telegram
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => void handleTriggerTrialShare('x')}
                                            className="inline-flex items-center justify-center h-9 px-3 rounded-xl border border-line bg-surface-2 hover:bg-surface-3 text-fg text-xs font-bold cursor-pointer"
                                        >
                                            X / Twitter
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => void handleTriggerTrialShare('facebook')}
                                            className="inline-flex items-center justify-center h-9 px-3 rounded-xl border border-indigo-500/35 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 text-xs font-bold cursor-pointer"
                                        >
                                            Facebook
                                        </button>
                                    </div>
                                </div>

                                <div className="rounded-xl border border-line bg-canvas-subtle p-3.5 space-y-2">
                                    <div className="flex items-center justify-between text-xs font-semibold">
                                        <span className="inline-flex items-center gap-1.5 text-fg">
                                            <Timer size={14} className="text-accent-fg" />
                                            {!hasSharedForTrial
                                                ? isEn
                                                    ? 'Step 1: Click a share button above to start the 30s unlock timer'
                                                    : 'Passo 1: Clique em partilhar acima para iniciar a contagem de 30s'
                                                : shareCooldownSeconds > 0
                                                  ? isEn
                                                      ? `Verifying share... unlocking in ${shareCooldownSeconds}s`
                                                      : `Validando partilha... liberação em ${shareCooldownSeconds}s`
                                                  : isEn
                                                    ? 'Verified! Your free trial button is unlocked.'
                                                    : 'Partilha confirmada! Botão de teste gratuito liberado.'}
                                        </span>
                                        <span className="font-mono text-accent-fg">
                                            {hasSharedForTrial ? `${shareCooldownSeconds}s` : '30s'}
                                        </span>
                                    </div>
                                    <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
                                        <div
                                            className="h-full bg-emerald-500 transition-all duration-500"
                                            style={{ width: `${progressPct}%` }}
                                        />
                                    </div>
                                </div>

                                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pt-1">
                                    <button
                                        type="button"
                                        onClick={() => setTrialGatePlan(null)}
                                        className="inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-xl border border-line bg-surface-2 hover:bg-surface-3 text-xs font-semibold text-fg-muted hover:text-fg cursor-pointer"
                                    >
                                        <ArrowLeft size={14} />
                                        <span>{isEn ? 'Back to Plans' : 'Voltar aos Planos'}</span>
                                    </button>

                                    <Button
                                        variant="gradient"
                                        className="flex-1 py-2.5 text-xs sm:text-sm font-bold"
                                        disabled={!canActivateNow || isPreparingShare}
                                        isLoading={activatingTrialTier === gateTier}
                                        onClick={() => void handleConfirmTrialActivation()}
                                    >
                                        {canActivateNow
                                            ? isEn
                                                ? `Acquire ${gateDays}-Day Free Trial`
                                                : `Adquirir Teste de ${gateDays} Dias Grátis`
                                            : hasSharedForTrial
                                              ? isEn
                                                  ? `Unlocks in ${shareCooldownSeconds}s`
                                                  : `Disponível em ${shareCooldownSeconds}s`
                                              : isEn
                                                ? 'Share Link First to Unlock'
                                                : 'Partilhe o Link para Desbloquear'}
                                    </Button>
                                </div>
                            </div>
                        );
                    })()
                ) : isFetchingPlans && plans.length === 0 ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="h-6 w-6 animate-spin text-accent" />
                    </div>
                ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5 items-stretch">
                        {plans.map((plan) => {
                            const meta = getPlanDisplayMeta(plan.tier);
                            const TierIcon = meta.icon;
                            const ItemCheck = meta.checkIcon;
                            const tierUpper = String(plan.tier || 'BASIC').toUpperCase() as
                                | 'BASIC'
                                | 'PRO'
                                | 'PREMIUM';
                            const isCurrentTier = user?.tier === plan.tier;
                            const tierTrialDays = TRIAL_DAYS_BY_TIER_CLIENT[tierUpper] ?? 0;
                            const isTierWithTrialChoice = effectiveTrialAvailable && tierTrialDays > 0;
                            const showTrialFreeBadge =
                                isTierWithTrialChoice && trialOptionByTier[tierUpper] === 'TRIAL';

                            const featuresList =
                                plan.features && plan.features.length > 0
                                    ? plan.features
                                    : getDefaultFeaturesForTier(
                                          plan.tier,
                                          plan.aiDailyCredits ?? getDefaultCreditsForTier(plan.tier),
                                          isEn,
                                      );

                            const ctaLabel =
                                isCurrentTier && user?.tier !== 'FREE'
                                    ? isEn
                                        ? 'Current Plan'
                                        : 'Plano Atual'
                                    : showTrialFreeBadge
                                      ? isEn
                                          ? `Start ${tierTrialDays}-Day Free Trial`
                                          : `Começar ${tierTrialDays} Dias Grátis`
                                      : plan.tier === 'BASIC'
                                        ? isEn
                                            ? 'Start Basic'
                                            : 'Assinar Básico'
                                        : plan.tier === 'PRO'
                                          ? isEn
                                              ? 'Unlock Pro'
                                              : 'Assinar Pro'
                                          : isEn
                                            ? 'Unlock Premium'
                                            : 'Assinar Premium';

                            return (
                                <div key={plan.id} className={meta.cardClass}>
                                    {meta.badge && (
                                        <div
                                            className={`absolute top-0 right-0 text-[10px] font-black px-3 py-1 rounded-bl-xl tracking-wider ${meta.badge.bg}`}
                                        >
                                            {meta.badge.text}
                                        </div>
                                    )}

                                    <div>
                                        <div className="text-center mb-4">
                                            <div className="inline-flex items-center gap-1.5 mb-1.5">
                                                <TierIcon className={`w-4 h-4 ${meta.accentText}`} />
                                                <h3 className={`text-xl font-bold ${meta.accentText}`}>
                                                    {meta.title}
                                                </h3>
                                            </div>

                                            <div className="flex items-baseline justify-center gap-1.5">
                                                {!showTrialFreeBadge &&
                                                    getDiscountPercent(plan) > 0 &&
                                                    plan.monthlyPrice > getPrice(plan) && (
                                                        <span className="text-sm font-semibold text-fg-subtle line-through font-mono">
                                                            ${plan.monthlyPrice.toFixed(2)}
                                                        </span>
                                                    )}
                                                <div className="flex items-baseline gap-0.5">
                                                    <span className="text-lg font-bold text-fg-subtle align-top mt-0.5">
                                                        $
                                                    </span>
                                                    <span className="text-4xl font-extrabold text-fg font-mono tabular-nums">
                                                        {showTrialFreeBadge
                                                            ? '0.00'
                                                            : getPrice(plan).toFixed(2)}
                                                    </span>
                                                    <span className="text-xs font-bold text-fg-subtle self-end mb-1.5">
                                                        {showTrialFreeBadge
                                                            ? isEn
                                                                ? ` / ${tierTrialDays}d`
                                                                : ` / ${tierTrialDays} dias`
                                                            : isEn
                                                              ? ' /mo'
                                                              : ' /mês'}
                                                    </span>
                                                </div>
                                            </div>

                                            {getDiscountPercent(plan) > 0 && !showTrialFreeBadge && (
                                                <div className="mt-1 inline-flex items-center rounded-full bg-rose-500/12 border border-rose-500/25 px-2.5 py-0.5 text-[10px] font-bold text-rose-500">
                                                    {billingCycle === 'MONTHLY'
                                                        ? `Black Friday · -${getDiscountPercent(plan)}%`
                                                        : isEn
                                                          ? `Save ${getDiscountPercent(plan)}%`
                                                          : `Economize ${getDiscountPercent(plan)}%`}
                                                </div>
                                            )}

                                            {!showTrialFreeBadge && getCycleMonths(billingCycle) > 1 && (
                                                <p className="text-[11px] text-fg-subtle mt-1 font-mono">
                                                    {isEn
                                                        ? `$${getCycleTotalUsd(plan).toFixed(2)} billed every ${getCycleMonths(billingCycle)} months`
                                                        : `$${getCycleTotalUsd(plan).toFixed(2)} cobrado a cada ${getCycleMonths(billingCycle)} meses`}
                                                </p>
                                            )}

                                            {isTierWithTrialChoice && (
                                                <div className="mt-3 text-left">
                                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-fg-muted mb-1">
                                                        {isEn ? 'Activation Mode' : 'Modalidade de Acesso'}
                                                    </label>
                                                    <select
                                                        aria-label={isEn ? 'Activation Mode' : 'Modalidade de Acesso'}
                                                        value={trialOptionByTier[tierUpper]}
                                                        onChange={(e) => {
                                                            const val = e.target.value as 'TRIAL' | 'PAID';
                                                            setTrialOptionByTier((prev) => ({
                                                                ...prev,
                                                                [tierUpper]: val,
                                                            }));
                                                        }}
                                                        className="w-full rounded-xl border border-emerald-500/40 bg-surface-2 px-3 py-2 text-xs font-semibold text-fg focus:outline-none focus:border-emerald-500"
                                                    >
                                                        <option value="TRIAL">
                                                            {isEn
                                                                ? `${tierTrialDays}-day free trial (Free access)`
                                                                : `Período de teste ${tierTrialDays} dias (Grátis)`}
                                                        </option>
                                                        <option value="PAID">
                                                            {isEn
                                                                ? 'Direct paid subscription'
                                                                : 'Assinar plano diretamente'}
                                                        </option>
                                                    </select>
                                                    {showTrialFreeBadge && (
                                                        <p className="mt-1.5 text-[10.5px] leading-snug text-amber-300 font-medium">
                                                            {isEn
                                                                ? `After ${formatPostTrialChargeDate(tierTrialDays)}, $${getPrice(plan).toFixed(2)}/mo is charged to continue.`
                                                                : `Após ${formatPostTrialChargeDate(tierTrialDays)}, será cobrado $${getPrice(plan).toFixed(2)}/mês para continuar.`}
                                                        </p>
                                                    )}
                                                </div>
                                            )}

                                            <p className="text-fg-muted text-xs mt-2 min-h-[2rem]">
                                                {plan.description || meta.subtitle}
                                            </p>
                                        </div>

                                        <ul className="space-y-2.5 mb-5 text-xs text-fg-muted border-t border-line pt-4">
                                            {featuresList.map((feature, idx) => (
                                                <li key={idx} className="flex items-start gap-2">
                                                    <ItemCheck
                                                        className={`w-4 h-4 ${meta.checkColor} shrink-0 mt-0.5`}
                                                    />
                                                    <span>{feature}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>

                                    <Button
                                        variant={meta.btnVariant}
                                        className="w-full py-2.5 text-xs sm:text-sm font-bold"
                                        isLoading={activatingTrialTier === tierUpper}
                                        disabled={isCurrentTier && user?.tier !== 'FREE'}
                                        onClick={() => void handleSelectPlan(plan)}
                                    >
                                        {ctaLabel}
                                    </Button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};
