import { useState, useEffect } from 'react';
import { useLocation, useNavigate, Navigate } from 'react-router-dom';
import { ShieldCheck, CreditCard, ChevronLeft, Smartphone, Loader2, Sparkles, Gift, AlertCircle } from 'lucide-react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { useLocale } from '../context/LocaleContext';
import { motion, AnimatePresence } from 'framer-motion';
import { 
    PlanSummary, 
    PaymentMethodBadge, 
    MobileMoneyForm, 
    CardPaymentView, 
    PollingOverlay 
} from '../components/subscription/CheckoutFlow';
import { trackButtonClick } from '../lib/tracking';

export const Checkout = () => {
    const { user, refreshProfile } = useAuth();
    const { locale, localizeBrowserPath } = useLocale();
    const isEn = locale === 'en';
    const location = useLocation();
    const navigate = useNavigate();

    const { plan, billingCycle, pricingConfig } = location.state || {};
    const exchangeRate = pricingConfig?.exchangeRate ? Number(pricingConfig.exchangeRate) : 65;
    const [paymentMethod, setPaymentMethod] = useState<'mpesa' | 'emola' | 'card'>('mpesa');
    const [phoneNumber, setPhoneNumber] = useState('');
    const [savePreference, setSavePreference] = useState(false);
    const [processing, setProcessing] = useState(false);
    const [showPinPrompt, setShowPinPrompt] = useState(false);
    const [showModal, setShowModal] = useState(false);
    const [pollingTimedOut, setPollingTimedOut] = useState(false);
    const [referralCreditsUsd, setReferralCreditsUsd] = useState(0);
    const [pendingCreditsUsd, setPendingCreditsUsd] = useState(0);
    const [useReferralCredits, setUseReferralCredits] = useState(false);
    const [redeemingCredits, setRedeemingCredits] = useState(false);

    useEffect(() => {
        if (user) {
            if (paymentMethod === 'mpesa' && user.preferredMpesa) setPhoneNumber(user.preferredMpesa);
            if (paymentMethod === 'emola' && user.preferredEmola) setPhoneNumber(user.preferredEmola);
        }
    }, [user, paymentMethod]);

    useEffect(() => {
        if (!user?.id) return;
        let mounted = true;
        api.get('/referrals/me')
            .then((res) => {
                if (!mounted || !res.data) return;
                setReferralCreditsUsd(Number(res.data.creditsUsd || 0));
                setPendingCreditsUsd(Number(res.data.pendingCreditsUsd || 0));
            })
            .catch(() => {});
        return () => {
            mounted = false;
        };
    }, [user?.id]);

    if (!plan || !billingCycle) {
        return <Navigate to="/pricing" replace />;
    }

    const getBillTotalUSD = () => {
        if (billingCycle === 'MONTHLY') return plan.monthlyPrice;
        const total = plan.monthlyPrice * 12;
        const discount = total * (plan.annualDiscountPercent / 100);
        return Number((total - discount).toFixed(2));
    };

    const baseTotalUSD = getBillTotalUSD();
    const appliedCreditUSD = useReferralCredits
        ? Number(Math.min(referralCreditsUsd, baseTotalUSD).toFixed(2))
        : 0;
    const payableTotalUSD = Number(Math.max(0, baseTotalUSD - appliedCreditUSD).toFixed(2));

    const handleRedeemCredits = async () => {
        if (redeemingCredits || referralCreditsUsd < baseTotalUSD) return;
        setRedeemingCredits(true);
        trackButtonClick({
            ctaTag: 'checkout_redeem_credits',
            intent: `pay_${String(plan.tier || '').toLowerCase()}`,
            label: 'Activate with Affiliate Credits',
            metadata: { tier: plan.tier, billingCycle, amountUSD: baseTotalUSD },
        });
        try {
            await api.post('/subscription/redeem-credits', {
                tier: plan.tier,
                cycle: billingCycle,
            });
            await refreshProfile().catch(() => {});
            navigate('/subscription/success', { state: { method: 'credits' } });
        } catch (error) {
            console.error(error);
            alert(
                isEn
                    ? 'Could not activate plan with referral credits right now.'
                    : 'Não foi possível ativar o plano com créditos de afiliado agora.'
            );
        } finally {
            setRedeemingCredits(false);
        }
    };

    const handleMobileMoneySubmit = async () => {
        if (!phoneNumber || phoneNumber.length !== 9) return;
        setProcessing(true);
        setShowPinPrompt(false);
        setPollingTimedOut(false);
        trackButtonClick({
            ctaTag: `checkout_submit_${paymentMethod}`,
            intent: `pay_${String(plan.tier || '').toLowerCase()}`,
            label: `Pay ${paymentMethod}`,
            metadata: { tier: plan.tier, billingCycle, amountUSD: payableTotalUSD },
        });
        try {
            await api.post('/subscription/subscribe/mobile', {
                tier: plan.tier,
                cycle: billingCycle,
                paymentMethod: paymentMethod,
                phoneNumber: phoneNumber,
                savePreference: savePreference,
                useReferralCredits,
            });
            setShowPinPrompt(true);
            setShowModal(true);
        } catch (error) {
            console.error(error);
            alert(
                isEn
                    ? 'Failed to initiate payment. Please check the number and try again.'
                    : 'Erro ao iniciar pagamento. Verifique o número e tente novamente.'
            );
        } finally {
            setProcessing(false);
        }
    };

    const handleCardSubmit = async () => {
        setProcessing(true);
        setShowPinPrompt(false);
        setPollingTimedOut(false);
        setShowModal(true);
        trackButtonClick({
            ctaTag: `checkout_submit_${paymentMethod}`,
            intent: `pay_${String(plan.tier || '').toLowerCase()}`,
            label: `Pay ${paymentMethod}`,
            metadata: { tier: plan.tier, billingCycle, amountUSD: payableTotalUSD },
        });
        try {
            const res = await api.post('/subscription/subscribe/card', {
                tier: plan.tier,
                cycle: billingCycle,
                returnUrl: `${window.location.origin}${localizeBrowserPath('/subscription/success')}`,
                cancelUrl: `${window.location.origin}${localizeBrowserPath('/checkout')}`,
                phoneNumber: phoneNumber, // Set via CountryPhoneInput callback
                paymentMethod: 'card',
                useReferralCredits,
            });

            if (res.data && res.data.checkoutUrl) {
                setTimeout(() => {
                    window.location.href = res.data.checkoutUrl;
                }, 1500);
            } else {
                setShowPinPrompt(true);
            }
        } catch (error) {
            console.error(error);
            setShowModal(false);
            alert(
                isEn
                    ? 'Failed to initiate card payment.'
                    : 'Erro ao iniciar pagamento com cartão.'
            );
        } finally {
            setProcessing(false);
        }
    };

    // Polling for success (bounded to 40 checks = 2 min)
    useEffect(() => {
        if (!showPinPrompt) return;
        let cancelled = false;
        let attempts = 0;
        const MAX_POLL_ATTEMPTS = 40;
        const interval = window.setInterval(async () => {
            if (cancelled) return;
            attempts += 1;
            if (attempts > MAX_POLL_ATTEMPTS) {
                window.clearInterval(interval);
                setPollingTimedOut(true);
                setShowPinPrompt(false);
                setProcessing(false);
                return;
            }
            try {
                const res = await api.get('/subscription/status');
                if (!cancelled && res.data && res.data.hasActive) {
                    window.clearInterval(interval);
                    await refreshProfile().catch(() => {});
                    navigate('/subscription/success', { state: { method: paymentMethod } });
                }
            } catch (error) {
                console.error("Polling error:", error);
            }
        }, 3000);
        return () => {
            cancelled = true;
            window.clearInterval(interval);
        };
    }, [showPinPrompt, navigate, paymentMethod, refreshProfile]);

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-[#050508] text-fg selection:bg-indigo-500/30 overflow-hidden relative transition-colors duration-200">
            {/* Ambient Background Glows */}
            <div className="absolute inset-0 pointer-events-none z-0">
                <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-indigo-500/5 blur-[150px] rounded-full" />
                <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-blue-600/5 blur-[150px] rounded-full" />
            </div>

            <div className="relative z-10 container mx-auto px-6 py-12 lg:py-24 max-w-7xl">
                {/* Header Navigation */}
                <motion.button 
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    onClick={() => navigate('/pricing')}
                    className="flex items-center gap-2 text-slate-600 dark:text-slate-500 hover:text-fg transition-colors mb-12 group"
                >
                    <div className="w-8 h-8 rounded-full bg-surface border border-line flex items-center justify-center group-hover:bg-surface-2 transition-colors shadow-sm">
                        <ChevronLeft size={16} />
                    </div>
                    <span className="text-sm font-bold uppercase tracking-widest text-[10px]">{isEn ? 'Back to Plans' : 'Voltar aos Planos'}</span>
                </motion.button>

                <div className="grid lg:grid-cols-12 gap-12 lg:gap-20 items-start">
                    {/* Left: Configuration & Details */}
                    <div className="lg:col-span-4">
                        <PlanSummary 
                            plan={plan} 
                            billingCycle={billingCycle} 
                            total={payableTotalUSD} 
                            exchangeRate={exchangeRate}
                            isEn={isEn}
                        />
                    </div>

                    {/* Right: Payment Center */}
                    <motion.div 
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.1 }}
                        className="lg:col-span-8"
                    >
                        <div className="bg-white/80 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-800/80 rounded-[32px] p-8 lg:p-12 backdrop-blur-xl shadow-2xl relative overflow-hidden">
                            <div className="relative z-10">
                                <header className="mb-10">
                                    <h2 className="text-3xl font-black text-fg mb-3 tracking-tight uppercase">Checkout</h2>
                                    <p className="text-fg-muted text-sm">{isEn ? 'Select your preferred payment method to activate your Torex workspace license.' : 'Escolha seu método de pagamento preferido para ativar sua licença Torex.'}</p>
                                </header>

                                {(referralCreditsUsd > 0 || pendingCreditsUsd > 0) && (
                                    <div className="mb-8 rounded-2xl border border-indigo-500/25 bg-indigo-500/5 dark:bg-indigo-500/10 p-4 space-y-3">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <div className="flex items-center gap-2 text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
                                                <Gift size={15} />
                                                <span>{isEn ? 'Affiliate Plan Credits' : 'Créditos de Afiliado'}</span>
                                            </div>
                                            <span className="text-xs font-mono font-black text-fg">
                                                ${referralCreditsUsd.toFixed(2)} USD {isEn ? 'available' : 'disponível'}
                                            </span>
                                        </div>

                                        {referralCreditsUsd >= baseTotalUSD ? (
                                            <div className="flex flex-wrap items-center justify-between gap-3">
                                                <p className="text-xs text-fg-muted">
                                                    {isEn
                                                        ? `Your balance covers the entire plan ($${baseTotalUSD.toFixed(2)} USD). Activate immediately at no cost.`
                                                        : `O seu saldo cobre integralmente este plano ($${baseTotalUSD.toFixed(2)} USD). Ative imediatamente sem custo adicional.`}
                                                </p>
                                                <button
                                                    type="button"
                                                    onClick={handleRedeemCredits}
                                                    disabled={redeemingCredits}
                                                    className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-2 transition-colors disabled:opacity-50 cursor-pointer"
                                                >
                                                    <Sparkles size={14} />
                                                    <span>
                                                        {redeemingCredits
                                                            ? (isEn ? 'Activating...' : 'Ativando...')
                                                            : (isEn
                                                                ? `Activate with Credits ($${baseTotalUSD.toFixed(2)})`
                                                                : `Ativar Plano com Créditos ($${baseTotalUSD.toFixed(2)})`)}
                                                    </span>
                                                </button>
                                            </div>
                                        ) : referralCreditsUsd > 0 ? (
                                            <label className="flex items-center justify-between gap-3 cursor-pointer text-xs text-fg">
                                                <span className="flex items-center gap-2">
                                                    <input
                                                        type="checkbox"
                                                        checked={useReferralCredits}
                                                        onChange={(e) => setUseReferralCredits(e.target.checked)}
                                                        className="rounded border-slate-400 text-indigo-600 focus:ring-indigo-500"
                                                    />
                                                    <span>
                                                        {isEn
                                                            ? `Use $${referralCreditsUsd.toFixed(2)} in affiliate credits (remaining $${payableTotalUSD.toFixed(2)})`
                                                            : `Usar $${referralCreditsUsd.toFixed(2)} em créditos de afiliado (resta $${payableTotalUSD.toFixed(2)})`}
                                                    </span>
                                                </span>
                                            </label>
                                        ) : null}

                                        {pendingCreditsUsd > 0 && (
                                            <p className="text-[11px] text-amber-700 dark:text-amber-300 leading-relaxed">
                                                {isEn
                                                    ? `$${pendingCreditsUsd.toFixed(2)} USD held in anti-fraud guarantee — automatically unlocked once your paid subscription activates.`
                                                    : `$${pendingCreditsUsd.toFixed(2)} USD em garantia antifraude — serão desbloqueados automaticamente após ativar a assinatura paga.`}
                                            </p>
                                        )}
                                    </div>
                                )}

                                {pollingTimedOut && !showModal && (
                                    <div className="mb-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3.5 flex items-start gap-2.5 text-xs text-amber-800 dark:text-amber-300">
                                        <AlertCircle size={16} className="shrink-0 mt-0.5" />
                                        <span>
                                            {isEn
                                                ? 'Confirmation timeout reached (2 min). If you already entered your PIN, check your account status or try again.'
                                                : 'Tempo limite de confirmação atingido (2 min). Se já digitou o PIN, verifique o estado da conta ou tente novamente.'}
                                        </span>
                                    </div>
                                )}

                                {/* Method Selector */}
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
                                    <PaymentMethodBadge 
                                        id="mpesa" 
                                        label="M-Pesa" 
                                        img="https://res.cloudinary.com/dndlqdylc/image/upload/v1771597297/mpesaIcon_rht9mz.jpg"
                                        active={paymentMethod === 'mpesa'}
                                        onClick={() => { setPaymentMethod('mpesa'); setShowPinPrompt(false); setPollingTimedOut(false); }}
                                    />
                                    <PaymentMethodBadge 
                                        id="emola" 
                                        label="e-Mola" 
                                        img="https://res.cloudinary.com/dndlqdylc/image/upload/v1771597297/emola_ykhnhj.png"
                                        active={paymentMethod === 'emola'}
                                        onClick={() => { setPaymentMethod('emola'); setShowPinPrompt(false); setPollingTimedOut(false); }}
                                    />
                                    <PaymentMethodBadge 
                                        id="card" 
                                        label={isEn ? 'Card' : 'Cartão'} 
                                        icon={CreditCard}
                                        active={paymentMethod === 'card'}
                                        onClick={() => { setPaymentMethod('card'); setShowPinPrompt(false); setPollingTimedOut(false); }}
                                    />
                                </div>

                                {/* Payment Forms */}
                                <div className="min-h-[260px]">
                                    <AnimatePresence mode="wait">
                                        {showPinPrompt ? (
                                            <PollingOverlay key="polling" method={paymentMethod} total={payableTotalUSD} exchangeRate={exchangeRate} isEn={isEn} />
                                        ) : (
                                            <motion.div
                                                key={paymentMethod}
                                                initial={{ opacity: 0, x: 10 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                exit={{ opacity: 0, x: -10 }}
                                                transition={{ duration: 0.2 }}
                                            >
                                                {(paymentMethod === 'mpesa' || paymentMethod === 'emola') && (
                                                    <MobileMoneyForm 
                                                        method={paymentMethod}
                                                        isEn={isEn}
                                                        phoneNumber={phoneNumber}
                                                        setPhoneNumber={setPhoneNumber}
                                                        savePreference={savePreference}
                                                        setSavePreference={setSavePreference}
                                                        onSubmit={handleMobileMoneySubmit}
                                                        processing={processing}
                                                    />
                                                )}

                                                {paymentMethod === 'card' && (
                                                    <CardPaymentView 
                                                        onSubmit={handleCardSubmit}
                                                        processing={processing}
                                                        isEn={isEn}
                                                        onPhoneChange={setPhoneNumber}
                                                    />
                                                )}
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>

                                <footer className="mt-10 pt-8 border-t border-slate-200 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-6 opacity-70 dark:opacity-50">
                                    <div className="flex items-center gap-2">
                                        <ShieldCheck className="text-indigo-600 dark:text-indigo-400" size={16} />
                                        <span className="text-[9px] font-bold uppercase tracking-widest text-fg-muted ">{isEn ? 'Encrypted Checkout' : 'Processamento Criptografado'}</span>
                                    </div>
                                    <div className="flex items-center gap-2 cursor-default">
                                        <span className="text-[9px] font-bold text-fg-subtle">{isEn ? 'Supported Methods:' : 'Métodos Aceitos:'}</span>
                                        <span className="text-[10px] font-black text-slate-800 dark:text-slate-300">M-Pesa · e-Mola · Cartão</span>
                                    </div>
                                </footer>
                            </div>
                        </div>
                    </motion.div>
                </div>
            </div>

            {/* Payment Processing Modal */}
            <AnimatePresence>
                {showModal && (
                    <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-md bg-black/60"
                    >
                        <motion.div 
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            className="bg-white dark:bg-[#0b0d14] border border-slate-200 dark:border-slate-800/80 rounded-[32px] p-8 max-w-sm w-full text-center relative overflow-hidden shadow-2xl"
                        >
                            <div className="relative z-10 space-y-6">
                                <div className="flex justify-center">
                                    <div className="relative">
                                        <div className="w-14 h-14 bg-indigo-500/10 rounded-2xl flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                                            {['mpesa', 'emola'].includes(paymentMethod) ? (
                                                <Smartphone size={28} className="animate-bounce" />
                                            ) : (
                                                <ShieldCheck size={28} className="text-emerald-500 dark:text-emerald-400" />
                                            )}
                                        </div>
                                        <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-indigo-600 rounded-full flex items-center justify-center">
                                            <Loader2 className="animate-spin text-fg" size={10} />
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <h3 className="text-lg font-black text-fg uppercase tracking-tight">
                                        {pollingTimedOut
                                            ? (isEn ? 'Confirmation Timeout' : 'Tempo Limite Atingido')
                                            : (isEn ? 'Awaiting Confirmation' : 'Aguardando Confirmação')}
                                    </h3>
                                    <p className="text-fg-muted text-xs leading-relaxed">
                                        {pollingTimedOut ? (
                                            isEn
                                                ? 'Confirmation timeout reached (2 min). If you already entered your PIN, check your account status or try again.'
                                                : 'Tempo limite de confirmação atingido (2 min). Se já digitou o PIN, verifique o estado da conta ou tente novamente.'
                                        ) : ['mpesa', 'emola'].includes(paymentMethod) ? (
                                            <>
                                                {isEn ? <>We sent a payment prompt of <span className="text-fg font-bold font-mono">$ {payableTotalUSD.toFixed(2)} USD</span> (~ MT {(payableTotalUSD * exchangeRate).toFixed(0)} MZN) to your phone. Please enter your <span className="text-indigo-600 dark:text-indigo-400 font-bold">PIN</span> to authorize.</> : <>Enviamos um pedido de pagamento de <span className="text-fg font-bold font-mono">$ {payableTotalUSD.toFixed(2)} USD</span> (~ MT {(payableTotalUSD * exchangeRate).toFixed(0)} MZN) para o seu telemóvel. Por favor, introduza o seu <span className="text-indigo-600 dark:text-indigo-400 font-bold">PIN</span> para autorizar.</>}
                                            </>
                                        ) : (
                                            <>
                                                {isEn ? <>Your card payment request of <span className="text-fg font-bold font-mono">$ {payableTotalUSD.toFixed(2)} USD</span> has been registered and is awaiting confirmation.</> : <>O seu pedido de pagamento via cartão no valor de <span className="text-fg font-bold font-mono">$ {payableTotalUSD.toFixed(2)} USD</span> foi registrado e aguarda confirmação.</>}
                                            </>
                                        )}
                                    </p>
                                </div>

                                <div className="bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-900 rounded-2xl p-4 text-[10px] text-slate-600 dark:text-slate-500 text-left space-y-2 shadow-sm">
                                    <div className="flex items-center justify-between text-indigo-600 dark:text-indigo-400 font-bold uppercase tracking-wider">
                                        <span>{isEn ? 'Status' : 'Estado'}</span>
                                        <span className="flex items-center gap-1">
                                            <span className={`w-1.5 h-1.5 rounded-full ${pollingTimedOut ? 'bg-amber-500' : 'bg-emerald-500 animate-pulse'}`} />
                                            {pollingTimedOut ? (isEn ? 'Timeout' : 'Expirado') : (isEn ? 'Pending' : 'Pendente')}
                                        </span>
                                    </div>
                                    <p className="text-[9px] text-fg-subtle leading-normal">
                                        {pollingTimedOut
                                            ? (isEn ? 'Close this dialog to verify subscription status or restart the payment.' : 'Feche esta janela para verificar o estado da subscrição ou reiniciar o pagamento.')
                                            : ['mpesa', 'emola'].includes(paymentMethod)
                                                ? (isEn ? 'After entering your PIN on your phone, wait for automatic confirmation on this screen. Do not close this tab.' : 'Após digitar o PIN no seu telemóvel, aguarde a confirmação automática nesta tela. Não feche a página.')
                                                : (isEn ? 'Waiting for card payment confirmation. Your subscription will activate automatically once confirmed.' : 'Aguardando a confirmação do pagamento com cartão. A sua assinatura será ativada automaticamente após a liquidação.')}
                                    </p>
                                </div>

                                <button 
                                    onClick={() => {
                                        setShowModal(false);
                                        setProcessing(false);
                                        setShowPinPrompt(false);
                                        setPollingTimedOut(false);
                                    }}
                                    className="text-[10px] text-fg-subtle hover:text-slate-800 dark:text-slate-600 dark:hover:text-slate-400 transition-colors uppercase font-bold tracking-widest pt-2 block mx-auto"
                                >
                                    {isEn ? 'Close' : 'Fechar'}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};
