import { useState, useEffect } from 'react';
import { useLocation, useNavigate, Navigate } from 'react-router-dom';
import { PayPalScriptProvider, PayPalButtons } from "@paypal/react-paypal-js";
import { ShieldCheck } from 'lucide-react';
import api from '../api';
import { useAuth } from '../context/AuthContext';

export const Checkout = () => {
    const [clientId, setClientId] = useState<string | null>(null);
    const { token } = useAuth();
    const [user, setUser] = useState<any>(null);
    const location = useLocation();
    const navigate = useNavigate();

    useEffect(() => {
        if (token) {
            api.get('/auth/profile').then(res => setUser(res.data)).catch(console.error);
        }
    }, [token]);

    // Get Plan from router state
    const { plan, billingCycle } = location.state || {};

    // const [processing, setProcessing] = useState(false);

    // Redirect if no plan selected
    if (!plan || !billingCycle) {
        return <Navigate to="/pricing" replace />;
    }

    useEffect(() => {
        const fetchConfig = async () => {
            try {
                const { data } = await api.get('/api/payment/config');
                setClientId(data.clientId);
            } catch (error) {
                console.error("Failed to load PayPal config", error);
            }
        };
        fetchConfig();
    }, []);

    /*    const getPrice = () => {
            if (billingCycle === 'MONTHLY') return plan.monthlyPrice;
            const total = plan.monthlyPrice * 12;
            const discount = total * (plan.annualDiscountPercent / 100);
            return (total - discount) / 12; // Monthly equivalent
        }; */

    const getBillTotal = () => {
        if (billingCycle === 'MONTHLY') return plan.monthlyPrice;
        const total = plan.monthlyPrice * 12;
        const discount = total * (plan.annualDiscountPercent / 100);
        return (total - discount).toFixed(2);
    };

    // handleApprove removed as CreateSubscription handles the creation
    // and onApprove handles the redirect.
    // If we needed to verify the approval on backend (capture), we would use onApprove.
    // But our current flow seems to rely on the backend creating the subscription and 
    // PayPal handling the rest, then we redirect.
    // Actually, createSubscription calls backend -> returns ID.
    // onApprove calls -> navigate.

    // We kept 'processing' state in case we need it, but currently it is only used in the deleted handleApprove.
    // Let's use it in createSubscription to show feedback if needed, or remove it.
    // For now, I will comment it out to fix lint.
    // const [processing, setProcessing] = useState(false);

    // We need to use the backend to CREATE the subscription ID for the button
    const createSubscription = async (_data: any, _actions: any) => {
        try {
            const res = await api.post('/subscription/subscribe', {
                userId: user?.id,
                tier: plan.tier,
                cycle: billingCycle,
                returnUrl: `${window.location.origin}/subscription/success`,
                cancelUrl: `${window.location.origin}/checkout`
            });

            // The backend returns a HATEOAS link or ID. 
            // If using JS SDK, we need the subscriptionID.
            // Our backend service currently returns the whole response objects with links.
            // Let's assume we can get the ID from it.
            // But wait, the backend currently does 'APPROVAL_PENDING' and returns links for redirection.
            // To use the JS SDK Button component properly, we need the 'id' (subscription_id) returned by PayPal Create Subscription API.

            // Let's modify the backend to return the subscription ID directly or within the object.
            // The PaypalSubscriptionsService returns 'response.data' from axios.post(.../subscriptions).
            // PayPal response contains 'id'.
            return res.data.id;
        } catch (err) {
            console.error(err);
            throw err;
        }
    };

    const onApprove = async (_data: any, _actions: any) => {
        // Successful subscription
        navigate('/subscription/success');
        // If we want to use handleApprove logic we should call it here or replace this
    };

    return (
        <div className="min-h-screen bg-slate-950 text-white flex flex-col lg:flex-row">
            {/* processing && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
                    <div className="text-white">Processando...</div>
                </div>
            ) */}
            {/* Left Side: Payment Form */}
            <div className="w-full lg:w-1/2 p-8 lg:p-16 flex flex-col justify-center border-r border-slate-800">
                <div className="max-w-md mx-auto w-full">
                    <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">
                        Finalize sua Inscrição
                    </h1>
                    <div className="space-y-6">
                        <div className="flex justify-between items-center pb-6 border-b border-slate-700">
                            <div>
                                <h3 className="text-xl font-bold text-white mb-1">{plan.tier} Plan</h3>
                                <p className="text-slate-400 capitalize">{billingCycle.toLowerCase()} Billing</p>
                            </div>
                            <div className="text-right">
                                <p className="text-3xl font-bold text-emerald-400">R$ {getBillTotal()}</p>
                                <p className="text-sm text-slate-500">Total charge</p>
                            </div>
                        </div>

                        <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-700">
                            <h4 className="font-semibold text-white mb-3">O que está incluso:</h4>
                            <ul className="space-y-2">
                                {plan.features?.map((feat: string, i: number) => (
                                    <li key={i} className="flex items-center gap-2 text-sm text-slate-300">
                                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                        {feat}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-emerald-400">
                        <ShieldCheck size={16} />
                        <span>Garantia de 7 dias ou seu dinheiro de volta</span>
                    </div>

                    {/* PayPal Buttons */}
                    <div className="space-y-4">
                        <p className="text-sm text-slate-500 font-medium uppercase tracking-wider mb-2">
                            Método de Pagamento Seguro
                        </p>
                        {clientId ? (
                            <PayPalScriptProvider options={{ clientId: clientId, currency: "BRL" }}>
                                <PayPalButtons
                                    createSubscription={createSubscription}
                                    onApprove={onApprove}
                                    style={{ layout: "vertical", color: 'blue', shape: 'rect', label: 'subscribe' }}
                                />
                            </PayPalScriptProvider>
                        ) : (
                            <div className="animate-pulse bg-slate-800 h-12 rounded-md"></div>
                        )}
                    </div>

                    <div className="mt-8 flex items-center justify-center gap-2 text-xs text-slate-600">
                        <ShieldCheck size={12} />
                        Pagamento processado com segurança via PayPal
                    </div>
                </div>
            </div>

            {/* Right Side: Video */}
            <div className="w-full lg:w-1/2 bg-slate-900 relative flex items-center justify-center p-8">
                <div className="absolute inset-0 bg-gradient-to-br from-indigo-900/20 to-purple-900/20" />

                <div className="relative z-10 w-full max-w-2xl aspect-video rounded-2xl overflow-hidden shadow-2xl border border-slate-700/50 group">
                    <iframe
                        src="https://player.cloudinary.com/embed/?cloud_name=dndlqdylc&public_id=V%C3%ADdeo_de_Trader_e_An%C3%A1lise_Pronto_zct1rm"
                        width="100%"
                        height="100%"
                        style={{ height: '100%', width: '100%', aspectRatio: '640 / 360' }}
                        allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
                        allowFullScreen
                        frameBorder="0"
                        title="Trader Analysis Video"
                    ></iframe>
                </div>

                <div className="absolute bottom-8 left-8 right-8 text-center text-slate-500 text-sm">
                    Aprenda a operar como um profissional com nossa metodologia exclusiva.
                </div>
            </div>
        </div>
    );
};
