import { useState, useEffect } from 'react';
import { useLocation, useNavigate, Navigate } from 'react-router-dom';
import { ShieldCheck, CreditCard, ChevronLeft } from 'lucide-react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
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
    const [paymentMethod, setPaymentMethod] = useState<'mpesa' | 'emola' | 'card'>('mpesa');
    const [phoneNumber, setPhoneNumber] = useState('');
    const [savePreference, setSavePreference] = useState(false);
    const [processing, setProcessing] = useState(false);
    const [showPinPrompt, setShowPinPrompt] = useState(false);

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
        } catch (error) {
            console.error(error);
            alert("Erro ao iniciar pagamento. Verifique o número e tente novamente.");
        } finally {
            setProcessing(false);
        }
    };

    const handleCardSubmit = async () => {
        setProcessing(true);
        try {
            const res = await api.post('/subscription/subscribe/card', {
                tier: plan.tier,
                cycle: billingCycle,
                returnUrl: `${window.location.origin}/subscription/success`,
                cancelUrl: `${window.location.origin}/checkout`,
                phoneNumber: phoneNumber // Set via CountryPhoneInput callback
            });

            if (res.data && res.data.checkoutUrl) {
                window.location.href = res.data.checkoutUrl;
            } else {
                throw new Error("No URL returned from gateway");
            }
        } catch (error) {
            console.error(error);
            alert("Erro ao iniciar pagamento com cartão.");
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
        <div className="min-h-screen bg-[#050508] text-white selection:bg-indigo-500/30">
            {/* Ambient Background */}
            <div className="fixed inset-0 pointer-events-none">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-600/10 blur-[120px] rounded-full" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-600/10 blur-[120px] rounded-full" />
            </div>

            <div className="relative z-10 container mx-auto px-6 py-12 lg:py-24 max-w-7xl">
                {/* Header Navigation */}
                <button 
                    onClick={() => navigate('/pricing')}
                    className="flex items-center gap-2 text-slate-500 hover:text-white transition-colors mb-12 group"
                >
                    <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-white/10 transition-colors">
                        <ChevronLeft size={16} />
                    </div>
                    <span className="text-sm font-bold uppercase tracking-widest">Voltar aos Planos</span>
                </button>

                <div className="grid lg:grid-cols-12 gap-12 lg:gap-24 items-start">
                    {/* Left: Configuration & Details */}
                    <div className="lg:col-span-4 space-y-8 animate-in fade-in slide-in-from-left-8 duration-700">
                        <PlanSummary 
                            plan={plan} 
                            billingCycle={billingCycle} 
                            total={getBillTotalMT()} 
                        />
                    </div>

                    {/* Right: Payment Center */}
                    <div className="lg:col-span-8 animate-in fade-in slide-in-from-right-8 duration-700 delay-200">
                        <div className="bg-white/[0.02] border border-white/5 rounded-[40px] p-8 lg:p-12 backdrop-blur-3xl shadow-2xl relative overflow-hidden group">
                            {/* Decorative border gradient */}
                            <div className="absolute inset-0 border-2 border-transparent bg-gradient-to-br from-white/10 to-transparent opacity-50 pointer-events-none rounded-[40px]" />
                            
                            <div className="relative z-10">
                                <header className="mb-12">
                                    <h2 className="text-4xl font-black text-white mb-4 tracking-tighter uppercase">Checkout</h2>
                                    <p className="text-slate-400 font-medium">Escolha seu método de pagamento preferido para ativar sua licença Torex.</p>
                                </header>

                                {/* Method Selector */}
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
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
                                </div>

                                {/* Payment Forms */}
                                <div className="min-h-[300px]">
                                    {showPinPrompt ? (
                                        <PollingOverlay method={paymentMethod} total={getBillTotalMT()} />
                                    ) : (
                                        <>
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

                                            {paymentMethod === 'card' && (
                                                <CardPaymentView 
                                                    onSubmit={handleCardSubmit}
                                                    processing={processing}
                                                    onPhoneChange={setPhoneNumber}
                                                />
                                            )}
                                        </>
                                    )}
                                </div>

                                <footer className="mt-12 pt-8 border-t border-white/5 flex flex-wrap items-center justify-between gap-6 opacity-60">
                                    <div className="flex items-center gap-2">
                                        <ShieldCheck className="text-indigo-400" size={16} />
                                        <span className="text-[10px] font-bold uppercase tracking-widest">Processamento Criptografado</span>
                                    </div>
                                    <div className="flex items-center gap-1.5 grayscale hover:grayscale-0 transition-all cursor-default">
                                        <img src="https://paymentsindustryintelligence.com/wp-content/uploads/2021/11/visa-mastercard-logos.jpg" alt="Visa/Mastercard" className="h-4 rounded-sm" />
                                        <span className="text-[10px] font-bold text-slate-300">Debito.co.mz</span>
                                    </div>
                                </footer>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
