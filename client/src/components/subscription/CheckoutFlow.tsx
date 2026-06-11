import { ShieldCheck, CreditCard, Smartphone, Check, Loader2, ChevronRight, Info, CheckCircle2 } from 'lucide-react';
import { CountryPhoneInput } from '../ui/CountryPhoneInput';
import { motion } from 'framer-motion';

// --- Sub-components ---

export const PlanSummary = ({ plan, billingCycle, total }: { plan: any; billingCycle: string; total: number }) => {
    const isYearly = billingCycle === 'YEARLY';
    const subtotal = plan.monthlyPrice * (isYearly ? 12 : 1);
    const discount = isYearly ? subtotal * (plan.annualDiscountPercent / 100) : 0;

    return (
        <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="space-y-6"
        >
            <div className="flex flex-col pb-6 border-b border-slate-800/80">
                <span className="text-indigo-400 text-xs font-bold uppercase tracking-wider mb-1 block">Plano Selecionado</span>
                <div className="flex justify-between items-baseline">
                    <h3 className="text-3xl font-black text-white tracking-tight">{plan.tier}</h3>
                    <div className="text-right">
                        <span className="text-[10px] text-slate-500 uppercase tracking-widest block font-bold">Cobrança {isYearly ? 'Anual' : 'Mensal'}</span>
                    </div>
                </div>
            </div>

            {/* Price Breakdown */}
            <div className="space-y-3 py-2 text-sm">
                <div className="flex justify-between text-slate-400">
                    <span>Preço Base</span>
                    <span className="font-mono text-slate-300">MT {subtotal.toFixed(2)}</span>
                </div>
                {isYearly && (
                    <div className="flex justify-between text-emerald-400 font-semibold bg-emerald-500/5 p-2.5 rounded-xl border border-emerald-500/10">
                        <span>Desconto Anual (-{plan.annualDiscountPercent}%)</span>
                        <span className="font-mono">- MT {discount.toFixed(2)}</span>
                    </div>
                )}
                <div className="flex justify-between items-baseline pt-3 border-t border-slate-800/50 text-white">
                    <span className="font-bold">Total a Pagar</span>
                    <div className="text-right">
                        <span className="text-2xl font-black font-mono text-white">MT {total.toFixed(2)}</span>
                        <span className="text-[10px] text-slate-500 block uppercase tracking-tighter mt-0.5">IVA Incluso</span>
                    </div>
                </div>
            </div>

            <div className="bg-slate-900/40 border border-slate-800/60 rounded-3xl p-6 backdrop-blur-md">
                <h4 className="text-xs font-black text-white/90 uppercase tracking-wider mb-4 flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
                    Benefícios Inclusos
                </h4>
                <ul className="space-y-3">
                    {plan.features?.map((feat: string, i: number) => (
                        <motion.li 
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: i * 0.05 }}
                            key={i} 
                            className="flex items-start gap-3 text-sm text-slate-300"
                        >
                            <Check size={16} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                            <span>{feat}</span>
                        </motion.li>
                    ))}
                </ul>
            </div>
            
            <div className="flex items-center gap-3 p-4 bg-indigo-500/5 border border-indigo-500/10 rounded-2xl text-xs text-indigo-300/80">
                <ShieldCheck size={18} className="flex-shrink-0 text-indigo-400" />
                <p>Sua transação é protegida por criptografia de ponta a ponta via Debito.co.mz</p>
            </div>
        </motion.div>
    );
};

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
}) => {
    // Detect currency based on label
    const isZar = label.toLowerCase().includes('payfast');

    return (
        <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onClick}
            className={`relative group p-4 rounded-2xl border transition-all duration-300 flex flex-col items-center justify-center gap-2.5 overflow-hidden ${
                active 
                ? 'border-indigo-500 bg-indigo-500/5 shadow-[0_0_20px_rgba(99,102,241,0.05)] text-white' 
                : 'border-slate-800 bg-slate-900/20 text-slate-400 hover:border-slate-700 hover:bg-slate-900/40 hover:text-white'
            }`}
        >
            <div className={`w-11 h-11 flex items-center justify-center rounded-xl transition-all duration-300 ${
                active ? 'bg-indigo-600 text-white shadow-lg' : 'bg-slate-900/80 border border-slate-800 text-slate-400'
            }`}>
                {img ? <img src={img} alt={label} className="w-full h-full object-cover rounded-xl" /> : <Icon size={22} />}
            </div>
            
            <div className="text-center">
                <span className={`text-[10px] font-black uppercase tracking-widest block ${active ? 'text-indigo-400' : 'text-slate-500'}`}>
                    {label}
                </span>
                <span className="text-[8px] font-bold text-slate-500 px-1.5 py-0.5 bg-slate-950 border border-slate-800 rounded mt-1 inline-block">
                    {isZar ? 'ZAR' : 'MZN'}
                </span>
            </div>

            {active && (
                <div className="absolute top-2 right-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                </div>
            )}
        </motion.button>
    );
};

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
        <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6 pt-4"
        >
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Número de Telefone</label>
                    <span className="text-[9px] text-slate-600 font-bold uppercase">Moçambique</span>
                </div>
                
                <div className={`group flex items-center bg-slate-950 border rounded-2xl overflow-hidden transition-all duration-300 focus-within:ring-4 focus-within:ring-indigo-500/10 ${
                    isInvalid ? 'border-rose-500/50' : 'border-slate-800 focus-within:border-indigo-500/70'
                }`}>
                    <div className="px-5 py-3.5 bg-slate-900 border-r border-slate-800 text-slate-500 font-bold text-sm select-none">
                        +258
                    </div>
                    <input
                        type="tel"
                        value={phoneNumber}
                        onChange={e => setPhoneNumber(e.target.value.replace(/\D/g, ''))}
                        placeholder={method === 'mpesa' ? '84 / 85' : '86 / 87'}
                        className="flex-1 bg-transparent px-5 py-3.5 text-white text-lg font-bold outline-none placeholder:text-slate-800"
                        maxLength={9}
                        disabled={processing}
                    />
                </div>
                
                {isInvalid && (
                    <p className="text-xs text-rose-400 flex items-center gap-1.5 px-1">
                        <Info size={14} />
                        Número {method.toUpperCase()} inválido. Use prefixos corretos.
                    </p>
                )}
            </div>

            <div className="flex items-center gap-3 p-1">
                <button 
                    onClick={() => setSavePreference(!savePreference)}
                    className="flex items-center gap-2 group cursor-pointer"
                    disabled={processing}
                >
                    <div className={`w-4.5 h-4.5 rounded-md border flex items-center justify-center transition-all ${
                        savePreference ? 'bg-indigo-600 border-indigo-600' : 'border-slate-800 bg-slate-950 group-hover:border-slate-700'
                    }`}>
                        {savePreference && <Check size={10} className="text-white" />}
                    </div>
                    <span className="text-xs text-slate-400 font-medium">Salvar número para renovações futuras</span>
                </button>
            </div>

            <motion.button
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                onClick={onSubmit}
                disabled={processing || phoneNumber.length !== 9 || isInvalid}
                className="group relative w-full h-14 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest transition-all duration-300 hover:bg-indigo-500 disabled:opacity-50 disabled:hover:bg-indigo-600 shadow-lg shadow-indigo-600/10 overflow-hidden"
            >
                <span className="relative z-10 flex items-center justify-center gap-2">
                    {processing ? (
                        <>
                            <Loader2 className="animate-spin" size={16} />
                            <span>Processando</span>
                        </>
                    ) : (
                        <>
                            <span>Enviar Pedido de Pagamento</span>
                            <ChevronRight size={16} />
                        </>
                    )}
                </span>
            </motion.button>
        </motion.div>
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
    <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-6 pt-4"
    >
        <div className="p-6 bg-slate-900/20 border border-slate-800/80 rounded-2xl">
            <p className="text-sm text-slate-400 mb-6 leading-relaxed">
                {method === 'payfast' ? (
                    <>Você será redirecionado para o ambiente de checkout seguro do <span className="text-white font-bold">PayFast</span> para efetuar o pagamento em <span className="text-indigo-400 font-bold">ZAR</span>.</>
                ) : (
                    <>Você será redirecionado para a página segura de pagamento da <span className="text-white font-bold">Debito.co.mz</span> para concluir sua compra usando <span className="text-indigo-400 font-bold">Visa ou Mastercard</span>.</>
                )}
            </p>
            
            <CountryPhoneInput 
                onChange={onPhoneChange} 
                placeholder="Contato telefónico de referência"
            />
            
            <div className="mt-5 flex items-center gap-4 py-3 opacity-40 border-t border-slate-800/60">
                {method === 'payfast' ? (
                    <span className="text-[9px] uppercase font-bold tracking-widest text-slate-500">Gateway PayFast Autenticado</span>
                ) : (
                    <>
                        <img src="https://paymentsindustryintelligence.com/wp-content/uploads/2021/11/visa-mastercard-logos.jpg" alt="Visa/MC" className="h-5 rounded-sm" />
                        <span className="text-[9px] uppercase font-bold tracking-widest text-slate-500">Gateway de Cartão Seguro</span>
                    </>
                )}
            </div>
        </div>

        <motion.button
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            onClick={onSubmit}
            disabled={processing}
            className="group relative w-full h-14 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest transition-all duration-300 hover:bg-indigo-500 disabled:opacity-50"
        >
            <span className="relative z-10 flex items-center justify-center gap-2">
                {processing ? <Loader2 className="animate-spin" size={16} /> : <CreditCard size={16} />}
                {processing ? 'Redirecionando...' : method === 'payfast' ? 'Prosseguir para o PayFast' : 'Pagar com Cartão'}
            </span>
        </motion.button>
    </motion.div>
);

export const PollingOverlay = ({ method, total }: { method: string; total: number }) => {
    // We simulate step-by-step connection states for the interactive terminal:
    return (
        <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mt-6 animate-in zoom-in-95 duration-500"
        >
            <div className="relative group p-8 bg-slate-900/30 rounded-[32px] border border-slate-800/80 flex flex-col items-center overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 via-cyan-500 to-indigo-500 animate-pulse" />
                
                <div className="relative mb-6">
                    <div className="w-16 h-16 bg-indigo-500/10 rounded-2xl flex items-center justify-center text-indigo-400 shadow-xl">
                        <Smartphone size={32} className="animate-bounce" />
                    </div>
                </div>

                <div className="w-full text-center space-y-6">
                    <div>
                        <h3 className="text-xl font-black text-white mb-2 leading-none uppercase tracking-tight">Pedido Enviado</h3>
                        <p className="text-slate-400 text-xs max-w-[280px] leading-relaxed mx-auto">
                            Lançamos um pedido de pagamento de <span className="text-white font-bold">MT {total.toFixed(2)}</span> para o seu celular via <span className="capitalize text-indigo-400 font-bold">{method}</span>.
                        </p>
                    </div>

                    {/* Step-by-step Interactive Billing Terminal */}
                    <div className="bg-slate-950/80 border border-slate-900 rounded-2xl p-4 text-left space-y-4 max-w-xs mx-auto">
                        <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block border-b border-slate-900 pb-2">Status do Terminal</span>
                        
                        <div className="space-y-3 text-xs">
                            <div className="flex items-center justify-between text-emerald-400">
                                <span className="font-medium">1. Inicializando Conexão</span>
                                <CheckCircle2 size={14} className="flex-shrink-0" />
                            </div>
                            <div className="flex items-center justify-between text-emerald-400">
                                <span className="font-medium">2. Criando Transação</span>
                                <CheckCircle2 size={14} className="flex-shrink-0" />
                            </div>
                            <div className="flex items-center justify-between text-indigo-400 font-semibold">
                                <span className="font-medium">3. Aguardando PIN no celular</span>
                                <Loader2 size={14} className="animate-spin flex-shrink-0" />
                            </div>
                        </div>
                    </div>

                    <div className="text-[10px] text-slate-500 leading-normal max-w-xs mx-auto">
                        Insira o seu PIN de segurança no celular para confirmar. Iremos ativar o seu plano assim que a transação for aprovada.
                    </div>
                </div>
            </div>
        </motion.div>
    );
};
