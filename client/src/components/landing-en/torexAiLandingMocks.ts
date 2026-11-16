import type { ClientAiActionLink, ClientAiMetricCard } from '../ai/torexAiFallback';

export type MockScenarioId = 'revenge-leak' | 'best-edge' | 'prop-firm' | 'plan-audit';
export type PatternSignalId = 'time-of-day' | 'behavior' | 'edge' | 'streak';
export type AgentCardId = 'habit' | 'risk' | 'sentiment';

export interface MockChatTurn {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
    metrics?: ClientAiMetricCard[];
    actionLinks?: ClientAiActionLink[];
    suggestions?: string[];
    groundingMeta?: {
        modelLabel: string;
        tradesScanned: number;
        accountLabel: string;
    };
}

export interface MockConversationScenario {
    id: MockScenarioId;
    tabLabel: string;
    shortBadge: string;
    linkedSignalId: PatternSignalId;
    accountPill: string;
    creditsPill: string;
    initialTurns: MockChatTurn[];
}

export interface PatternSignalItem {
    id: PatternSignalId;
    category: 'TIME-OF-DAY' | 'BEHAVIOR' | 'EDGE' | 'STREAK';
    accentTone: 'blue' | 'violet' | 'amber' | 'emerald';
    headline: string;
    deltaPill: string;
    signalTag: string;
    signalBars: 2 | 3;
    linkedScenarioId: MockScenarioId;
}

export interface AutonomousAgentMock {
    id: AgentCardId;
    badge: string;
    name: string;
    shortRole: string;
    accentTone: 'sky' | 'blue' | 'violet';
    signalAlert: string;
    idleChip: string;
    armedChip: string;
    metricLabel: string;
    metricValue: string;
    actionTriggerLabel: string;
    confirmedShortNote: string;
    confirmedStatusLabel: string;
    defaultStatusLabel: string;
    signalStrength: number;
    hasCountdown?: boolean;
}

export const MOCK_SCENARIOS: Record<MockScenarioId, MockConversationScenario> = {
    'revenge-leak': {
        id: 'revenge-leak',
        tabLabel: 'Revenge Leak',
        shortBadge: '-$6,420',
        linkedSignalId: 'behavior',
        accountPill: 'FTMO 100K · MT5 · 1,248',
        creditsPill: 'Unlimited · Pro',
        initialTurns: [
            {
                id: 'rl-u1',
                role: 'user',
                timestamp: '14:32 EST',
                content: 'Where am I losing money right now?',
            },
            {
                id: 'rl-a1',
                role: 'assistant',
                timestamp: '14:32 EST',
                content:
                    '**23 re-entries** under 2 min post-loss cost **-$6,420** (**73% red**). Meanwhile, `London Sweep` & `NY Breakout` on `XAU/USD` hold a **62% win rate**.',
                metrics: [
                    {
                        label: 'Revenge Cost',
                        value: '-$6,420',
                        tone: 'negative',
                        subtext: '23 trades < 2m',
                    },
                    {
                        label: 'A-Setup Win Rate',
                        value: '62%',
                        tone: 'positive',
                        subtext: 'XAU/USD · NAS100',
                    },
                ],
                actionLinks: [
                    { label: 'Audit Losing Streak', route: '/register?intent=revenge-audit' },
                    { label: 'Lock 15m Cooldown', route: '/register?intent=cooldown-guardrail' },
                ],
                suggestions: [
                    'Which pair drives the revenge loss?',
                    'Show P&L without re-entries',
                ],
                groundingMeta: {
                    modelLabel: 'Torex Edge Coach · MT5',
                    tradesScanned: 1248,
                    accountLabel: 'FTMO 100K',
                },
            },
        ],
    },
    'best-edge': {
        id: 'best-edge',
        tabLabel: 'Best Edge',
        shortBadge: '+$22.6K',
        linkedSignalId: 'edge',
        accountPill: 'FTMO 100K · MT5 · 1,248',
        creditsPill: 'Unlimited · Pro',
        initialTurns: [
            {
                id: 'be-u1',
                role: 'user',
                timestamp: '09:48 EST',
                content: 'Where is my sharpest edge right now?',
            },
            {
                id: 'be-a1',
                role: 'assistant',
                timestamp: '09:48 EST',
                content:
                    '`XAU/USD` London Open (`03:00–05:15 EST`) drives **+$22,642.60** net at **2.41 PF** (**+2.46R** avg). Cutting afternoon `EUR/USD` scalps recovers **+$4,810**.',
                metrics: [
                    {
                        label: 'Net Profit',
                        value: '+$22,642.60',
                        tone: 'positive',
                        subtext: '2.41 Profit Factor',
                    },
                    {
                        label: 'Edge Score',
                        value: '89 / 100',
                        tone: 'positive',
                        subtext: '+2.46R Expectancy',
                    },
                ],
                actionLinks: [
                    { label: 'Inspect XAU Playbook', route: '/register?intent=edge-playbook' },
                    { label: 'Replay Top Setups', route: '/register?intent=backtesting-replay' },
                ],
                suggestions: [
                    'Compare NAS100 vs XAU/USD',
                    'Export criteria to Journal',
                ],
                groundingMeta: {
                    modelLabel: 'Torex Edge Coach · Playbooks',
                    tradesScanned: 1248,
                    accountLabel: 'FTMO 100K',
                },
            },
        ],
    },
    'prop-firm': {
        id: 'prop-firm',
        tabLabel: 'Prop DD',
        shortBadge: '3.8% Left',
        linkedSignalId: 'time-of-day',
        accountPill: 'FundedNext 100K · MT5 · 412',
        creditsPill: 'Unlimited · Pro',
        initialTurns: [
            {
                id: 'pf-u1',
                role: 'user',
                timestamp: '15:10 EST',
                content: 'Am I safe on Daily Drawdown today?',
            },
            {
                id: 'pf-a1',
                role: 'assistant',
                timestamp: '15:10 EST',
                content:
                    '**3.80% ($3,800)** DD buffer left — **68% of red days** happen after **3:00 PM EST** on `NAS100` (**-2.1%** avg dip). Cap size at `0.25R` until Asia Open.',
                metrics: [
                    {
                        label: 'Daily DD Buffer',
                        value: '3.80%',
                        tone: 'positive',
                        subtext: '$3,800 safe margin',
                    },
                    {
                        label: 'Recommended Cap',
                        value: '0.25R',
                        tone: 'neutral',
                        subtext: 'Max 1 trade left',
                    },
                ],
                actionLinks: [
                    { label: 'Enable DD Guardrail', route: '/register?intent=prop-guardrail' },
                    { label: 'Session Heatmap', route: '/register?intent=session-heatmap' },
                ],
                suggestions: [
                    'Simulate two -1R losses',
                    'Auto-lock after -1.5% day',
                ],
                groundingMeta: {
                    modelLabel: 'Torex Risk Sentinel · Prop',
                    tradesScanned: 412,
                    accountLabel: 'FundedNext 100K',
                },
            },
        ],
    },
    'plan-audit': {
        id: 'plan-audit',
        tabLabel: 'Plan Audit',
        shortBadge: '91% Sync',
        linkedSignalId: 'streak',
        accountPill: 'Deriv + MT5 · 1,248',
        creditsPill: 'Unlimited · Pro',
        initialTurns: [
            {
                id: 'pa-u1',
                role: 'user',
                timestamp: '08:05 EST',
                content: 'Checklist days vs skipped pre-market days?',
            },
            {
                id: 'pa-a1',
                role: 'assistant',
                timestamp: '08:05 EST',
                content:
                    'Pre-market checklist days maintain **91% compliance** and **+1.94R** expectancy (**+$18,920**). Skipped days trigger **2x stop-outs** (**-$420** avg loss).',
                metrics: [
                    {
                        label: 'Checklist Days',
                        value: '+1.94R',
                        tone: 'positive',
                        subtext: '91% rule compliance',
                    },
                    {
                        label: 'Skipped Plan',
                        value: '-$420',
                        tone: 'negative',
                        subtext: '2x opening stop-outs',
                    },
                ],
                actionLinks: [
                    { label: 'Open Morning Ritual', route: '/register?intent=habit-checklist' },
                    { label: 'Inspect Journal Tags', route: '/register?intent=journal-audit' },
                ],
                suggestions: [
                    'Draft tomorrow NY Open bias',
                    'Sync Deriv Volatility 75',
                ],
                groundingMeta: {
                    modelLabel: 'Torex Habit Engine · Journal',
                    tradesScanned: 1248,
                    accountLabel: 'MT5 + Deriv',
                },
            },
        ],
    },
};

export const MOCK_SCENARIO_ORDER: MockScenarioId[] = [
    'revenge-leak',
    'best-edge',
    'prop-firm',
    'plan-audit',
];

export const PATTERN_DETECTION_SIGNALS: PatternSignalItem[] = [
    {
        id: 'time-of-day',
        category: 'TIME-OF-DAY',
        accentTone: 'blue',
        headline: 'After 3:00 PM EST, win rate drops 18%',
        deltaPill: '-18% WR',
        signalTag: 'NAS100 · Late NY',
        signalBars: 3,
        linkedScenarioId: 'prop-firm',
    },
    {
        id: 'behavior',
        category: 'BEHAVIOR',
        accentTone: 'violet',
        headline: 'Trades < 2m post-loss end red 73%',
        deltaPill: '-$6,420',
        signalTag: '23 Revenge Entries',
        signalBars: 3,
        linkedScenarioId: 'revenge-leak',
    },
    {
        id: 'edge',
        category: 'EDGE',
        accentTone: 'amber',
        headline: 'XAU/USD London Sweep: +2.46R edge',
        deltaPill: '+$22,642.60',
        signalTag: '62% WR · 2.41 PF',
        signalBars: 3,
        linkedScenarioId: 'best-edge',
    },
    {
        id: 'streak',
        category: 'STREAK',
        accentTone: 'emerald',
        headline: 'Checklist days double R-multiple',
        deltaPill: '+1.94R',
        signalTag: '91% Compliance',
        signalBars: 2,
        linkedScenarioId: 'plan-audit',
    },
];

export const AUTONOMOUS_AGENTS_MOCKS: AutonomousAgentMock[] = [
    {
        id: 'habit',
        badge: 'RITUALS.V2',
        name: 'Habit Agent',
        shortRole: 'Pre-Market & Bias Lock',
        accentTone: 'sky',
        signalAlert: 'XAU/USD key levels unmarked',
        idleChip: '0/4 Ready',
        armedChip: '4/4 Armed',
        metricLabel: 'NY Bias',
        metricValue: '2,648 / 2,671',
        actionTriggerLabel: 'Run Check-in',
        confirmedShortNote: 'Bias locked · Checklist armed',
        confirmedStatusLabel: 'RITUALS · ARMED',
        defaultStatusLabel: 'SIGNAL · PENDING',
        signalStrength: 2,
    },
    {
        id: 'risk',
        badge: 'GUARDRAILS',
        name: 'Risk Agent',
        shortRole: 'Prop DD & Size Sentinel',
        accentTone: 'blue',
        signalAlert: '2x consecutive -1R detected',
        idleChip: '3.8% DD Left',
        armedChip: '0.25R Locked',
        metricLabel: 'Max Size',
        metricValue: '0.25R Cap',
        actionTriggerLabel: 'Cap at 0.25R',
        confirmedShortNote: 'Risk capped until next session',
        confirmedStatusLabel: 'CAP · ENFORCED',
        defaultStatusLabel: 'SIGNAL · WARNING',
        signalStrength: 3,
    },
    {
        id: 'sentiment',
        badge: 'MINDSET',
        name: 'Sentiment Agent',
        shortRole: 'Tilt & Cooldown Guard',
        accentTone: 'violet',
        signalAlert: 'Re-entry 48s post stop-out',
        idleChip: 'Tilt Risk',
        armedChip: 'Paused',
        metricLabel: 'Cooldown',
        metricValue: '15:00',
        actionTriggerLabel: 'Start 15m Cooldown',
        confirmedShortNote: 'Tilt alerts muted on MT5',
        confirmedStatusLabel: 'COOLDOWN · LIVE',
        defaultStatusLabel: 'SIGNAL · HIGH TILT',
        signalStrength: 3,
        hasCountdown: true,
    },
];

export function buildCustomPromptReply(rawPrompt: string): MockChatTurn {
    const normalized = rawPrompt.trim().toLowerCase();

    if (
        normalized.includes('gold') ||
        normalized.includes('xau') ||
        normalized.includes('nas') ||
        normalized.includes('edge') ||
        normalized.includes('profit') ||
        normalized.includes('best')
    ) {
        return {
            id: `custom-a-${Date.now()}`,
            role: 'assistant',
            timestamp: 'Just now',
            content:
                '`XAU/USD` & `NAS100` (`03:00–05:15 EST`) produce **+$22,642.60** net (**+2.46R** avg). Filtering to top 2 setups raises Profit Factor to **2.41**.',
            metrics: [
                { label: 'Top Setup Net', value: '+$22,642.60', tone: 'positive', subtext: 'XAU/USD · NAS100' },
                { label: 'Profit Factor', value: '2.41', tone: 'positive', subtext: '62% win rate' },
            ],
            actionLinks: [{ label: 'Filter Best Edge', route: '/register?intent=edge-filter' }],
            suggestions: [
                'Where am I losing money right now?',
                'Check Prop Firm DD margin',
            ],
            groundingMeta: {
                modelLabel: 'Torex Edge Coach · Custom',
                tradesScanned: 1248,
                accountLabel: 'FTMO 100K',
            },
        };
    }

    if (
        normalized.includes('dd') ||
        normalized.includes('drawdown') ||
        normalized.includes('ftmo') ||
        normalized.includes('prop') ||
        normalized.includes('risk') ||
        normalized.includes('funded')
    ) {
        return {
            id: `custom-a-${Date.now()}`,
            role: 'assistant',
            timestamp: 'Just now',
            content:
                '**FTMO 100K** sits **3.80% ($3,800)** above Daily DD. Capping post-3 PM `NAS100` entries at **0.25R** keeps breach probability under **2%**.',
            metrics: [
                { label: 'Daily DD Safety', value: '3.80%', tone: 'positive', subtext: 'Within Funded rules' },
                { label: 'Risk Cap', value: '0.25R', tone: 'neutral', subtext: 'Post-3 PM guard' },
            ],
            actionLinks: [{ label: 'Activate Guardrails', route: '/register?intent=risk-guardrails' }],
            suggestions: [
                'Auto-lock after -1.5% day',
                'Audit pre-market compliance',
            ],
            groundingMeta: {
                modelLabel: 'Torex Risk Sentinel · Custom',
                tradesScanned: 1248,
                accountLabel: 'FTMO 100K',
            },
        };
    }

    return {
        id: `custom-a-${Date.now()}`,
        role: 'assistant',
        timestamp: 'Just now',
        content:
            'Scanned **1,248 synced executions** across MT5 & Deriv. Cutting `<2m` post-loss entries saves **+$6,420**, while checklist days lift expectancy to **+1.94R**.',
        metrics: [
            { label: 'Recoverable Leak', value: '+$6,420', tone: 'positive', subtext: '23 tilt trades' },
            { label: 'Checklist Edge', value: '+1.94R', tone: 'positive', subtext: '91% compliance' },
        ],
        actionLinks: [
            { label: 'Connect MT5 / Deriv', route: '/register?intent=ai-demo-query' },
            { label: 'Open Backtesting', route: '/register?intent=backtesting' },
        ],
        suggestions: [
            'How does XAU/USD perform at London Open?',
            'Show Prop Firm DD buffer',
        ],
        groundingMeta: {
            modelLabel: 'Torex Edge Coach · Custom',
            tradesScanned: 1248,
            accountLabel: 'MT5 + Deriv',
        },
    };
}
