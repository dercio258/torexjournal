import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
    TrendingUp,
    BarChart3,
    ArrowRight,
    CheckCircle2,
    Award,
    ChevronRight,
    Menu,
    X,
    FileText,
    ListFilter,
    Calendar,
    Smile,
    Layers,
    Sliders,
    ShieldCheck,
    Check
} from 'lucide-react';
import {
    CandlestickHeroBackground
} from '../components/landing/CandlestickBackground';

export const Landing = () => {
    const [scrolled, setScrolled] = useState(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<'reports' | 'trades' | 'calendar' | 'emotions'>('reports');

    // Strictly enforce authentic dark mode on the landing page
    useEffect(() => {
        const root = document.documentElement;
        root.classList.add('dark');
        root.classList.remove('light');
    }, []);

    useEffect(() => {
        const handleScroll = () => {
            setScrolled(window.scrollY > 20);
        };
        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    // Official Cloudinary Assets
    const ASSETS = {
        awardImage: "https://pub-354475384fd04c1e8c075e14e17ed14d.r2.dev/produtos/originals/1790960005698_9c1b15b912b83c8c_img-20260911-wa0018.jpg",
        mascotRocket: "https://res.cloudinary.com/dndlqdylc/image/upload/v1788819094/mascot-rocket-BkEtyIqW_ji8mlc.png",
        dashboardMockup: "https://pub-354475384fd04c1e8c075e14e17ed14d.r2.dev/produtos/originals/1790959463602_0d9ff4122d063a3e_img-20260911-wa0012.jpg",
        reportsMockup: "https://pub-354475384fd04c1e8c075e14e17ed14d.r2.dev/produtos/originals/1790960143809_ed412afba184c0fa_img-20260911-wa0022.jpg",
        tradesMockup: "https://pub-354475384fd04c1e8c075e14e17ed14d.r2.dev/conteudo/originals/1791302679484_b21832ff3a42f0e8_trade_logs.PNG",
        calendarMockup: "https://pub-354475384fd04c1e8c075e14e17ed14d.r2.dev/produtos/originals/1791303086942_70508b69bef5e0f8_diario.png",
        emotionsMockup: "https://pub-354475384fd04c1e8c075e14e17ed14d.r2.dev/produtos/originals/1791303054223_4d0b75a6535a7c5c_emocional.png",
        logo: "https://pub-354475384fd04c1e8c075e14e17ed14d.r2.dev/produtos/originals/1790957899791_0521d2dc46a60392_touro_design_1.jpeg"
    };

    const PREVIEW_TABS = [
        {
            id: 'reports' as const,
            label: 'Relatórios',
            icon: FileText,
            image: ASSETS.reportsMockup,
            alt: 'Relatório de Performance Torex Journal',
            description: 'Métricas analíticas profundas, fatores de lucratividade e relatórios detalhados.',
        },
        {
            id: 'trades' as const,
            label: 'Trades Logs',
            icon: ListFilter,
            image: ASSETS.tradesMockup,
            alt: 'Logs de Operações e Histórico de Trades Torex Journal',
            description: 'Histórico auditado de todas as ordens, setups, horários e P&L individual.',
        },
        {
            id: 'calendar' as const,
            label: 'Diário',
            icon: Calendar,
            image: ASSETS.calendarMockup,
            alt: 'Diário de Trading e Calendário Mensal Torex Journal',
            description: 'Visão de calendário por dias de lucro e perda com métricas de consistência contínua.',
        },
        {
            id: 'emotions' as const,
            label: 'Emocional',
            icon: Smile,
            image: ASSETS.emotionsMockup,
            alt: 'Gestão Emocional e Psicologia de Trading Torex Journal',
            description: 'Rastreamento de estado mental, disciplina operacional e controle comportamental.',
        },
    ];

    const currentTab = PREVIEW_TABS.find((t) => t.id === activeTab) || PREVIEW_TABS[0];

    return (
        <div className="min-h-screen bg-[#08090C] text-[#F3F4F6] flex flex-col font-sans selection:bg-emerald-500/25 overflow-x-hidden">
            {/* Subtle Ambient Background Grid Pattern */}
            <div
                className="fixed inset-0 pointer-events-none opacity-[0.025] z-0"
                style={{
                    backgroundImage: `radial-gradient(rgba(255, 255, 255, 0.4) 1px, transparent 1px)`,
                    backgroundSize: '28px 28px'
                }}
            />

            {/* Navbar */}
            <nav className={`fixed w-full z-50 transition-all duration-300 ${scrolled
                ? 'bg-[#08090C]/90 backdrop-blur-xl border-b border-white/[0.07] py-3 shadow-2xl'
                : 'bg-transparent py-5'
                }`}>
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between">
                    <Link to="/" className="flex items-center gap-2.5 group cursor-pointer">
                        <img
                            src={ASSETS.logo}
                            alt="Torex Journal Logo"
                            className="w-8 h-8 object-contain drop-shadow-md group-hover:scale-105 transition-transform"
                        />
                        <span className="font-bold text-lg tracking-tight text-[#F3F4F6]">
                            TOREX <span className="text-emerald-400">JOURNAL</span>
                        </span>
                    </Link>

                    {/* Desktop Navigation Links */}
                    <div className="hidden md:flex items-center gap-8 text-sm font-medium text-[#9CA3AF]">
                        <a href="#plataforma" className="hover:text-emerald-400 transition-colors">Plataforma</a>
                        <a href="#recursos" className="hover:text-emerald-400 transition-colors">Recursos</a>
                        <a href="#premiacoes" className="hover:text-emerald-400 transition-colors flex items-center gap-1.5">
                            <span>Premiações</span>
                            <span className="text-[9px] font-bold px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-full uppercase tracking-wider">3 Meses</span>
                        </a>
                        <Link to="/pricing" className="hover:text-emerald-400 transition-colors">Planos</Link>
                    </div>

                    {/* Desktop Auth CTA */}
                    <div className="hidden md:flex items-center gap-3">
                        <Link
                            to="/login"
                            className="text-sm font-semibold text-[#9CA3AF] hover:text-[#F3F4F6] px-4 py-2 rounded-lg hover:bg-[#161822] transition-all"
                        >
                            Entrar
                        </Link>
                        <Link
                            to="/register"
                            className="text-sm font-semibold px-5 py-2 bg-[#10B981] hover:bg-[#34D399] text-[#04110C] rounded-full transition-all duration-200 hover:shadow-[0_0_24px_rgba(16,185,129,0.30)] active:scale-95 shadow-sm flex items-center gap-1.5"
                        >
                            <span>Começar agora</span>
                            <ChevronRight size={15} strokeWidth={2.5} />
                        </Link>
                    </div>

                    {/* Mobile Menu Button */}
                    <button
                        className="md:hidden p-2 text-[#9CA3AF] hover:text-white bg-[#111319] border border-white/[0.08] rounded-lg"
                        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                        title="Abrir menu"
                    >
                        {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
                    </button>
                </div>

                {/* Mobile Menu Dropdown */}
                {mobileMenuOpen && (
                    <div className="md:hidden absolute top-full left-0 w-full bg-[#0E1017] border-b border-white/[0.08] p-5 flex flex-col gap-3 shadow-2xl animate-in slide-in-from-top-2">
                        <a
                            href="#plataforma"
                            onClick={() => setMobileMenuOpen(false)}
                            className="text-[#9CA3AF] hover:text-emerald-400 py-2 text-sm font-medium"
                        >
                            Plataforma
                        </a>
                        <a
                            href="#recursos"
                            onClick={() => setMobileMenuOpen(false)}
                            className="text-[#9CA3AF] hover:text-emerald-400 py-2 text-sm font-medium"
                        >
                            Recursos
                        </a>
                        <a
                            href="#premiacoes"
                            onClick={() => setMobileMenuOpen(false)}
                            className="text-[#9CA3AF] hover:text-emerald-400 py-2 text-sm font-medium flex items-center justify-between"
                        >
                            <span>Premiações</span>
                            <span className="text-[9px] font-bold px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-full">3 MESES</span>
                        </a>
                        <Link
                            to="/pricing"
                            onClick={() => setMobileMenuOpen(false)}
                            className="text-[#9CA3AF] hover:text-emerald-400 py-2 text-sm font-medium"
                        >
                            Planos
                        </Link>
                        <div className="pt-2 border-t border-white/[0.08] flex flex-col gap-2">
                            <Link
                                to="/login"
                                className="text-center py-2 text-sm font-semibold text-[#F3F4F6] bg-[#111319] rounded-lg border border-white/[0.08]"
                            >
                                Entrar
                            </Link>
                            <Link
                                to="/register"
                                className="text-center py-2.5 text-sm font-semibold text-[#04110C] bg-[#10B981] rounded-full shadow-md"
                            >
                                Começar Grátis
                            </Link>
                        </div>
                    </div>
                )}
            </nav>

            {/* HERO SECTION: OBSIDIAN DARK FINTECH + CANDLESTICKS BACKGROUND */}
            <header className="relative pt-32 pb-20 md:pt-40 md:pb-28 px-4 sm:px-6 lg:px-8 z-10 flex flex-col items-center overflow-hidden">
                {/* Candlestick Trading Operations Background */}
                <CandlestickHeroBackground />
                <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center relative z-20">
                    {/* Left Column: Headline & Value Prop */}
                    <div className="lg:col-span-6 text-center lg:text-left flex flex-col justify-center">
                        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#111319] border border-emerald-500/30 text-emerald-400 text-xs font-semibold mb-6 shadow-xs backdrop-blur-md self-center lg:self-start">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                            <span>Métricas que Revelam a Verdade do Seu Trading</span>
                        </div>

                        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black text-[#F3F4F6] tracking-tight leading-[1.1] mb-6">
                            Pare de operar no achismo. <span className="text-emerald-400">Comece a operar com dados.</span>
                        </h1>

                        <p className="text-base sm:text-lg text-[#9CA3AF] leading-relaxed mb-8 max-w-xl mx-auto lg:mx-0">
                            Acompanhe as métricas que realmente importam para entender sua performance e evoluir com consistência. Mais dados. Mais clareza. Melhores decisões.
                        </p>

                        {/* CTA Buttons */}
                        <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-3.5">
                            <Link
                                to="/register"
                                className="w-full sm:w-auto px-7 py-3.5 bg-[#10B981] hover:bg-[#34D399] text-[#04110C] font-semibold text-sm rounded-full transition-all duration-200 hover:shadow-[0_0_24px_rgba(16,185,129,0.30)] active:scale-95 shadow-md flex items-center justify-center gap-2"
                            >
                                <span>Começar agora</span>
                                <ArrowRight size={16} strokeWidth={2.5} />
                            </Link>

                            <Link
                                to="/login"
                                className="w-full sm:w-auto px-6 py-3.5 bg-[#111319] hover:bg-[#161822] text-[#9CA3AF] hover:text-[#F3F4F6] font-semibold text-sm rounded-full border border-white/[0.08] hover:border-emerald-500/40 transition-all duration-200 flex items-center justify-center"
                            >
                                Ver Demonstração
                            </Link>
                        </div>
                    </div>

                    {/* Right Column: Imagem do Dashboard em Resolução Real (1366x680) */}
                    <div className="lg:col-span-6 flex flex-col justify-center relative w-full">
                        {/* Glow ambient expandido */}
                        <div className="absolute -inset-3 bg-gradient-to-r from-emerald-500/30 via-emerald-400/20 to-teal-500/15 rounded-3xl blur-2xl opacity-80 pointer-events-none" />

                        <div className="relative w-full rounded-2xl bg-[#0E1017] border border-emerald-500/40 p-2 sm:p-2.5 shadow-2xl overflow-hidden group">
                            <div className="relative w-full overflow-hidden rounded-xl bg-[#08090C] border border-white/[0.05]">
                                <img
                                    src={ASSETS.dashboardMockup}
                                    alt="Dashboard Torex Journal em Tempo Real"
                                    width={1366}
                                    height={680}
                                    className="w-full h-auto object-contain block rounded-xl shadow-2xl group-hover:scale-[1.01] transition-transform duration-500"
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </header>

            {/* SECTION 2: EXPLORE A PLATAFORMA (4 PILLS INTERATIVAS) */}
            <section id="plataforma" className="py-20 md:py-28 px-4 sm:px-6 lg:px-8 border-t border-white/[0.07] relative z-10 overflow-hidden">
                <div className="max-w-6xl mx-auto text-center mb-10 relative z-10">
                    <div className="text-[10px] font-semibold text-emerald-400 uppercase tracking-[0.14em] mb-2">
                        Plataforma Interativa
                    </div>
                    <h2 className="text-3xl sm:text-4xl md:text-5xl font-black text-[#F3F4F6] tracking-tight mb-4">
                        Visualize cada dimensão do seu operacional
                    </h2>
                    <p className="text-sm sm:text-base text-[#9CA3AF] max-w-2xl mx-auto leading-relaxed">
                        Alterne entre os módulos analíticos do Torex Journal para gerenciar suas operações com precisão institucional.
                    </p>

                    {/* Header Pills */}
                    <div className="mt-8 flex flex-wrap items-center justify-center gap-2.5 sm:gap-3">
                        {PREVIEW_TABS.map((tab) => {
                            const Icon = tab.icon;
                            const isActive = activeTab === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`px-4 sm:px-5 py-2.5 rounded-full text-xs sm:text-sm font-bold flex items-center gap-2 transition-all cursor-pointer border ${isActive
                                        ? 'bg-emerald-500 text-slate-950 border-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.35)] scale-105'
                                        : 'bg-[#111319] text-[#9CA3AF] border-white/[0.08] hover:border-white/[0.2] hover:text-white hover:bg-[#161822]'
                                        }`}
                                >
                                    <Icon className={`w-4 h-4 ${isActive ? 'text-slate-950' : 'text-emerald-400'}`} />
                                    <span>{tab.label}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Showcase Screen Container */}
                <div className="max-w-6xl mx-auto relative group z-10">
                    {/* Ambient Glow */}
                    <div className="absolute -inset-2 bg-gradient-to-b from-emerald-500/20 via-emerald-500/5 to-transparent rounded-2xl blur-2xl opacity-60 group-hover:opacity-80 transition-opacity duration-500 pointer-events-none" />

                    <div className="relative rounded-2xl bg-[#0E1017] border border-white/[0.12] p-2.5 sm:p-4 shadow-2xl overflow-hidden">
                        {/* Terminal Header Bar */}
                        <div className="flex items-center justify-between px-3 py-2 bg-[#111319] border-b border-white/[0.06] rounded-t-xl mb-3">
                            <div className="flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
                                <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
                                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
                                <span className="ml-2 text-xs font-mono text-[#6B7280]">
                                    torexjournal.com/{currentTab.id}
                                </span>
                            </div>
                            <div className="text-[11px] font-mono text-emerald-400 font-semibold bg-emerald-500/10 px-2.5 py-0.5 rounded-full border border-emerald-500/30">
                                {currentTab.label}
                            </div>
                        </div>

                        {/* Image Preview with Smooth Transition */}
                        <div className="relative overflow-hidden rounded-xl bg-[#08090C]">
                            <img
                                key={currentTab.id}
                                src={currentTab.image}
                                alt={currentTab.alt}
                                className="w-full h-auto object-contain block rounded-xl shadow-inner border border-white/[0.05] animate-in fade-in zoom-in-95 duration-300"
                            />
                        </div>

                        {/* Caption bar */}
                        <div className="mt-3 px-3 py-2 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-[#9CA3AF] bg-[#111319]/60 rounded-lg">
                            <span className="flex items-center gap-2">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                <span>{currentTab.description}</span>
                            </span>
                            <span className="text-[11px] font-mono text-[#6B7280]">Alta Resolução • Atualizado</span>
                        </div>
                    </div>
                </div>
            </section>

            {/* SECTION 3: TUDO O QUE VOCÊ PRECISA PARA OPERAR MELHOR */}
            <section id="recursos" className="py-20 md:py-28 px-4 sm:px-6 lg:px-8 bg-[#0C0D12]/80 border-t border-white/[0.07] relative z-10 overflow-hidden">
                <div className="max-w-6xl mx-auto text-center mb-14 relative z-10">
                    <div className="text-[10px] font-semibold text-emerald-400 uppercase tracking-[0.14em] mb-2">
                        Recursos Completos
                    </div>
                    <h2 className="text-3xl sm:text-4xl md:text-5xl font-black text-[#F3F4F6] tracking-tight mb-4">
                        Tudo o que você precisa para operar melhor.
                    </h2>
                    <p className="text-sm sm:text-base text-[#9CA3AF] max-w-2xl mx-auto leading-relaxed">
                        Ferramentas poderosas projetadas para traders ativos de futuros, forex e opções.
                    </p>
                </div>

                <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 relative z-10">
                    {/* Card 1: Performance Dashboard */}
                    <div className="bg-[#111319] border border-white/[0.08] hover:border-emerald-500/30 rounded-2xl p-6 transition-all duration-200 card-hover flex flex-col justify-between group">
                        <div>
                            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform">
                                <TrendingUp size={22} />
                            </div>
                            <h3 className="text-lg font-bold text-[#F3F4F6] mb-2">Performance Dashboard</h3>
                            <p className="text-sm text-[#9CA3AF] leading-relaxed">
                                P&L em tempo real, taxa de acerto (win rate), fator de lucro e índice Sharpe. Enxergue sua vantagem operacional num piscar de olhos.
                            </p>
                        </div>
                        <div className="mt-6 pt-4 border-t border-white/[0.06] flex items-center gap-2 text-xs text-emerald-400 font-mono">
                            <span>Tempo Real • Métricas Avançadas</span>
                        </div>
                    </div>

                    {/* Card 2: Trading Calendar */}
                    <div className="bg-[#111319] border border-white/[0.08] hover:border-emerald-500/30 rounded-2xl p-6 transition-all duration-200 card-hover flex flex-col justify-between group">
                        <div>
                            <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform">
                                <Calendar size={22} />
                            </div>
                            <h3 className="text-lg font-bold text-[#F3F4F6] mb-2">Trading Calendar</h3>
                            <p className="text-sm text-[#9CA3AF] leading-relaxed">
                                Visualizações por ano, mês e semana com dias de P&L codificados por cores intuitivas para rastrear seus ciclos de lucros e perdas.
                            </p>
                        </div>
                        <div className="mt-6 pt-4 border-t border-white/[0.06] flex items-center gap-2 text-xs text-blue-400 font-mono">
                            <span>Visão Anual, Mensal e Semanal</span>
                        </div>
                    </div>

                    {/* Card 3: Deep Analytics */}
                    <div className="bg-[#111319] border border-white/[0.08] hover:border-emerald-500/30 rounded-2xl p-6 transition-all duration-200 card-hover flex flex-col justify-between group">
                        <div>
                            <div className="w-12 h-12 rounded-xl bg-purple-500/10 border border-purple-500/20 text-[#A78BFA] flex items-center justify-center mb-5 group-hover:scale-110 transition-transform">
                                <BarChart3 size={22} />
                            </div>
                            <h3 className="text-lg font-bold text-[#F3F4F6] mb-2">Deep Analytics</h3>
                            <p className="text-sm text-[#9CA3AF] leading-relaxed">
                                Mais de 10 gráficos aprofundados: curva de capital, sequências, performance por horário, impacto emocional, múltiplos de R e mais.
                            </p>
                        </div>
                        <div className="mt-6 pt-4 border-t border-white/[0.06] flex items-center gap-2 text-xs text-[#A78BFA] font-mono">
                            <span>10+ Gráficos Quantitativos</span>
                        </div>
                    </div>

                    {/* Card 4: Options Spreads */}
                    <div className="bg-[#111319] border border-white/[0.08] hover:border-emerald-500/30 rounded-2xl p-6 transition-all duration-200 card-hover flex flex-col justify-between group">
                        <div>
                            <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform">
                                <Layers size={22} />
                            </div>
                            <h3 className="text-lg font-bold text-[#F3F4F6] mb-2">Options Spreads</h3>
                            <p className="text-sm text-[#9CA3AF] leading-relaxed">
                                Suporte completo a múltiplas pontas operacionais — travas verticais, condors, straddles, borboletas e estruturas personalizadas.
                            </p>
                        </div>
                        <div className="mt-6 pt-4 border-t border-white/[0.06] flex items-center gap-2 text-xs text-amber-400 font-mono">
                            <span>Multi-Leg • Opções & Derivativos</span>
                        </div>
                    </div>

                    {/* Card 5: Profit Simulator */}
                    <div className="bg-[#111319] border border-white/[0.08] hover:border-emerald-500/30 rounded-2xl p-6 transition-all duration-200 card-hover flex flex-col justify-between group">
                        <div>
                            <div className="w-12 h-12 rounded-xl bg-teal-500/10 border border-teal-500/20 text-teal-400 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform">
                                <Sliders size={22} />
                            </div>
                            <h3 className="text-lg font-bold text-[#F3F4F6] mb-2">Profit Simulator</h3>
                            <p className="text-sm text-[#9CA3AF] leading-relaxed">
                                Diagramas interativos de payoff de opções com visualização dinâmica de P&L através de controle deslizante (drag-slider).
                            </p>
                        </div>
                        <div className="mt-6 pt-4 border-t border-white/[0.06] flex items-center gap-2 text-xs text-teal-400 font-mono">
                            <span>Simulação Visual Interativa</span>
                        </div>
                    </div>

                    {/* Card 6: Position Sizer */}
                    <div className="bg-[#111319] border border-white/[0.08] hover:border-emerald-500/30 rounded-2xl p-6 transition-all duration-200 card-hover flex flex-col justify-between group">
                        <div>
                            <div className="w-12 h-12 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform">
                                <ShieldCheck size={22} />
                            </div>
                            <h3 className="text-lg font-bold text-[#F3F4F6] mb-2">Position Sizer</h3>
                            <p className="text-sm text-[#9CA3AF] leading-relaxed">
                                Calculadora de risco/retorno integrada para dimensionar o tamanho ideal de lotes e posições em qualquer ativo com rigor financeiro.
                            </p>
                        </div>
                        <div className="mt-6 pt-4 border-t border-white/[0.06] flex items-center gap-2 text-xs text-rose-400 font-mono">
                            <span>Gestão de Risco Precisa</span>
                        </div>
                    </div>
                </div>
            </section>

            {/* SECTION: CONSTRUÍDO PARA TRADERS SÉRIOS (COM FUNDO DE VELAS COMO NO HEADER) */}
            <section className="relative py-24 md:py-32 px-4 sm:px-6 lg:px-8 border-t border-white/[0.07] overflow-hidden flex flex-col items-center isolate z-10">
                {/* Candlestick Trading Operations Background */}
                <CandlestickHeroBackground opacity="opacity-70 sm:opacity-85" />

                <div className="max-w-5xl mx-auto relative z-20 text-center">
                    <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#111319] border border-emerald-500/30 text-emerald-400 text-xs font-semibold mb-6 shadow-xs backdrop-blur-md">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                        <span>Construído para traders sérios</span>
                    </div>

                    <h2 className="text-3xl sm:text-5xl lg:text-6xl font-black text-[#F3F4F6] tracking-tight leading-[1.15] mb-4">
                        Todas as funcionalidades que precisas <span className="text-emerald-400">em um único sítio.</span>
                    </h2>

                    <p className="text-base sm:text-xl font-bold text-emerald-400/90 mb-10 font-mono tracking-wide">
                        Começa agora grátis, sem cartão de crédito
                    </p>

                    {/* Grid of Checklist Features em Português */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 text-left mb-12">
                        {[
                            'Futuros, opções e spreads',
                            'Importação CSV de múltiplas corretoras',
                            'Simulador de lucros em opções',
                            'Calculadora de tamanho de posição',
                            'Relatórios de performance em PDF',
                            'Rastreamento de regras operacionais e playbook',
                            'Modelos de trades e templates operacionais',
                            'Perfil público de estatísticas',
                            'Filtragem avançada por estratégia',
                            'Detecção de operações duplicadas',
                            'Calendário econômico ao vivo',
                        ].map((feature, idx) => (
                            <div
                                key={idx}
                                className="flex items-center gap-3 p-3.5 rounded-xl bg-[#0E1017]/70 border border-white/[0.08] backdrop-blur-md hover:border-emerald-500/40 hover:bg-[#111319]/90 transition-all shadow-sm"
                            >
                                <div className="w-6 h-6 rounded-full bg-emerald-500/15 text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-500/30">
                                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                                </div>
                                <span className="text-xs sm:text-sm font-semibold text-[#F3F4F6]">{feature}</span>
                            </div>
                        ))}
                    </div>

                    {/* CTA Button */}
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                        <Link
                            to="/register"
                            className="px-8 py-3.5 bg-[#10B981] hover:bg-[#34D399] text-[#04110C] font-bold text-sm rounded-full transition-all duration-200 hover:shadow-[0_0_24px_rgba(16,185,129,0.35)] active:scale-95 shadow-md flex items-center gap-2"
                        >
                            <span>Começar Grátis Agora</span>
                            <ArrowRight size={16} strokeWidth={2.5} />
                        </Link>
                    </div>
                </div>
            </section>

            {/* SECTION 4: PRÊMIOS TOREX JOURNAL (3 MESES DE CONSISTÊNCIA) COM IMAGEM OFICIAL */}
            <section id="premiacoes" className="py-20 md:py-28 px-4 sm:px-6 lg:px-8 border-t border-white/[0.07] relative z-10 overflow-hidden">
                <div className="max-w-6xl mx-auto relative z-10">
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
                        {/* Left Column: Official Prize Image Provided by User */}
                        <div className="lg:col-span-6 relative">
                            <div className="relative rounded-2xl overflow-hidden border border-emerald-500/30 shadow-2xl bg-[#0E1017] group">
                                <img
                                    src={ASSETS.awardImage}
                                    alt="Kit de Premiações Torex Journal - Certificado, Notebook e Chaveiro"
                                    className="w-full h-auto object-cover group-hover:scale-102 transition-transform duration-500"
                                />
                                <div className="absolute bottom-3 left-3 right-3 p-3 rounded-xl bg-[#08090C]/90 backdrop-blur-md border border-white/[0.10] flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Award size={18} className="text-emerald-400" />
                                        <span className="text-xs font-bold text-[#F3F4F6]">Kit Consistência Torex</span>
                                    </div>
                                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 uppercase">
                                        Oficial
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Right Column: Descriptions & Eligibility */}
                        <div className="lg:col-span-6">
                            <div className="flex items-center justify-between gap-3 mb-2">
                                <div className="text-[10px] font-semibold text-emerald-400 uppercase tracking-[0.14em]">
                                    Reconhecimento Real
                                </div>
                                {/* Mascote em Miniatura Solicitado */}
                                <div className="flex items-center gap-2 bg-[#111319] border border-emerald-500/30 px-3 py-1 rounded-full shadow-sm">
                                    <img
                                        src={ASSETS.mascotRocket}
                                        alt="Mascote Torex Rocket Miniatura"
                                        className="w-7 h-7 object-contain drop-shadow-sm"
                                    />
                                    <span className="text-[11px] font-bold text-emerald-400 font-mono">Torex Pro</span>
                                </div>
                            </div>
                            <h2 className="text-3xl sm:text-4xl font-black text-[#F3F4F6] tracking-tight mb-4">
                                Prêmios Torex Journal
                            </h2>
                            <p className="text-sm sm:text-base text-[#9CA3AF] leading-relaxed mb-8">
                                Certificado, Notebook executivo e Chaveiro exclusivos entregues para traders que alcançam 3 meses consecutivos de consistência comprovada na plataforma.
                            </p>

                            <div className="space-y-4 mb-8">
                                <div className="flex items-start gap-3 p-3.5 rounded-xl bg-[#111319] border border-white/[0.08]">
                                    <div className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-400 font-mono font-bold text-xs flex items-center justify-center shrink-0">
                                        01
                                    </div>
                                    <div>
                                        <h4 className="text-sm font-bold text-[#F3F4F6]">Certificado de Consistência</h4>
                                        <p className="text-xs text-[#6B7280] mt-0.5">Certificado oficial personalizado com seu nome e código de validação institucional.</p>
                                    </div>
                                </div>

                                <div className="flex items-start gap-3 p-3.5 rounded-xl bg-[#111319] border border-white/[0.08]">
                                    <div className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-400 font-mono font-bold text-xs flex items-center justify-center shrink-0">
                                        02
                                    </div>
                                    <div>
                                        <h4 className="text-sm font-bold text-[#F3F4F6]">Notebook Torex</h4>
                                        <p className="text-xs text-[#6B7280] mt-0.5">Caderno premium de capa dura exclusivo para anotações de setups, rotinas e plano de trading.</p>
                                    </div>
                                </div>

                                <div className="flex items-start gap-3 p-3.5 rounded-xl bg-[#111319] border border-white/[0.08]">
                                    <div className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-400 font-mono font-bold text-xs flex items-center justify-center shrink-0">
                                        03
                                    </div>
                                    <div>
                                        <h4 className="text-sm font-bold text-[#F3F4F6]">Chaveiro Torex</h4>
                                        <p className="text-xs text-[#6B7280] mt-0.5">Chaveiro em metal com acabamento no verde esmeralda Torex para carregar sua identidade de trader.</p>
                                    </div>
                                </div>

                                <div className="flex items-start gap-3 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
                                    <div className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-400 font-mono font-bold text-xs flex items-center justify-center shrink-0">
                                        04
                                    </div>
                                    <div>
                                        <h4 className="text-sm font-bold text-emerald-300">3 Meses de Consistência</h4>
                                        <p className="text-xs text-emerald-400/80 mt-0.5">Requisito de disciplina com dados auditados na sua conta de trading para desbloquear o kit.</p>
                                    </div>
                                </div>
                            </div>

                            <Link
                                to="/register"
                                className="inline-flex items-center gap-2 px-7 py-3.5 bg-[#10B981] hover:bg-[#34D399] text-[#04110C] font-semibold text-sm rounded-full transition-all duration-200 hover:shadow-[0_0_24px_rgba(16,185,129,0.30)] active:scale-95 shadow-md"
                            >
                                <span>Quero minha premiação</span>
                                <ArrowRight size={16} strokeWidth={2.5} />
                            </Link>
                        </div>
                    </div>
                </div>
            </section>

            {/* SECTION 5: FOOTER INSTITUCIONAL */}
            <footer className="bg-[#0E1017] border-t border-white/[0.07] pt-16 pb-12 px-4 sm:px-6 lg:px-8 mt-auto relative z-10">
                <div className="max-w-7xl mx-auto">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-10 mb-12">
                        {/* Coluna Marca */}
                        <div className="md:col-span-2">
                            <div className="flex items-center gap-2.5 mb-4">
                                <img
                                    src={ASSETS.logo}
                                    alt="Logo"
                                    className="w-7 h-7 object-contain"
                                />
                                <span className="font-bold text-base text-[#F3F4F6]">
                                    TOREX <span className="text-emerald-400">JOURNAL</span>
                                </span>
                            </div>
                            <p className="text-sm text-[#6B7280] max-w-sm leading-relaxed mb-6">
                                Plataforma institucional de trading journal quantitativo, análise de performance e desenvolvimento de disciplina financeira para operadores do mercado financeiro.
                            </p>
                            <span className="text-xs text-[#6B7280] font-mono">
                                Design System: Obsidian Dark FinTech + Trading Terminal
                            </span>
                        </div>

                        {/* Coluna Navegação */}
                        <div>
                            <h4 className="text-xs font-bold text-[#F3F4F6] uppercase tracking-wider mb-4">Navegação</h4>
                            <ul className="space-y-2.5 text-xs text-[#9CA3AF]">
                                <li><a href="#plataforma" className="hover:text-emerald-400 transition-colors">Plataforma</a></li>
                                <li><a href="#recursos" className="hover:text-emerald-400 transition-colors">Recursos</a></li>
                                <li><a href="#premiacoes" className="hover:text-emerald-400 transition-colors">Premiações</a></li>
                                <li><Link to="/pricing" className="hover:text-emerald-400 transition-colors">Planos & Preços</Link></li>
                                <li><Link to="/login" className="hover:text-emerald-400 transition-colors">Acessar Conta</Link></li>
                            </ul>
                        </div>

                        {/* Coluna Legal */}
                        <div>
                            <h4 className="text-xs font-bold text-[#F3F4F6] uppercase tracking-wider mb-4">Compliance & Legal</h4>
                            <ul className="space-y-2.5 text-xs text-[#9CA3AF]">
                                <li><Link to="/privacy" className="hover:text-emerald-400 transition-colors">Política de Privacidade</Link></li>
                                <li><Link to="/terms" className="hover:text-emerald-400 transition-colors">Termos de Uso</Link></li>
                                <li><Link to="/risk-disclosure" className="hover:text-emerald-400 transition-colors">Aviso de Risco de Mercado</Link></li>
                                <li><Link to="/refund-policy" className="hover:text-emerald-400 transition-colors">Política de Reembolso</Link></li>
                            </ul>
                        </div>
                    </div>

                    <div className="pt-8 border-t border-white/[0.05] flex flex-col sm:flex-row justify-between items-center gap-4 text-xs text-[#6B7280]">
                        <p>© 2026 TOREX JOURNAL. Todos os direitos reservados.</p>
                        <p className="font-mono text-[11px]">Alta Performance • Consistência • Disciplina</p>
                    </div>
                </div>
            </footer>
        </div>
    );
};
