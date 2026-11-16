import type { LucideIcon } from 'lucide-react';
import { BarChart3, Calendar, FileText, Layers, ListFilter, ShieldCheck, Sliders, Smile, TrendingUp } from 'lucide-react';

/**
 * Landing page copy and assets for Portuguese (`/` and `/pt`) and English (`/en`).
 * Section components only handle presentation.
 */

export type LandingLocale = 'pt' | 'en';

const CDN = 'https://pub-354475384fd04c1e8c075e14e17ed14d.r2.dev';

export const LANDING_ASSETS = {
    dashboardMockup: `${CDN}/produtos/originals/1790959463602_0d9ff4122d063a3e_img-20260911-wa0012.jpg`,
    awardImage: `${CDN}/produtos/originals/1790960005698_9c1b15b912b83c8c_img-20260911-wa0018.jpg`,
    mascotRocket: 'https://res.cloudinary.com/dndlqdylc/image/upload/v1788819094/mascot-rocket-BkEtyIqW_ji8mlc.png',
} as const;

export interface NavLink {
    label: string;
    /** In-page anchor (`#id`) or app route (`/path`). */
    href: string;
    badge?: string;
}

export interface PreviewTab {
    id: string;
    label: string;
    icon: LucideIcon;
    image: string;
    alt: string;
    description: string;
}

/** Per-card accent. Kept as a closed set so Tailwind can see every class. */
export type FeatureTone = 'emerald' | 'blue' | 'violet' | 'amber' | 'teal' | 'rose';

export interface Feature {
    title: string;
    description: string;
    tag: string;
    icon: LucideIcon;
    tone: FeatureTone;
}

export interface LandingCopy {
    locale: LandingLocale;
    pageTitle: string;
    navbar: {
        ariaLabel: string;
        logoAriaLabel: string;
        homeHref: string;
        links: NavLink[];
        loginLabel: string;
        ctaDesktop: string;
        ctaMobile: string;
        openMenuAria: string;
        closeMenuAria: string;
        langSwitchAria: string;
    };
    hero: {
        eyebrow: string;
        title: string;
        titleAccent: string;
        description: string;
        primaryCta: string;
        secondaryCta: string;
        secondaryHref: string;
        mockupAlt: string;
    };
    chartLabels: {
        upperWick: string;
        lowerWick: string;
    };
    showcase: {
        sectionId: string;
        eyebrow: string;
        title: string;
        description: string;
        tablistAriaLabel: string;
        tabs: PreviewTab[];
    };
    featuresSection: {
        sectionId: string;
        eyebrow: string;
        title: string;
        description: string;
        items: Feature[];
    };
    checklist: {
        eyebrow: string;
        title: string;
        titleAccent: string;
        subtitle: string;
        ctaLabel: string;
        items: string[];
    };
    awards: {
        sectionId: string;
        eyebrow: string;
        title: string;
        description: string;
        imageAlt: string;
        imageCaption: string;
        officialBadge: string;
        ctaLabel: string;
        items: { title: string; description: string }[];
        requirement: { title: string; description: string };
    };
    footer: {
        tagline: string;
        columns: { title: string; links: NavLink[] }[];
        rightsReserved: string;
        motto: string;
    };
}

export const LANDING_CONTENT: Record<LandingLocale, LandingCopy> = {
    pt: {
        locale: 'pt',
        pageTitle: 'TOREX JOURNAL',
        navbar: {
            ariaLabel: 'Principal',
            logoAriaLabel: 'TOREX JOURNAL — página inicial',
            homeHref: '/',
            links: [
                { label: 'Plataforma', href: '#plataforma' },
                { label: 'Recursos', href: '#recursos' },
                { label: 'Premiações', href: '#premiacoes', badge: '3 meses' },
                { label: 'Planos', href: '/pricing' },
            ],
            loginLabel: 'Entrar',
            ctaDesktop: 'Começar agora',
            ctaMobile: 'Começar grátis',
            openMenuAria: 'Abrir menu',
            closeMenuAria: 'Fechar menu',
            langSwitchAria: 'Selecionar idioma',
        },
        hero: {
            eyebrow: 'Métricas que revelam a verdade do seu trading',
            title: 'Pare de operar no achismo.',
            titleAccent: 'Comece a operar com dados.',
            description:
                'Acompanhe as métricas que realmente importam para entender sua performance e evoluir com consistência. Mais dados. Mais clareza. Melhores decisões.',
            primaryCta: 'Começar agora',
            secondaryCta: 'Ver a plataforma',
            secondaryHref: '#plataforma',
            mockupAlt: 'Dashboard do Torex Journal com métricas de performance',
        },
        chartLabels: {
            upperWick: 'PAVIO SUPERIOR • WIN RATE 68.5%',
            lowerWick: 'PAVIO INFERIOR • PROFIT FACTOR 2.42',
        },
        showcase: {
            sectionId: 'plataforma',
            eyebrow: 'Plataforma interativa',
            title: 'Visualize cada dimensão do seu operacional',
            description: 'Alterne entre os módulos analíticos do Torex Journal para gerenciar suas operações com precisão.',
            tablistAriaLabel: 'Módulos da plataforma',
            tabs: [
                {
                    id: 'reports',
                    label: 'Relatórios',
                    icon: FileText,
                    image: `${CDN}/produtos/originals/1790960143809_ed412afba184c0fa_img-20260911-wa0022.jpg`,
                    alt: 'Relatório de performance do Torex Journal',
                    description: 'Métricas analíticas profundas, fatores de lucratividade e relatórios detalhados.',
                },
                {
                    id: 'trades',
                    label: 'Trades Logs',
                    icon: ListFilter,
                    image: `${CDN}/conteudo/originals/1791302679484_b21832ff3a42f0e8_trade_logs.PNG`,
                    alt: 'Logs de operações e histórico de trades do Torex Journal',
                    description: 'Histórico auditado de todas as ordens, setups, horários e P&L individual.',
                },
                {
                    id: 'calendar',
                    label: 'Diário',
                    icon: Calendar,
                    image: `${CDN}/produtos/originals/1791303086942_70508b69bef5e0f8_diario.png`,
                    alt: 'Diário de trading e calendário mensal do Torex Journal',
                    description: 'Visão de calendário por dias de lucro e perda com métricas de consistência contínua.',
                },
                {
                    id: 'emotions',
                    label: 'Emocional',
                    icon: Smile,
                    image: `${CDN}/produtos/originals/1791303054223_4d0b75a6535a7c5c_emocional.png`,
                    alt: 'Gestão emocional e psicologia de trading no Torex Journal',
                    description: 'Rastreamento de estado mental, disciplina operacional e controle comportamental.',
                },
            ],
        },
        featuresSection: {
            sectionId: 'recursos',
            eyebrow: 'Recursos completos',
            title: 'Tudo o que você precisa para operar melhor.',
            description: 'Ferramentas projetadas para traders ativos de futuros, forex e opções.',
            items: [
                {
                    title: 'Performance Dashboard',
                    description:
                        'P&L em tempo real, taxa de acerto (win rate), fator de lucro e índice Sharpe. Enxergue sua vantagem operacional num piscar de olhos.',
                    tag: 'Tempo real • Métricas avançadas',
                    icon: TrendingUp,
                    tone: 'emerald',
                },
                {
                    title: 'Trading Calendar',
                    description:
                        'Visualizações por ano, mês e semana com dias de P&L codificados por cores intuitivas para rastrear seus ciclos de lucros e perdas.',
                    tag: 'Visão anual, mensal e semanal',
                    icon: Calendar,
                    tone: 'blue',
                },
                {
                    title: 'Deep Analytics',
                    description:
                        'Mais de 10 gráficos aprofundados: curva de capital, sequências, performance por horário, impacto emocional, múltiplos de R e mais.',
                    tag: '10+ gráficos quantitativos',
                    icon: BarChart3,
                    tone: 'violet',
                },
                {
                    title: 'Options Spreads',
                    description:
                        'Suporte completo a múltiplas pontas operacionais — travas verticais, condors, straddles, borboletas e estruturas personalizadas.',
                    tag: 'Multi-leg • Opções & derivativos',
                    icon: Layers,
                    tone: 'amber',
                },
                {
                    title: 'Profit Simulator',
                    description: 'Diagramas interativos de payoff de opções com visualização dinâmica de P&L através de controle deslizante.',
                    tag: 'Simulação visual interativa',
                    icon: Sliders,
                    tone: 'teal',
                },
                {
                    title: 'Position Sizer',
                    description:
                        'Calculadora de risco/retorno integrada para dimensionar o tamanho ideal de lotes e posições em qualquer ativo com rigor financeiro.',
                    tag: 'Gestão de risco precisa',
                    icon: ShieldCheck,
                    tone: 'rose',
                },
            ],
        },
        checklist: {
            eyebrow: 'Construído para traders sérios',
            title: 'Todas as funcionalidades que precisas',
            titleAccent: 'em um único sítio.',
            subtitle: 'Começa agora grátis, sem cartão de crédito',
            ctaLabel: 'Começar grátis agora',
            items: [
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
            ],
        },
        awards: {
            sectionId: 'premiacoes',
            eyebrow: 'Reconhecimento real',
            title: 'Prêmios Torex Journal',
            description:
                'Certificado, Notebook executivo e Chaveiro exclusivos entregues para traders que alcançam 3 meses consecutivos de consistência comprovada na plataforma.',
            imageAlt: 'Kit de premiações Torex Journal: certificado, notebook e chaveiro',
            imageCaption: 'Kit Consistência Torex',
            officialBadge: 'Oficial',
            ctaLabel: 'Quero minha premiação',
            items: [
                { title: 'Certificado de Consistência', description: 'Certificado oficial personalizado com seu nome e código de validação institucional.' },
                { title: 'Notebook Torex', description: 'Caderno premium de capa dura exclusivo para anotações de setups, rotinas e plano de trading.' },
                { title: 'Chaveiro Torex', description: 'Chaveiro em metal com acabamento no verde esmeralda Torex para carregar sua identidade de trader.' },
            ],
            requirement: {
                title: '3 Meses de Consistência',
                description: 'Requisito de disciplina com dados auditados na sua conta de trading para desbloquear o kit.',
            },
        },
        footer: {
            tagline:
                'Plataforma de trading journal quantitativo, análise de performance e desenvolvimento de disciplina financeira para operadores do mercado financeiro.',
            columns: [
                {
                    title: 'Navegação',
                    links: [
                        { label: 'Plataforma', href: '#plataforma' },
                        { label: 'Recursos', href: '#recursos' },
                        { label: 'Premiações', href: '#premiacoes' },
                        { label: 'Planos & Preços', href: '/pricing' },
                        { label: 'Acessar conta', href: '/login' },
                    ],
                },
                {
                    title: 'Compliance & Legal',
                    links: [
                        { label: 'Política de Privacidade', href: '/privacy' },
                        { label: 'Política de Cookies', href: '/cookies' },
                        { label: 'Termos de Uso', href: '/terms' },
                        { label: 'Aviso de Risco de Mercado', href: '/risk-disclosure' },
                        { label: 'Política de Reembolso', href: '/refund-policy' },
                    ],
                },
            ],
            rightsReserved: 'Todos os direitos reservados.',
            motto: 'Alta Performance • Consistência • Disciplina',
        },
    },

    en: {
        locale: 'en',
        pageTitle: 'TOREX JOURNAL — AI-Powered Trading Journal',
        navbar: {
            ariaLabel: 'Main navigation',
            logoAriaLabel: 'TOREX JOURNAL — Home',
            homeHref: '/',
            links: [
                { label: 'Platform', href: '#platform' },
                { label: 'Features', href: '#features' },
                { label: 'Awards', href: '#awards', badge: '3 months' },
                { label: 'Pricing', href: '/pricing' },
            ],
            loginLabel: 'Sign in',
            ctaDesktop: 'Get started',
            ctaMobile: 'Start for free',
            openMenuAria: 'Open menu',
            closeMenuAria: 'Close menu',
            langSwitchAria: 'Select language',
        },
        hero: {
            eyebrow: 'AI-powered trading intelligence',
            title: 'Stop Journaling in the Dark.',
            titleAccent: 'Let AI Decode Your Trades.',
            description:
                'Torex Journal goes beyond basic tracking—analyzing your setup, timing, and psychology to turn data into consistent profits.',
            primaryCta: 'Start for free',
            secondaryCta: 'Explore the platform',
            secondaryHref: '#platform',
            mockupAlt: 'Torex Journal dashboard displaying trading performance analytics',
        },
        chartLabels: {
            upperWick: 'UPPER WICK • WIN RATE 68.5%',
            lowerWick: 'LOWER WICK • PROFIT FACTOR 2.42',
        },
        showcase: {
            sectionId: 'platform',
            eyebrow: 'Interactive platform',
            title: 'Visualize every dimension of your trading',
            description: 'Switch between Torex Journal’s analytical modules to audit and refine your execution with precision.',
            tablistAriaLabel: 'Platform modules',
            tabs: [
                {
                    id: 'reports',
                    label: 'Reports',
                    icon: FileText,
                    image: `${CDN}/produtos/originals/1790960143809_ed412afba184c0fa_img-20260911-wa0022.jpg`,
                    alt: 'Torex Journal performance analytics report',
                    description: 'Deep analytical metrics, profitability factors, and institutional-grade performance breakdowns.',
                },
                {
                    id: 'trades',
                    label: 'Trade Logs',
                    icon: ListFilter,
                    image: `${CDN}/conteudo/originals/1791302679484_b21832ff3a42f0e8_trade_logs.PNG`,
                    alt: 'Torex Journal audited trade logs and execution history',
                    description: 'Audited execution log of every order, setup, market session, and individual trade P&L.',
                },
                {
                    id: 'calendar',
                    label: 'Journal',
                    icon: Calendar,
                    image: `${CDN}/produtos/originals/1791303086942_70508b69bef5e0f8_diario.png`,
                    alt: 'Torex Journal monthly trading calendar and daily log',
                    description: 'Color-coded calendar view of winning and losing days with continuous consistency metrics.',
                },
                {
                    id: 'emotions',
                    label: 'Psychology',
                    icon: Smile,
                    image: `${CDN}/produtos/originals/1791303054223_4d0b75a6535a7c5c_emocional.png`,
                    alt: 'Trading psychology and mindset tracking in Torex Journal',
                    description: 'Mental state tracking, execution discipline scoring, and behavioral pattern recognition.',
                },
            ],
        },
        featuresSection: {
            sectionId: 'features',
            eyebrow: 'Complete toolkit',
            title: 'Everything you need to trade smarter.',
            description: 'Purpose-built analytics and risk tools for active futures, forex, and options traders.',
            items: [
                {
                    title: 'Performance Dashboard',
                    description:
                        'Real-time P&L, win rate, profit factor, and Sharpe ratio. Spot your true statistical edge at a glance.',
                    tag: 'Real-time • Advanced metrics',
                    icon: TrendingUp,
                    tone: 'emerald',
                },
                {
                    title: 'Trading Calendar',
                    description:
                        'Yearly, monthly, and weekly views with intuitive color-coded P&L days to track winning and losing cycles.',
                    tag: 'Yearly, monthly & weekly views',
                    icon: Calendar,
                    tone: 'blue',
                },
                {
                    title: 'Deep Analytics',
                    description:
                        '10+ quantitative charts: equity curve, streaks, hourly & session performance, psychology impact, R-multiples, and more.',
                    tag: '10+ quantitative charts',
                    icon: BarChart3,
                    tone: 'violet',
                },
                {
                    title: 'Options Spreads',
                    description:
                        'Full multi-leg execution support — vertical spreads, iron condors, straddles, butterflies, and custom structures.',
                    tag: 'Multi-leg • Options & derivatives',
                    icon: Layers,
                    tone: 'amber',
                },
                {
                    title: 'Profit Simulator',
                    description: 'Interactive options payoff diagrams with dynamic P&L slider visualization across price scenarios.',
                    tag: 'Interactive visual simulation',
                    icon: Sliders,
                    tone: 'teal',
                },
                {
                    title: 'Position Sizer',
                    description:
                        'Built-in risk/reward calculator to size lots and positions accurately across any instrument with strict discipline.',
                    tag: 'Precision risk management',
                    icon: ShieldCheck,
                    tone: 'rose',
                },
            ],
        },
        checklist: {
            eyebrow: 'Built for serious traders',
            title: 'Every feature you need',
            titleAccent: 'in one unified workspace.',
            subtitle: 'Start free today — no credit card required',
            ctaLabel: 'Start for free now',
            items: [
                'Futures, options, and spreads',
                'Multi-broker CSV import',
                'Options profit simulator',
                'Position size calculator',
                'PDF performance reports',
                'Trading rules & playbook tracking',
                'Trade templates & execution checklists',
                'Public verified stats profile',
                'Advanced filtering by strategy',
                'Duplicate trade detection',
                'Live economic calendar',
            ],
        },
        awards: {
            sectionId: 'awards',
            eyebrow: 'Real recognition',
            title: 'Torex Journal Awards',
            description:
                'An exclusive Certificate, Executive Notebook, and Metal Keychain shipped to traders who achieve 3 consecutive months of verified consistency on the platform.',
            imageAlt: 'Torex Journal awards kit: certificate, executive notebook, and keychain',
            imageCaption: 'Torex Consistency Kit',
            officialBadge: 'Official',
            ctaLabel: 'Claim my award',
            items: [
                { title: 'Certificate of Consistency', description: 'Official personalized certificate featuring your name and institutional verification code.' },
                { title: 'Torex Notebook', description: 'Exclusive hardcover executive notebook built for logging setups, routines, and your trading plan.' },
                { title: 'Torex Keychain', description: 'Signature emerald-finish metal keychain crafted to carry your disciplined trader identity.' },
            ],
            requirement: {
                title: '3 Months of Consistency',
                description: 'Audited discipline milestone on your trading account required to unlock the awards kit.',
            },
        },
        footer: {
            tagline:
                'Quantitative trading journal, AI-powered performance analytics, and financial discipline platform built for market operators.',
            columns: [
                {
                    title: 'Navigation',
                    links: [
                        { label: 'Platform', href: '#platform' },
                        { label: 'Features', href: '#features' },
                        { label: 'Awards', href: '#awards' },
                        { label: 'Plans & Pricing', href: '/pricing' },
                        { label: 'Sign in', href: '/login' },
                    ],
                },
                {
                    title: 'Compliance & Legal',
                    links: [
                        { label: 'Privacy Policy', href: '/privacy' },
                        { label: 'Terms of Service', href: '/terms' },
                        { label: 'Market Risk Disclosure', href: '/risk-disclosure' },
                        { label: 'Refund Policy', href: '/refund-policy' },
                    ],
                },
            ],
            rightsReserved: 'All rights reserved.',
            motto: 'High Performance • Consistency • Discipline',
        },
    },
};

export const getLandingContent = (locale: LandingLocale = 'pt'): LandingCopy => LANDING_CONTENT[locale];

// Default Portuguese exports preserved for backward compatibility
export const NAV_LINKS = LANDING_CONTENT.pt.navbar.links;
export const HERO = LANDING_CONTENT.pt.hero;
export const PREVIEW_TABS = LANDING_CONTENT.pt.showcase.tabs;
export const FEATURES = LANDING_CONTENT.pt.featuresSection.items;
export const CHECKLIST = LANDING_CONTENT.pt.checklist;
export const AWARDS = LANDING_CONTENT.pt.awards;
export const FOOTER = LANDING_CONTENT.pt.footer;
