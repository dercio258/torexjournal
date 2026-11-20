import type { LucideIcon } from 'lucide-react';
import { BarChart3, Bot, Compass, CreditCard, Layers, PlayCircle, Sparkles } from 'lucide-react';

export interface ProductFeaturedItem {
    title: string;
    description: string;
    href: string;
    icon: LucideIcon;
}

export interface ProductQuickLink {
    label: string;
    href: string;
    icon: LucideIcon;
    badge?: string;
}

export interface EnNavItem {
    label: string;
    href?: string;
    hasProductDropdown?: boolean;
}

export interface EnPillarCardCopy {
    id: 'torex-ai' | 'training' | 'journal';
    badge: string;
    headlineLine1: string;
    headlineLine2: string;
    href: string;
}

export const EN_NAVBAR = {
    logoAriaLabel: 'TOREX JOURNAL — Home',
    homeHref: '/en',
    items: [
        { label: 'Product', hasProductDropdown: true },
        { label: 'Suite', href: '#trading-suite' },
        { label: 'Why Torex', href: '#torex-advantage' },
        { label: 'Support', href: '#footer-support' },
    ] satisfies EnNavItem[],
    productDropdown: {
        featuredTitle: 'Core Capabilities',
        featured: [
            {
                title: 'Analytics',
                description: 'Discover your trading edge with Torex Journal',
                href: '#ai-decode',
                icon: BarChart3,
            },
            {
                title: 'Market Replay Simulator',
                description: 'Master trading strategies with realistic simulator',
                href: '#ai-backtesting',
                icon: PlayCircle,
            },
            {
                title: 'AI Performance Assistant',
                description: 'Boost your trading with your AI assistant',
                href: '#torex-ai-agents',
                icon: Bot,
            },
        ] satisfies ProductFeaturedItem[],
        linksTitle: 'Explore',
        links: [
            { label: 'Start Free', href: '/register', icon: CreditCard },
            { label: 'Supported Brokers', href: '#supported-brokers', icon: Layers },
            { label: 'AI Agents', href: '#torex-ai-agents', icon: Sparkles, badge: 'New' },
        ] satisfies ProductQuickLink[],
    },
    ctaLabel: 'GET STARTED',
    ctaHref: '/register',
    loginLabel: 'Sign In',
    loginHref: '/login',
    openMenuAria: 'Open navigation menu',
    closeMenuAria: 'Close navigation menu',
} as const;

export const EN_HERO = {
    headlineLine1: 'MASTER YOUR TRADING.',
    headlineLine2: 'COMMAND YOUR EDGE.',
    subheadline:
        'Torex Journal transforms trading data into actionable intelligence, uncovering the patterns, decisions, and psychology that define your performance.',
    ctaLabel: 'Start Trading Smarter',
    ctaHref: '/register',
    exploreIcon: Compass,
} as const;

export const EN_INTEGRATIONS = {
    badge: 'INTEGRATIONS',
    statHighlight: '80+',
    headline: 'Trading Platform Integrations',
    ctaLabel: 'Connect Account',
    ctaHref: '/add-trades',
} as const;

export const EN_AI_DECODE = {
    badge: 'AI TRADE INTELLIGENCE',
    headlineLine1: 'Stop journaling in the dark.',
    headlineLine2: 'Let AI decode your trades.',
    subheadline:
        'Automatically sync your trades, uncover hidden behavioral leaks, and let AI show you exactly what makes you profitable.',
    ctaLabel: 'Get Started',
    ctaHref: '/register',
    userInitials: 'DM',
    userPrompt: 'How are my current trades and profits performing?',
    aiProfitValue: '+$22,642.60',
    aiProfitBadge: '68.4% Win Rate · 2.34 PF',
    aiTechnicalSummary:
        'Your London Liquidity Sweeps and NY Opening Breakouts drive 118% of net profit (+2.46R avg) — while off-plan entries after 16:00 UTC leaked -$3,410. Cut late-session impulse trades to lock in peak expectancy.',
} as const;

export interface EnSuiteTabItem {
    id: 'analytics' | 'backtesting' | 'journal';
    label: string;
    shortTag: string;
    description: string;
    imageSrc: string;
    imageAlt: string;
    ctaLabel: string;
    ctaHref: string;
}

export const EN_ALL_IN_ONE_SUITE = {
    eyebrow: 'ALL-IN-ONE TRADING SUITE',
    headline: 'Built for your entire trading workflow.',
    subheadline:
        'From pre-market prep to post-trade AI review — every tool you need to refine your strategy lives in a single workspace.',
    tabs: [
        {
            id: 'analytics',
            label: 'Analytics Dashboard',
            shortTag: 'Metrics & Edge Score',
            description:
                'Track Net P&L, Win Rate, Profit Factor, cumulative equity, and your 5-axis Torex Edge Score in real time.',
            imageSrc: '/suite/suite-analytics.png',
            imageAlt: 'Torex Journal Analytics Dashboard showing Net P&L, Win Rate, Profit Factor, and Edge Score',
            ctaLabel: 'Explore Analytics',
            ctaHref: '/register',
        },
        {
            id: 'backtesting',
            label: 'Backtesting & Replay',
            shortTag: 'Candle-by-Candle Sim',
            description:
                'Replay historical sessions on XAU/USD and FX pairs with multi-timeframe execution, speed controls, and realistic order fills.',
            imageSrc: '/suite/suite-backtest.png',
            imageAlt: 'Torex Journal Backtesting and Market Replay workspace on XAU/USD 15m chart',
            ctaLabel: 'Launch Simulator',
            ctaHref: '/register',
        },
        {
            id: 'journal',
            label: 'Trading Journal',
            shortTag: 'Plans & Chart Review',
            description:
                'Document pre-market bias, emotional state, structured setup rules, and side-by-side Before & After chart markups.',
            imageSrc: '/suite/suite-journal.png',
            imageAlt: 'Torex Journal Daily Notes and Technical Trade Plan with Before and After comparison',
            ctaLabel: 'Open Journal',
            ctaHref: '/register',
        },
    ] satisfies readonly EnSuiteTabItem[],
} as const;

export const EN_AI_BACKTESTING_SCROLL = {
    eyebrow: 'AI-POWERED BACKTESTING',
    headline: 'Transform Historical Data Into Trading Intelligence.',
    subheadline:
        'Test your trading strategies against historical market conditions with AI-powered backtesting. Replay market movements, evaluate entry and exit decisions, identify recurring patterns, and uncover strategic weaknesses with intelligent analysis designed to help you trade with greater precision.',
    scrollHint: 'Scroll to reveal simulator',
    windowTitle: 'AI Backtesting & Market Replay · Live Multi-Chart',
    imageSrc: '/backtesting-showcase.gif',
    imageAlt: 'Torex Journal AI-Powered Backtesting dual chart replay and order simulator',
    ctaLabel: 'Start Backtesting',
    ctaHref: '/register',
} as const;

export const EN_TOREX_AI_AGENTS = {
    messenger: {
        eyebrow: 'TOREX AI MESSENGER',
        headline: 'Get answers from your own data.',
        subheadline:
            'Grounded in 1,248+ synced MT5, Deriv & Prop Firm trades — zero generic guesswork.',
        coachTitle: 'TOREX AI',
        coachSubtitle: 'Personal Coach',
        liveSyncLabel: 'Live Sync',
        composerPlaceholder: 'Ask Torex AI anything about your trading...',
        micTooltip: 'Voice dictation active inside Torex App',
        userInitials: 'TR',
        stage1Label: 'Querying 1,248 executions...',
        stage2Label: 'Synthesizing Edge Coach...',
    },
    patterns: {
        eyebrow: 'PATTERN DETECTION',
        headline: "See patterns you can't see.",
        subheadline: 'Hidden leaks & edges surfaced automatically from live executions.',
        syncedMicroLabel: 'Active in chat',
        footerTelemetry: '1,248 executions · Synced 2s ago',
        ctaLabel: 'Uncover your leaks',
        ctaHref: '/register?intent=pattern-detection',
    },
    agents: {
        eyebrow: 'AUTONOMOUS TRADING AGENTS',
        headlineLine1: 'Build a team of agents',
        headlineGradient: 'that work for you.',
        subheadline:
            '3 always-on AI specialists monitoring your MT5, Deriv & Journal stream in real time.',
        countdownInitialLabel: '15:00 cooldown running...',
    },
    conversionStrip: {
        badge: 'READY IN 60 SECONDS · NO CREDIT CARD REQUIRED',
        headline: 'Deploy Torex AI & your 3 Guardian Agents on your real trade history.',
        proofBullets: [
            'MT5 & Deriv Auto-Sync',
            'Prop Firm DD Guardrails',
            '1,200+ Trades Analyzed Instantly',
        ],
        primaryCtaLabel: 'Start Free with Torex AI',
        primaryCtaHref: '/register?intent=torex-ai-agents',
        secondaryCtaLabel: 'Compare Plans',
        secondaryCtaHref: '/pricing',
    },
} as const;

export const EN_TOREX_ADVANTAGE = {
    eyebrow: 'INSTITUTIONAL ARCHITECTURE',
    headlineLine1: 'Why Serious Traders',
    headlineGradient: 'Choose Torex Journal.',
    subheadline:
        'Precision telemetry, realistic market replay, and AI behavioral guardrails — engineered into one uncluttered workspace.',
    trustStrip: {
        label: '7-Day Full Workspace Access · MT5 & Deriv Ready',
        linkLabel: 'View Plans',
        linkHref: '/pricing',
    },
    cta: {
        label: 'Start Free Workspace',
        href: '/register',
    },
    pillars: [
        {
            iconKey: 'replay',
            title: 'Realistic Market Replay',
            description:
                'Practice setups candle-by-candle on historical XAU/USD and FX sessions.',
        },
        {
            iconKey: 'edge-radar',
            title: '5-Axis Edge Analytics',
            description:
                'Measure Profit Factor, expectancy, and discipline through one calibrated score.',
        },
        {
            iconKey: 'behavioral-guard',
            title: 'AI Leak Detection',
            description:
                'Spot revenge entries, late-session overtrading, and emotional drift before losses compound.',
        },
        {
            iconKey: 'zero-latency-ui',
            title: 'Clutter-Free Workspace',
            description:
                'An obsidian interface built for fast execution reviews with zero visual noise.',
        },
        {
            iconKey: 'mfe-mae-journal',
            title: 'Precision Trade Journaling',
            description:
                'Log pre-market bias, MFE/MAE metrics, and Before & After chart markups.',
        },
        {
            iconKey: 'autonomous-agent',
            title: 'Autonomous Risk Agents',
            description:
                'Enforce daily drawdown caps, lot limits, and tilt cool-downs automatically.',
        },
        {
            iconKey: 'broker-mesh',
            title: '80+ Broker & Prop Sync',
            description:
                'Connect MetaTrader 5, Deriv, or major Prop Firms with automated sync.',
        },
        {
            iconKey: 'audit-integrity',
            title: 'Audit-Grade Equity Data',
            description:
                'Net P&L reconciled accurately across commissions, swaps, and multi-account portfolios.',
        },
        {
            iconKey: 'unified-suite',
            title: 'One Unified Ecosystem',
            description:
                'Journal, backtesting, AI coaching, and analytics unified under a single subscription.',
        },
        {
            iconKey: 'trader-concierge',
            title: 'Responsive Trader Support',
            description:
                'Fast technical onboarding, real-time email & web push insights, and direct access to our support team.',
        },
    ],
} as const;

export const EN_CORE_PILLARS: readonly EnPillarCardCopy[] = [
    {
        id: 'torex-ai',
        badge: 'TOREX AI',
        headlineLine1: 'Meet Torex AI.',
        headlineLine2: 'Your Trading Intelligence Coach.',
        href: '/register',
    },
    {
        id: 'training',
        badge: 'TRAINING',
        headlineLine1: 'Validate Strategies.',
        headlineLine2: 'Realistic Market Replay.',
        href: '/register',
    },
    {
        id: 'journal',
        badge: 'JOURNAL',
        headlineLine1: 'Precision Journaling.',
        headlineLine2: 'Consistent Decisions.',
        href: '/register',
    },
] as const;

export interface EnFooterLink {
    label: string;
    href: string;
    external?: boolean;
}

export interface EnFooterColumn {
    id?: string;
    title: string;
    links: readonly EnFooterLink[];
}

export const EN_FOOTER = {
    homeHref: '/en',
    logoAriaLabel: 'TOREX JOURNAL — Home',
    tagline:
        'Transform raw execution data into disciplined trading edge. Automated journaling, realistic replay, and autonomous AI guardrails.',
    statusBadge: 'Systems Operational · MT5 & Deriv Sync',
    columns: [
        {
            title: 'Product',
            links: [
                { label: 'Core Modules', href: '#core-pillars' },
                { label: 'AI Trade Intelligence', href: '#ai-decode' },
                { label: 'All-in-One Suite', href: '#trading-suite' },
                { label: 'AI Backtesting', href: '#ai-backtesting' },
                { label: 'Torex AI Agents', href: '#torex-ai-agents' },
            ],
        },
        {
            title: 'Platform',
            links: [
                { label: '80+ Broker Sync', href: '#supported-brokers' },
                { label: 'Why Torex Journal', href: '#torex-advantage' },
                { label: 'Start Free Workspace', href: '/register' },
                { label: 'Sign In', href: '/login' },
            ],
        },
        {
            id: 'footer-support',
            title: 'Support',
            links: [
                {
                    label: 'Email Support',
                    href: 'mailto:info@torexjournal.com',
                    external: true,
                },
                { label: 'Broker Setup Guide', href: '/add-trades' },
            ],
        },
        {
            title: 'Legal Info',
            links: [
                { label: 'Legal Hub', href: '/legal' },
                { label: 'Terms of Service', href: '/terms' },
                { label: 'Privacy Policy', href: '/privacy' },
                { label: 'Cookie Policy', href: '/cookies' },
                { label: 'Risk Disclosure', href: '/risk-disclosure' },
                { label: 'Refund Policy', href: '/refund-policy' },
            ],
        },
    ] satisfies readonly EnFooterColumn[],
    rightsReserved: 'All rights reserved.',
    motto: 'Discipline. Precision. Edge.',
} as const;
