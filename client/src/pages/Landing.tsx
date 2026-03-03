
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
    TrendingUp,
    Shield,
    Zap,
    BarChart3,
    ArrowRight,
    BrainCircuit,
    CheckCircle2,
    FlaskConical,
    Menu,
    X,
    ChevronRight
} from 'lucide-react';

// --- Custom UI Components ---

const LandingButton = ({ children, variant = 'primary', className = '', ...props }: any) => {
    const baseStyles = "px-6 py-3 rounded-xl font-bold transition-all duration-300 flex items-center justify-center cursor-pointer active:scale-95";

    const variants: any = {
        primary: "bg-emerald-500 hover:bg-emerald-400 text-white shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/40 border border-transparent",
        secondary: "bg-slate-800/50 hover:bg-slate-800 text-slate-200 border border-slate-700 hover:border-slate-600 backdrop-blur-sm",
        ghost: "bg-transparent hover:bg-slate-800/50 text-slate-400 hover:text-white"
    };

    return (
        <button
            className={`${baseStyles} ${variants[variant] || variants.primary} ${className}`}
            {...props}
        >
            {children}
        </button>
    );
};

const FeatureCard = ({ icon, title, description }: any) => (
    <div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-800 hover:border-emerald-500/30 transition-all duration-300 hover:bg-slate-800/60 group hover:-translate-y-1">
        <div className="w-12 h-12 bg-slate-800 rounded-lg flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300 text-emerald-400 group-hover:bg-emerald-500/10 group-hover:text-emerald-300 shadow-lg shadow-black/20">
            {icon}
        </div>
        <h3 className="text-xl font-bold text-slate-100 mb-3 group-hover:text-emerald-400 transition-colors">{title}</h3>
        <p className="text-slate-400 leading-relaxed text-sm">{description}</p>
    </div>
);

const StatItem = ({ value, label }: any) => (
    <div className="text-center group cursor-default">
        <div className="text-3xl md:text-5xl font-bold text-white mb-2 group-hover:text-emerald-400 transition-colors duration-300">{value}</div>
        <div className="text-slate-500 text-xs md:text-sm font-bold uppercase tracking-widest group-hover:text-slate-400 transition-colors">{label}</div>
    </div>
);

// --- Main Application Component ---

export const Landing = () => {
    const [scrolled, setScrolled] = useState(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    // Handle scroll effect for navbar
    useEffect(() => {
        const handleScroll = () => {
            setScrolled(window.scrollY > 20);
        };
        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-emerald-500/30 overflow-x-hidden">

            {/* CSS Styles for Animations */}
            <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
        @keyframes pulse-glow {
          0%, 100% { opacity: 0.5; transform: scale(1); }
          50% { opacity: 0.8; transform: scale(1.05); }
        }
        .animate-float {
          animation: float 6s ease-in-out infinite;
        }
        .animate-float-delayed {
          animation: float 6s ease-in-out 3s infinite;
        }
        .bg-grid-pattern {
          background-size: 40px 40px;
          background-image: linear-gradient(to right, rgba(255, 255, 255, 0.03) 1px, transparent 1px),
                            linear-gradient(to bottom, rgba(255, 255, 255, 0.03) 1px, transparent 1px);
        }
      `}</style>

            {/* Navbar */}
            <nav className={`fixed w-full z-50 transition-all duration-300 ${scrolled ? 'bg-slate-950/90 backdrop-blur-xl border-b border-slate-800/60 py-2' : 'bg-transparent py-4'}`}>
                <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-3 group cursor-pointer">
                        <img
                            src="https://res.cloudinary.com/dndlqdylc/image/upload/v1769335429/Touro_design_1_beuv9b.png"
                            alt="Torex Journal Logo"
                            className="w-10 h-10 object-contain drop-shadow-lg group-hover:scale-110 transition-transform duration-300"
                        />
                        <span className="font-bold text-xl tracking-tight text-white">
                            TOREX <span className="text-emerald-400">JOURNAL</span>
                        </span>
                    </div>

                    {/* Desktop Nav */}
                    <div className="hidden md:flex items-center gap-8">
                        <div className="flex items-center gap-6 text-sm font-medium text-slate-400">
                            <a href="#features" className="hover:text-emerald-400 transition-colors">Funcionalidades</a>
                            <a href="#pricing" className="hover:text-emerald-400 transition-colors">Planos</a>
                            <a href="#blog" className="hover:text-emerald-400 transition-colors">Blog</a>
                        </div>
                        <div className="h-6 w-px bg-slate-800"></div>
                        <div className="flex items-center gap-4">
                            <Link to="/login" className="text-slate-300 hover:text-white font-medium transition-colors">
                                Entrar
                            </Link>
                            <Link to="/register">
                                <LandingButton className="py-2 px-5 text-sm">
                                    Começar Grátis
                                </LandingButton>
                            </Link>
                        </div>
                    </div>

                    {/* Mobile Menu Toggle */}
                    <button
                        className="md:hidden text-slate-300 p-2"
                        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                    >
                        {mobileMenuOpen ? <X /> : <Menu />}
                    </button>
                </div>

                {/* Mobile Menu Dropdown */}
                {mobileMenuOpen && (
                    <div className="md:hidden absolute top-full left-0 w-full bg-slate-950 border-b border-slate-800 p-6 flex flex-col gap-4 animate-in slide-in-from-top-5">
                        <a href="#features" className="text-slate-300 hover:text-emerald-400 py-2">Funcionalidades</a>
                        <a href="#pricing" className="text-slate-300 hover:text-emerald-400 py-2">Planos</a>
                        <hr className="border-slate-800" />
                        <Link to="/login" className="text-slate-300 hover:text-emerald-400 py-2">Entrar</Link>
                        <LandingButton className="w-full">Criar Conta</LandingButton>
                    </div>
                )}
            </nav>

            {/* Hero Section */}
            <header className="pt-32 pb-20 px-6 relative overflow-hidden flex flex-col items-center">
                {/* Background Effects */}
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[600px] bg-emerald-500/10 rounded-full blur-[120px] -z-10" />
                <div className="absolute inset-0 bg-grid-pattern opacity-20 -z-20 mask-gradient" />

                <div className="max-w-4xl mx-auto text-center z-10">
                    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-slate-900/80 border border-emerald-500/20 text-emerald-400 text-xs md:text-sm font-medium mb-8 hover:bg-slate-900 transition-colors cursor-pointer group">
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                        </span>
                        <span>Nova feature: Backtest Inteligente Disponível</span>
                        <ChevronRight size={14} className="group-hover:translate-x-1 transition-transform" />
                    </div>

                    <h1 className="text-5xl md:text-7xl font-extrabold mb-8 leading-tight tracking-tight text-white">
                        Domine o Mercado com <br />
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-300">Inteligência de Dados</span>
                    </h1>

                    <p className="text-lg md:text-xl text-slate-400 mb-10 max-w-2xl mx-auto leading-relaxed">
                        Pare de operar no escuro. O TorexJournal combina diário automatizado, gestão emocional e backtests avançados para transformar você em um trader consistente.
                    </p>

                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4 w-full sm:w-auto">
                        <Link to="/register" className="w-full sm:w-auto">
                            <LandingButton className="w-full sm:w-auto px-8 py-4 text-lg gap-2 group">
                                Criar Conta Gratuita <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                            </LandingButton>
                        </Link>
                        <Link to="/login" className="w-full sm:w-auto">
                            <LandingButton variant="secondary" className="w-full sm:w-auto px-8 py-4 text-lg">
                                Ver Demonstração
                            </LandingButton>
                        </Link>
                    </div>

                    <div className="mt-16 flex flex-wrap items-center justify-center gap-8 md:gap-16 text-slate-600 grayscale hover:grayscale-0 transition-all duration-500">
                        {/* Fake Trust Logos */}
                        <div className="flex items-center gap-2 font-bold text-lg hover:text-slate-300 transition-colors cursor-default"><TrendingUp size={20} /> MetaTrader 5</div>
                        <div className="flex items-center gap-2 font-bold text-lg hover:text-slate-300 transition-colors cursor-default"><BarChart3 size={20} /> TradingView</div>
                        <div className="flex items-center gap-2 font-bold text-lg hover:text-slate-300 transition-colors cursor-default"><Shield size={20} /> Binance</div>
                    </div>
                </div>
            </header>

            {/* Dashboard Preview Section */}
            <section className="px-6 pb-24 relative z-10">
                <div className="max-w-6xl mx-auto bg-slate-900/80 rounded-2xl border border-slate-800 p-2 md:p-3 shadow-2xl backdrop-blur-sm">
                    <div className="rounded-xl overflow-hidden bg-slate-950 aspect-video relative group border border-slate-800/50 flex flex-col">

                        {/* Mock Header of Dashboard */}
                        <div className="h-12 border-b border-slate-800 bg-slate-900/50 flex items-center px-4 gap-2">
                            <div className="flex gap-1.5">
                                <div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/50"></div>
                                <div className="w-3 h-3 rounded-full bg-yellow-500/20 border border-yellow-500/50"></div>
                                <div className="w-3 h-3 rounded-full bg-green-500/20 border border-green-500/50"></div>
                            </div>
                            <div className="ml-4 h-6 w-64 bg-slate-800/50 rounded-md"></div>
                        </div>

                        {/* Content of Mock Dashboard */}
                        <div className="flex-1 p-6 grid grid-cols-12 gap-6 bg-slate-950/50 relative">
                            {/* Sidebar */}
                            <div className="hidden md:block col-span-2 space-y-3">
                                {[1, 2, 3, 4, 5].map(i => (
                                    <div key={i} className="h-10 w-full bg-slate-800/30 rounded-lg animate-pulse" style={{ animationDelay: `${i * 100}ms` }}></div>
                                ))}
                            </div>
                            {/* Main Content */}
                            <div className="col-span-12 md:col-span-10 grid grid-cols-3 gap-6">
                                <div className="col-span-3 grid grid-cols-3 gap-6">
                                    <div className="h-32 bg-slate-800/20 rounded-xl border border-slate-800/50"></div>
                                    <div className="h-32 bg-slate-800/20 rounded-xl border border-slate-800/50"></div>
                                    <div className="h-32 bg-slate-800/20 rounded-xl border border-slate-800/50"></div>
                                </div>
                                <div className="col-span-3 md:col-span-2 h-64 bg-slate-800/20 rounded-xl border border-slate-800/50 relative overflow-hidden">
                                    {/* Chart Mockup */}
                                    <div className="absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-emerald-500/10 to-transparent"></div>
                                    <svg className="absolute bottom-10 left-4 right-4 h-32 w-full text-emerald-500" preserveAspectRatio="none">
                                        <path d="M0,100 C150,80 200,120 300,60 C400,0 500,40 600,20 L600,150 L0,150 Z" fill="none" stroke="currentColor" strokeWidth="2" />
                                    </svg>
                                </div>
                                <div className="col-span-3 md:col-span-1 h-64 bg-slate-800/20 rounded-xl border border-slate-800/50"></div>
                            </div>

                            {/* Floating Interactive Cards Overlay */}
                            <div className="absolute bottom-10 left-10 p-4 bg-slate-900/95 backdrop-blur-md border border-slate-700/50 rounded-xl shadow-2xl w-64 animate-float hidden md:block z-20">
                                <div className="flex items-center gap-3 mb-2">
                                    <div className="p-2 bg-emerald-500/20 rounded-lg text-emerald-400"><TrendingUp size={16} /></div>
                                    <div className="text-sm font-bold text-white">Win Rate</div>
                                </div>
                                <div className="text-2xl font-bold text-emerald-400">68.5% <span className="text-xs text-slate-500 font-normal ml-2">↑ 2.1%</span></div>
                            </div>

                            <div className="absolute top-20 right-10 p-4 bg-slate-900/95 backdrop-blur-md border border-slate-700/50 rounded-xl shadow-2xl w-64 animate-float-delayed hidden md:block z-20">
                                <div className="flex items-center gap-3 mb-2">
                                    <div className="p-2 bg-purple-500/20 rounded-lg text-purple-400"><BrainCircuit size={16} /></div>
                                    <div className="text-sm font-bold text-white">Score Mental</div>
                                </div>
                                <div className="text-2xl font-bold text-purple-400">92/100 <span className="text-xs text-slate-500 font-normal ml-2">Focado</span></div>
                            </div>
                        </div>

                        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent opacity-40 pointer-events-none" />
                    </div>
                </div>
            </section>

            {/* Features Grid */}
            <section id="features" className="py-24 bg-slate-900/30 border-t border-slate-800/50">
                <div className="max-w-7xl mx-auto px-6">
                    <div className="text-center mb-20">
                        <h2 className="text-3xl md:text-5xl font-bold mb-6 text-slate-100">
                            Tudo que você precisa para <span className="text-emerald-400">evoluir</span>
                        </h2>
                        <p className="text-slate-400 max-w-2xl mx-auto text-lg leading-relaxed">
                            Ferramentas profissionais projetadas para eliminar a aleatoriedade e trazer consistência matemática ao seu operacional.
                        </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                        <FeatureCard
                            icon={<BarChart3 />}
                            title="Diário Automatizado"
                            description="Sincronização em tempo real com MT5. Seus trades são registrados, categorizados e analisados automaticamente sem esforço manual."
                        />
                        <FeatureCard
                            icon={<BrainCircuit />}
                            title="Gestão Mental 3.0"
                            description="Monitore seu sono, estresse e foco. Descubra através de dados como seu estado emocional impacta diretamente no seu PnL."
                        />
                        <FeatureCard
                            icon={<FlaskConical />}
                            title="Backtest Lab"
                            description="Valide suas estratégias com dados históricos reais. Simule cenários, ajuste parâmetros e encontre seu edge estatístico."
                        />
                        <FeatureCard
                            icon={<Zap />}
                            title="Execução Instantânea"
                            description="Sem delay. Nossa infraestrutura de baixa latência garante que seus dados analíticos estejam sempre atualizados com o mercado."
                        />
                        <FeatureCard
                            icon={<Shield />}
                            title="Gestão de Risco"
                            description="Travas de segurança e alertas em tempo real quando você foge do plano. Proteja seu capital contra dias de fúria."
                        />
                        <FeatureCard
                            icon={<TrendingUp />}
                            title="Analytics Avançado"
                            description="Relatórios detalhados por horário, par, setup e humor. Saiba exatamente onde você ganha e perde dinheiro."
                        />
                    </div>
                </div>
            </section>

            {/* Stats Section */}
            <section className="py-24 border-t border-slate-800/50 relative overflow-hidden bg-slate-950">
                <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-emerald-500/5 rounded-full blur-[100px] -z-10" />
                <div className="max-w-5xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-y-16 gap-x-8">
                    <StatItem value="$10M+" label="Volume Analisado" />
                    <StatItem value="50k+" label="Trades Importados" />
                    <StatItem value="1.2k+" label="Traders Ativos" />
                    <StatItem value="99.9%" label="Uptime" />
                </div>
            </section>

            {/* CTA Section */}
            <section className="py-24 px-6">
                <div className="max-w-5xl mx-auto bg-gradient-to-br from-emerald-900/50 to-slate-900 border border-emerald-500/20 rounded-3xl p-10 md:p-16 text-center relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-full bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20"></div>
                    <div className="relative z-10">
                        <h2 className="text-3xl md:text-5xl font-bold text-white mb-6">Pronto para a consistência?</h2>
                        <p className="text-slate-300 text-lg mb-10 max-w-xl mx-auto">Junte-se a milhares de traders que transformaram seus resultados usando a inteligência de dados do TorexJournal.</p>
                        <Link to="/register">
                            <LandingButton className="px-10 py-4 text-lg bg-white text-slate-900 hover:bg-emerald-50 hover:text-emerald-700 mx-auto shadow-2xl">
                                Começar Teste Gratuito
                            </LandingButton>
                        </Link>
                    </div>
                </div>
            </section>

            {/* Footer */}
            <footer className="bg-slate-950 border-t border-slate-800 pt-20 pb-10">
                <div className="max-w-7xl mx-auto px-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 mb-16">
                        <div className="col-span-1 md:col-span-2 lg:col-span-1">
                            <div className="flex items-center gap-2 mb-6">
                                <img
                                    src="https://res.cloudinary.com/dndlqdylc/image/upload/v1769335429/Touro_design_1_beuv9b.png"
                                    alt="Logo"
                                    className="w-10 h-10 object-contain"
                                />
                                <span className="font-bold text-lg text-white">
                                    TOREX <span className="text-emerald-400">JOURNAL</span>
                                </span>
                            </div>
                            <p className="text-slate-500 text-sm leading-relaxed mb-6">
                                A plataforma definitiva para traders que buscam profissionalização e consistência através da análise de dados e performance.
                            </p>
                            <div className="flex gap-4">
                                <a href="#" className="w-10 h-10 rounded-full bg-slate-900 flex items-center justify-center text-slate-400 hover:bg-emerald-500 hover:text-white transition-all"><TrendingUp size={18} /></a>
                                <a href="#" className="w-10 h-10 rounded-full bg-slate-900 flex items-center justify-center text-slate-400 hover:bg-emerald-500 hover:text-white transition-all"><CheckCircle2 size={18} /></a>
                            </div>
                        </div>

                        {[
                            { title: "Plataforma", links: ["Funcionalidades", "Preços", "Changelog", "Download"] },
                            { title: "Recursos", links: ["Blog", "Academy", "Calculadoras", "Glossário"] },
                            { title: "Empresa", links: ["Sobre nós", "Carreiras", "Contato", "Termos"] },
                        ].map((col, idx) => (
                            <div key={idx}>
                                <h4 className="font-bold text-slate-100 mb-6">{col.title}</h4>
                                <ul className="space-y-4">
                                    {col.links.map(link => (
                                        <li key={link}>
                                            <a href="#" className="text-slate-500 hover:text-emerald-400 transition-colors text-sm font-medium">{link}</a>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>

                    <div className="border-t border-slate-900 pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
                        <p className="text-slate-600 text-sm">© 2025 TOREX JOURNAL. Todos os direitos reservados.</p>
                        <div className="flex gap-6 text-sm text-slate-600">
                            <Link to="/privacy" className="hover:text-slate-400">Privacidade</Link>
                            <Link to="/terms" className="hover:text-slate-400">Termos</Link>
                            <Link to="/risk-disclosure" className="hover:text-slate-400">Aviso de Risco</Link>
                        </div>
                    </div>

                </div>
            </footer>
        </div>
    );
};
