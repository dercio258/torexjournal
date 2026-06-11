import { useState, useEffect } from 'react';
import { useLocation, useNavigate, Navigate } from 'react-router-dom';
import { ShieldCheck, CreditCard, ChevronLeft, Smartphone, Loader2 } from 'lucide-react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';
import { 
    PlanSummary, 
    PaymentMethodBadge, 
    MobileMoneyForm, 
    CardPaymentView, 
    PollingOverlay 
} from '../components/subscription/CheckoutFlow';

export const Checkout = () => {
    const { token } = useAuth();
    const [user, setUser] = useState<any>(null);
    const location = useLocation();
    const navigate = useNavigate();

    useEffect(() => {
        if (token) {
            api.get('/auth/profile').then(res => setUser(res.data)).catch(console.error);
        }
    }, [token]);

    const { plan, billingCycle } = location.state || {};
    const [paymentMethod, setPaymentMethod] = useState<'mpesa' | 'emola' | 'card' | 'payfast'>('mpesa');
    const [phoneNumber, setPhoneNumber] = useState('');
    const [savePreference, setSavePreference] = useState(false);
    const [processing, setProcessing] = useState(false);
    const [showPinPrompt, setShowPinPrompt] = useState(false);
    const [showModal, setShowModal] = useState(false);

    useEffect(() => {
        if (user) {
            if (paymentMethod === 'mpesa' && user.preferredMpesa) setPhoneNumber(user.preferredMpesa);
            if (paymentMethod === 'emola' && user.preferredEmola) setPhoneNumber(user.preferredEmola);
        }
    }, [user, paymentMethod]);

    if (!plan || !billingCycle) {
        return <Navigate to="/pricing" replace />;
    }

    const getBillTotalMT = () => {
        if (billingCycle === 'MONTHLY') return plan.monthlyPrice;
        const total = plan.monthlyPrice * 12;
        const discount = total * (plan.annualDiscountPercent / 100);
        return Number((total - discount).toFixed(2));
    };

    const handleMobileMoneySubmit = async () => {
        if (!phoneNumber || phoneNumber.length !== 9) return;
        setProcessing(true);
        setShowPinPrompt(false);
        try {
            await api.post('/subscription/subscribe/mobile', {
                tier: plan.tier,
                cycle: billingCycle,
                paymentMethod: paymentMethod,
                phoneNumber: phoneNumber,
                savePreference: savePreference
            });
            setShowPinPrompt(true);
            setShowModal(true);
        } catch (error) {
            console.error(error);
            alert("Erro ao iniciar pagamento. Verifique o número e tente novamente.");
        } finally {
            setProcessing(false);
        }
    };

    const handleRedirectSubmit = async () => {
        setProcessing(true);
        setShowModal(true);
        try {
            const res = await api.post('/subscription/subscribe/card', {
                tier: plan.tier,
                cycle: billingCycle,
                returnUrl: `${window.location.origin}/subscription/success`,
                cancelUrl: `${window.location.origin}/checkout`,
                phoneNumber: phoneNumber, // Set via CountryPhoneInput callback
                paymentMethod: paymentMethod === 'payfast' ? 'payfast' : 'card'
            });

            if (res.data && res.data.checkoutUrl) {
                setTimeout(() => {
                    window.location.href = res.data.checkoutUrl;
                }, 1500);
            } else {
                throw new Error("No URL returned from gateway");
            }
        } catch (error) {
            console.error(error);
            setShowModal(false);
            alert(`Erro ao iniciar pagamento com ${paymentMethod === 'payfast' ? 'PayFast' : 'cartão'}.`);
        } finally {
            setProcessing(false);
        }
    };

    // Polling for success
    useEffect(() => {
        let interval: any;
        if (showPinPrompt) {
            interval = setInterval(async () => {
                try {
                    const res = await api.get('/subscription/status');
                    if (res.data && res.data.hasActive) {
                        navigate('/subscription/success', { state: { method: paymentMethod } });
                    }
                } catch (error) {
                    console.error("Polling error:", error);
                }
            }, 3000);
        }
        return () => clearInterval(interval);
    }, [showPinPrompt, navigate, paymentMethod]);

    return (
        <div className="min-h-screen bg-[#050508] text-white selection:bg-indigo-500/30 overflow-hidden relative">
            {/* Ambient Background Glows - Subtly structured as requested */}
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
                    className="flex items-center gap-2 text-slate-500 hover:text-white transition-colors mb-12 group"
                >
                    <div className="w-8 h-8 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center group-hover:bg-slate-800 transition-colors">
                        <ChevronLeft size={16} />
                    </div>
                    <span className="text-sm font-bold uppercase tracking-widest text-[10px]">Voltar aos Planos</span>
                </motion.button>

                <div className="grid lg:grid-cols-12 gap-12 lg:gap-20 items-start">
                    {/* Left: Configuration & Details */}
                    <div className="lg:col-span-4">
                        <PlanSummary 
                            plan={plan} 
                            billingCycle={billingCycle} 
                            total={getBillTotalMT()} 
                        />
                    </div>

                    {/* Right: Payment Center */}
                    <motion.div 
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.1 }}
                        className="lg:col-span-8"
                    >
                        <div className="bg-slate-900/30 border border-slate-800/80 rounded-[32px] p-8 lg:p-12 backdrop-blur-xl shadow-2xl relative overflow-hidden">
                            <div className="relative z-10">
                                <header className="mb-10">
                                    <h2 className="text-3xl font-black text-white mb-3 tracking-tight uppercase">Checkout</h2>
                                    <p className="text-slate-400 text-sm">Escolha seu método de pagamento preferido para ativar sua licença Torex.</p>
                                </header>

                                {/* Method Selector */}
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                                    <PaymentMethodBadge 
                                        id="mpesa" 
                                        label="M-Pesa" 
                                        img="https://res.cloudinary.com/dndlqdylc/image/upload/v1771597297/mpesaIcon_rht9mz.jpg"
                                        active={paymentMethod === 'mpesa'}
                                        onClick={() => { setPaymentMethod('mpesa'); setShowPinPrompt(false); }}
                                    />
                                    <PaymentMethodBadge 
                                        id="emola" 
                                        label="e-Mola" 
                                        img="https://res.cloudinary.com/dndlqdylc/image/upload/v1771597297/emola_ykhnhj.png"
                                        active={paymentMethod === 'emola'}
                                        onClick={() => { setPaymentMethod('emola'); setShowPinPrompt(false); }}
                                    />
                                    <PaymentMethodBadge 
                                        id="card" 
                                        label="Cartão" 
                                        icon={CreditCard}
                                        active={paymentMethod === 'card'}
                                        onClick={() => { setPaymentMethod('card'); setShowPinPrompt(false); }}
                                    />
                                    <PaymentMethodBadge 
                                        id="payfast" 
                                        label="PayFast" 
                                        icon={CreditCard}
                                        active={paymentMethod === 'payfast'}
                                        onClick={() => { setPaymentMethod('payfast'); setShowPinPrompt(false); }}
                                    />
                                </div>

                                {/* Payment Forms */}
                                <div className="min-h-[260px]">
                                    <AnimatePresence mode="wait">
                                        {showPinPrompt ? (
                                            <PollingOverlay key="polling" method={paymentMethod} total={getBillTotalMT()} />
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
                                                        phoneNumber={phoneNumber}
                                                        setPhoneNumber={setPhoneNumber}
                                                        savePreference={savePreference}
                                                        setSavePreference={setSavePreference}
                                                        onSubmit={handleMobileMoneySubmit}
                                                        processing={processing}
                                                    />
                                                )}

                                                {(paymentMethod === 'card' || paymentMethod === 'payfast') && (
                                                    <CardPaymentView 
                                                        onSubmit={handleRedirectSubmit}
                                                        processing={processing}
                                                        onPhoneChange={setPhoneNumber}
                                                        method={paymentMethod}
                                                    />
                                                )}
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>

                                <footer className="mt-10 pt-8 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-6 opacity-50">
                                    <div className="flex items-center gap-2">
                                        <ShieldCheck className="text-indigo-400" size={16} />
                                        <span className="text-[9px] font-bold uppercase tracking-widest">Processamento Criptografado</span>
                                    </div>
                                    <div className="flex items-center gap-2 grayscale hover:grayscale-0 transition-all cursor-default">
                                        <span className="text-[9px] font-bold text-slate-500">Parceiro Oficial:</span>
                                        <span className="text-[10px] font-black text-slate-300">Debito.co.mz</span>
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
                            className="bg-[#0b0d14] border border-slate-800/80 rounded-[32px] p-8 max-w-sm w-full text-center relative overflow-hidden shadow-2xl"
                        >
                            <div className="relative z-10 space-y-6">
                                <div className="flex justify-center">
                                    <div className="relative">
                                        <div className="w-14 h-14 bg-indigo-500/10 rounded-2xl flex items-center justify-center text-indigo-400">
                                            {['mpesa', 'emola'].includes(paymentMethod) ? (
                                                <Smartphone size={28} className="animate-bounce" />
                                            ) : (
                                                <ShieldCheck size={28} className="text-emerald-400" />
                                            )}
                                        </div>
                                        <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-indigo-600 rounded-full flex items-center justify-center">
                                            <Loader2 className="animate-spin text-white" size={10} />
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <h3 className="text-lg font-black text-white uppercase tracking-tight">
                                        {['mpesa', 'emola'].includes(paymentMethod) ? 'Aguardando Confirmação' : 'Redirecionando'}
                                    </h3>
                                    <p className="text-slate-400 text-xs leading-relaxed">
                                        {['mpesa', 'emola'].includes(paymentMethod) ? (
                                            <>
                                                Enviamos um pedido de pagamento de <span className="text-white font-bold">MT {getBillTotalMT().toFixed(2)}</span> para o seu telemóvel. Por favor, introduza o seu <span className="text-indigo-400 font-bold">PIN</span> para autorizar.
                                            </>
                                        ) : (
                                            <>
                                                Estamos a preparar a sua ligação segura. Você será redirecionado para a página de pagamento seguro para concluir a transação de <span className="text-white font-bold">MT {getBillTotalMT().toFixed(2)}</span>.
                                            </>
                                        )}
                                    </p>
                                </div>

                                {['mpesa', 'emola'].includes(paymentMethod) && (
                                    <div className="bg-slate-950/60 border border-slate-900 rounded-2xl p-4 text-[10px] text-slate-500 text-left space-y-2">
                                        <div className="flex items-center justify-between text-indigo-400 font-bold uppercase tracking-wider">
                                            <span>Estado</span>
                                            <span className="flex items-center gap-1">
                                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                                Pendente
                                            </span>
                                        </div>
                                        <p className="text-[9px] text-slate-500 leading-normal">
                                            Após digitar o PIN no seu telemóvel, aguarde a confirmação automática nesta tela. Não feche a página.
                                        </p>
                                    </div>
                                )}
                                
                                {['mpesa', 'emola'].includes(paymentMethod) && (
                                    <button 
                                        onClick={() => {
                                            setShowModal(false);
                                            setProcessing(false);
                                            setShowPinPrompt(false);
                                        }}
                                        className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors uppercase font-bold tracking-widest pt-2 block mx-auto"
                                    >
                                        Cancelar
                                    </button>
                                )}
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};
