import { ShieldCheck, CreditCard, Smartphone, Check, Loader2, ChevronRight, Info } from 'lucide-react';
import { CountryPhoneInput } from '../ui/CountryPhoneInput';

// --- Sub-components ---

export const PlanSummary = ({ plan, billingCycle, total }: { plan: any; billingCycle: string; total: number }) => (
    <div className="space-y-6">
        <div className="flex justify-between items-end pb-6 border-b border-white/10">
            <div>
                <span className="text-indigo-400 text-xs font-bold uppercase tracking-wider mb-1 block">Plano Selecionado</span>
                <h3 className="text-2xl font-bold text-white">{plan.tier}</h3>
                <p className="text-slate-400 text-sm capitalize">{billingCycle.toLowerCase()} Billing</p>
            </div>
            <div className="text-right">
                <p className="text-3xl font-black text-white">MT {total}</p>
                <span className="text-[10px] text-slate-500 uppercase tracking-tighter">IVA Incluso</span>
            </div>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-sm">
            <h4 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                Benefícios Inclusos
            </h4>
            <ul className="space-y-3">
                {plan.features?.map((feat: string, i: number) => (
                    <li key={i} className="flex items-start gap-3 text-sm text-slate-300">
                        <Check size={16} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                        <span>{feat}</span>
                    </li>
                ))}
            </ul>
        </div>
        
        <div className="flex items-center gap-3 p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl text-xs text-indigo-300">
            <ShieldCheck size={18} className="flex-shrink-0" />
            <p>Sua transação é protegida por criptografia de ponta a ponta via Debito.co.mz</p>
        </div>
    </div>
);

export const PaymentMethodBadge = ({ 
    label, 
    icon: Icon, 
    img, 
    active, 
    onClick 
}: { 
    id: string; 
    label: string; 
    icon?: any; 
    img?: string; 
    active: boolean; 
    onClick: () => void 
}) => (
    <button
        onClick={onClick}
        className={`relative group p-4 rounded-2xl border-2 transition-all duration-300 flex flex-col items-center justify-center gap-3 overflow-hidden ${
            active 
            ? 'border-indigo-500 bg-indigo-500/10 shadow-[0_0_20px_rgba(99,102,241,0.2)]' 
            : 'border-white/5 bg-white/5 hover:border-white/20 hover:bg-white/10'
        }`}
    >
        <div className={`w-12 h-12 flex items-center justify-center rounded-xl transition-all duration-300 ${
            active ? 'bg-indigo-500 text-white shadow-lg' : 'bg-white/5 text-slate-400'
        }`}>
            {img ? <img src={img} alt={label} className="w-full h-full object-cover rounded-xl" /> : <Icon size={24} />}
        </div>
        <span className={`text-[11px] font-black uppercase tracking-widest ${active ? 'text-indigo-400' : 'text-slate-500'}`}>
            {label}
        </span>
        {active && (
            <div className="absolute top-2 right-2">
                <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
            </div>
        )}
    </button>
);

export const MobileMoneyForm = ({ 
    method, 
    phoneNumber, 
    setPhoneNumber, 
    onSubmit, 
    processing,
    savePreference,
    setSavePreference 
}: { 
    method: 'mpesa' | 'emola'; 
    phoneNumber: string; 
    setPhoneNumber: (v: string) => void;
    onSubmit: () => void;
    processing: boolean;
    savePreference: boolean;
    setSavePreference: (v: boolean) => void;
}) => {
    const isInvalid = phoneNumber.length === 9 && (
        (method === 'mpesa' && !['84', '85'].includes(phoneNumber.substring(0, 2))) ||
        (method === 'emola' && !['86', '87'].includes(phoneNumber.substring(0, 2)))
    );

    return (
        <div className="space-y-6 pt-6 animate-in fade-in slide-in-from-top-4 duration-500">
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <label className="text-xs font-black text-slate-500 uppercase tracking-widest">Número de Telefone</label>
                    <span className="text-[10px] text-slate-600 font-medium">Somente Moçambique</span>
                </div>
                
                <div className={`group flex items-center bg-white/5 border-2 rounded-2xl overflow-hidden transition-all duration-300 focus-within:ring-4 focus-within:ring-indigo-500/20 ${
                    isInvalid ? 'border-rose-500/50' : 'border-white/5 focus-within:border-indigo-500'
                }`}>
                    <div className="px-5 py-4 bg-white/5 text-slate-400 border-r border-white/5 font-bold text-sm">
                        +258
                    </div>
                    <input
                        type="tel"
                        value={phoneNumber}
                        onChange={e => setPhoneNumber(e.target.value.replace(/\D/g, ''))}
                        placeholder={method === 'mpesa' ? '84 / 85' : '86 / 87'}
                        className="flex-1 bg-transparent px-5 py-4 text-white text-lg font-bold outline-none placeholder:text-slate-700"
                        maxLength={9}
                    />
                </div>
                
                {isInvalid && (
                    <p className="text-xs text-rose-400 flex items-center gap-1.5 px-1 animate-in shake-x">
                        <Info size={14} />
                        Número {method.toUpperCase()} inválido. Use prefixos corretos.
                    </p>
                )}
            </div>

            <div className="flex items-center gap-3 p-1">
                <button 
                    onClick={() => setSavePreference(!savePreference)}
                    className="flex items-center gap-2 group cursor-pointer"
                >
                    <div className={`w-5 h-5 rounded-lg border-2 flex items-center justify-center transition-all ${
                        savePreference ? 'bg-indigo-500 border-indigo-500' : 'border-white/10 bg-white/5 group-hover:border-white/20'
                    }`}>
                        {savePreference && <Check size={12} className="text-white" />}
                    </div>
                    <span className="text-xs text-slate-400 font-medium">Guardar para renovações futuras</span>
                </button>
            </div>

            <button
                onClick={onSubmit}
                disabled={processing || phoneNumber.length !== 9 || isInvalid}
                className="group relative w-full h-16 bg-white text-slate-950 rounded-2xl font-black text-sm uppercase tracking-widest transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:scale-100 shadow-[0_10px_30px_rgba(255,255,255,0.1)] overflow-hidden"
            >
                <div className="absolute inset-0 bg-gradient-to-r from-indigo-500 to-cyan-500 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <span className="relative z-10 group-hover:text-white transition-colors duration-300">
                    {processing ? (
                        <div className="flex items-center justify-center gap-2">
                            <Loader2 className="animate-spin" size={20} />
                            <span>Processando</span>
                        </div>
                    ) : (
                        <div className="flex items-center justify-center gap-2">
                            <span>Finalizar Agora</span>
                            <ChevronRight size={18} />
                        </div>
                    )}
                </span>
            </button>
        </div>
    );
};

export const CardPaymentView = ({ 
    onSubmit, 
    processing, 
    onPhoneChange, 
    method = 'card' 
}: { 
    onSubmit: () => void; 
    processing: boolean; 
    onPhoneChange: (v: string) => void; 
    method?: 'card' | 'payfast';
}) => (
    <div className="space-y-6 pt-6 animate-in fade-in slide-in-from-top-4 duration-500">
        <div className="p-6 bg-white/5 border border-white/10 rounded-2xl">
            <p className="text-sm text-slate-400 mb-6 leading-relaxed">
                {method === 'payfast' ? (
                    <>Você será redirecionado para o ambiente seguro do <span className="text-white font-bold">PayFast</span> para concluir seu pagamento em ZAR (África do Sul).</>
                ) : (
                    <>Você será redirecionado para o ambiente seguro do <span className="text-white font-bold">Debito.co.mz</span> para concluir seu pagamento via <span className="text-white font-bold">Visa ou Mastercard</span>.</>
                )}
            </p>
            
            <CountryPhoneInput 
                onChange={onPhoneChange} 
                placeholder="Introduza um contacto de referência"
            />
            
            <div className="mt-4 flex items-center gap-4 py-3 opacity-50 border-t border-white/5">
                {method === 'payfast' ? (
                    <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400">PayFast Gateway</span>
                ) : (
                    <>
                        <img src="https://paymentsindustryintelligence.com/wp-content/uploads/2021/11/visa-mastercard-logos.jpg" alt="Visa/MC" className="h-6 rounded" />
                        <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400">Secure Gateway</span>
                    </>
                )}
            </div>
        </div>

        <button
            onClick={onSubmit}
            disabled={processing}
            className="group relative w-full h-16 bg-indigo-600 text-white rounded-2xl font-black text-sm uppercase tracking-widest transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:scale-100 shadow-[0_10px_30px_rgba(99,102,241,0.2)]"
        >
            <div className="absolute inset-0 bg-gradient-to-r from-indigo-500 to-indigo-700 rounded-2xl" />
            <span className="relative z-10 flex items-center justify-center gap-2">
                {processing ? <Loader2 className="animate-spin" size={20} /> : <CreditCard size={20} />}
                {processing ? 'Redirecionando...' : method === 'payfast' ? 'Pagar com PayFast' : 'Pagar com Cartão'}
            </span>
        </button>
    </div>
);

export const PollingOverlay = ({ total }: { method: string; total: number }) => (
    <div className="mt-8 pt-8 border-t border-white/5 animate-in zoom-in-95 duration-700">
        <div className="relative group p-10 bg-indigo-500/5 rounded-[32px] border border-indigo-500/20 flex flex-col items-center text-center overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-indigo-500/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-1000" />
            
            <div className="relative mb-6">
                <div className="w-20 h-20 bg-indigo-500/20 rounded-3xl flex items-center justify-center text-indigo-400 rotate-12 group-hover:rotate-0 transition-transform duration-500 shadow-2xl">
                    <Smartphone size={40} />
                </div>
                <div className="absolute -bottom-2 -right-2 w-10 h-10 bg-emerald-500 rounded-2xl border-4 border-slate-950 flex items-center justify-center shadow-lg">
                    <Loader2 className="animate-spin text-white" size={20} />
                </div>
            </div>

            <div className="relative">
                <h3 className="text-2xl font-black text-white mb-2 leading-none uppercase tracking-tighter">Pedido Enviado!</h3>
                <p className="text-slate-400 text-sm max-w-[280px] leading-relaxed mx-auto">
                    Verifique seu telemóvel agora e introduza seu <span className="text-indigo-400 font-black">PIN</span> para autorizar o pagamento de <span className="text-white font-black whitespace-nowrap">MT {total}</span>.
                </p>
                <div className="mt-8 flex items-center gap-2 px-4 py-2 bg-white/5 rounded-full border border-white/5">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-[10px] font-black uppercase text-slate-500 tracking-[0.2em] ml-1">Polling Active</span>
                </div>
            </div>
        </div>
    </div>
);
