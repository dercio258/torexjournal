import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { buildTaggedUrl } from '../../lib/attribution';
import { motion, useReducedMotion } from 'framer-motion';
import {
    Activity,
    AlertTriangle,
    ArrowUpRight,
    BellRing,
    BrainCircuit,
    CheckCircle2,
    Clock,
    Crosshair,
    Flame,
    Gauge,
    Loader2,
    Mic,
    Radio,
    RotateCcw,
    SendHorizontal,
    ShieldAlert,
    ShieldCheck,
    SlidersHorizontal,
    Sparkles,
    Timer,
    TrendingDown,
    TrendingUp,
    Zap,
} from 'lucide-react';
import { BRAND } from '../../constants/brand';
import { cn } from '../../lib/cn';
import { EN_TOREX_AI_AGENTS } from './contentEn';
import {
    AUTONOMOUS_AGENTS_MOCKS,
    MOCK_SCENARIO_ORDER,
    MOCK_SCENARIOS,
    PATTERN_DETECTION_SIGNALS,
    buildCustomPromptReply,
    type AgentCardId,
    type MockChatTurn,
    type MockScenarioId,
    type PatternSignalItem,
} from './torexAiLandingMocks';

function formatCountdown(totalSeconds: number): string {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function renderInlineSegments(text: string, keyPrefix: string): React.ReactNode[] {
    const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\/[a-z][a-z0-9-]*)/g);
    return tokens.map((token, idx) => {
        if (!token) return null;
        if (token.startsWith('**') && token.endsWith('**')) {
            const inner = token.slice(2, -2);
            const hasNumbers = /[\d$%+-]/.test(inner);
            return (
                <strong
                    key={`${keyPrefix}-b-${idx}`}
                    className={cn(
                        'font-semibold text-white',
                        hasNumbers && 'font-mono tabular-nums text-emerald-300'
                    )}
                >
                    {inner}
                </strong>
            );
        }
        if (token.startsWith('`') && token.endsWith('`')) {
            return (
                <code
                    key={`${keyPrefix}-c-${idx}`}
                    className="rounded border border-white/10 bg-white/[0.06] px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-sky-300"
                >
                    {token.slice(1, -1)}
                </code>
            );
        }
        if (token.startsWith('/') && token.length > 1) {
            return (
                <span
                    key={`${keyPrefix}-r-${idx}`}
                    className="font-mono text-[11px] font-medium text-accent-fg underline decoration-accent/40 underline-offset-2"
                >
                    {token}
                </span>
            );
        }
        return <React.Fragment key={`${keyPrefix}-t-${idx}`}>{token}</React.Fragment>;
    });
}

const SignalBars: React.FC<{ level: number; activeColorClass: string }> = ({
    level,
    activeColorClass,
}) => (
    <span className="inline-flex items-end gap-0.5" aria-hidden="true">
        {[1, 2, 3].map((bar) => (
            <span
                key={bar}
                className={cn(
                    'w-[3px] rounded-full transition-colors',
                    bar === 1 ? 'h-1.5' : bar === 2 ? 'h-2.5' : 'h-3.5',
                    bar <= level ? activeColorClass : 'bg-white/15'
                )}
            />
        ))}
    </span>
);

const SIGNAL_STYLES: Record<
    PatternSignalItem['accentTone'],
    {
        badge: string;
        activeCard: string;
        iconBg: string;
        delta: string;
        bar: string;
        Icon: React.ComponentType<{ className?: string }>;
    }
> = {
    blue: {
        badge: 'border-sky-400/30 bg-sky-400/10 text-sky-300',
        activeCard:
            'border-sky-400/45 bg-sky-500/[0.08] shadow-[0_0_24px_-8px_rgba(56,189,248,0.35)]',
        iconBg: 'bg-sky-500/15 text-sky-300 border-sky-400/25',
        delta: 'text-sky-300 bg-sky-500/15 border-sky-400/25',
        bar: 'bg-sky-400',
        Icon: Clock,
    },
    violet: {
        badge: 'border-violet-400/30 bg-violet-400/10 text-violet-300',
        activeCard:
            'border-violet-400/45 bg-violet-500/[0.08] shadow-[0_0_24px_-8px_rgba(139,92,246,0.35)]',
        iconBg: 'bg-violet-500/15 text-violet-300 border-violet-400/25',
        delta: 'text-rose-300 bg-rose-500/15 border-rose-400/25',
        bar: 'bg-violet-400',
        Icon: Flame,
    },
    amber: {
        badge: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
        activeCard:
            'border-amber-400/45 bg-amber-500/[0.08] shadow-[0_0_24px_-8px_rgba(245,158,11,0.35)]',
        iconBg: 'bg-amber-500/15 text-amber-300 border-amber-400/25',
        delta: 'text-emerald-300 bg-emerald-500/15 border-emerald-400/25',
        bar: 'bg-amber-400',
        Icon: Crosshair,
    },
    emerald: {
        badge: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
        activeCard:
            'border-emerald-400/45 bg-emerald-500/[0.08] shadow-[0_0_24px_-8px_rgba(16,185,129,0.38)]',
        iconBg: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/25',
        delta: 'text-emerald-300 bg-emerald-500/15 border-emerald-400/25',
        bar: 'bg-emerald-400',
        Icon: Zap,
    },
};

const AGENT_STYLES: Record<
    'sky' | 'blue' | 'violet',
    {
        ring: string;
        badge: string;
        button: string;
        statusConfirmed: string;
        glow: string;
        bar: string;
        alertChip: string;
        Icon: React.ComponentType<{ className?: string }>;
        TriggerIcon: React.ComponentType<{ className?: string }>;
        TelemetryIcon: React.ComponentType<{ className?: string }>;
    }
> = {
    sky: {
        ring: 'border-sky-400/35 bg-sky-500/12 text-sky-300',
        badge: 'border-sky-400/30 bg-sky-500/10 text-sky-300',
        button: 'border-sky-400/40 bg-sky-500/15 text-sky-100 hover:bg-sky-500/25',
        statusConfirmed: 'border-sky-400/40 bg-sky-500/15 text-sky-300',
        glow: 'from-sky-500/14 via-transparent to-transparent',
        bar: 'bg-sky-400',
        alertChip: 'border-sky-400/25 bg-sky-500/10 text-sky-300',
        Icon: Activity,
        TriggerIcon: BellRing,
        TelemetryIcon: SlidersHorizontal,
    },
    blue: {
        ring: 'border-[#3987E5]/40 bg-[#3987E5]/15 text-sky-300',
        badge: 'border-[#3987E5]/35 bg-[#3987E5]/12 text-sky-300',
        button: 'border-[#3987E5]/45 bg-[#3987E5]/18 text-sky-100 hover:bg-[#3987E5]/28',
        statusConfirmed: 'border-[#3987E5]/45 bg-[#3987E5]/15 text-sky-300',
        glow: 'from-[#3987E5]/16 via-transparent to-transparent',
        bar: 'bg-[#3987E5]',
        alertChip: 'border-amber-400/30 bg-amber-500/10 text-amber-300',
        Icon: ShieldAlert,
        TriggerIcon: AlertTriangle,
        TelemetryIcon: Gauge,
    },
    violet: {
        ring: 'border-[#8B5CF6]/40 bg-[#8B5CF6]/15 text-violet-300',
        badge: 'border-[#8B5CF6]/35 bg-[#8B5CF6]/12 text-violet-300',
        button: 'border-[#8B5CF6]/45 bg-[#8B5CF6]/18 text-violet-100 hover:bg-[#8B5CF6]/28',
        statusConfirmed: 'border-[#8B5CF6]/45 bg-[#8B5CF6]/15 text-violet-300',
        glow: 'from-[#8B5CF6]/16 via-transparent to-transparent',
        bar: 'bg-[#8B5CF6]',
        alertChip: 'border-rose-400/30 bg-rose-500/10 text-rose-300',
        Icon: BrainCircuit,
        TriggerIcon: Flame,
        TelemetryIcon: Timer,
    },
};

export const TorexAiAgentsEnSection: React.FC = () => {
    const prefersReducedMotion = useReducedMotion();

    const [activeScenarioId, setActiveScenarioId] = useState<MockScenarioId>('revenge-leak');
    const [turns, setTurns] = useState<MockChatTurn[]>(
        () => MOCK_SCENARIOS['revenge-leak'].initialTurns
    );
    const [composerValue, setComposerValue] = useState('');
    const [showMicTooltip, setShowMicTooltip] = useState(false);

    const [thinkingStage, setThinkingStage] = useState<0 | 1 | 2>(0);
    const [streamingTurnId, setStreamingTurnId] = useState<string | null>(null);
    const [streamedChars, setStreamedChars] = useState<number>(0);

    const [activatedAgents, setActivatedAgents] = useState<Record<AgentCardId, boolean>>({
        habit: false,
        risk: false,
        sentiment: false,
    });
    const [cooldownSeconds, setCooldownSeconds] = useState<number>(900);

    const messagesEndRef = useRef<HTMLDivElement | null>(null);
    const timersRef = useRef<number[]>([]);
    const streamIntervalRef = useRef<number | null>(null);
    const micTimeoutRef = useRef<number | null>(null);

    const activeScenario = useMemo(() => MOCK_SCENARIOS[activeScenarioId], [activeScenarioId]);

    const clearChatTimers = useCallback(() => {
        timersRef.current.forEach((id) => window.clearTimeout(id));
        timersRef.current = [];
        if (streamIntervalRef.current !== null) {
            window.clearInterval(streamIntervalRef.current);
            streamIntervalRef.current = null;
        }
    }, []);

    useEffect(() => {
        return () => {
            clearChatTimers();
            if (micTimeoutRef.current !== null) {
                window.clearTimeout(micTimeoutRef.current);
            }
        };
    }, [clearChatTimers]);

    useEffect(() => {
        if (!activatedAgents.sentiment) return undefined;
        const intervalId = window.setInterval(() => {
            setCooldownSeconds((prev) => (prev > 0 ? prev - 1 : 0));
        }, 1000);
        return () => window.clearInterval(intervalId);
    }, [activatedAgents.sentiment]);

    const scrollMessagesToBottom = useCallback(() => {
        if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }, []);

    const streamAssistantTurn = useCallback(
        (userTurn: MockChatTurn, assistantTurn: MockChatTurn, replaceHistory: boolean) => {
            clearChatTimers();

            if (prefersReducedMotion) {
                setThinkingStage(0);
                setTurns((prev) =>
                    replaceHistory ? [userTurn, assistantTurn] : [...prev, userTurn, assistantTurn]
                );
                setStreamingTurnId(null);
                setStreamedChars(assistantTurn.content.length);
                window.requestAnimationFrame(scrollMessagesToBottom);
                return;
            }

            setTurns((prev) => (replaceHistory ? [userTurn] : [...prev, userTurn]));
            setThinkingStage(1);
            const t1 = window.setTimeout(() => {
                setThinkingStage(2);
            }, 340);

            const t2 = window.setTimeout(() => {
                setThinkingStage(0);
                setTurns((prev) => [...prev, assistantTurn]);
                setStreamingTurnId(assistantTurn.id);
                setStreamedChars(0);

                const totalLen = assistantTurn.content.length;
                let cursor = 0;
                streamIntervalRef.current = window.setInterval(() => {
                    cursor = Math.min(totalLen, cursor + 8);
                    setStreamedChars(cursor);
                    if (cursor >= totalLen) {
                        if (streamIntervalRef.current !== null) {
                            window.clearInterval(streamIntervalRef.current);
                            streamIntervalRef.current = null;
                        }
                        setStreamingTurnId(null);
                    }
                }, 18);
            }, 720);

            timersRef.current.push(t1, t2);
        },
        [clearChatTimers, prefersReducedMotion, scrollMessagesToBottom]
    );

    const handleSelectScenario = useCallback(
        (scenarioId: MockScenarioId) => {
            setActiveScenarioId(scenarioId);
            const scenario = MOCK_SCENARIOS[scenarioId];
            const [uTurn, aTurn] = scenario.initialTurns;
            if (!uTurn || !aTurn) return;
            streamAssistantTurn(uTurn, aTurn, true);
        },
        [streamAssistantTurn]
    );

    const handleSendPrompt = useCallback(
        (rawInput: string) => {
            const trimmed = rawInput.trim();
            if (!trimmed || thinkingStage !== 0) return;

            const userTurn: MockChatTurn = {
                id: `user-${Date.now()}`,
                role: 'user',
                timestamp: 'Just now',
                content: trimmed,
            };
            const assistantTurn = buildCustomPromptReply(trimmed);
            setComposerValue('');
            streamAssistantTurn(userTurn, assistantTurn, false);
        },
        [streamAssistantTurn, thinkingStage]
    );

    const handleComposerSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        handleSendPrompt(composerValue);
    };

    const handleMicClick = () => {
        setShowMicTooltip(true);
        if (micTimeoutRef.current !== null) {
            window.clearTimeout(micTimeoutRef.current);
        }
        micTimeoutRef.current = window.setTimeout(() => {
            setShowMicTooltip(false);
        }, 2600);
    };

    const handleToggleAgent = (agentId: AgentCardId) => {
        setActivatedAgents((prev) => {
            const nextState = !prev[agentId];
            if (agentId === 'sentiment' && nextState) {
                setCooldownSeconds(900);
            }
            return { ...prev, [agentId]: nextState };
        });
    };

    return (
        <section
            id="torex-ai-agents"
            className="relative z-20 mx-auto w-full max-w-7xl px-4 pb-28 pt-12 sm:px-6 lg:px-8"
        >
            {/* Atmospheric Ambient Glow */}
            <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-12 -z-10 mx-auto h-[520px] max-w-5xl rounded-full opacity-45 blur-3xl"
                style={{
                    background:
                        'radial-gradient(circle at 30% 35%, rgba(16,185,129,0.12), transparent 55%), radial-gradient(circle at 75% 45%, rgba(57,135,229,0.11), transparent 55%)',
                }}
            />

            {/* BLOCK A — BENTO DE INTELIGÊNCIA CONVERSACIONAL & TELEMETRIA */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                {/* A1. LEFT CARD (7 cols): TOREX AI MESSENGER */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, amount: 0.15 }}
                    transition={{ duration: 0.5 }}
                    className="flex flex-col rounded-3xl border border-white/[0.09] bg-[#070B14] p-5 shadow-[0_24px_70px_-30px_rgba(0,0,0,0.85)] sm:p-7 lg:col-span-7"
                >
                    <div className="mb-5">
                        <div className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.09em] text-accent-fg">
                            <Sparkles className="h-3.5 w-3.5" />
                            <span>{EN_TOREX_AI_AGENTS.messenger.eyebrow}</span>
                        </div>
                        <h2 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
                            {EN_TOREX_AI_AGENTS.messenger.headline}
                        </h2>
                        <p className="mt-1.5 max-w-xl text-sm text-fg-muted">
                            {EN_TOREX_AI_AGENTS.messenger.subheadline}
                        </p>
                    </div>

                    {/* Inner Messenger Stage */}
                    <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-white/[0.06] bg-[#050810]">
                        {/* Top Chrome Bar */}
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.07] bg-[#080D1A]/90 px-4 py-2.5">
                            <div className="flex items-center gap-2.5">
                                <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full border border-accent/45 bg-surface p-0.5">
                                    <img
                                        src={BRAND.logoUrl}
                                        alt={`${BRAND.name} AI Avatar`}
                                        className="h-full w-full rounded-full object-cover"
                                    />
                                    <span
                                        aria-hidden="true"
                                        className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-[#050810] bg-emerald-500 text-[#050810]"
                                    >
                                        <Sparkles className="h-2 w-2" />
                                    </span>
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-[11px] font-bold tracking-[0.06em] text-accent-fg">
                                            {EN_TOREX_AI_AGENTS.messenger.coachTitle}
                                        </span>
                                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
                                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                                            {EN_TOREX_AI_AGENTS.messenger.liveSyncLabel}
                                        </span>
                                    </div>
                                    <p className="text-[10px] text-fg-subtle">
                                        {EN_TOREX_AI_AGENTS.messenger.coachSubtitle}
                                    </p>
                                </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-1.5">
                                <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-surface px-2.5 py-1 font-mono text-[10px] font-medium tabular-nums text-fg-muted">
                                    <Sparkles className="h-3 w-3 text-accent-fg" />
                                    {activeScenario.accountPill}
                                </span>
                                <span className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-[10px] font-semibold text-accent-fg">
                                    <Zap className="h-3 w-3" />
                                    {activeScenario.creditsPill}
                                </span>
                            </div>
                        </div>

                        {/* Scenario Quick Selector Tabs */}
                        <div
                            role="tablist"
                            aria-label="Torex AI sample conversations"
                            className="flex flex-wrap items-center gap-1.5 border-b border-white/[0.06] bg-[#060A15] px-3 py-2 sm:px-4"
                        >
                            {MOCK_SCENARIO_ORDER.map((scenarioId) => {
                                const scenario = MOCK_SCENARIOS[scenarioId];
                                const isActive = scenarioId === activeScenarioId;
                                return (
                                    <button
                                        key={scenario.id}
                                        type="button"
                                        role="tab"
                                        aria-selected={isActive}
                                        onClick={() => handleSelectScenario(scenario.id)}
                                        className={cn(
                                            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all',
                                            isActive
                                                ? 'border-accent/45 bg-accent/15 text-emerald-200 shadow-[0_0_16px_-6px_rgba(16,185,129,0.55)]'
                                                : 'border-white/[0.08] bg-white/[0.02] text-fg-muted hover:border-white/20 hover:text-white'
                                        )}
                                    >
                                        <span
                                            className={cn(
                                                'h-1.5 w-1.5 rounded-full',
                                                isActive ? 'bg-accent-fg' : 'bg-white/20'
                                            )}
                                        />
                                        <span>{scenario.tabLabel}</span>
                                        <span
                                            className={cn(
                                                'font-mono text-[10px] tabular-nums',
                                                isActive ? 'text-accent-fg' : 'text-fg-subtle'
                                            )}
                                        >
                                            {scenario.shortBadge}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>

                        {/* Messages Stage */}
                        <div
                            aria-live="polite"
                            className="flex min-h-[320px] max-h-[370px] flex-1 flex-col gap-3.5 overflow-y-auto px-3.5 py-4 sm:px-5"
                        >
                            {turns.map((turn) => {
                                if (turn.role === 'user') {
                                    return (
                                        <div
                                            key={turn.id}
                                            className="flex items-end justify-end gap-2"
                                        >
                                            <div className="max-w-[82%] rounded-2xl rounded-tr-sm border border-emerald-500/40 bg-emerald-600 px-3.5 py-2 text-xs leading-relaxed text-white shadow-sm sm:text-[13px]">
                                                {turn.content}
                                            </div>
                                            <div
                                                aria-hidden="true"
                                                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-500/20 font-mono text-[10px] font-bold text-emerald-200"
                                            >
                                                {EN_TOREX_AI_AGENTS.messenger.userInitials}
                                            </div>
                                        </div>
                                    );
                                }

                                const isStreamingThisTurn = streamingTurnId === turn.id;
                                const displayedText = isStreamingThisTurn
                                    ? turn.content.slice(0, streamedChars)
                                    : turn.content;

                                return (
                                    <div key={turn.id} className="flex items-start gap-2.5">
                                        <div className="mt-0.5 h-7 w-7 shrink-0 overflow-hidden rounded-full border border-accent/45 bg-surface p-0.5">
                                            <img
                                                src={BRAND.logoUrl}
                                                alt="Torex AI"
                                                className="h-full w-full rounded-full object-cover"
                                            />
                                        </div>

                                        <div className="min-w-0 flex-1 space-y-2.5">
                                            <div className="rounded-2xl rounded-tl-sm border border-white/[0.08] bg-[#0C1220]/95 px-4 py-3 text-xs leading-relaxed text-slate-200 sm:text-[13px]">
                                                <p>
                                                    {renderInlineSegments(displayedText, turn.id)}
                                                    {isStreamingThisTurn && (
                                                        <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-accent-fg align-middle" />
                                                    )}
                                                </p>

                                                {/* Crisp Icon-Led Metric Cards */}
                                                {turn.metrics && turn.metrics.length > 0 && !isStreamingThisTurn && (
                                                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                                                        {turn.metrics.map((metric) => {
                                                            const MetricIcon =
                                                                metric.tone === 'positive'
                                                                    ? TrendingUp
                                                                    : metric.tone === 'negative'
                                                                      ? TrendingDown
                                                                      : ShieldCheck;
                                                            return (
                                                                <div
                                                                    key={metric.label}
                                                                    className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 py-2"
                                                                >
                                                                    <div className="flex items-center gap-2 min-w-0">
                                                                        <span
                                                                            className={cn(
                                                                                'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border',
                                                                                metric.tone === 'positive'
                                                                                    ? 'border-emerald-400/25 bg-emerald-500/12 text-emerald-300'
                                                                                    : metric.tone === 'negative'
                                                                                      ? 'border-rose-400/25 bg-rose-500/12 text-rose-300'
                                                                                      : 'border-sky-400/25 bg-sky-500/12 text-sky-300'
                                                                            )}
                                                                        >
                                                                            <MetricIcon className="h-3.5 w-3.5" />
                                                                        </span>
                                                                        <div className="min-w-0">
                                                                            <p className="truncate text-[10px] font-medium uppercase tracking-wider text-fg-subtle">
                                                                                {metric.label}
                                                                            </p>
                                                                            {metric.subtext && (
                                                                                <p className="truncate text-[10px] text-fg-muted">
                                                                                    {metric.subtext}
                                                                                </p>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                    <span
                                                                        className={cn(
                                                                            'shrink-0 font-mono text-sm font-bold tabular-nums',
                                                                            metric.tone === 'positive'
                                                                                ? 'text-emerald-400'
                                                                                : metric.tone === 'negative'
                                                                                  ? 'text-rose-400'
                                                                                  : 'text-sky-300'
                                                                        )}
                                                                    >
                                                                        {metric.value}
                                                                    </span>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}

                                                {/* Action Links + Grounding Bar */}
                                                {!isStreamingThisTurn && (
                                                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] pt-2.5">
                                                        <div className="flex flex-wrap gap-1.5">
                                                            {turn.actionLinks?.map((action) => (
                                                                <Link
                                                                    key={action.label}
                                                                    to={buildTaggedUrl(action.route, {
                                                                        ctaTag: `lp_en_ai_action_${action.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 32)}`,
                                                                        intent: 'ai_coach_action',
                                                                    })}
                                                                    data-cta-tag={`lp_en_ai_action_${action.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 32)}`}
                                                                    data-intent="ai_coach_action"
                                                                    className="inline-flex items-center gap-1 rounded-lg border border-accent/35 bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent-fg transition-colors hover:bg-accent/20"
                                                                >
                                                                    <span>{action.label}</span>
                                                                    <ArrowUpRight className="h-3 w-3" />
                                                                </Link>
                                                            ))}
                                                        </div>

                                                        {turn.groundingMeta && (
                                                            <span className="font-mono text-[10px] tabular-nums text-fg-subtle">
                                                                {turn.groundingMeta.tradesScanned.toLocaleString()} ·{' '}
                                                                {turn.groundingMeta.accountLabel}
                                                            </span>
                                                        )}
                                                    </div>
                                                )}
                                            </div>

                                            {/* Follow-up Suggestions */}
                                            {turn.suggestions &&
                                                turn.suggestions.length > 0 &&
                                                !isStreamingThisTurn && (
                                                    <div className="flex flex-wrap gap-1.5">
                                                        {turn.suggestions.map((suggestion) => (
                                                            <button
                                                                key={suggestion}
                                                                type="button"
                                                                onClick={() => handleSendPrompt(suggestion)}
                                                                disabled={thinkingStage !== 0}
                                                                className="rounded-full border border-line-subtle bg-surface px-2.5 py-1 text-[11px] text-fg-muted transition-colors hover:border-accent/40 hover:bg-surface-2 hover:text-white disabled:opacity-50"
                                                            >
                                                                {suggestion}
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                        </div>
                                    </div>
                                );
                            })}

                            {/* 2-Stage Progressive Spinner */}
                            {thinkingStage !== 0 && (
                                <div className="flex items-start gap-2.5">
                                    <div className="mt-0.5 h-7 w-7 shrink-0 overflow-hidden rounded-full border border-accent/45 bg-surface p-0.5">
                                        <img
                                            src={BRAND.logoUrl}
                                            alt="Torex AI thinking"
                                            className="h-full w-full rounded-full object-cover"
                                        />
                                    </div>
                                    <div className="inline-flex items-center gap-3 rounded-2xl rounded-tl-sm border border-white/[0.08] bg-[#0C1220]/95 px-4 py-2.5">
                                        <Loader2 className="h-3.5 w-3.5 animate-spin text-accent-fg" />
                                        <span className="text-xs font-medium text-fg-muted">
                                            {thinkingStage === 1
                                                ? EN_TOREX_AI_AGENTS.messenger.stage1Label
                                                : EN_TOREX_AI_AGENTS.messenger.stage2Label}
                                        </span>
                                        <span className="flex items-center gap-1" aria-hidden="true">
                                            <span
                                                className={cn(
                                                    'h-1 rounded-full transition-all duration-300',
                                                    thinkingStage >= 1
                                                        ? 'w-3 bg-accent'
                                                        : 'w-1.5 bg-white/20'
                                                )}
                                            />
                                            <span
                                                className={cn(
                                                    'h-1 rounded-full transition-all duration-300',
                                                    thinkingStage >= 2
                                                        ? 'w-3 bg-accent'
                                                        : 'w-1.5 bg-white/20'
                                                )}
                                            />
                                        </span>
                                    </div>
                                </div>
                            )}
                            <div ref={messagesEndRef} />
                        </div>

                        {/* Interactive Bottom Pill Composer */}
                        <div className="border-t border-white/[0.07] bg-[#080D1A]/90 p-3 sm:px-4">
                            <form
                                onSubmit={handleComposerSubmit}
                                className="relative flex items-center gap-2 rounded-full border border-line bg-surface py-1.5 pl-4 pr-1.5 transition-colors focus-within:border-accent/55"
                            >
                                <input
                                    type="text"
                                    value={composerValue}
                                    onChange={(e) => setComposerValue(e.target.value)}
                                    placeholder={EN_TOREX_AI_AGENTS.messenger.composerPlaceholder}
                                    aria-label={EN_TOREX_AI_AGENTS.messenger.composerPlaceholder}
                                    className="min-w-0 flex-1 bg-transparent text-xs text-white placeholder:text-fg-subtle focus:outline-none sm:text-[13px]"
                                />

                                <div className="relative flex items-center gap-1.5">
                                    {showMicTooltip && (
                                        <div
                                            role="status"
                                            className="absolute bottom-11 right-0 z-10 whitespace-nowrap rounded-lg border border-white/15 bg-[#0B1120] px-2.5 py-1.5 text-[11px] font-medium text-fg-muted shadow-xl"
                                        >
                                            {EN_TOREX_AI_AGENTS.messenger.micTooltip}
                                        </div>
                                    )}
                                    <button
                                        type="button"
                                        onClick={handleMicClick}
                                        title={EN_TOREX_AI_AGENTS.messenger.micTooltip}
                                        aria-label="Voice dictation"
                                        className="flex h-8 w-8 items-center justify-center rounded-full text-fg-muted transition-colors hover:bg-white/[0.06] hover:text-white"
                                    >
                                        <Mic className="h-4 w-4" />
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={!composerValue.trim() || thinkingStage !== 0}
                                        aria-label="Send message to Torex AI"
                                        className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-accent-on transition-all hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45"
                                    >
                                        <SendHorizontal className="h-4 w-4" />
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </motion.div>

                {/* A2. RIGHT CARD (5 cols): SLEEK SIGNAL-FIRST PATTERN DETECTION */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, amount: 0.15 }}
                    transition={{ duration: 0.5, delay: 0.08 }}
                    className="flex flex-col justify-between rounded-3xl border border-white/[0.09] bg-[#070B14] p-5 shadow-[0_24px_70px_-30px_rgba(0,0,0,0.85)] sm:p-7 lg:col-span-5"
                >
                    <div>
                        <div className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.09em] text-accent-fg">
                            <Radio className="h-3.5 w-3.5" />
                            <span>{EN_TOREX_AI_AGENTS.patterns.eyebrow}</span>
                        </div>
                        <h3 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
                            {EN_TOREX_AI_AGENTS.patterns.headline}
                        </h3>
                        <p className="mt-1.5 text-sm text-fg-muted">
                            {EN_TOREX_AI_AGENTS.patterns.subheadline}
                        </p>

                        {/* 4 Compact Signal Cards */}
                        <div className="mt-5 space-y-2.5">
                            {PATTERN_DETECTION_SIGNALS.map((signal) => {
                                const style = SIGNAL_STYLES[signal.accentTone];
                                const Icon = style.Icon;
                                const isLinked = activeScenario.linkedSignalId === signal.id;

                                return (
                                    <button
                                        key={signal.id}
                                        type="button"
                                        onClick={() => handleSelectScenario(signal.linkedScenarioId)}
                                        aria-pressed={isLinked}
                                        className={cn(
                                            'group w-full rounded-2xl border p-3.5 text-left transition-all',
                                            isLinked
                                                ? style.activeCard
                                                : 'border-white/[0.07] bg-[#0B101D]/90 hover:border-white/20 hover:bg-[#0E1526]'
                                        )}
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="flex items-center gap-2">
                                                <span
                                                    className={cn(
                                                        'flex h-7 w-7 items-center justify-center rounded-lg border',
                                                        style.iconBg
                                                    )}
                                                >
                                                    <Icon className="h-3.5 w-3.5" />
                                                </span>
                                                <span
                                                    className={cn(
                                                        'rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em]',
                                                        style.badge
                                                    )}
                                                >
                                                    {signal.category}
                                                </span>
                                            </div>

                                            <div className="flex items-center gap-2">
                                                <SignalBars
                                                    level={signal.signalBars}
                                                    activeColorClass={style.bar}
                                                />
                                                <span
                                                    className={cn(
                                                        'rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-bold tabular-nums',
                                                        style.delta
                                                    )}
                                                >
                                                    {signal.deltaPill}
                                                </span>
                                            </div>
                                        </div>

                                        <p className="mt-2.5 text-[13px] font-semibold leading-snug text-white sm:text-sm">
                                            {signal.headline}
                                        </p>

                                        <div className="mt-2 flex items-center justify-between gap-2">
                                            <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-fg-subtle">
                                                <Activity className="h-3 w-3 text-fg-muted" />
                                                <span>{signal.signalTag}</span>
                                            </span>

                                            {isLinked ? (
                                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-accent-fg">
                                                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-fg" />
                                                    <span>{EN_TOREX_AI_AGENTS.patterns.syncedMicroLabel}</span>
                                                </span>
                                            ) : (
                                                <ArrowUpRight className="h-3.5 w-3.5 text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100" />
                                            )}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Telemetry Proof Footer */}
                    <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.07] pt-4">
                        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] tabular-nums text-fg-subtle">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                            <span>{EN_TOREX_AI_AGENTS.patterns.footerTelemetry}</span>
                        </span>
                        <Link
                            to={buildTaggedUrl(EN_TOREX_AI_AGENTS.patterns.ctaHref, {
                                ctaTag: 'lp_en_patterns_cta',
                                intent: 'ai_pattern_radar',
                            })}
                            data-cta-tag="lp_en_patterns_cta"
                            data-intent="ai_pattern_radar"
                            className="inline-flex items-center gap-1 text-xs font-semibold text-accent-fg transition-colors hover:text-emerald-300"
                        >
                            <span>{EN_TOREX_AI_AGENTS.patterns.ctaLabel}</span>
                            <ArrowUpRight className="h-3.5 w-3.5" />
                        </Link>
                    </div>
                </motion.div>
            </div>

            {/* BLOCK B — AUTONOMOUS TRADING AGENTS (SLEEK SIGNAL TELEMETRY CARDS) */}
            <div className="mt-20 sm:mt-24">
                <div className="mx-auto max-w-3xl text-center">
                    <div className="inline-flex items-center gap-2 rounded-full border border-accent/25 bg-accent/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.09em] text-accent-fg">
                        <BrainCircuit className="h-3.5 w-3.5" />
                        <span>{EN_TOREX_AI_AGENTS.agents.eyebrow}</span>
                    </div>
                    <h2 className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-5xl sm:leading-[1.12]">
                        <span className="block">{EN_TOREX_AI_AGENTS.agents.headlineLine1}</span>
                        <span className="block bg-gradient-to-r from-emerald-300 via-accent-fg to-sky-400 bg-clip-text text-transparent">
                            {EN_TOREX_AI_AGENTS.agents.headlineGradient}
                        </span>
                    </h2>
                    <p className="mx-auto mt-3 max-w-xl text-sm text-fg-muted sm:text-base">
                        {EN_TOREX_AI_AGENTS.agents.subheadline}
                    </p>
                </div>

                {/* 3 Sleek Signal-Driven Agent Cards */}
                <div className="mt-11 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
                    {AUTONOMOUS_AGENTS_MOCKS.map((agent, index) => {
                        const style = AGENT_STYLES[agent.accentTone];
                        const Icon = style.Icon;
                        const TriggerIcon = style.TriggerIcon;
                        const TelemetryIcon = style.TelemetryIcon;
                        const isActivated = activatedAgents[agent.id];

                        return (
                            <motion.div
                                key={agent.id}
                                initial={{ opacity: 0, y: 20 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true, amount: 0.15 }}
                                transition={{ duration: 0.45, delay: index * 0.08 }}
                                className="relative flex flex-col justify-between overflow-hidden rounded-3xl border border-white/[0.09] bg-[#070B14] p-5 shadow-[0_24px_60px_-30px_rgba(0,0,0,0.85)] sm:p-6"
                            >
                                <div
                                    aria-hidden="true"
                                    className={cn(
                                        'pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b',
                                        style.glow
                                    )}
                                />

                                <div className="relative">
                                    {/* Top Icon + Badge + Signal Strength */}
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-3">
                                            <span
                                                className={cn(
                                                    'flex h-10 w-10 items-center justify-center rounded-2xl border',
                                                    style.ring
                                                )}
                                            >
                                                <Icon className="h-5 w-5" />
                                            </span>
                                            <div>
                                                <h3 className="text-base font-bold text-white sm:text-lg">
                                                    {agent.name}
                                                </h3>
                                                <p className="text-[11px] text-fg-subtle">
                                                    {agent.shortRole}
                                                </p>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2">
                                            <SignalBars
                                                level={agent.signalStrength}
                                                activeColorClass={style.bar}
                                            />
                                            <span
                                                className={cn(
                                                    'rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold tracking-[0.07em]',
                                                    style.badge
                                                )}
                                            >
                                                {agent.badge}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Compact Signal & Telemetry Stage */}
                                    <div className="mt-5 space-y-2.5 rounded-2xl border border-white/[0.06] bg-[#050810] p-3.5">
                                        {/* Signal Alert Row */}
                                        <div className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-[#0B101D] px-3 py-2">
                                            <div className="flex min-w-0 items-center gap-2">
                                                <TriggerIcon className="h-3.5 w-3.5 shrink-0 text-amber-300" />
                                                <span className="truncate text-xs font-medium text-slate-200">
                                                    {agent.signalAlert}
                                                </span>
                                            </div>
                                            <span
                                                className={cn(
                                                    'shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold tabular-nums',
                                                    isActivated
                                                        ? 'border-emerald-400/35 bg-emerald-500/15 text-emerald-300'
                                                        : style.alertChip
                                                )}
                                            >
                                                {isActivated ? agent.armedChip : agent.idleChip}
                                            </span>
                                        </div>

                                        {/* Telemetry Pill Row */}
                                        <div className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2">
                                            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-fg-muted">
                                                <TelemetryIcon className="h-3.5 w-3.5 text-fg-subtle" />
                                                <span>{agent.metricLabel}</span>
                                            </span>
                                            <span className="font-mono text-xs font-bold tabular-nums text-white">
                                                {agent.hasCountdown && isActivated
                                                    ? formatCountdown(cooldownSeconds)
                                                    : agent.metricValue}
                                            </span>
                                        </div>

                                        {/* Interactive 1-Tap Action / Confirmation */}
                                        {!isActivated ? (
                                            <button
                                                type="button"
                                                data-cta-tag={`lp_en_agent_${agent.id}_activate`}
                                                data-intent={`agent_${agent.id}`}
                                                onClick={() => handleToggleAgent(agent.id)}
                                                className={cn(
                                                    'flex w-full items-center justify-between rounded-xl border px-3.5 py-2 text-xs font-semibold transition-all',
                                                    style.button
                                                )}
                                            >
                                                <span>{agent.actionTriggerLabel}</span>
                                                <ArrowUpRight className="h-3.5 w-3.5" />
                                            </button>
                                        ) : (
                                            <div className="flex items-center justify-between gap-2 rounded-xl border border-accent/30 bg-accent/10 px-3 py-2 text-xs font-medium text-emerald-200">
                                                <span className="inline-flex items-center gap-1.5 truncate">
                                                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-accent-fg" />
                                                    <span className="truncate">{agent.confirmedShortNote}</span>
                                                </span>
                                                {agent.hasCountdown && (
                                                    <span className="shrink-0 font-mono text-[11px] font-bold tabular-nums text-violet-200">
                                                        LIVE
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Footer Signal Pill */}
                                <div className="relative mt-4 flex items-center justify-between border-t border-white/[0.06] pt-3">
                                    <span
                                        className={cn(
                                            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-semibold tracking-wider',
                                            isActivated
                                                ? style.statusConfirmed
                                                : 'border-white/10 bg-white/[0.03] text-fg-muted'
                                        )}
                                    >
                                        <span
                                            className={cn(
                                                'h-1.5 w-1.5 rounded-full',
                                                isActivated
                                                    ? 'animate-pulse bg-emerald-400'
                                                    : 'bg-amber-400'
                                            )}
                                        />
                                        {isActivated
                                            ? agent.confirmedStatusLabel
                                            : agent.defaultStatusLabel}
                                    </span>

                                    {isActivated && (
                                        <button
                                            type="button"
                                            onClick={() => handleToggleAgent(agent.id)}
                                            className="inline-flex items-center gap-1 text-[11px] text-fg-subtle transition-colors hover:text-white"
                                        >
                                            <RotateCcw className="h-3 w-3" />
                                            <span>Reset</span>
                                        </button>
                                    )}
                                </div>
                            </motion.div>
                        );
                    })}
                </div>

                {/* Final Conversion Anchor Strip */}
                <motion.div
                    initial={{ opacity: 0, y: 18 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, amount: 0.2 }}
                    transition={{ duration: 0.45 }}
                    className="mt-10 flex flex-col items-start justify-between gap-6 rounded-3xl border border-accent/25 bg-gradient-to-r from-[#08121E] via-[#081018] to-[#0A131E] p-6 shadow-[0_20px_60px_-28px_rgba(16,185,129,0.28)] sm:p-8 lg:flex-row lg:items-center"
                >
                    <div className="max-w-2xl">
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-0.5 font-mono text-[10px] font-bold tracking-[0.08em] text-accent-fg">
                            {EN_TOREX_AI_AGENTS.conversionStrip.badge}
                        </span>
                        <h3 className="mt-3 text-xl font-bold tracking-tight text-white sm:text-2xl">
                            {EN_TOREX_AI_AGENTS.conversionStrip.headline}
                        </h3>
                        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
                            {EN_TOREX_AI_AGENTS.conversionStrip.proofBullets.map((bullet) => (
                                <span
                                    key={bullet}
                                    className="inline-flex items-center gap-1.5 text-xs text-fg-muted"
                                >
                                    <CheckCircle2 className="h-3.5 w-3.5 text-accent-fg" />
                                    <span>{bullet}</span>
                                </span>
                            ))}
                        </div>
                    </div>

                    <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
                        <Link
                            to={buildTaggedUrl(EN_TOREX_AI_AGENTS.conversionStrip.primaryCtaHref, {
                                ctaTag: 'lp_en_conversion_primary',
                                intent: 'start_free_trial',
                            })}
                            data-cta-tag="lp_en_conversion_primary"
                            data-intent="start_free_trial"
                            className="inline-flex items-center justify-center gap-2 rounded-full bg-accent px-6 py-3 text-sm font-semibold text-accent-on shadow-glow transition-all hover:bg-accent-hover"
                        >
                            <span>{EN_TOREX_AI_AGENTS.conversionStrip.primaryCtaLabel}</span>
                            <ArrowUpRight className="h-4 w-4" />
                        </Link>
                        <Link
                            to={buildTaggedUrl(EN_TOREX_AI_AGENTS.conversionStrip.secondaryCtaHref, {
                                ctaTag: 'lp_en_conversion_secondary',
                                intent: 'view_pricing',
                            })}
                            data-cta-tag="lp_en_conversion_secondary"
                            data-intent="view_pricing"
                            className="inline-flex items-center justify-center rounded-full border border-white/15 bg-white/[0.03] px-6 py-3 text-sm font-semibold text-white transition-colors hover:border-white/30 hover:bg-white/[0.07]"
                        >
                            {EN_TOREX_AI_AGENTS.conversionStrip.secondaryCtaLabel}
                        </Link>
                    </div>
                </motion.div>
            </div>
        </section>
    );
};
