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
    Share2,
    Sparkles,
    Timer,
    X,
    Zap,
} from 'lucide-react';
import { resolvePricingModalCloseAction } from '../../lib/planGate';
import api from '../../api';
import { Button } from '../ui/Button';
import { useAuth } from '../../context/AuthContext';
import { useLocale } from '../../context/LocaleContext';
import { buildTaggedUrl, mergeSessionUtmsIntoSearch } from '../../lib/attribution';
import {
    FALLBACK_WORKSPACE_PLANS,
    getDefaultCreditsForTier,
    getDefaultFeaturesForTier,
    getPlanSubtitleForTier,
    normalizeWorkspacePlansCatalog,
    WorkspacePlanConfig,
} from '../../lib/pricingPlans';
import { TRIAL_DAYS_BY_TIER_CLIENT } from '../../lib/planGate';
import { trackButtonClick, trackConversion } from '../../lib/tracking';

export type { WorkspacePlanConfig };

interface WorkspacePricingModalProps {
    isOpen: boolean;
    dismissible: boolean;
    hasActivePlan?: boolean;
    onClose?: () => void;
    onActivated?: () => void;
    isExpired?: boolean;
    trialEligible?: boolean;
}

export const WorkspacePricingModal: React.FC<WorkspacePricingModalProps> = ({
    isOpen,
    dismissible,
    hasActivePlan,
    onClose,
    onActivated,
    isExpired = false,
    trialEligible = false,
}) => {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { user, logout, refreshProfile } = useAuth();
    const { locale, setLocale } = useLocale();
    const isEn = locale === 'en';

    const [billingCycle, setBillingCycle] = useState<'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'BIENNIAL'>('YEARLY');
    const [plans, setPlans] = useState<WorkspacePlanConfig[]>(() =>
        normalizeWorkspacePlansCatalog(FALLBACK_WORKSPACE_PLANS, isEn),
    );
    const [isFetchingPlans, setIsFetchingPlans] = useState(false);
    const [promoBannerVisible, setPromoBannerVisible] = useState(true);

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
        setPlans((prev) => normalizeWorkspacePlansCatalog(prev, isEn));
    }, [isEn]);

    useEffect(() => {
        if (!isOpen) return;
        let active = true;
        setPromoBannerVisible(true);
        setIsFetchingPlans(true);
        api.get('/payment/plans')
            .then((plansRes) => {
                if (!active) return;
                setPlans(normalizeWorkspacePlansCatalog(plansRes.data || [], isEn));
            })
            .catch(() => {
                if (!active) return;
                setPlans((prev) => normalizeWorkspacePlansCatalog(prev, isEn));
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

    const resolvedHasActivePlan =
        hasActivePlan ??
        (dismissible && Boolean(user?.tier && user.tier !== 'FREE') && !isExpired);

    const handleLogout = () => {
        logout();
        navigate('/login', { replace: true });
    };

    const handleCloseModal = () => {
        const action = resolvePricingModalCloseAction({
            isAuthenticated: Boolean(user),
            hasActivePlan: resolvedHasActivePlan,
            hasOnClose: Boolean(onClose),
        });
        if (action === 'LOGOUT') {
            handleLogout();
            return;
        }
        if (action === 'CLOSE_TO_CURRENT_VIEW' && onClose) {
            onClose();
            return;
        }
        if (typeof window !== 'undefined' && window.history.length > 1) {
            navigate(-1);
        } else {
            navigate('/dashboard', { replace: true });
        }
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
            : 'Vem operar comigo no Torex Journal — diário de trading automático, AI Coach e análise institucional:';
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
                subtitle: getPlanSubtitleForTier('BASIC', isEn),
                accentText: 'text-emerald-600',
                iconWrapClass: 'bg-emerald-50 text-emerald-600',
                cardClass:
                    'p-4 sm:p-5 bg-white rounded-2xl transition-all duration-200 shadow-[0_8px_28px_-8px_rgba(15,23,42,0.08)] hover:shadow-[0_16px_38px_-10px_rgba(15,23,42,0.14)] hover:-translate-y-0.5 flex flex-col justify-between',
                badge: null,
                icon: Zap,
                checkIcon: Check,
                checkColor: 'text-emerald-600',
                btnVariant: 'brand' as const,
                btnClass:
                    '!border-0 bg-emerald-600 hover:bg-emerald-700 !text-white shadow-md shadow-emerald-600/20',
            };
        }
        if (tier === 'PRO') {
            return {
                title: 'Pro',
                subtitle: getPlanSubtitleForTier('PRO', isEn),
                accentText: 'text-indigo-600',
                iconWrapClass: 'bg-indigo-50 text-indigo-600',
                cardClass:
                    'p-4 sm:p-5 bg-white rounded-2xl relative overflow-hidden transition-all duration-200 shadow-[0_22px_50px_-14px_rgba(79,70,229,0.24)] hover:shadow-[0_26px_56px_-12px_rgba(79,70,229,0.32)] hover:-translate-y-0.5 flex flex-col justify-between',
                badge: {
                    text: isEn ? 'MOST POPULAR' : 'MAIS POPULAR',
                    bg: 'bg-indigo-600 text-white shadow-sm',
                },
                icon: Sparkles,
                checkIcon: CheckCircle,
                checkColor: 'text-indigo-600',
                btnVariant: 'brand' as const,
                btnClass:
                    '!border-0 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 !text-white shadow-lg shadow-indigo-600/25',
            };
        }
        return {
            title: tier === 'PREMIUM' ? 'Premium' : tier,
            subtitle: getPlanSubtitleForTier('PREMIUM', isEn),
            accentText: 'text-amber-600',
            iconWrapClass: 'bg-amber-50 text-amber-600',
            cardClass:
                'p-4 sm:p-5 bg-white rounded-2xl relative overflow-hidden transition-all duration-200 shadow-[0_18px_42px_-12px_rgba(245,158,11,0.20)] hover:shadow-[0_22px_48px_-12px_rgba(245,158,11,0.28)] hover:-translate-y-0.5 flex flex-col justify-between',
            badge: {
                text: isEn ? 'FULL POWER' : 'MÁXIMA POTÊNCIA',
                bg: 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-sm',
            },
            icon: Crown,
            checkIcon: CheckCircle,
            checkColor: 'text-amber-600',
            btnVariant: 'brand' as const,
            btnClass:
                '!border-0 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 !text-white shadow-lg shadow-amber-500/25',
        };
    };

    const promoBannerText =
        billingCycle === 'MONTHLY'
            ? isEn
                ? 'Special Offer · 20% off monthly plans'
                : 'Oferta Especial · 20% de desconto no mensal'
            : billingCycle === 'QUARTERLY'
              ? isEn
                  ? 'Special Offer · Up to 19% off quarterly'
                  : 'Oferta Especial · Até 19% no trimestral'
              : billingCycle === 'BIENNIAL'
                ? isEn
                    ? 'Special Offer · Up to 51% off biennial'
                    : 'Oferta Especial · Até 51% no bianual'
                : isEn
                  ? 'Special Offer · Up to 49% off annual plans'
                  : 'Oferta Especial · Até 49% de desconto no anual';

    return (
        <div
            role="dialog"
            aria-modal="true"
            className="theme-light fixed inset-0 z-[100] flex items-start sm:items-center justify-center p-2.5 sm:p-5 bg-slate-900/15 backdrop-blur-[1px] overflow-y-auto"
            onClick={() => {
                if (dismissible && onClose) onClose();
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                className="relative w-full max-w-5xl flex flex-col rounded-[28px] bg-[#F8FAFC] text-slate-900 shadow-[0_32px_72px_-16px_rgba(15,23,42,0.24)] my-auto overflow-hidden animate-in fade-in zoom-in-95 duration-200"
            >
                {/* Floating Headerless Utility Controls (Zero Header Bar / Zero Borders) */}
                <div className="absolute top-3.5 left-3.5 sm:top-4 sm:left-5 z-20 flex items-center gap-1.5">

                    <div
                        role="group"
                        aria-label={isEn ? 'Select language' : 'Selecionar idioma'}
                        className="inline-flex items-center rounded-full bg-slate-200/75 p-0.5 text-[10.5px] font-bold"
                    >
                        <button
                            type="button"
                            onClick={() => setLocale('pt')}
                            className={`px-2 py-0.5 rounded-full transition-colors cursor-pointer ${
                                !isEn
                                    ? 'bg-white text-slate-900 shadow-xs'
                                    : 'text-slate-500 hover:text-slate-900'
                            }`}
                        >
                            PT
                        </button>
                        <button
                            type="button"
                            onClick={() => setLocale('en')}
                            className={`px-2 py-0.5 rounded-full transition-colors cursor-pointer ${
                                isEn
                                    ? 'bg-white text-slate-900 shadow-xs'
                                    : 'text-slate-500 hover:text-slate-900'
                            }`}
                        >
                            EN
                        </button>
                    </div>
                </div>

                <button
                    type="button"
                    onClick={handleCloseModal}
                    aria-label={
                        user && !resolvedHasActivePlan
                            ? isEn
                                ? 'Close and sign out'
                                : 'Fechar e sair'
                            : isEn
                              ? 'Close'
                              : 'Fechar'
                    }
                    title={
                        user && !resolvedHasActivePlan
                            ? isEn
                                ? 'Close and sign out'
                                : 'Fechar e sair'
                            : isEn
                              ? 'Close'
                              : 'Fechar'
                    }
                    className="absolute top-3.5 right-3.5 sm:top-4 sm:right-5 z-20 w-8 h-8 rounded-full bg-white/95 hover:bg-white text-slate-500 hover:text-slate-900 flex items-center justify-center shadow-sm transition-colors cursor-pointer"
                >
                    <X className="h-4 w-4" />
                </button>

                {/* Borderless, Light-Mode, Compact Body */}
                <div className="px-3.5 pt-11 pb-4 sm:px-7 sm:pt-7 sm:pb-6">
                    {/* Responsive Headline & Subheadline */}
                    <div className="text-center mb-3.5 sm:mb-4 px-1 sm:px-10">
                        <div className="flex flex-wrap items-center justify-center gap-2 mb-1.5">
                            {isExpired && (
                                <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider text-rose-600">
                                    {isEn ? 'Plan Expired · Renew to Unlock' : 'Plano Expirado · Renove para Desbloquear'}
                                </span>
                            )}
                            {!trialGatePlan && promoBannerVisible && (
                                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-0.5 text-[10.5px] sm:text-[11px] font-bold text-amber-700 shadow-xs max-w-full">
                                    <Sparkles className="w-3 h-3 shrink-0 text-amber-500" />
                                    <span className="truncate">{promoBannerText}</span>
                                    <button
                                        type="button"
                                        onClick={() => setPromoBannerVisible(false)}
                                        aria-label={isEn ? 'Dismiss banner' : 'Ocultar aviso'}
                                        className="ml-0.5 rounded-full p-0.5 text-amber-600/70 hover:text-amber-900 transition-colors cursor-pointer shrink-0"
                                    >
                                        <X className="w-3 h-3" />
                                    </button>
                                </span>
                            )}
                        </div>

                        <h2 className="text-[20px] sm:text-2xl lg:text-[28px] font-extrabold text-slate-900 tracking-[-0.025em] leading-[1.15] text-balance max-w-2xl mx-auto">
                            {trialGatePlan
                                ? isEn
                                    ? 'Share with Friends to Unlock Your Free Trial'
                                    : 'Compartilhe com Amigos para Liberar seu Teste Grátis'
                                : isEn
                                  ? 'Plans built to scale your trading consistency'
                                  : 'Escolha o plano ideal para evoluir sua consistência'}
                        </h2>
                        <p className="text-xs sm:text-[13.5px] text-slate-500 font-medium leading-relaxed text-balance max-w-xl mx-auto mt-1.5 mb-3">
                            {trialGatePlan
                                ? isEn
                                    ? 'Share your affiliate link, wait 30 seconds, and unlock instant free access.'
                                    : 'Partilhe seu link de afiliado nas redes sociais, aguarde 30 segundos e desbloqueie o acesso gratuito.'
                                : isEn
                                  ? 'Automated journaling, monthly AI credits, AI Coach, and market backtesting in one clean workspace.'
                                  : 'Diário automatizado, créditos mensais de IA, AI Coach e backtesting avançado num único espaço.'}
                        </p>

                        {/* Borderless Billing Cycle Selector */}
                        {!trialGatePlan && (
                            <div className="grid grid-cols-2 sm:inline-flex items-center gap-1 w-full sm:w-auto bg-slate-200/75 rounded-2xl sm:rounded-full p-1">
                                {(
                                    [
                                        {
                                            id: 'MONTHLY',
                                            labelPt: 'Mensal',
                                            labelEn: 'Monthly',
                                            badge: '-20%',
                                        },
                                        {
                                            id: 'QUARTERLY',
                                            labelPt: 'Trimestral',
                                            labelEn: 'Quarterly',
                                            badge: isEn ? 'up to -19%' : 'até -19%',
                                        },
                                        {
                                            id: 'YEARLY',
                                            labelPt: 'Anual',
                                            labelEn: 'Annual',
                                            badge: isEn ? 'up to -49%' : 'até -49%',
                                        },
                                        {
                                            id: 'BIENNIAL',
                                            labelPt: 'Bianual (2A)',
                                            labelEn: 'Biennial (2Y)',
                                            badge: isEn ? 'up to -51%' : 'até -51%',
                                        },
                                    ] as const
                                ).map((opt) => {
                                    const active = billingCycle === opt.id;
                                    return (
                                        <button
                                            key={opt.id}
                                            type="button"
                                            onClick={() => setBillingCycle(opt.id)}
                                            className={`px-2.5 sm:px-3.5 py-1.5 rounded-xl sm:rounded-full text-[11px] sm:text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                                                active
                                                    ? 'bg-white text-slate-900 shadow-sm'
                                                    : 'text-slate-600 hover:text-slate-900'
                                            }`}
                                        >
                                            <span>{isEn ? opt.labelEn : opt.labelPt}</span>
                                            <span
                                                className={`text-[10px] font-extrabold ${
                                                    active ? 'text-emerald-600' : 'text-emerald-600/85'
                                                }`}
                                            >
                                                {opt.badge}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {trialError && (
                        <div className="mb-3 rounded-xl bg-rose-50 px-3.5 py-2 text-center text-xs font-semibold text-rose-600">
                            {trialError}
                        </div>
                    )}

                    {trialGatePlan ? (
                        (() => {
                            const gateTier = String(trialGatePlan.tier || 'BASIC').toUpperCase() as
                                | 'BASIC'
                                | 'PRO'
                                | 'PREMIUM';
                            const gateMeta = getPlanDisplayMeta(gateTier);
                            const gateDays = TRIAL_DAYS_BY_TIER_CLIENT[gateTier] ?? 30;
                            const renewalDateStr = formatPostTrialChargeDate(gateDays);
                            const recurringUsd = getPrice(trialGatePlan).toFixed(2);
                            const progressPct = hasSharedForTrial
                                ? Math.round(((30 - shareCooldownSeconds) / 30) * 100)
                                : 0;
                            const canActivateNow =
                                hasSharedForTrial && shareCooldownSeconds === 0 && !activatingTrialTier;

                            return (
                                <div className="max-w-2xl mx-auto rounded-2xl bg-white p-4 sm:p-5 space-y-3.5 shadow-[0_14px_40px_-12px_rgba(15,23,42,0.12)]">
                                    <div className="rounded-xl bg-amber-50/90 p-3 text-xs sm:text-sm space-y-1">
                                        <div className="font-bold text-amber-700">
                                            {isEn
                                                ? `${gateMeta.title} Plan · ${gateDays}-Day Free Trial Summary`
                                                : `Plano ${gateMeta.title} · Resumo do Teste Grátis de ${gateDays} Dias`}
                                        </div>
                                        <p className="text-slate-700 leading-snug">
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

                                    <div className="space-y-2">
                                        <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                                            {isEn
                                                ? 'Your Affiliate Invitation Link'
                                                : 'Seu Link de Afiliado para Partilha'}
                                        </label>
                                        <div className="flex flex-col sm:flex-row gap-2">
                                            <input
                                                type="text"
                                                readOnly
                                                value={referralShareUrl}
                                                className="flex-1 rounded-xl bg-slate-100 px-3 py-2 text-xs font-mono text-slate-900 focus:outline-none"
                                            />
                                            <Button
                                                type="button"
                                                variant="secondary"
                                                onClick={() => void handleTriggerTrialShare('copy')}
                                                className="shrink-0 !border-0 bg-slate-200/80 hover:bg-slate-300/80 text-slate-900"
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

                                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-0.5">
                                            <button
                                                type="button"
                                                onClick={() => void handleTriggerTrialShare('native')}
                                                className="col-span-2 sm:col-span-1 inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer"
                                            >
                                                <Share2 size={13} />
                                                <span>{isEn ? 'Share' : 'Partilhar'}</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => void handleTriggerTrialShare('whatsapp')}
                                                className="inline-flex items-center justify-center h-8 px-3 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-bold cursor-pointer"
                                            >
                                                WhatsApp
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => void handleTriggerTrialShare('telegram')}
                                                className="inline-flex items-center justify-center h-8 px-3 rounded-xl bg-sky-50 hover:bg-sky-100 text-sky-700 text-xs font-bold cursor-pointer"
                                            >
                                                Telegram
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => void handleTriggerTrialShare('x')}
                                                className="inline-flex items-center justify-center h-8 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold cursor-pointer"
                                            >
                                                X / Twitter
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => void handleTriggerTrialShare('facebook')}
                                                className="inline-flex items-center justify-center h-8 px-3 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold cursor-pointer"
                                            >
                                                Facebook
                                            </button>
                                        </div>
                                    </div>

                                    <div className="rounded-xl bg-slate-50 p-3 space-y-1.5">
                                        <div className="flex items-center justify-between text-xs font-semibold gap-2">
                                            <span className="inline-flex items-center gap-1.5 text-slate-800">
                                                <Timer size={14} className="text-emerald-600 shrink-0" />
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
                                            <span className="font-mono text-emerald-600 shrink-0">
                                                {hasSharedForTrial ? `${shareCooldownSeconds}s` : '30s'}
                                            </span>
                                        </div>
                                        <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
                                            <div
                                                className="h-full bg-emerald-500 transition-all duration-500"
                                                style={{ width: `${progressPct}%` }}
                                            />
                                        </div>
                                    </div>

                                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 pt-0.5">
                                        <button
                                            type="button"
                                            onClick={() => setTrialGatePlan(null)}
                                            className="inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-700 cursor-pointer"
                                        >
                                            <ArrowLeft size={14} />
                                            <span>{isEn ? 'Back to Plans' : 'Voltar aos Planos'}</span>
                                        </button>

                                        <Button
                                            variant="brand"
                                            className="flex-1 py-2 text-xs sm:text-sm font-bold !border-0 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 !text-white shadow-md shadow-emerald-600/20"
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
                        <div className="flex items-center justify-center py-10">
                            <Loader2 className="h-6 w-6 animate-spin text-indigo-600" />
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4 items-stretch">
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

                                const featuresList = getDefaultFeaturesForTier(
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
                                                className={`absolute top-2.5 right-2.5 text-[9px] font-black px-2.5 py-0.5 rounded-full tracking-wider ${meta.badge.bg}`}
                                            >
                                                {meta.badge.text}
                                            </div>
                                        )}

                                        <div>
                                            <div className="text-center mb-2.5">
                                                <div className="inline-flex items-center gap-1.5 mb-1">
                                                    <span className={`w-6 h-6 rounded-lg inline-flex items-center justify-center ${meta.iconWrapClass}`}>
                                                        <TierIcon className="w-3.5 h-3.5" />
                                                    </span>
                                                    <h3 className={`text-base sm:text-lg font-extrabold ${meta.accentText}`}>
                                                        {meta.title}
                                                    </h3>
                                                </div>

                                                <div className="flex items-baseline justify-center gap-1.5">
                                                    {!showTrialFreeBadge &&
                                                        getDiscountPercent(plan) > 0 &&
                                                        plan.monthlyPrice > getPrice(plan) && (
                                                            <span className="text-xs font-semibold text-slate-400 line-through font-mono">
                                                                ${plan.monthlyPrice.toFixed(2)}
                                                            </span>
                                                        )}
                                                    <div className="flex items-baseline gap-0.5">
                                                        <span className="text-sm sm:text-base font-bold text-slate-400 align-top mt-0.5">
                                                            $
                                                        </span>
                                                        <span className="text-2xl sm:text-[30px] leading-none font-extrabold text-slate-900 font-mono tabular-nums">
                                                            {showTrialFreeBadge
                                                                ? '0.00'
                                                                : getPrice(plan).toFixed(2)}
                                                        </span>
                                                        <span className="text-[11px] font-bold text-slate-400 self-end mb-0.5">
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

                                                {!showTrialFreeBadge && (getDiscountPercent(plan) > 0 || getCycleMonths(billingCycle) > 1) && (
                                                    <div className="mt-1.5 flex flex-wrap items-center justify-center gap-1.5">
                                                        {getDiscountPercent(plan) > 0 && (
                                                            <span className="inline-flex items-center rounded-full bg-rose-50 px-2.5 py-0.5 text-[10px] font-bold text-rose-600 leading-none">
                                                                {isEn
                                                                    ? `Save ${getDiscountPercent(plan)}%`
                                                                    : `Economize ${getDiscountPercent(plan)}%`}
                                                            </span>
                                                        )}
                                                        {getCycleMonths(billingCycle) > 1 && (
                                                            <span className="text-[10.5px] text-slate-500 font-mono font-medium">
                                                                {`$${getCycleTotalUsd(plan).toFixed(2)}/${getCycleMonths(billingCycle)}m`}
                                                            </span>
                                                        )}
                                                    </div>
                                                )}

                                                {isTierWithTrialChoice && (
                                                    <div className="mt-2">
                                                        <div
                                                            role="group"
                                                            aria-label={isEn ? 'Activation Mode' : 'Modalidade de Acesso'}
                                                            className="grid grid-cols-2 gap-1 rounded-xl bg-emerald-50/90 p-1"
                                                        >
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    setTrialOptionByTier((prev) => ({
                                                                        ...prev,
                                                                        [tierUpper]: 'TRIAL',
                                                                    }))
                                                                }
                                                                className={`rounded-lg py-1 px-1.5 text-[10.5px] font-bold transition-all cursor-pointer truncate ${
                                                                    trialOptionByTier[tierUpper] === 'TRIAL'
                                                                        ? 'bg-emerald-600 text-white shadow-xs'
                                                                        : 'text-emerald-800/70 hover:text-emerald-900'
                                                                }`}
                                                            >
                                                                {isEn ? `${tierTrialDays}d Free` : `${tierTrialDays}d Grátis`}
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    setTrialOptionByTier((prev) => ({
                                                                        ...prev,
                                                                        [tierUpper]: 'PAID',
                                                                    }))
                                                                }
                                                                className={`rounded-lg py-1 px-1.5 text-[10.5px] font-bold transition-all cursor-pointer truncate ${
                                                                    trialOptionByTier[tierUpper] === 'PAID'
                                                                        ? 'bg-white text-slate-900 shadow-xs'
                                                                        : 'text-slate-600 hover:text-slate-900'
                                                                }`}
                                                            >
                                                                {isEn ? 'Pay Direct' : 'Assinar Direto'}
                                                            </button>
                                                        </div>
                                                        {showTrialFreeBadge && (
                                                            <p className="mt-1 text-[10px] leading-tight text-amber-700 font-medium">
                                                                {isEn
                                                                    ? `After ${formatPostTrialChargeDate(tierTrialDays)}: $${getPrice(plan).toFixed(2)}/mo`
                                                                    : `Após ${formatPostTrialChargeDate(tierTrialDays)}: $${getPrice(plan).toFixed(2)}/mês`}
                                                            </p>
                                                        )}
                                                    </div>
                                                )}

                                                <p className="text-slate-500 text-[11px] leading-snug mt-1.5">
                                                    {meta.subtitle}
                                                </p>
                                            </div>

                                            <ul className="space-y-1.5 mb-3 text-[11.5px] leading-snug text-slate-600 pt-2">
                                                {featuresList.map((feature, idx) => (
                                                    <li key={idx} className="flex items-start gap-1.5">
                                                        <ItemCheck
                                                            className={`w-3.5 h-3.5 ${meta.checkColor} shrink-0 mt-0.5`}
                                                        />
                                                        <span>{feature}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>

                                        <Button
                                            variant={meta.btnVariant}
                                            className={`w-full py-2 text-xs font-bold min-h-[38px] ${meta.btnClass}`}
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
        </div>
    );
};
