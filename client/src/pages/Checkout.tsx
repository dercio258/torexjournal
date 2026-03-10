import { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate, Navigate } from 'react-router-dom';
import { ShieldCheck, CreditCard, Globe, ChevronDown, Search, Loader2 } from 'lucide-react';
import api from '../api';
import { useAuth } from '../context/AuthContext';

interface Country {
    name: { common: string };
    idd: { root: string; suffixes: string[] };
    flags: { svg: string; png: string; alt: string };
    cca2: string;
}

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

    // Get Plan from router state
    const { plan, billingCycle, pricingConfig: initialPricingConfig } = location.state || {};
    const [pricingConfig, setPricingConfig] = useState(initialPricingConfig);
    const [paymentMethod, setPaymentMethod] = useState<'mpesa' | 'emola' | 'card'>('mpesa');
    const [phoneNumber, setPhoneNumber] = useState('');
    const [savePreference, setSavePreference] = useState(false);
    const [processing, setProcessing] = useState(false);
    const [showPinPrompt, setShowPinPrompt] = useState(false);

    // Country selection for international cards
    const [countries, setCountries] = useState<Country[]>([]);
    const [selectedCountry, setSelectedCountry] = useState<Country | null>(null);
    const [showCountryDropdown, setShowCountryDropdown] = useState(false);
    const [countrySearch, setCountrySearch] = useState('');
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const fetchCountries = async () => {
            try {
                const res = await fetch('https://restcountries.com/v3.1/all?fields=name,idd,flags,cca2');
                const data = await res.json();
                const sorted = data.sort((a: Country, b: Country) => a.name.common.localeCompare(b.name.common));
                setCountries(sorted);
                const mz = sorted.find((c: Country) => c.cca2 === 'MZ');
                if (mz) setSelectedCountry(mz);
            } catch (err) {
                console.error("Failed to fetch countries", err);
            }
        };
        fetchCountries();
    }, []);

    useEffect(() => {
        if (user) {
            if (paymentMethod === 'mpesa' && user.preferredMpesa) setPhoneNumber(user.preferredMpesa);
            if (paymentMethod === 'emola' && user.preferredEmola) setPhoneNumber(user.preferredEmola);
        }
    }, [user, paymentMethod]);

    // Redirect if no plan selected
    if (!plan || !billingCycle) {
        return <Navigate to="/pricing" replace />;
    }

    useEffect(() => {
        const fetchData = async () => {
            try {
                if (!pricingConfig) {
                    const pricingRes = await api.get('/api/payment/pricing-config');
                    setPricingConfig(pricingRes.data);
                }
            } catch (error) {
                console.error("Failed to load configs", error);
            }
        };
        fetchData();
    }, [pricingConfig]);

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
                paymentMethod: paymentMethod, // 'mpesa' | 'emola'
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

    const getDialCode = (c: Country) => c.idd.root + (c.idd.suffixes?.length === 1 ? c.idd.suffixes[0] : '');

    const handleCardSubmit = async () => {
        setProcessing(true);
        try {
            const res = await api.post('/subscription/subscribe/card', {
                tier: plan.tier,
                cycle: billingCycle,
                returnUrl: `${window.location.origin}/subscription/success`,
                cancelUrl: `${window.location.origin}/checkout`,
                phoneNumber: selectedCountry ? `${getDialCode(selectedCountry)}${phoneNumber}` : phoneNumber
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

    return (
        <div className="min-h-screen bg-slate-950 text-white flex flex-col lg:flex-row">
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
                                <p className="text-3xl font-bold text-emerald-400">MT {getBillTotalMT()}</p>
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
                    <div className="flex items-center gap-2 text-sm text-emerald-400 mb-6">
                        <ShieldCheck size={16} />
                        <span>Garantia de 7 dias ou seu dinheiro de volta</span>
                    </div>

                    {/* Payment Options Selection */}
                    <div className="grid grid-cols-3 gap-3 mb-4">
                        {[
                            { id: 'mpesa', label: 'M-Pesa', img: 'https://res.cloudinary.com/dndlqdylc/image/upload/v1771597297/mpesaIcon_rht9mz.jpg' },
                            { id: 'emola', label: 'e-Mola', img: 'https://res.cloudinary.com/dndlqdylc/image/upload/v1771597297/emola_ykhnhj.png' },
                            { id: 'card', label: 'Cartão', img: 'https://paymentsindustryintelligence.com/wp-content/uploads/2021/11/visa-mastercard-logos.jpg' }
                        ].map(method => (
                            <button
                                key={method.id}
                                onClick={() => setPaymentMethod(method.id as 'mpesa' | 'emola' | 'card')}
                                className={`p-2 border rounded-xl flex flex-col items-center justify-center gap-2 transition-all h-24 overflow-hidden ${paymentMethod === method.id
                                    ? 'border-indigo-500 bg-indigo-500/10'
                                    : 'border-slate-700 bg-slate-800/50 hover:bg-slate-750'
                                    }`}
                            >
                                <div className="w-full h-12 flex items-center justify-center overflow-hidden rounded-lg">
                                    <img src={method.img} alt={method.label} className="w-full h-full object-cover" />
                                </div>
                                <span className={`text-[10px] font-bold uppercase ${paymentMethod === method.id ? 'text-indigo-400' : 'text-slate-400'}`}>
                                    {method.label}
                                </span>
                            </button>
                        ))}
                    </div>

                    {(paymentMethod === 'mpesa' || paymentMethod === 'emola') && !showPinPrompt && (
                        <div className="space-y-4 pt-4 border-t border-slate-800">
                            <div>
                                <label className="block text-xs font-bold text-slate-400 mb-2">Número de Telefone</label>
                                <div className={`flex bg-slate-900 border ${phoneNumber.length === 9 && (
                                    (paymentMethod === 'mpesa' && !['84', '85'].includes(phoneNumber.substring(0, 2))) ||
                                    (paymentMethod === 'emola' && !['86', '87'].includes(phoneNumber.substring(0, 2)))
                                ) ? 'border-red-500' : 'border-slate-700'} rounded-xl overflow-hidden focus-within:border-indigo-500 transition-colors`}>
                                    <div className="px-4 py-3 bg-slate-800 text-slate-400 border-r border-slate-700 font-medium">
                                        +258
                                    </div>
                                    <input
                                        type="tel"
                                        value={phoneNumber}
                                        onChange={e => setPhoneNumber(e.target.value.replace(/\D/g, ''))}
                                        placeholder={paymentMethod === 'mpesa' ? '84/85XXXXXXX' : '86/87XXXXXXX'}
                                        className="w-full bg-transparent px-4 py-3 text-white outline-none"
                                        maxLength={9}
                                    />
                                </div>
                                {phoneNumber.length > 0 && phoneNumber.length < 9 && (
                                    <p className="text-[10px] text-slate-500 mt-1">O número deve ter 9 dígitos.</p>
                                )}
                                {phoneNumber.length === 9 && paymentMethod === 'mpesa' && !['84', '85'].includes(phoneNumber.substring(0, 2)) && (
                                    <p className="text-[10px] text-red-400 mt-1">Número M-Pesa deve iniciar com 84 ou 85.</p>
                                )}
                                {phoneNumber.length === 9 && paymentMethod === 'emola' && !['86', '87'].includes(phoneNumber.substring(0, 2)) && (
                                    <p className="text-[10px] text-red-400 mt-1">Número e-Mola deve iniciar com 86 ou 87.</p>
                                )}
                            </div>

                            <div className="flex items-center gap-2 mb-2">
                                <input
                                    type="checkbox"
                                    id="savePref"
                                    checked={savePreference}
                                    onChange={(e) => setSavePreference(e.target.checked)}
                                    className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-indigo-500"
                                />
                                <label htmlFor="savePref" className="text-sm text-slate-400 cursor-pointer select-none">
                                    Guardar este contacto para renovações rápidas
                                </label>
                            </div>
                            <button
                                onClick={handleMobileMoneySubmit}
                                disabled={processing || phoneNumber.length !== 9 || (paymentMethod === 'mpesa' && !['84', '85'].includes(phoneNumber.substring(0, 2))) || (paymentMethod === 'emola' && !['86', '87'].includes(phoneNumber.substring(0, 2)))}
                                className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-bold transition-all shadow-lg shadow-indigo-900/20"
                            >
                                {processing ? 'Processando...' : `Confirmar Pagamento (${getBillTotalMT()} MT)`}
                            </button>
                        </div>
                    )}

                    {/* PIN Prompt */}
                    {showPinPrompt && (
                        <div className="space-y-6 pt-6 border-t border-slate-700 animate-in fade-in slide-in-from-bottom-4">
                            <div className="bg-emerald-500/10 border border-emerald-500/20 p-6 rounded-2xl flex flex-col items-center text-center gap-4">
                                <div className="w-12 h-12 bg-emerald-500/20 rounded-full flex items-center justify-center text-emerald-400">
                                    <Loader2 className="animate-spin" size={24} />
                                </div>
                                <div>
                                    <h3 className="text-white font-bold text-lg mb-1">Pedido Enviado!</h3>
                                    <p className="text-slate-400 text-sm">
                                        Verifique o seu telemóvel agora. Introduza o <span className="text-emerald-400 font-bold">PIN</span> para confirmar o pagamento de <span className="text-white font-bold">MT {getBillTotalMT()}</span>.
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => navigate('/subscription/success', { state: { method: paymentMethod } })}
                                className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold transition-all shadow-lg"
                            >
                                Já confirmei no telemóvel
                            </button>
                        </div>
                    )}

                    {/* Card Payment */}
                    {paymentMethod === 'card' && (
                        <div className="space-y-4 pt-4 border-t border-slate-800">
                            <div>
                                <label className="block text-xs font-bold text-slate-400 mb-2">Contacto de Referência</label>
                                <div className="relative" ref={dropdownRef}>
                                    <div className={`flex bg-slate-900 border border-slate-700 rounded-xl overflow-hidden focus-within:border-indigo-500 transition-colors`}>
                                        <button
                                            type="button"
                                            onClick={() => setShowCountryDropdown(!showCountryDropdown)}
                                            className="flex items-center gap-2 pl-4 pr-3 bg-slate-800 border-r border-slate-700 text-slate-300 hover:text-white transition-colors h-full py-3.5 min-w-[100px]"
                                        >
                                            {selectedCountry ? (
                                                <>
                                                    <img src={selectedCountry.flags.svg} alt={selectedCountry.name.common} className="w-5 h-3.5 object-cover rounded-sm" />
                                                    <span className="text-sm font-medium">{getDialCode(selectedCountry)}</span>
                                                </>
                                            ) : (
                                                <Globe size={18} className="text-indigo-500" />
                                            )}
                                            <ChevronDown size={14} className={`text-slate-500 transition-transform ${showCountryDropdown ? 'rotate-180' : ''}`} />
                                        </button>
                                        <input
                                            type="tel"
                                            value={phoneNumber}
                                            onChange={e => setPhoneNumber(e.target.value.replace(/\D/g, ''))}
                                            placeholder="Contacto nacional ou estrangeiro"
                                            className="w-full bg-transparent px-4 py-3 text-white outline-none"
                                            maxLength={15}
                                        />
                                    </div>

                                    {showCountryDropdown && (
                                        <div className="absolute bottom-full left-0 mb-2 w-full max-h-64 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden z-50 flex flex-col animate-in fade-in zoom-in-95 duration-200">
                                            <div className="p-2 border-b border-slate-800 sticky top-0 bg-slate-900 z-10">
                                                <div className="relative">
                                                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                                                    <input
                                                        type="text"
                                                        placeholder="Buscar país..."
                                                        className="w-full bg-slate-950 border border-slate-800 rounded-lg py-1.5 pl-9 pr-3 text-xs text-slate-200 focus:outline-none focus:border-indigo-500/50"
                                                        value={countrySearch}
                                                        onChange={e => setCountrySearch(e.target.value)}
                                                        autoFocus
                                                    />
                                                </div>
                                            </div>
                                            <div className="overflow-y-auto flex-1 p-1">
                                                {countries.filter(c => c.name.common.toLowerCase().includes(countrySearch.toLowerCase()) || getDialCode(c).includes(countrySearch)).map((country, idx) => (
                                                    <button
                                                        key={country.cca2 + idx}
                                                        onClick={() => {
                                                            setSelectedCountry(country);
                                                            setShowCountryDropdown(false);
                                                        }}
                                                        className="w-full flex items-center gap-3 p-2 hover:bg-slate-800 rounded-lg transition-colors text-left"
                                                    >
                                                        <img src={country.flags.svg} alt={country.name.common} className="w-6 h-4 object-cover rounded-sm" />
                                                        <span className="text-xs font-medium text-slate-200 flex-1 truncate">{country.name.common}</span>
                                                        <span className="text-xs text-slate-500 font-mono">{getDialCode(country)}</span>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                                <p className="text-[10px] text-slate-500 mt-1">Necessário para identificação. Suporta números internacionais.</p>
                            </div>
                            <button
                                onClick={handleCardSubmit}
                                disabled={processing}
                                className="w-full py-4 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white rounded-xl font-bold transition-all flex items-center justify-center gap-2"
                            >
                                <CreditCard size={18} />
                                {processing ? 'Processando...' : `Pagar com Cartão (${getBillTotalMT()} MT)`}
                            </button>
                            <p className="text-xs text-center text-slate-500">Gateway seguro Mastercard/Visa via Debito.co.mz</p>
                        </div>
                    )}

                    <div className="mt-8 flex items-center justify-center gap-2 text-xs text-slate-600">
                        <ShieldCheck size={12} />
                        Pagamentos processados de forma segura via Debito.co.mz
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
