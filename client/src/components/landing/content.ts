import type { LucideIcon } from 'lucide-react';
import { BarChart3, Calendar, FileText, Layers, ListFilter, ShieldCheck, Sliders, Smile, TrendingUp } from 'lucide-react';

/**
 * Landing page copy and assets. Edit content here; section components only
 * handle presentation.
 */

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

export const NAV_LINKS: NavLink[] = [
    { label: 'Plataforma', href: '#plataforma' },
    { label: 'Recursos', href: '#recursos' },
    { label: 'Premiações', href: '#premiacoes', badge: '3 meses' },
    { label: 'Planos', href: '/pricing' },
];

export const HERO = {
    eyebrow: 'Métricas que revelam a verdade do seu trading',
    title: 'Pare de operar no achismo.',
    titleAccent: 'Comece a operar com dados.',
    description:
        'Acompanhe as métricas que realmente importam para entender sua performance e evoluir com consistência. Mais dados. Mais clareza. Melhores decisões.',
};

export interface PreviewTab {
    id: string;
    label: string;
    icon: LucideIcon;
    image: string;
    alt: string;
    description: string;
}

export const PREVIEW_TABS: PreviewTab[] = [
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
];

/** Per-card accent. Kept as a closed set so Tailwind can see every class. */
export type FeatureTone = 'emerald' | 'blue' | 'violet' | 'amber' | 'teal' | 'rose';

export interface Feature {
    title: string;
    description: string;
    tag: string;
    icon: LucideIcon;
    tone: FeatureTone;
}

export const FEATURES: Feature[] = [
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
];

export const CHECKLIST = {
    eyebrow: 'Construído para traders sérios',
    title: 'Todas as funcionalidades que precisas',
    titleAccent: 'em um único sítio.',
    subtitle: 'Começa agora grátis, sem cartão de crédito',
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
};

export const AWARDS = {
    eyebrow: 'Reconhecimento real',
    title: 'Prêmios Torex Journal',
    description:
        'Certificado, Notebook executivo e Chaveiro exclusivos entregues para traders que alcançam 3 meses consecutivos de consistência comprovada na plataforma.',
    imageAlt: 'Kit de premiações Torex Journal: certificado, notebook e chaveiro',
    imageCaption: 'Kit Consistência Torex',
    items: [
        { title: 'Certificado de Consistência', description: 'Certificado oficial personalizado com seu nome e código de validação institucional.' },
        { title: 'Notebook Torex', description: 'Caderno premium de capa dura exclusivo para anotações de setups, rotinas e plano de trading.' },
        { title: 'Chaveiro Torex', description: 'Chaveiro em metal com acabamento no verde esmeralda Torex para carregar sua identidade de trader.' },
    ],
    requirement: {
        title: '3 Meses de Consistência',
        description: 'Requisito de disciplina com dados auditados na sua conta de trading para desbloquear o kit.',
    },
};

export const FOOTER = {
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
                { label: 'Termos de Uso', href: '/terms' },
                { label: 'Aviso de Risco de Mercado', href: '/risk-disclosure' },
                { label: 'Política de Reembolso', href: '/refund-policy' },
            ],
        },
    ] satisfies { title: string; links: NavLink[] }[],
};
