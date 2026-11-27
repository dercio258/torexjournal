import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Sparkles, KeyRound, RefreshCw, Smartphone, ShieldAlert, Clock } from 'lucide-react';
import api from '../../api';
import { useLocale } from '../../context/LocaleContext';
import { trackButtonClick } from '../../lib/tracking';
import {
    FALLBACK_WORKSPACE_PLANS,
    normalizeWorkspacePlansCatalog,
} from '../../lib/pricingPlans';
import { openWorkspacePlansModal } from '../../lib/planGate';

interface PlanModalProps {
    type: 'NO_ACTIVE_PLAN' | 'UPGRADE_REQUIRED' | 'RENEWAL_CONFIRMATION' | 'PLAN_EXPIRED' | 'NEAR_EXPIRATION_WARNING';
    onClose?: () => void;
    featureName?: string;
    savedPaymentMethod?: 'mpesa' | 'emola' | 'card';
    savedPhoneNumber?: string;
    planTier?: 'BASIC' | 'PRO' | 'PREMIUM';
    daysLeft?: number;
}

export const PlanModal = ({
    type,
    onClose,
    featureName,
    savedPaymentMethod,
    savedPhoneNumber,
    planTier = 'BASIC',
    daysLeft
}: PlanModalProps) => {
    const navigate = useNavigate();
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const resolvedFeatureName = featureName || (isEn ? 'Institutional Feature' : 'Funcionalidade Avançada');
    const [isRenewing, setIsRenewing] = useState(false);
    const [showPinPrompt, setShowPinPrompt] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    useEffect(() => {
        if (type === 'NEAR_EXPIRATION_WARNING') {
            trackButtonClick({
                ctaTag: 'renewal_modal_impression',
                intent: 'renewal_view',
                label: `Near Expiration Warning (${planTier})`,
                metadata: { planTier, daysLeft },
            });
        }
    }, [type, planTier, daysLeft]);

    // Dynamic redirection for Upgrade or Plan Selection (opens centered modal in current view)
    const handleRedirectToPricing = () => {
        if (onClose) onClose();
        openWorkspacePlansModal('plan_modal_upgrade', { type, planTier });
    };

    const handleConfirmRenewal = async () => {
        setIsRenewing(true);
        setErrorMessage(null);
        try {
            await api.post('/subscription/renew');
            setShowPinPrompt(true);
        } catch (error: any) {
            console.error("Renewal error", error);
            setErrorMessage(
                error.response?.data?.message ||
                (isEn
                    ? "Unable to initiate renewal. Check your balance and try again."
                    : "Erro ao iniciar a renovação. Verifique se possui saldo e tente novamente.")
            );
            setIsRenewing(false);
        }
    };

    // Polling logic for fast renewal confirmation
    useEffect(() => {
        let interval: any;
        if (showPinPrompt) {
            interval = setInterval(async () => {
                try {
                    const res = await api.get('/subscription/status');
                    if (res.data && res.data.hasActive) {
                        clearInterval(interval);
                        navigate('/subscription/success', { state: { method: savedPaymentMethod || 'mpesa' } });
                        if (onClose) onClose();
                    }
                } catch (error) {
                    console.error("Polling error:", error);
                }
            }, 3000);
        }
        return () => clearInterval(interval);
    }, [showPinPrompt, navigate, savedPaymentMethod, onClose]);

    const handleAlternativeCheckout = async () => {
        if (onClose) onClose();
        setIsRenewing(true);
        try {
            const plansRes = await api.get('/payment/plans').catch(() => ({ data: FALLBACK_WORKSPACE_PLANS }));
            const catalog = normalizeWorkspacePlansCatalog(
                Array.isArray(plansRes.data) && plansRes.data.length > 0
                    ? plansRes.data
                    : FALLBACK_WORKSPACE_PLANS,
                isEn,
            );
            const targetTier = planTier === 'PREMIUM' ? 'PREMIUM' : planTier === 'PRO' ? 'PRO' : 'BASIC';
            const plan = catalog.find((p) => p.tier === targetTier) || catalog[0];

            navigate(`/checkout?tier=${encodeURIComponent(plan.tier)}&cycle=MONTHLY`, {
                state: {
                    plan,
                    billingCycle: 'MONTHLY',
                },
            });
        } catch (error) {
            console.error('Failed to redirect to checkout:', error);
            openWorkspacePlansModal('plan_modal_renewal_fallback', { planTier });
        } finally {
            setIsRenewing(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-canvas/85 backdrop-blur-md animate-in fade-in duration-300">
            {/* Modal Container */}
            <div className="bg-surface border border-line rounded-3xl w-full max-w-md overflow-hidden shadow-2xl relative p-8 text-center animate-in zoom-in-95 duration-300">
                {/* Glow Effects */}
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-48 bg-indigo-500/10 blur-[50px] rounded-full pointer-events-none" />

                {/* Close Button for closeable variants */}
                {type !== 'NO_ACTIVE_PLAN' && type !== 'PLAN_EXPIRED' && !showPinPrompt && (
                    <button 
                        onClick={onClose} 
                        className="absolute top-6 right-6 p-1.5 rounded-lg bg-surface-2 border border-line text-fg-muted hover:text-fg transition-all"
                    >
                        <X size={18} />
                    </button>
                )}

                {/* Variant 1: NO ACTIVE PLAN */}
                {type === 'NO_ACTIVE_PLAN' && (
                    <div className="space-y-6">
                        <div className="mx-auto w-16 h-16 bg-amber-500/10 border border-amber-500/20 text-amber-500 rounded-2xl flex items-center justify-center animate-pulse">
                            <KeyRound size={32} />
                        </div>
                        <div className="space-y-2">
                            <h3 className="text-2xl font-black text-fg tracking-tight">{isEn ? 'WORKSPACE ACTIVATION' : 'ATIVAÇÃO DE CONTA'}</h3>
                            <p className="text-fg-muted text-sm leading-relaxed">
                                {isEn ? (
                                    <>Welcome to <strong>TOREX JOURNAL</strong>! Activate a workspace plan to unlock the execution dashboard, trade analytics, and institutional replay tools.</>
                                ) : (
                                    <>Seja bem-vindo ao <strong>TOREX JOURNAL</strong>! Para visualizar o painel operacional, gerenciar seus trades e desbloquear as ferramentas, você precisa ativar um plano.</>
                                )}
                            </p>
                        </div>
                        <button
                            onClick={handleRedirectToPricing}
                            className="w-full py-4 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black rounded-xl transition-all shadow-lg shadow-amber-500/10 uppercase tracking-wider text-sm"
                        >
                            {isEn ? 'View Workspace Plans' : 'Ver Planos de Assinatura'}
                        </button>
                    </div>
                )}

                {/* Variant 2: UPGRADE REQUIRED */}
                {type === 'UPGRADE_REQUIRED' && (
                    <div className="space-y-6">
                        <div className="mx-auto w-16 h-16 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-2xl flex items-center justify-center">
                            <Sparkles size={32} />
                        </div>
                        <div className="space-y-2">
                            <h3 className="text-2xl font-black text-fg tracking-tight uppercase">{isEn ? 'Premium Upgrade' : 'Upgrade Premium'}</h3>
                            <p className="text-indigo-400 text-xs font-bold uppercase tracking-widest">{resolvedFeatureName}</p>
                            <p className="text-fg-muted text-sm leading-relaxed">
                                {isEn ? (
                                    <>This capability requires the <strong>Pro or Premium</strong> tier. Upgrade now to unlock broker auto-sync, unlimited backtesting, Torex AI review, and more.</>
                                ) : (
                                    <>Esta funcionalidade requer o plano <strong>Premium (PRO)</strong>. Faça o upgrade agora para ter auto-sync, backtesting ilimitado, análises com IA e muito mais.</>
                                )}
                            </p>
                        </div>
                        <button
                            onClick={handleRedirectToPricing}
                            className="w-full py-4 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white font-black rounded-xl transition-all shadow-lg shadow-indigo-500/20 uppercase tracking-wider text-sm"
                        >
                            {isEn ? 'Upgrade Plan' : 'Upgrade para Premium'}
                        </button>
                    </div>
                )}

                {/* Variant 3: RENEWAL CONFIRMATION */}
                {type === 'RENEWAL_CONFIRMATION' && (
                    <div className="space-y-6">
                        {showPinPrompt ? (
                            <div className="space-y-6 py-4 animate-in fade-in duration-300">
                                <div className="mx-auto w-16 h-16 bg-indigo-500/10 text-indigo-400 rounded-2xl flex items-center justify-center animate-spin">
                                    <RefreshCw size={32} />
                                </div>
                                <div className="space-y-2">
                                    <h4 className="text-xl font-bold text-fg uppercase tracking-tight">{isEn ? 'Confirm on Phone' : 'Confirmar no Telemóvel'}</h4>
                                    <p className="text-fg-muted text-sm leading-relaxed">
                                        {isEn ? (
                                            <>We sent an M-Pesa / e-Mola payment prompt to <strong>{savedPhoneNumber}</strong>. Enter your PIN on your handset to complete renewal.</>
                                        ) : (
                                            <>Enviamos um pedido de pagamento de Mpesa/e-Mola para o número <strong>{savedPhoneNumber}</strong>. Digite seu PIN no celular para concluir a renovação.</>
                                        )}
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <>
                                <div className="mx-auto w-16 h-16 bg-emerald-500/10 border border-emerald-500/20 text-accent-fg rounded-2xl flex items-center justify-center">
                                    <Smartphone size={32} />
                                </div>
                                <div className="space-y-2">
                                    <h3 className="text-2xl font-black text-fg tracking-tight">{isEn ? 'EXPRESS RENEWAL' : 'RENOVAÇÃO RÁPIDA'}</h3>
                                    <p className="text-fg-muted text-sm leading-relaxed">
                                        {isEn ? 'Renew your subscription using your saved payment details?' : 'Deseja renovar sua assinatura do plano usando seus dados salvos?'}
                                    </p>
                                </div>

                                {savedPhoneNumber && savedPaymentMethod && (
                                    <div className="bg-canvas-subtle border border-line rounded-2xl p-4 flex items-center justify-between text-left">
                                        <div>
                                            <p className="text-[10px] text-fg-subtle font-bold uppercase tracking-wider">{isEn ? 'Saved Method' : 'Método Salvo'}</p>
                                            <p className="text-fg font-bold capitalize">{savedPaymentMethod}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-[10px] text-fg-subtle font-bold uppercase tracking-wider">{isEn ? 'Number' : 'Número'}</p>
                                            <p className="text-fg font-mono font-bold">{savedPhoneNumber}</p>
                                        </div>
                                    </div>
                                )}

                                {errorMessage && (
                                    <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-danger-fg text-xs font-semibold">
                                        {errorMessage}
                                    </div>
                                )}

                                <div className="space-y-3 pt-2">
                                    {savedPhoneNumber && savedPaymentMethod && (
                                        <button
                                            onClick={handleConfirmRenewal}
                                            disabled={isRenewing}
                                            className="w-full py-4 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-black rounded-xl transition-all shadow-lg shadow-emerald-500/10 uppercase tracking-wider text-sm flex items-center justify-center gap-2"
                                        >
                                            {isRenewing ? (
                                                <>
                                                    <RefreshCw className="w-4 h-4 animate-spin" />
                                                    {isEn ? 'Processing...' : 'Processando...'}
                                                </>
                                            ) : (
                                                isEn ? 'Confirm & Pay' : 'Confirmar e Pagar'
                                            )}
                                        </button>
                                    )}

                                    <button
                                        onClick={handleAlternativeCheckout}
                                        disabled={isRenewing}
                                        className="w-full py-3 bg-surface-2 hover:bg-surface-3 text-fg font-bold rounded-xl transition-colors border border-line text-xs uppercase"
                                    >
                                        {isEn ? 'Change Method / Go to Checkout' : 'Alterar Método / Ir para Checkout'}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                )}

                {/* Variant 4: PLAN EXPIRED */}
                {type === 'PLAN_EXPIRED' && (
                    <div className="space-y-6">
                        <div className="mx-auto w-16 h-16 bg-rose-500/10 border border-rose-500/20 text-rose-500 rounded-2xl flex items-center justify-center animate-pulse">
                            <ShieldAlert size={32} />
                        </div>
                        <div className="space-y-2">
                            <h3 className="text-2xl font-black text-fg tracking-tight uppercase">{isEn ? 'SUBSCRIPTION EXPIRED' : 'ASSINATURA EXPIRADA'}</h3>
                            <p className="text-fg-muted text-sm leading-relaxed">
                                {isEn
                                    ? 'Your workspace subscription has expired. Renew your plan to restore live auto-sync, execution logging, and analytics tools.'
                                    : 'Sua assinatura expirou. Para continuar acompanhando seu desempenho, registrar novos trades e utilizar nossas ferramentas de análise, por favor reative sua assinatura.'}
                            </p>
                        </div>
                        <button
                            onClick={handleRedirectToPricing}
                            className="w-full py-4 bg-gradient-to-r from-rose-500 to-rose-600 hover:from-rose-400 hover:to-rose-500 text-white font-black rounded-xl transition-all shadow-lg shadow-rose-500/10 uppercase tracking-wider text-sm"
                        >
                            {isEn ? 'Renew Subscription' : 'Renovar Assinatura'}
                        </button>
                    </div>
                )}

                {/* Variant 5: NEAR EXPIRATION WARNING (Modern Dismissible Popup) */}
                {type === 'NEAR_EXPIRATION_WARNING' && (
                    <div className="space-y-5">
                        <div className="mx-auto w-14 h-14 bg-amber-500/12 border border-amber-500/30 text-amber-500 rounded-2xl flex items-center justify-center shadow-inner">
                            <Clock size={28} />
                        </div>

                        <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-amber-500">
                            {typeof daysLeft === 'number'
                                ? isEn
                                    ? `${daysLeft} day${daysLeft === 1 ? '' : 's'} remaining`
                                    : `${daysLeft} dia${daysLeft === 1 ? '' : 's'} restante${daysLeft === 1 ? '' : 's'}`
                                : isEn
                                  ? 'Expiring soon'
                                  : 'Expirando em breve'}
                        </div>

                        <div className="space-y-2">
                            <h3 className="text-xl sm:text-2xl font-black text-fg tracking-tight">
                                {isEn ? 'Your Plan Is Expiring Soon' : 'Assinatura Próxima do Vencimento'}
                            </h3>
                            <p className="text-fg-muted text-xs sm:text-sm leading-relaxed">
                                {isEn ? (
                                    <>
                                        Renew your <strong>{planTier}</strong> subscription ahead of time to keep uninterrupted auto-sync, Torex AI insights, and full analytics access.
                                    </>
                                ) : (
                                    <>
                                        Renove seu plano <strong>{planTier}</strong> antecipadamente para manter a sincronização automática, o Torex AI e todas as suas ferramentas ativas sem interrupção.
                                    </>
                                )}
                            </p>
                        </div>

                        <div className="space-y-2.5 pt-1">
                            <button
                                onClick={() => {
                                    trackButtonClick({
                                        ctaTag: 'renewal_modal_cta_click',
                                        intent: 'renewal',
                                        label: 'Renew Plan Modal CTA',
                                        metadata: { planTier, daysLeft },
                                    });
                                    handleRedirectToPricing();
                                }}
                                className="w-full py-3.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black rounded-xl transition-all shadow-lg shadow-amber-500/15 uppercase tracking-wider text-xs sm:text-sm cursor-pointer"
                            >
                                {isEn ? 'Renew / View Plans' : 'Renovar / Escolher Plano'}
                            </button>
                            {onClose && (
                                <button
                                    onClick={() => {
                                        trackButtonClick({
                                            ctaTag: 'renewal_modal_dismiss',
                                            intent: 'renewal_dismiss',
                                            label: 'Remind me later',
                                            metadata: { planTier, daysLeft },
                                        });
                                        onClose();
                                    }}
                                    className="w-full py-2.5 bg-surface-2 hover:bg-surface-3 text-fg-muted hover:text-fg font-semibold rounded-xl transition-colors border border-line text-xs cursor-pointer"
                                >
                                    {isEn ? 'Remind me later' : 'Lembrar depois'}
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
