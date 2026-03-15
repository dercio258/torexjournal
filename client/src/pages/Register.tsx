
import React, { useState, useEffect, useRef } from 'react';
import {
    Mail,
    Lock,
    Check,
    ArrowRight,
    TrendingUp,
    AlertCircle,
    Loader2,
    User,
    Globe,
    Eye,
    EyeOff,
    ChevronDown,
    Search,
    Github
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api';

// --- Type Definitions ---
interface Country {
    name: { common: string };
    idd: { root: string; suffixes: string[] };
    flags: { svg: string; png: string; alt: string };
    cca2: string;
}

// Simple SVG Component for Google
const GoogleIcon = ({ className }: { className?: string }) => (
    <svg className={`w-4 h-4 ${className}`} viewBox="0 0 24 24" fill="currentColor">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
);

// --- Components de UI Reutilizáveis (In-file) ---

const Input = ({ label, icon, type = "text", error, ...props }: any) => {
    const [isFocused, setIsFocused] = useState(false);
    const [showPassword, setShowPassword] = useState(false);

    const inputType = type === 'password' ? (showPassword ? 'text' : 'password') : type;

    return (
        <div className="space-y-1.5 group">
            <label className={`text-sm font-medium transition-colors ${isFocused ? 'text-emerald-400' : 'text-slate-400'}`}>
                {label}
            </label>
            <div className={`relative flex items-center bg-slate-900/50 border rounded-xl transition-all duration-300 ${error
                ? 'border-red-500/50 shadow-[0_0_0_1px_rgba(239,68,68,0.2)]'
                : isFocused
                    ? 'border-emerald-500/50 shadow-[0_0_0_1px_rgba(16,185,129,0.2)]'
                    : 'border-slate-800 hover:border-slate-700'
                }`}>
                <div className={`pl-4 pr-3 ${isFocused ? 'text-emerald-400' : 'text-slate-500'}`}>
                    {icon}
                </div>
                <input
                    type={inputType}
                    className="w-full bg-transparent border-none text-slate-100 placeholder:text-slate-600 focus:ring-0 py-3.5 pl-0 pr-4 text-sm font-medium outline-none"
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                    {...props}
                />
                {type === 'password' && (
                    <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-4 text-slate-500 hover:text-slate-300 transition-colors"
                    >
                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                )}
            </div>
            {error && (
                <div className="flex items-center gap-1.5 text-red-400 text-xs animate-in slide-in-from-left-1">
                    <AlertCircle size={12} />
                    <span>{error}</span>
                </div>
            )}
        </div>
    );
};

const PhoneInput = ({ label, value, onChange, error, onCountryChange }: any) => {
    const [isFocused, setIsFocused] = useState(false);
    const [showDropdown, setShowDropdown] = useState(false);
    const [countries, setCountries] = useState<Country[]>([]);
    const [selectedCountry, setSelectedCountry] = useState<Country | null>(null);
    const [search, setSearch] = useState('');
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const fetchCountries = async () => {
            try {
                const res = await fetch('https://restcountries.com/v3.1/all?fields=name,idd,flags,cca2');
                const data = await res.json();
                const sorted = data.sort((a: Country, b: Country) => a.name.common.localeCompare(b.name.common));
                setCountries(sorted);

                // Default to Brazil if found, else first one
                const br = sorted.find((c: Country) => c.cca2 === 'BR');
                if (br) {
                    setSelectedCountry(br);
                    if (onCountryChange) onCountryChange(br.idd.root + (br.idd.suffixes?.[0] || ''));
                }
            } catch (err) {
                console.error("Failed to fetch countries", err);
            }
        };
        fetchCountries();

        // Click outside handler
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setShowDropdown(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const handleCountrySelect = (country: Country) => {
        setSelectedCountry(country);
        setShowDropdown(false);
        const code = country.idd.root + (country.idd.suffixes?.length === 1 ? country.idd.suffixes[0] : '');
        if (onCountryChange) onCountryChange(code);
    };

    const filteredCountries = countries.filter(c =>
        c.name.common.toLowerCase().includes(search.toLowerCase()) ||
        (c.idd.root + (c.idd.suffixes?.[0] || '')).includes(search)
    );

    const getDialCode = (c: Country) => c.idd.root + (c.idd.suffixes?.length === 1 ? c.idd.suffixes[0] : '');

    return (
        <div className="space-y-1.5 group relative" ref={dropdownRef}>
            <label className={`text-sm font-medium transition-colors ${isFocused ? 'text-emerald-400' : 'text-slate-400'}`}>
                {label}
            </label>
            <div className={`relative flex items-center bg-slate-900/50 border rounded-xl transition-all duration-300 ${error
                ? 'border-red-500/50'
                : isFocused
                    ? 'border-emerald-500/50 shadow-[0_0_0_1px_rgba(16,185,129,0.2)]'
                    : 'border-slate-800 hover:border-slate-700'
                }`}>

                {/* Country Selector Button */}
                <button
                    type="button"
                    onClick={() => setShowDropdown(!showDropdown)}
                    className="flex items-center gap-2 pl-4 pr-3 border-r border-slate-700 text-slate-300 hover:text-white transition-colors h-full py-3.5 min-w-[100px]"
                >
                    {selectedCountry ? (
                        <>
                            <img src={selectedCountry.flags.svg} alt={selectedCountry.name.common} className="w-5 h-3.5 object-cover rounded-sm" />
                            <span className="text-sm font-medium">{getDialCode(selectedCountry)}</span>
                        </>
                    ) : (
                        <Globe size={18} className="text-emerald-500" />
                    )}
                    <ChevronDown size={14} className={`text-slate-500 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
                </button>

                <input
                    type="tel"
                    className="w-full bg-transparent border-none text-slate-100 placeholder:text-slate-600 focus:ring-0 py-3.5 px-4 text-sm font-medium outline-none"
                    placeholder="99999-9999"
                    value={value}
                    onChange={onChange}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                />
            </div>

            {/* Dropdown Menu */}
            {showDropdown && (
                <div className="absolute top-full left-0 mt-2 w-72 max-h-80 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden z-50 flex flex-col animate-in fade-in zoom-in-95 duration-200">
                    <div className="p-2 border-b border-slate-800 sticky top-0 bg-slate-900 z-10">
                        <div className="relative">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                            <input
                                type="text"
                                placeholder="Buscar país..."
                                className="w-full bg-slate-950 border border-slate-800 rounded-lg py-1.5 pl-9 pr-3 text-xs text-slate-200 focus:outline-none focus:border-emerald-500/50"
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                autoFocus
                            />
                        </div>
                    </div>
                    <div className="overflow-y-auto flex-1 p-1">
                        {filteredCountries.map((country, idx) => (
                            <button
                                key={country.cca2 + idx}
                                onClick={() => handleCountrySelect(country)}
                                className="w-full flex items-center gap-3 p-2 hover:bg-slate-800 rounded-lg transition-colors text-left"
                            >
                                <img src={country.flags.svg} alt={country.name.common} className="w-6 h-4 object-cover rounded-sm shadow-sm" />
                                <span className="text-xs font-medium text-slate-200 flex-1 truncate">{country.name.common}</span>
                                <span className="text-xs text-slate-500 font-mono">{getDialCode(country)}</span>
                            </button>
                        ))}
                        {filteredCountries.length === 0 && (
                            <div className="p-4 text-center text-xs text-slate-500">Nenhum país encontrado</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

const Checkbox = ({ checked, onChange, label }: any) => (
    <label className="flex items-start gap-3 cursor-pointer group select-none">
        <div className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center transition-all duration-200 flex-shrink-0 ${checked
            ? 'bg-emerald-500 border-emerald-500 text-slate-900'
            : 'bg-slate-900/50 border-slate-700 group-hover:border-slate-600'
            }`}>
            {checked && <Check size={14} strokeWidth={4} />}
        </div>
        <span className={`text-sm leading-tight transition-colors ${checked ? 'text-slate-300' : 'text-slate-500 group-hover:text-slate-400'}`}>
            {label}
        </span>
        <input type="checkbox" className="hidden" checked={checked} onChange={e => onChange(e.target.checked)} />
    </label>
);

const RegisterButton = ({ children, isLoading, variant = 'primary', className = '', ...props }: any) => {
    const baseStyles = "relative w-full h-12 rounded-xl font-bold transition-all duration-300 flex items-center justify-center disabled:opacity-70 disabled:cursor-not-allowed active:scale-[0.98]";

    const variants: any = {
        primary: "bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-lg shadow-emerald-900/20 border border-transparent",
        outline: "bg-transparent border border-slate-700 hover:bg-slate-800 text-slate-300 hover:text-white"
    };

    return (
        <button className={`${baseStyles} ${variants[variant]} ${className}`} disabled={isLoading} {...props}>
            {isLoading ? (
                <Loader2 className="animate-spin text-white/80" size={20} />
            ) : (
                children
            )}
        </button>
    );
};

// --- Componente Principal ---

export const Register = () => {
    const { login } = useAuth();
    const navigate = useNavigate();

    // State
    const [countryCode, setCountryCode] = useState('+55');
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        contact: '',
        password: '',
        otp: ''
    });
    const [otpSent, setOtpSent] = useState(false);
    const [otpTimer, setOtpTimer] = useState(0);
    const [terms, setTerms] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const getFormalErrorMessage = (originalError: string) => {
        const err = originalError?.toLowerCase() || '';
        if (err.includes('email already registered')) return 'Este endereço de e-mail já está associado a uma conta.';
        if (err.includes('invalid or expired otp')) return 'O código de verificação inválido ou expirado. Tente novamente.';
        if (err.includes('otp is required')) return 'O código de verificação é obrigatório.';
        if (err.includes('connect')) return 'Falha na comunicação com o servidor. Verifique sua conexão.';
        if (err.includes('validation')) return 'Dados inválidos. Verifique as informações preenchidas.';
        return `Não foi possível concluir o seu cadastro. Detalhes: ${originalError}`;
    };

    useEffect(() => {
        let interval: any;
        if (otpTimer > 0) {
            interval = setInterval(() => setOtpTimer(prev => prev - 1), 1000);
        }
        return () => clearInterval(interval);
    }, [otpTimer]);

    const handleChange = (e: any) => {
        // Handle both standard inputs and mocked custom inputs if needed
        const name = e.target?.name;
        const value = e.target?.value;
        if (name) {
            setFormData(prev => ({ ...prev, [name]: value }));
        }
    };

    const handleSendOtp = async () => {
        if (!formData.email) {
            setError('Digite seu e-mail para receber o código.');
            return;
        }
        setIsLoading(true);
        setError(null);
        try {
            const res = await api.post('/auth/send-otp', { email: formData.email });
            if (res.data.success) {
                setOtpSent(true);
                setOtpTimer(60); // 60 seconds cooldown
            } else {
                setError(getFormalErrorMessage(res.data.error || 'Erro ao enviar OTP'));
            }
        } catch (err: any) {
            const backendMsg = err.response?.data?.error || '';
            setError(getFormalErrorMessage(backendMsg));
        } finally {
            setIsLoading(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (!otpSent) {
            setError('Por favor, solicite o código de verificação (OTP) antes de continuar.');
            return;
        }
        if (!formData.otp) {
            setError('Digite o código de verificação enviado ao seu e-mail.');
            return;
        }

        if (!terms) {
            setError('Você deve aceitar os Termos & Condições para continuar.');
            return;
        }

        if (formData.password.length < 6) {
            setError('A senha deve ter no mínimo 6 caracteres.');
            return;
        }

        setIsLoading(true);

        try {
            // Combine Code + Phone
            const payload = {
                ...formData,
                contact: `${countryCode} ${formData.contact}`
            };

            const res = await api.post('/auth/register', payload);

            if (res.data.success) {
                if (res.data.token) {
                    login(res.data.token);
                }
                navigate('/dashboard');
                window.location.reload();
            } else {
                setError(getFormalErrorMessage(res.data.error || res.data.message));
            }
        } catch (err: any) {
            console.error(err);
            const backendMsg = err.response?.data?.message || err.response?.data?.error || '';
            setError(getFormalErrorMessage(backendMsg));
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 md:p-6 font-sans relative overflow-hidden">

            {/* Logo Absolute */}
            <div className="absolute top-6 left-6 md:top-8 md:left-8 z-20 flex items-center gap-3">
                <img
                    src="https://res.cloudinary.com/dndlqdylc/image/upload/v1769335429/Touro_design_1_beuv9b.png"
                    alt="Logo"
                    className="w-10 h-10 object-contain drop-shadow-lg"
                />
                <span className="font-bold text-xl tracking-tight text-white">
                    TOREX <span className="text-emerald-400">JOURNAL</span>
                </span>
            </div>

            {/* Background Ambience */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
                <div className="absolute top-[10%] right-[10%] w-[60%] h-[60%] bg-emerald-500/5 rounded-full blur-[120px]" />
                <div className="absolute bottom-[10%] left-[0%] w-[50%] h-[50%] bg-teal-500/5 rounded-full blur-[100px]" />
                {/* Grid Pattern */}
                <div
                    className="absolute inset-0 opacity-[0.03]"
                    style={{
                        backgroundImage: 'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
                        backgroundSize: '40px 40px'
                    }}
                />
            </div>

            <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-24 items-center relative z-10">

                {/* Left Column (Form) - Inverted relative to login for dynamism */}
                <div className="w-full max-w-md mx-auto order-2 lg:order-1">
                    <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800/60 p-8 md:p-10 rounded-3xl shadow-2xl relative group">
                        {/* Glow Effect on Hover */}
                        <div className="absolute -inset-0.5 bg-gradient-to-br from-emerald-500/20 to-slate-800/0 rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 -z-10 blur-sm" />

                        <div className="flex flex-col items-center mb-6">
                            <h2 className="text-2xl font-bold text-white">Crie sua conta</h2>
                            <p className="text-slate-400 text-sm mt-2">Teste gratuitamente por 14 dias. Sem compromisso.</p>
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-5">
                            <Input
                                name="name"
                                label="Nome Completo"
                                placeholder="João Silva"
                                icon={<User size={18} />}
                                value={formData.name}
                                onChange={handleChange}
                            />

                            <Input
                                name="email"
                                label="E-mail"
                                placeholder="exemplo@torex.com"
                                type="email"
                                icon={<Mail size={18} />}
                                value={formData.email}
                                onChange={handleChange}
                            />

                            {/* OTP Section */}
                            <div className="flex gap-2 items-end">
                                <div className="flex-1">
                                    <Input
                                        name="otp"
                                        label="Código de Verificação (OTP)"
                                        placeholder="123456"
                                        type="text"
                                        icon={<Lock size={18} />}
                                        value={formData.otp}
                                        onChange={handleChange}
                                        maxLength={6}
                                        disabled={!otpSent}
                                    />
                                </div>
                                <button
                                    type="button"
                                    onClick={handleSendOtp}
                                    disabled={isLoading || otpTimer > 0 || !formData.email}
                                    className={`h-[50px] px-4 rounded-xl font-medium text-sm transition-all border ${otpTimer > 0
                                        ? 'bg-slate-800 text-slate-500 border-slate-700 cursor-not-allowed'
                                        : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20'
                                        }`}
                                >
                                    {otpTimer > 0 ? `${otpTimer}s` : (otpSent ? 'Reenviar' : 'Enviar Código')}
                                </button>
                            </div>

                            <PhoneInput
                                label="WhatsApp / Celular"
                                value={formData.contact}
                                onChange={(e: any) => setFormData(prev => ({ ...prev, contact: e.target.value }))}
                                onCountryChange={setCountryCode}
                            />

                            <div className="space-y-1">
                                <Input
                                    name="password"
                                    label="Senha"
                                    placeholder="••••••••"
                                    type="password"
                                    icon={<Lock size={18} />}
                                    value={formData.password}
                                    onChange={handleChange}
                                />
                                <p className="text-[10px] text-slate-500 text-right px-1">Mínimo de 6 caracteres</p>
                            </div>

                            {error && (
                                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center gap-3 text-red-400 text-sm animate-in slide-in-from-top-2">
                                    <AlertCircle size={18} />
                                    {error}
                                </div>
                            )}

                            <div className="pt-2">
                                <Checkbox
                                    label={<span>Aceito os <a href="#" className="text-emerald-400 hover:text-emerald-300 font-medium hover:underline">Termos de Uso</a> e a <a href="#" className="text-emerald-400 hover:text-emerald-300 font-medium hover:underline">Política de Privacidade</a>.</span>}
                                    checked={terms}
                                    onChange={setTerms}
                                />
                            </div>

                            <RegisterButton type="submit" isLoading={isLoading}>
                                Criar Conta Gratuita <ArrowRight size={18} className="ml-2 opacity-80" />
                            </RegisterButton>

                            <div className="relative my-6">
                                <div className="absolute inset-0 flex items-center">
                                    <div className="w-full border-t border-slate-800"></div>
                                </div>
                                <div className="relative flex justify-center text-xs uppercase">
                                    <span className="bg-slate-900 px-4 text-slate-500 font-medium">Ou continue com</span>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <RegisterButton 
                                    type="button"
                                    variant="outline" 
                                    className="h-10 text-sm font-medium"
                                    onClick={() => {
                                        window.location.href = '/api/auth/google';
                                    }}
                                >
                                    <GoogleIcon className="mr-2" /> Google
                                </RegisterButton>
                                <RegisterButton 
                                    type="button"
                                    variant="outline" 
                                    className="h-10 text-sm font-medium"
                                    onClick={() => {
                                        window.location.href = '/api/auth/github';
                                    }}
                                >
                                    <Github size={16} className="mr-2" /> GitHub
                                </RegisterButton>
                            </div>
                        </form>

                        <div className="mt-8 text-center">
                            <p className="text-slate-400 text-sm">
                                Já tem uma conta?
                                <Link to="/login" className="text-emerald-400 hover:text-emerald-300 font-bold ml-1 transition-colors">
                                    Fazer Login
                                </Link>
                            </p>
                        </div>
                    </div>
                </div>

                {/* Right Column (Marketing/Brand) */}
                <div className="hidden lg:block space-y-8 pl-8 order-1 lg:order-2">
                    <div className="w-16 h-16 bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-2xl flex items-center justify-center shadow-2xl shadow-emerald-500/30 mb-8">
                        <TrendingUp className="text-white w-8 h-8" />
                    </div>

                    <h1 className="text-5xl font-extrabold text-white leading-tight">
                        Comece sua jornada rumo à <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-400">profissionalização.</span>
                    </h1>

                    <div className="space-y-6 pt-4">
                        {[
                            "Sincronização automática com MT4/MT5",
                            "Análise detalhada de performance",
                            "Diário emocional integrado",
                            "Gestão de risco automatizada"
                        ].map((item, idx) => (
                            <div key={idx} className="flex items-center gap-4 group">
                                <div className="w-8 h-8 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center group-hover:bg-emerald-500/20 group-hover:border-emerald-500/40 transition-colors">
                                    <Check size={14} className="text-emerald-400" strokeWidth={3} />
                                </div>
                                <span className="text-slate-300 font-medium text-lg">{item}</span>
                            </div>
                        ))}
                    </div>

                    {/* Social Proof Mini */}
                    <div className="pt-8 border-t border-slate-800/50 mt-8">
                        <div className="flex items-center gap-4">
                            <div className="flex -space-x-3">
                                {[1, 2, 3, 4].map(i => (
                                    <div key={i} className="w-10 h-10 rounded-full border-2 border-slate-950 bg-slate-800 flex items-center justify-center text-xs font-bold text-white">
                                        {String.fromCharCode(64 + i)}
                                    </div>
                                ))}
                            </div>
                            <div className="text-sm">
                                <div className="flex gap-1 text-yellow-500 mb-0.5">
                                    {[1, 2, 3, 4, 5].map(s => <span key={s} className="fill-current">★</span>)}
                                </div>
                                <p className="text-slate-400"><span className="text-white font-bold">4.9/5</span> de avaliações de traders.</p>
                            </div>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
};
