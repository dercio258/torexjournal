import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
    ArrowDown,
    ArrowUpRight,
    Check,
    Compass,
    Copy,
    CornerDownRight,
    Loader2,
    MessageSquare,
    Mic,
    MicOff,
    PanelLeftClose,
    PanelLeftOpen,
    Plus,
    Search,
    SendHorizontal,
    Sparkles,
    ThumbsDown,
    ThumbsUp,
    Trash2,
    WifiOff,
    X,
    Zap,
} from 'lucide-react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { useLocale } from '../context/LocaleContext';
import { useOfflineSyncStore } from '../store/useOfflineSyncStore';
import {
    ClientAiCreditStatus,
    ClientAiMessage,
    ClientAiMetricCard,
    ClientAiSession,
    TOREX_AI_SUPPORT_FALLBACK,
    TOREX_AI_SUPPORT_FALLBACK_EN,
    isGreetingPrompt,
} from '../components/ai/torexAiFallback';

const TOREX_LOGO_URL =
    'https://pub-354475384fd04c1e8c075e14e17ed14d.r2.dev/produtos/originals/1790957899791_0521d2dc46a60392_touro_design_1.jpeg';

const DEFAULT_QUICK_PROMPTS_PT = [
    'Como estão minhas operações e lucros atuais?',
    'O que estou fazendo de errado ultimamente?',
    'Como importar meus trades (MT5, Deriv ou CSV)?',
    'Como anotar minhas operações no Diário?',
];

const DEFAULT_QUICK_PROMPTS_EN = [
    'How are my closed trades and Net P&L performing?',
    'What behavioral patterns are hurting my expectancy?',
    'How do I sync executions (MT5, Deriv, or CSV)?',
    'How do I structure post-trade reviews in the Journal?',
];

const PROCESSING_STAGES_PT = [
    'Analisando a questão...',
    'Escrevendo...',
];

const PROCESSING_STAGES_EN = [
    'Analyzing telemetry...',
    'Drafting insights...',
];

/**
 * Limite duro do polling no cliente. Deve ficar acima do guarda de timeout do servidor
 * (getJobStatus, 180s), para que a resposta persistida pelo servidor sempre vença.
 */
const POLL_GIVE_UP_MS = 240_000;

/** Mensagens de aviso criadas só no cliente; são descartadas quando a resposta real chega. */
const isClientOnlyFallbackId = (id: string) =>
    id.startsWith('net-fb-') || id.startsWith('fb-job-');

interface PendingSessionJob {
    jobId: string;
    sessionId: string;
    stages: string[];
    stageIndex: number;
    startedAt: number;
    minSpinnerMs: number;
    fastGreeting: boolean;
}

interface TypingSessionState {
    sessionId: string;
    messageId: string;
    fullText: string;
    visibleLength: number;
}

function resolveTierCharCap(tier?: string): number {
    const normalized = String(tier || '')
        .trim()
        .toUpperCase();
    if (
        normalized === 'PREMIUM' ||
        normalized === 'ENTERPRISE' ||
        normalized === 'ULTIMATE'
    ) {
        return 1000;
    }
    if (normalized === 'PRO') {
        return 250;
    }
    return 50;
}

function resolveHumanFirstName(
    name?: string | null,
    username?: string | null
): string | null {
    const candidates = [name, username];
    for (const raw of candidates) {
        const trimmed = String(raw || '').trim();
        if (!trimmed) continue;
        const firstToken = trimmed.split(/\s+/)[0] || '';
        if (
            firstToken.length < 2 ||
            firstToken.length > 20 ||
            /[\d_@.]/.test(firstToken)
        ) {
            continue;
        }
        return (
            firstToken.charAt(0).toUpperCase() +
            firstToken.slice(1).toLowerCase()
        );
    }
    return null;
}

function formatRelativeSessionDate(iso?: string, isEn = false): string {
    if (!iso) return '';
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return '';

    const now = new Date();
    const sameDay =
        dt.getFullYear() === now.getFullYear() &&
        dt.getMonth() === now.getMonth() &&
        dt.getDate() === now.getDate();
    if (sameDay) {
        return dt.toLocaleTimeString(isEn ? 'en-US' : 'pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        });
    }

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday =
        dt.getFullYear() === yesterday.getFullYear() &&
        dt.getMonth() === yesterday.getMonth() &&
        dt.getDate() === yesterday.getDate();
    if (isYesterday) {
        return isEn ? 'Yesterday' : 'Ontem';
    }

    return dt.toLocaleDateString(isEn ? 'en-US' : 'pt-BR', {
        day: '2-digit',
        month: 'short',
    });
}

function formatMessageTimestamp(iso?: string, isEn = false): string {
    if (!iso) return '';
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return '';
    return dt.toLocaleTimeString(isEn ? 'en-US' : 'pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });
}

function formatSignedUsd(value: number, isEn = false): string {
    const absFormatted = Math.abs(value).toLocaleString(
        isEn ? 'en-US' : 'pt-BR',
        {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }
    );
    if (value > 0) return `+$${absFormatted}`;
    if (value < 0) return `-$${absFormatted}`;
    return `$${absFormatted}`;
}

function resolveAssistantBadge(
    msg: ClientAiMessage,
    isEn: boolean
): string | null {
    const intent = String(msg.intent || '').trim().toUpperCase();
    const domain = String(
        (msg as { domain?: string | null }).domain || ''
    )
        .trim()
        .toUpperCase();

    if (intent === 'SUPPORT_FALLBACK' || msg.provider === 'support_fallback') {
        return isEn ? 'Connection Notice' : 'Aviso de Conexão';
    }
    if (
        domain === 'PLATFORM_GUIDE' ||
        intent === 'PLATFORM_SUPPORT' ||
        intent === 'PLATFORM_GUIDE'
    ) {
        return isEn ? 'Platform Guide' : 'Guia da Plataforma';
    }
    if (
        domain === 'RISK_COMPLIANCE' ||
        intent === 'GUARDRAIL' ||
        intent === 'BLOCKED' ||
        intent === 'OUT_OF_SCOPE'
    ) {
        return isEn ? 'Risk Governance' : 'Governança de Risco';
    }
    if (
        domain === 'PERFORMANCE_COACH' ||
        domain === 'DATA_DETECTIVE' ||
        intent.includes('AUDIT') ||
        intent.includes('DIAGNOSTIC') ||
        intent.includes('EDGE') ||
        intent.includes('DISCIPLINE') ||
        intent.includes('IMPROVEMENT') ||
        intent.includes('METRIC')
    ) {
        return isEn ? 'Account Audit' : 'Auditoria da Conta';
    }
    return null;
}

function mergeUniqueMessages(
    existing: ClientAiMessage[],
    incoming: ClientAiMessage[]
): ClientAiMessage[] {
    const map = new Map<string, ClientAiMessage>();
    const hasRealAssistant = incoming.some(
        (m) => m.role === 'assistant' && !isClientOnlyFallbackId(String(m.id))
    );
    for (const m of existing) {
        // A resposta real substitui qualquer aviso provisório gerado no cliente
        if (hasRealAssistant && isClientOnlyFallbackId(String(m.id))) continue;
        map.set(m.id, m);
    }
    for (const m of incoming) {
        map.set(m.id, m);
    }
    return Array.from(map.values()).sort((a, b) => {
        const ta = new Date(a.createdAt || 0).getTime();
        const tb = new Date(b.createdAt || 0).getTime();
        return ta - tb;
    });
}

const SESSION_UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidSessionUuid(value?: string | null): value is string {
    return SESSION_UUID_REGEX.test(String(value || '').trim());
}

function generateClientSessionUuid(): string {
    if (
        typeof crypto !== 'undefined' &&
        typeof crypto.randomUUID === 'function'
    ) {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

const ROUTE_DISPLAY_LABELS_PT: Record<string, string> = {
    '/dashboard': 'Dashboard',
    '/trades': 'Histórico de Trades',
    '/add-trades': 'Importar Trades',
    '/journal': 'Diário',
    '/backtesting': 'Backtesting',
    '/calendar': 'Calendário',
    '/reports': 'Relatórios',
    '/configuration': 'Configurações',
    '/payments': 'Pagamentos',
    '/pricing': 'Planos',
};

const ROUTE_DISPLAY_LABELS_EN: Record<string, string> = {
    '/dashboard': 'Dashboard',
    '/trades': 'Trade History',
    '/add-trades': 'Import Trades',
    '/journal': 'Journal',
    '/backtesting': 'Backtesting',
    '/calendar': 'Calendar',
    '/reports': 'Reports',
    '/configuration': 'Settings',
    '/payments': 'Payments',
    '/pricing': 'Pricing',
};

function resolveRouteDisplayLabel(routePath: string, isEn: boolean): string {
    const clean = String(routePath || '').trim();
    const base = '/' + clean.replace(/^\/+/, '').split('/')[0].toLowerCase();
    const map = isEn ? ROUTE_DISPLAY_LABELS_EN : ROUTE_DISPLAY_LABELS_PT;
    return map[base] || clean;
}

function renderFormattedText(
    text: string,
    showCursor = false,
    isEn = false
): React.ReactNode {
    const lines = String(text || '').split('\n');
    const elements: React.ReactNode[] = [];

    const renderInline = (line: string, keyPrefix: string) => {
        const parts = line.split(
            /(\*\*[^*]+\*\*|\*[^*\n]+\*|\[[^\]]+\]\((?:https?:\/\/[^)\s/]+)?\/(?:add-trades|backtesting|journal|reports|trades|calendar|dashboard|configuration|payments|pricing)(?:\/[a-z0-9\-_]+)*\)|`[^`]+`|\B\/(?:add-trades|backtesting|journal|reports|trades|calendar|dashboard|configuration|payments|pricing)(?:\/[a-z0-9\-_]+)*\b)/gi
        );
        return parts.map((part, idx) => {
            if (!part) return null;
            if (part.startsWith('**') && part.endsWith('**')) {
                return (
                    <strong key={`${keyPrefix}-b-${idx}`} className="font-semibold text-fg">
                        {part.slice(2, -2)}
                    </strong>
                );
            }
            if (
                part.length > 2 &&
                part.startsWith('*') &&
                part.endsWith('*') &&
                !part.startsWith('**')
            ) {
                return (
                    <em key={`${keyPrefix}-i-${idx}`} className="italic text-fg">
                        {part.slice(1, -1)}
                    </em>
                );
            }
            const mdLinkMatch = part.match(
                /^\[([^\]]+)\]\((?:https?:\/\/[^)\s/]+)?(\/[a-z0-9\-_/]+)\)$/i
            );
            if (mdLinkMatch) {
                const rawLabel = mdLinkMatch[1].trim();
                const targetRoute = mdLinkMatch[2].trim();
                const displayLabel = rawLabel.startsWith('/')
                    ? resolveRouteDisplayLabel(targetRoute, isEn)
                    : rawLabel;
                return (
                    <Link
                        key={`${keyPrefix}-mdlnk-${idx}`}
                        to={targetRoute}
                        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-accent/10 hover:bg-accent/20 border border-accent/35 text-[11px] font-medium text-accent-fg underline-offset-2 hover:underline transition-colors"
                    >
                        <span>{displayLabel}</span>
                        <ArrowUpRight className="w-2.5 h-2.5 shrink-0" />
                    </Link>
                );
            }
            if (part.startsWith('`') && part.endsWith('`')) {
                const inner = part.slice(1, -1).trim();
                if (inner.startsWith('/')) {
                    return (
                        <Link
                            key={`${keyPrefix}-lnk-${idx}`}
                            to={inner}
                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-accent/10 hover:bg-accent/20 border border-accent/35 text-[11px] font-medium text-accent-fg underline-offset-2 hover:underline transition-colors"
                        >
                            <span>{resolveRouteDisplayLabel(inner, isEn)}</span>
                            <ArrowUpRight className="w-2.5 h-2.5 shrink-0" />
                        </Link>
                    );
                }
                return (
                    <code
                        key={`${keyPrefix}-c-${idx}`}
                        className="px-1.5 py-0.5 rounded-md bg-canvas-subtle border border-line-subtle font-mono text-[11px] text-accent-fg"
                    >
                        {inner}
                    </code>
                );
            }
            if (part.startsWith('/')) {
                return (
                    <Link
                        key={`${keyPrefix}-rawlnk-${idx}`}
                        to={part}
                        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-accent/10 hover:bg-accent/20 border border-accent/35 text-[11px] font-medium text-accent-fg underline-offset-2 hover:underline transition-colors"
                    >
                        <span>{resolveRouteDisplayLabel(part, isEn)}</span>
                        <ArrowUpRight className="w-2.5 h-2.5 shrink-0" />
                    </Link>
                );
            }
            return <React.Fragment key={`${keyPrefix}-t-${idx}`}>{part}</React.Fragment>;
        });
    };

    const lastNonEmptyIdx = (() => {
        for (let i = lines.length - 1; i >= 0; i--) {
            if (lines[i].trim()) return i;
        }
        return lines.length - 1;
    })();

    const cursorEl = (
        <span className="inline-block w-1.5 h-3.5 ml-0.5 align-middle rounded-sm bg-accent animate-pulse" />
    );

    lines.forEach((rawLine, index) => {
        const line = rawLine.trim();
        const isLastLine = showCursor && index === lastNonEmptyIdx;

        if (!line) {
            if (isLastLine && elements.length === 0) {
                elements.push(
                    <p
                        key={`cur-${index}`}
                        className="text-[13px] sm:text-[13.5px] text-fg/90 leading-relaxed"
                    >
                        {cursorEl}
                    </p>
                );
            } else {
                elements.push(<div key={`sp-${index}`} className="h-1.5" />);
            }
            return;
        }
        if (/^---+$/.test(line) || /^\*\*\*+$/.test(line)) {
            elements.push(
                <hr key={`hr-${index}`} className="border-line-subtle my-2" />
            );
            return;
        }
        if (line.startsWith('## ')) {
            elements.push(
                <h2
                    key={`h2-${index}`}
                    className="text-sm sm:text-[15px] font-bold text-fg tracking-tight mt-2 mb-1"
                >
                    {renderInline(line.slice(3), `h2-${index}`)}
                    {isLastLine && cursorEl}
                </h2>
            );
            return;
        }
        if (line.startsWith('### ')) {
            elements.push(
                <h3
                    key={`h3-${index}`}
                    className="text-[13px] sm:text-sm font-semibold text-fg tracking-tight mt-1.5 mb-0.5"
                >
                    {renderInline(line.slice(4), `h3-${index}`)}
                    {isLastLine && cursorEl}
                </h3>
            );
            return;
        }
        const bulletMatch = line.match(/^[-*•]\s+(.*)$/);
        if (bulletMatch) {
            elements.push(
                <div
                    key={`li-${index}`}
                    className="flex items-start gap-2.5 text-[13px] sm:text-[13.5px] text-fg/90 leading-relaxed pl-1"
                >
                    <span className="w-1.5 h-1.5 rounded-full bg-accent mt-2 shrink-0" />
                    <div className="flex-1">
                        {renderInline(bulletMatch[1], `li-${index}`)}
                        {isLastLine && cursorEl}
                    </div>
                </div>
            );
            return;
        }
        if (/^\d+\.\s/.test(line)) {
            const match = line.match(/^(\d+\.)\s+(.*)$/);
            if (match) {
                elements.push(
                    <div
                        key={`oli-${index}`}
                        className="flex items-start gap-2.5 text-[13px] sm:text-[13.5px] text-fg/90 leading-relaxed pl-1"
                    >
                        <span className="font-mono text-xs font-semibold text-accent-fg mt-0.5 shrink-0">
                            {match[1]}
                        </span>
                        <div className="flex-1">
                            {renderInline(match[2], `oli-${index}`)}
                            {isLastLine && cursorEl}
                        </div>
                    </div>
                );
                return;
            }
        }
        elements.push(
            <p
                key={`p-${index}`}
                className="text-[13px] sm:text-[13.5px] text-fg/90 leading-relaxed"
            >
                {renderInline(line, `p-${index}`)}
                {isLastLine && cursorEl}
            </p>
        );
    });

    return <div className="space-y-2">{elements}</div>;
}

export const TorexAi: React.FC = () => {
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const supportFallback = isEn ? TOREX_AI_SUPPORT_FALLBACK_EN : TOREX_AI_SUPPORT_FALLBACK;
    const quickPrompts = isEn ? DEFAULT_QUICK_PROMPTS_EN : DEFAULT_QUICK_PROMPTS_PT;
    const processingStages = isEn ? PROCESSING_STAGES_EN : PROCESSING_STAGES_PT;

    const { user, token } = useAuth();
    const { selectedAccountId, selectedAccount, isConsolidated } = useAccount();
    const isOnline = useOfflineSyncStore((s) => s.isOnline);

    const [isHistoryOpen, setIsHistoryOpen] = useState<boolean>(true);
    const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState<boolean>(false);
    const [searchQuery, setSearchQuery] = useState<string>('');

    const { sessionId: rawRouteSessionId } = useParams<{ sessionId?: string }>();
    const navigate = useNavigate();
    const normalizedRouteSessionId =
        rawRouteSessionId?.trim().toLowerCase() || null;

    const [sessions, setSessions] = useState<ClientAiSession[]>([]);
    const [activeSessionId, setActiveSessionId] = useState<string | null>(() =>
        isValidSessionUuid(normalizedRouteSessionId)
            ? normalizedRouteSessionId
            : null
    );

    // Armazenamento isolado por sessionId: garante roteamento exato da resposta para o chat correto sem perda
    const [messagesBySession, setMessagesBySession] = useState<
        Record<string, ClientAiMessage[]>
    >({});
    const [draftPendingMessages, setDraftPendingMessages] = useState<
        ClientAiMessage[]
    >([]);

    const [pendingJobsBySession, setPendingJobsBySession] = useState<
        Record<string, PendingSessionJob>
    >({});
    const [typingBySession, setTypingBySession] = useState<
        Record<string, TypingSessionState>
    >({});
    const [unreadReadySessions, setUnreadReadySessions] = useState<
        Record<string, boolean>
    >({});

    const [inputText, setInputText] = useState<string>('');
    const [isSubmittingSend, setIsSubmittingSend] = useState<boolean>(false);
    const [draftStageInfo, setDraftStageInfo] = useState<{
        stages: string[];
        stageIndex: number;
    } | null>(null);
    const [isLoadingSession, setIsLoadingSession] = useState<boolean>(() =>
        Boolean(isValidSessionUuid(normalizedRouteSessionId))
    );

    const [credits, setCredits] = useState<ClientAiCreditStatus | null>(null);
    const [accountSummary, setAccountSummary] = useState<{
        accountLabel: string;
        totalTrades: number;
        netPnl: number;
        winRate?: number;
        profitFactor?: number;
    } | null>(null);

    const [isListening, setIsListening] = useState<boolean>(false);
    const [showScrollBottomBtn, setShowScrollBottomBtn] = useState<boolean>(false);
    const [avatarLoadError, setAvatarLoadError] = useState<boolean>(false);
    const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
    const [openFeedbackMsgId, setOpenFeedbackMsgId] = useState<string | null>(
        null
    );
    const [feedbackNoteDrafts, setFeedbackNoteDrafts] = useState<
        Record<string, string>
    >({});
    const [feedbackSubmittingIds, setFeedbackSubmittingIds] = useState<
        Record<string, boolean>
    >({});
    const recognitionRef = useRef<any>(null);
    const chatScrollContainerRef = useRef<HTMLDivElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    const activeSessionIdRef = useRef<string | null>(
        isValidSessionUuid(normalizedRouteSessionId)
            ? normalizedRouteSessionId
            : null
    );
    const pollingInFlightRef = useRef<Set<string>>(new Set());
    const inFlightCreationIdsRef = useRef<Set<string>>(new Set());
    const localUnsyncedIdsRef = useRef<Set<string>>(new Set());
    const messagesBySessionRef = useRef<Record<string, ClientAiMessage[]>>({});
    const typingIntervalsRef = useRef<Record<string, number>>({});
    const isMountedRef = useRef<boolean>(true);

    useEffect(() => {
        activeSessionIdRef.current = activeSessionId;
    }, [activeSessionId]);

    useEffect(() => {
        messagesBySessionRef.current = messagesBySession;
    }, [messagesBySession]);

    const persistLastActiveSessionId = useCallback(
        (id: string | null) => {
            if (!user?.id || typeof window === 'undefined') return;
            const key = `torex_ai_active_session_${user.id}`;
            try {
                if (id && isValidSessionUuid(id)) {
                    sessionStorage.setItem(key, id.toLowerCase());
                } else {
                    sessionStorage.removeItem(key);
                }
            } catch {
                // ignore storage errors
            }
        },
        [user?.id]
    );

    const readLastActiveSessionId = useCallback((): string | null => {
        if (!user?.id || typeof window === 'undefined') return null;
        const key = `torex_ai_active_session_${user.id}`;
        try {
            const raw = sessionStorage.getItem(key);
            return isValidSessionUuid(raw) ? raw.trim().toLowerCase() : null;
        } catch {
            return null;
        }
    }, [user?.id]);

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
            Object.values(typingIntervalsRef.current).forEach((id) =>
                window.clearInterval(id)
            );
            typingIntervalsRef.current = {};
        };
    }, []);

    // Mensagens da conversa atualmente aberta
    const activeMessages = useMemo(() => {
        if (!activeSessionId) {
            return draftPendingMessages;
        }
        return messagesBySession[activeSessionId] || [];
    }, [activeSessionId, messagesBySession, draftPendingMessages]);

    const activePendingJob = activeSessionId
        ? pendingJobsBySession[activeSessionId] || null
        : null;
    const activeTypingState = activeSessionId
        ? typingBySession[activeSessionId] || null
        : null;

    // Bloqueia o botão de enviar enquanto a conversa atual está a processar em etapas ou a escrever
    const isCurrentSessionBusy = Boolean(
        isSubmittingSend ||
            draftStageInfo ||
            activePendingJob ||
            activeTypingState
    );

    // Limite dinâmico silencioso por mensagem de acordo com o plano ativo (50 / 250 / 1000)
    const maxInputChars = useMemo(() => {
        if (credits?.maxMessageChars && credits.maxMessageChars > 0) {
            return credits.maxMessageChars;
        }
        return resolveTierCharCap(credits?.planTier || user?.tier);
    }, [credits, user?.tier]);

    useEffect(() => {
        setInputText((prev) =>
            prev.length > maxInputChars ? prev.slice(0, maxInputChars) : prev
        );
    }, [maxInputChars]);

    const displayName = useMemo(() => {
        const raw = user?.name?.trim() || user?.username?.trim() || 'Trader';
        return raw.split(' ')[0];
    }, [user]);

    const humanFirstName = useMemo(
        () => resolveHumanFirstName(user?.name, user?.username),
        [user?.name, user?.username]
    );

    const activeSessionTitle = useMemo(() => {
        if (!activeSessionId) return null;
        return sessions.find((s) => s.id === activeSessionId)?.title || null;
    }, [sessions, activeSessionId]);

    const userInitials = useMemo(() => {
        const full = user?.name?.trim() || user?.username?.trim() || 'T';
        const parts = full.split(/\s+/).filter(Boolean);
        if (parts.length >= 2) {
            return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
        }
        return full.slice(0, 2).toUpperCase();
    }, [user]);

    useEffect(() => {
        setAvatarLoadError(false);
    }, [user?.avatarUrl]);

    const currentAccountLabel = useMemo(() => {
        if (accountSummary?.accountLabel) return accountSummary.accountLabel;
        if (isConsolidated || !selectedAccount) return isEn ? 'All Accounts' : 'Todas as Contas';
        return selectedAccount.name || `MT5 ${selectedAccount.mt5Id || ''}`.trim();
    }, [accountSummary, isConsolidated, selectedAccount, isEn]);

    const startTypewriterForSession = useCallback(
        (targetSessionId: string, targetMessageId: string, fullContent: string) => {
            const cleanFull = String(fullContent || '');
            if (!cleanFull) return;

            const stepChars =
                cleanFull.length <= 120
                    ? 3
                    : cleanFull.length <= 360
                    ? 6
                    : cleanFull.length <= 800
                    ? 11
                    : 16;

            if (typingIntervalsRef.current[targetSessionId]) {
                window.clearInterval(typingIntervalsRef.current[targetSessionId]);
            }

            setTypingBySession((prev) => ({
                ...prev,
                [targetSessionId]: {
                    sessionId: targetSessionId,
                    messageId: targetMessageId,
                    fullText: cleanFull,
                    visibleLength: Math.min(cleanFull.length, stepChars),
                },
            }));

            typingIntervalsRef.current[targetSessionId] = window.setInterval(
                () => {
                    if (!isMountedRef.current) return;
                    setTypingBySession((prev) => {
                        const current = prev[targetSessionId];
                        if (!current || current.messageId !== targetMessageId) {
                            return prev;
                        }
                        const nextLen = current.visibleLength + stepChars;
                        if (nextLen >= current.fullText.length) {
                            if (typingIntervalsRef.current[targetSessionId]) {
                                window.clearInterval(
                                    typingIntervalsRef.current[targetSessionId]
                                );
                                delete typingIntervalsRef.current[targetSessionId];
                            }
                            const clone = { ...prev };
                            delete clone[targetSessionId];
                            return clone;
                        }
                        return {
                            ...prev,
                            [targetSessionId]: {
                                ...current,
                                visibleLength: nextLen,
                            },
                        };
                    });
                },
                20
            );
        },
        []
    );

    const registerPendingJob = useCallback(
        (job: {
            jobId: string;
            sessionId: string;
            fastGreeting?: boolean;
        }) => {
            setPendingJobsBySession((prev) => {
                if (prev[job.sessionId]?.jobId === job.jobId) {
                    return prev;
                }
                const fast = Boolean(job.fastGreeting);
                return {
                    ...prev,
                    [job.sessionId]: {
                        jobId: job.jobId,
                        sessionId: job.sessionId,
                        stages: processingStages,
                        stageIndex: 0,
                        startedAt: Date.now(),
                        minSpinnerMs: fast ? 520 : 850,
                        fastGreeting: fast,
                    },
                };
            });
        },
        [processingStages]
    );

    const loadBootstrap = useCallback(async () => {
        if (!token) return;
        try {
            const params: Record<string, string> = {};
            if (selectedAccountId) params.accountId = selectedAccountId;
            params.locale = locale;
            const res = await api.get('/ai/chat/bootstrap', { params });

            if (Array.isArray(res.data?.sessions)) {
                setSessions(res.data.sessions);
            }
            if (res.data?.accountSummary) {
                setAccountSummary(res.data.accountSummary);
            }
            if (res.data?.credits) {
                setCredits(res.data.credits as ClientAiCreditStatus);
            }
            // Reconecta automaticamente qualquer job assíncrono em andamento (ex.: após trocar de página ou F5)
            if (Array.isArray(res.data?.pendingJobs)) {
                for (const pj of res.data.pendingJobs) {
                    if (pj?.jobId && pj?.sessionId) {
                        registerPendingJob({
                            jobId: pj.jobId,
                            sessionId: pj.sessionId,
                        });
                    }
                }
            }
        } catch {
            // Silencioso no bootstrap
        }
    }, [token, selectedAccountId, locale, registerPendingJob]);

    useEffect(() => {
        void loadBootstrap();
    }, [loadBootstrap]);

    // Sincroniza UUID da URL (/torex-ai/:sessionId?) com o histórico persistido no banco (F5, voltar/avançar, navegação)
    useEffect(() => {
        if (rawRouteSessionId && !isValidSessionUuid(normalizedRouteSessionId)) {
            persistLastActiveSessionId(null);
            setActiveSessionId(null);
            activeSessionIdRef.current = null;
            setIsLoadingSession(false);
            navigate('/torex-ai', { replace: true });
            return;
        }

        if (!rawRouteSessionId) {
            const remembered = readLastActiveSessionId();
            if (remembered) {
                navigate(`/torex-ai/${remembered}`, { replace: true });
                return;
            }
            setActiveSessionId(null);
            activeSessionIdRef.current = null;
            setIsLoadingSession(false);
            return;
        }

        if (!normalizedRouteSessionId) return;

        setActiveSessionId(normalizedRouteSessionId);
        activeSessionIdRef.current = normalizedRouteSessionId;
        persistLastActiveSessionId(normalizedRouteSessionId);
        setUnreadReadySessions((prev) => {
            if (!prev[normalizedRouteSessionId]) return prev;
            const clone = { ...prev };
            delete clone[normalizedRouteSessionId];
            return clone;
        });

        if (
            inFlightCreationIdsRef.current.has(normalizedRouteSessionId) ||
            localUnsyncedIdsRef.current.has(normalizedRouteSessionId)
        ) {
            setIsLoadingSession(false);
            return;
        }

        if (!token) {
            return;
        }

        let cancelled = false;
        const hasCached = Boolean(
            messagesBySessionRef.current[normalizedRouteSessionId]?.length
        );
        if (!hasCached) {
            setIsLoadingSession(true);
        }

        void (async () => {
            try {
                const res = await api.get(
                    `/ai/chat/sessions/${normalizedRouteSessionId}`
                );
                if (cancelled || !isMountedRef.current) return;

                if (res.data?.session) {
                    const loadedSess = res.data.session as ClientAiSession;
                    setSessions((prev) => [
                        loadedSess,
                        ...prev.filter((s) => s.id !== loadedSess.id),
                    ]);
                }

                const fetchedMsgs: ClientAiMessage[] = Array.isArray(
                    res.data?.messages
                )
                    ? res.data.messages
                    : [];

                setMessagesBySession((prev) => ({
                    ...prev,
                    [normalizedRouteSessionId]: mergeUniqueMessages(
                        prev[normalizedRouteSessionId] || [],
                        fetchedMsgs
                    ),
                }));

                if (res.data?.activeJob?.jobId) {
                    registerPendingJob({
                        jobId: res.data.activeJob.jobId,
                        sessionId: normalizedRouteSessionId,
                    });
                }
            } catch (err: any) {
                if (cancelled || !isMountedRef.current) return;
                if (err?.response?.status === 404) {
                    persistLastActiveSessionId(null);
                    setActiveSessionId(null);
                    activeSessionIdRef.current = null;
                    setDraftPendingMessages([]);
                    navigate('/torex-ai', { replace: true });
                } else if (
                    !messagesBySessionRef.current[normalizedRouteSessionId]?.length
                ) {
                    setMessagesBySession((prev) => ({
                        ...prev,
                        [normalizedRouteSessionId]: [
                            {
                                id: `err-sess-${Date.now()}`,
                                role: 'assistant',
                                content: supportFallback,
                                createdAt: new Date().toISOString(),
                            },
                        ],
                    }));
                }
            } finally {
                if (!cancelled && isMountedRef.current) {
                    setIsLoadingSession(false);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [
        rawRouteSessionId,
        normalizedRouteSessionId,
        token,
        persistLastActiveSessionId,
        readLastActiveSessionId,
        registerPendingJob,
        supportFallback,
        navigate,
    ]);

    // Motor assíncrono de avanço de etapas + polling resiliente por jobId/sessionId
    const hasPendingJobs = Object.keys(pendingJobsBySession).length > 0;

    useEffect(() => {
        if (!hasPendingJobs) return;

        const stageTimer = window.setInterval(() => {
            setPendingJobsBySession((prev) => {
                let changed = false;
                const next = { ...prev };
                for (const [sessId, job] of Object.entries(prev)) {
                    if (job.stageIndex < job.stages.length - 1) {
                        next[sessId] = {
                            ...job,
                            stageIndex: job.stageIndex + 1,
                        };
                        changed = true;
                    }
                }
                return changed ? next : prev;
            });
        }, 420);

        const pollOnce = async () => {
            const entries = Object.values(pendingJobsBySession);
            for (const job of entries) {
                if (pollingInFlightRef.current.has(job.jobId)) continue;
                pollingInFlightRef.current.add(job.jobId);

                void (async () => {
                    try {
                        const res = await api.get(`/ai/chat/jobs/${job.jobId}`);
                        if (!isMountedRef.current) return;

                        if (res.data?.status === 'PROCESSING') {
                            return;
                        }

                        const elapsed = Date.now() - job.startedAt;
                        if (elapsed < job.minSpinnerMs) {
                            await new Promise((r) =>
                                window.setTimeout(r, job.minSpinnerMs - elapsed)
                            );
                        }
                        if (!isMountedRef.current) return;

                        const targetSessionId: string =
                            res.data?.sessionId || job.sessionId;
                        const assistantMsg: ClientAiMessage =
                            res.data?.assistantMessage || {
                                id: `fb-job-${Date.now()}`,
                                role: 'assistant',
                                content: supportFallback,
                                createdAt: new Date().toISOString(),
                            };

                        if (res.data?.credits) {
                            setCredits(res.data.credits as ClientAiCreditStatus);
                        }

                        if (res.data?.session) {
                            const updatedSess = res.data.session as ClientAiSession;
                            setSessions((prev) => [
                                updatedSess,
                                ...prev.filter((s) => s.id !== updatedSess.id),
                            ]);
                        }

                        // Persiste a resposta exatamente no chat de origem (targetSessionId)
                        setMessagesBySession((prev) => ({
                            ...prev,
                            [targetSessionId]: mergeUniqueMessages(
                                prev[targetSessionId] || [],
                                [assistantMsg]
                            ),
                        }));

                        setPendingJobsBySession((prev) => {
                            const clone = { ...prev };
                            delete clone[targetSessionId];
                            return clone;
                        });

                        if (activeSessionIdRef.current === targetSessionId) {
                            startTypewriterForSession(
                                targetSessionId,
                                assistantMsg.id,
                                assistantMsg.content
                            );
                        } else {
                            setUnreadReadySessions((prev) => ({
                                ...prev,
                                [targetSessionId]: true,
                            }));
                        }
                    } catch (err: any) {
                        if (!isMountedRef.current) return;
                        // Falhas transitórias de polling (rede, 502, reinício) NÃO encerram o processamento:
                        // o job continua no servidor, que tem o seu próprio guarda de timeout e sempre grava
                        // uma resposta. Só desistimos se o job não existir mais (404) ou após o limite duro.
                        const jobGone = err?.response?.status === 404;
                        if (jobGone || Date.now() - job.startedAt > POLL_GIVE_UP_MS) {
                            const fallbackMsg: ClientAiMessage = {
                                id: `net-fb-${Date.now()}`,
                                role: 'assistant',
                                content: supportFallback,
                                createdAt: new Date().toISOString(),
                            };
                            setMessagesBySession((prev) => ({
                                ...prev,
                                [job.sessionId]: mergeUniqueMessages(
                                    prev[job.sessionId] || [],
                                    [fallbackMsg]
                                ),
                            }));
                            setPendingJobsBySession((prev) => {
                                const clone = { ...prev };
                                delete clone[job.sessionId];
                                return clone;
                            });
                            if (activeSessionIdRef.current === job.sessionId) {
                                startTypewriterForSession(
                                    job.sessionId,
                                    fallbackMsg.id,
                                    fallbackMsg.content
                                );
                            }
                        }
                    } finally {
                        pollingInFlightRef.current.delete(job.jobId);
                    }
                })();
            }
        };

        void pollOnce();
        const pollTimer = window.setInterval(() => {
            void pollOnce();
        }, 1200);

        return () => {
            window.clearInterval(stageTimer);
            window.clearInterval(pollTimer);
        };
    }, [hasPendingJobs, pendingJobsBySession, startTypewriterForSession]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [
        activeMessages,
        activePendingJob?.stageIndex,
        draftStageInfo?.stageIndex,
        activeTypingState?.visibleLength,
    ]);

    const handleSelectSession = (sessionId: string) => {
        setDraftPendingMessages([]);
        setOpenFeedbackMsgId(null);
        setIsMobileDrawerOpen(false);
        setUnreadReadySessions((prev) => {
            if (!prev[sessionId]) return prev;
            const clone = { ...prev };
            delete clone[sessionId];
            return clone;
        });

        // Se for uma sessão temporária local de erro offline, já está no mapa em memória
        if (sessionId.startsWith('offline-')) {
            setActiveSessionId(sessionId);
            activeSessionIdRef.current = sessionId;
            return;
        }

        persistLastActiveSessionId(sessionId);
        if (normalizedRouteSessionId !== sessionId) {
            navigate(`/torex-ai/${sessionId}`);
        }
    };

    const handleStartNewChat = async () => {
        if (isSubmittingSend) return;

        // Evita criar sessões vazias em cascata se o utilizador já estiver numa "Nova Conversa" sem mensagens
        if (activeSessionId && isValidSessionUuid(activeSessionId)) {
            const currentMsgs = messagesBySession[activeSessionId] || [];
            const currentSession = sessions.find((s) => s.id === activeSessionId);
            const normTitle = String(currentSession?.title || '')
                .trim()
                .toLowerCase();
            const isDefaultEmptyTitle =
                !normTitle ||
                normTitle === 'nova conversa' ||
                normTitle === 'new thread' ||
                normTitle === 'new chat';
            if (
                currentMsgs.length === 0 &&
                !pendingJobsBySession[activeSessionId] &&
                isDefaultEmptyTitle
            ) {
                setIsMobileDrawerOpen(false);
                window.setTimeout(() => inputRef.current?.focus(), 50);
                return;
            }
        }

        const newSessionId = generateClientSessionUuid();
        const nowIso = new Date().toISOString();
        const defaultTitle = isEn ? 'New Thread' : 'Nova Conversa';
        const optimisticSession: ClientAiSession = {
            id: newSessionId,
            title: defaultTitle,
            accountId: selectedAccountId || null,
            createdAt: nowIso,
            updatedAt: nowIso,
        };

        inFlightCreationIdsRef.current.add(newSessionId);
        setSessions((prev) => [
            optimisticSession,
            ...prev.filter((s) => s.id !== newSessionId),
        ]);
        setMessagesBySession((prev) => ({
            ...prev,
            [newSessionId]: prev[newSessionId] || [],
        }));
        setActiveSessionId(newSessionId);
        activeSessionIdRef.current = newSessionId;
        setDraftPendingMessages([]);
        setOpenFeedbackMsgId(null);
        setIsMobileDrawerOpen(false);
        persistLastActiveSessionId(newSessionId);
        navigate(`/torex-ai/${newSessionId}`);
        window.setTimeout(() => inputRef.current?.focus(), 50);

        if (token && isOnline) {
            try {
                const res = await api.post('/ai/chat/sessions', {
                    id: newSessionId,
                    accountId: selectedAccountId || null,
                    locale,
                });
                const savedSess: ClientAiSession | undefined = res.data?.session;
                if (savedSess?.id) {
                    setSessions((prev) => [
                        savedSess,
                        ...prev.filter(
                            (s) => s.id !== newSessionId && s.id !== savedSess.id
                        ),
                    ]);
                    if (savedSess.id !== newSessionId) {
                        setMessagesBySession((prev) => {
                            const next = { ...prev };
                            if (next[newSessionId]) {
                                next[savedSess.id] = next[newSessionId];
                                delete next[newSessionId];
                            }
                            return next;
                        });
                        if (activeSessionIdRef.current === newSessionId) {
                            setActiveSessionId(savedSess.id);
                            activeSessionIdRef.current = savedSess.id;
                            persistLastActiveSessionId(savedSess.id);
                            navigate(`/torex-ai/${savedSess.id}`, {
                                replace: true,
                            });
                        }
                    }
                }
            } catch {
                localUnsyncedIdsRef.current.add(newSessionId);
            } finally {
                inFlightCreationIdsRef.current.delete(newSessionId);
            }
        } else {
            inFlightCreationIdsRef.current.delete(newSessionId);
            localUnsyncedIdsRef.current.add(newSessionId);
        }
    };

    const isPersistedMessageUuid = (id: string) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            String(id || '').trim()
        );

    const updateLocalMessageFeedback = useCallback(
        (
            messageId: string,
            nextFeedback: ClientAiMessage['metadata'] extends {
                userFeedback?: infer F;
            }
                ? F
                : any
        ) => {
            setMessagesBySession((prev) => {
                const updated: Record<string, ClientAiMessage[]> = {};
                for (const [sessId, list] of Object.entries(prev)) {
                    let changed = false;
                    const mapped = list.map((m) => {
                        if (m.id !== messageId) return m;
                        changed = true;
                        return {
                            ...m,
                            metadata: {
                                ...(m.metadata || {}),
                                userFeedback: nextFeedback,
                            },
                        };
                    });
                    updated[sessId] = changed ? mapped : list;
                }
                return updated;
            });
        },
        []
    );

    /** Implicit feedback (opened a linked page, copied the reply); never blocks the UI. */
    const sendMessageSignal = (msgId: string, signal: 'ACTION_CLICK' | 'COPY') => {
        if (!isPersistedMessageUuid(msgId)) return;
        void api.post(`/ai/chat/messages/${msgId}/signal`, { signal }).catch(() => undefined);
    };

    const handleCopyMessage = (msgId: string, content: string) => {
        if (!content || typeof navigator === 'undefined' || !navigator.clipboard) {
            return;
        }
        void navigator.clipboard.writeText(content).then(() => {
            sendMessageSignal(msgId, 'COPY');
            setCopiedMessageId(msgId);
            window.setTimeout(() => {
                setCopiedMessageId((prev) => (prev === msgId ? null : prev));
            }, 1800);
        });
    };

    const handleVoteMessage = async (
        msg: ClientAiMessage,
        rating: 1 | -1,
        options?: {
            reasonCode?: string;
            correctionNote?: string;
            toggleOffIfSame?: boolean;
        }
    ) => {
        if (!isPersistedMessageUuid(msg.id) || feedbackSubmittingIds[msg.id]) {
            return;
        }
        const prevFeedback = msg.metadata?.userFeedback || null;
        const shouldRemove =
            Boolean(options?.toggleOffIfSame) && prevFeedback?.rating === rating;

        setFeedbackSubmittingIds((prev) => ({ ...prev, [msg.id]: true }));
        try {
            if (shouldRemove) {
                updateLocalMessageFeedback(msg.id, null);
                await api.delete(`/ai/chat/messages/${msg.id}/feedback`);
                if (openFeedbackMsgId === msg.id) {
                    setOpenFeedbackMsgId(null);
                }
                return;
            }

            const optimistic = {
                rating,
                reasonCode:
                    options?.reasonCode || (rating === 1 ? 'HELPFUL' : 'OTHER'),
                correctionNote: options?.correctionNote ?? prevFeedback?.correctionNote ?? null,
                updatedAtIso: new Date().toISOString(),
            };
            updateLocalMessageFeedback(msg.id, optimistic);

            const res = await api.post(`/ai/chat/messages/${msg.id}/feedback`, {
                rating,
                reasonCode: optimistic.reasonCode,
                correctionNote: options?.correctionNote,
                locale,
            });
            if (res.data?.userFeedback) {
                updateLocalMessageFeedback(msg.id, res.data.userFeedback);
            }
            if (rating === 1 && openFeedbackMsgId === msg.id) {
                setOpenFeedbackMsgId(null);
            }
        } catch {
            updateLocalMessageFeedback(msg.id, prevFeedback);
        } finally {
            setFeedbackSubmittingIds((prev) => {
                const clone = { ...prev };
                delete clone[msg.id];
                return clone;
            });
        }
    };

    const handleDeleteSession = async (
        e: React.MouseEvent,
        sessionId: string
    ) => {
        e.stopPropagation();

        inFlightCreationIdsRef.current.delete(sessionId);
        localUnsyncedIdsRef.current.delete(sessionId);

        if (!sessionId.startsWith('offline-')) {
            try {
                await api.delete(`/ai/chat/sessions/${sessionId}`);
            } catch {
                // ignore delete error
            }
        }

        setSessions((prev) => prev.filter((s) => s.id !== sessionId));
        setMessagesBySession((prev) => {
            const clone = { ...prev };
            delete clone[sessionId];
            return clone;
        });
        setPendingJobsBySession((prev) => {
            const clone = { ...prev };
            delete clone[sessionId];
            return clone;
        });
        if (typingIntervalsRef.current[sessionId]) {
            window.clearInterval(typingIntervalsRef.current[sessionId]);
            delete typingIntervalsRef.current[sessionId];
        }
        setTypingBySession((prev) => {
            const clone = { ...prev };
            delete clone[sessionId];
            return clone;
        });

        if (readLastActiveSessionId() === sessionId) {
            persistLastActiveSessionId(null);
        }

        if (
            activeSessionId === sessionId ||
            normalizedRouteSessionId === sessionId
        ) {
            persistLastActiveSessionId(null);
            setActiveSessionId(null);
            activeSessionIdRef.current = null;
            setDraftPendingMessages([]);
            navigate('/torex-ai', { replace: true });
        }
    };

    const handleSendPrompt = async (promptOverride?: string) => {
        const rawCandidate = String(promptOverride ?? inputText).trim();
        if (!isOnline || !rawCandidate || isCurrentSessionBusy) return;

        const text = rawCandidate.slice(0, maxInputChars);
        if (!text) return;

        const originSessionId = activeSessionId;
        const wasImplicitNew = !originSessionId;
        const targetInitialId =
            originSessionId || generateClientSessionUuid();
        const fastGreeting = isGreetingPrompt(text);

        setInputText('');
        setIsSubmittingSend(true);

        const optimisticUserMsg: ClientAiMessage = {
            id: `temp-user-${Date.now()}`,
            role: 'user',
            content: text,
            createdAt: new Date().toISOString(),
        };

        if (
            wasImplicitNew ||
            localUnsyncedIdsRef.current.has(targetInitialId)
        ) {
            inFlightCreationIdsRef.current.add(targetInitialId);
        }

        if (wasImplicitNew) {
            const nowIso = new Date().toISOString();
            const optimisticSession: ClientAiSession = {
                id: targetInitialId,
                title: text.length > 52 ? `${text.slice(0, 52).trim()}…` : text,
                accountId: selectedAccountId || null,
                createdAt: nowIso,
                updatedAt: nowIso,
            };
            setSessions((prev) => [
                optimisticSession,
                ...prev.filter((s) => s.id !== targetInitialId),
            ]);
            setActiveSessionId(targetInitialId);
            activeSessionIdRef.current = targetInitialId;
            persistLastActiveSessionId(targetInitialId);
            setDraftPendingMessages([]);
            navigate(`/torex-ai/${targetInitialId}`, { replace: true });
        }

        setMessagesBySession((prev) => ({
            ...prev,
            [targetInitialId]: [
                ...(prev[targetInitialId] || []),
                optimisticUserMsg,
            ],
        }));

        setDraftStageInfo({ stages: processingStages, stageIndex: 0 });

        try {
            if (!token) {
                throw new Error('NO_AUTH_TOKEN');
            }

            const res = await api.post('/ai/chat/message', {
                sessionId: targetInitialId,
                message: text,
                accountId: selectedAccountId || null,
                locale,
                async: true,
            });

            inFlightCreationIdsRef.current.delete(targetInitialId);
            localUnsyncedIdsRef.current.delete(targetInitialId);
            setDraftStageInfo(null);

            const returnedSession: ClientAiSession | undefined =
                res.data?.session;
            const savedUserMsg: ClientAiMessage =
                res.data?.userMessage || optimisticUserMsg;

            if (res.data?.credits) {
                setCredits(res.data.credits as ClientAiCreditStatus);
            }

            const targetSessionId =
                returnedSession?.id &&
                !String(returnedSession.id).startsWith('fallback-')
                    ? returnedSession.id
                    : targetInitialId;

            if (
                returnedSession?.id &&
                !String(returnedSession.id).startsWith('fallback-')
            ) {
                setSessions((prev) => [
                    returnedSession,
                    ...prev.filter(
                        (s) =>
                            s.id !== targetInitialId &&
                            s.id !== returnedSession.id
                    ),
                ]);
            }

            if (targetSessionId !== targetInitialId) {
                setMessagesBySession((prev) => {
                    const existing = (prev[targetInitialId] || []).filter(
                        (m) => m.id !== optimisticUserMsg.id
                    );
                    const next = { ...prev };
                    delete next[targetInitialId];
                    next[targetSessionId] = mergeUniqueMessages(
                        next[targetSessionId] || existing,
                        [savedUserMsg]
                    );
                    return next;
                });

                if (activeSessionIdRef.current === targetInitialId) {
                    setActiveSessionId(targetSessionId);
                    activeSessionIdRef.current = targetSessionId;
                    persistLastActiveSessionId(targetSessionId);
                    navigate(`/torex-ai/${targetSessionId}`, {
                        replace: true,
                    });
                }
            } else {
                // Substitui a mensagem otimista pela mensagem real persistida na sessão exata
                setMessagesBySession((prev) => {
                    const base = (prev[targetSessionId] || []).filter(
                        (m) => m.id !== optimisticUserMsg.id
                    );
                    return {
                        ...prev,
                        [targetSessionId]: mergeUniqueMessages(base, [
                            savedUserMsg,
                        ]),
                    };
                });
            }

            // Caso assíncrono normal: acompanha o job até gravar a resposta no targetSessionId
            if (res.data?.async && res.data?.jobId) {
                registerPendingJob({
                    jobId: res.data.jobId,
                    sessionId: targetSessionId,
                    fastGreeting,
                });
            } else if (res.data?.assistantMessage) {
                const immediateAssistant: ClientAiMessage =
                    res.data.assistantMessage;
                setMessagesBySession((prev) => ({
                    ...prev,
                    [targetSessionId]: mergeUniqueMessages(
                        prev[targetSessionId] || [],
                        [immediateAssistant]
                    ),
                }));
                if (activeSessionIdRef.current === targetSessionId) {
                    startTypewriterForSession(
                        targetSessionId,
                        immediateAssistant.id,
                        immediateAssistant.content
                    );
                }
            }
        } catch (err: any) {
            await new Promise((r) => window.setTimeout(r, 450));
            inFlightCreationIdsRef.current.delete(targetInitialId);
            setDraftStageInfo(null);

            if (err?.response?.data?.credits) {
                setCredits(err.response.data.credits as ClientAiCreditStatus);
            }

            if (wasImplicitNew) {
                localUnsyncedIdsRef.current.add(targetInitialId);
            }

            const fallbackAssistantMsg: ClientAiMessage = {
                id: `support-${Date.now()}`,
                role: 'assistant',
                content: supportFallback,
                createdAt: new Date().toISOString(),
            };

            setMessagesBySession((prev) => ({
                ...prev,
                [targetInitialId]: mergeUniqueMessages(
                    prev[targetInitialId] || [],
                    [optimisticUserMsg, fallbackAssistantMsg]
                ),
            }));

            if (activeSessionIdRef.current === targetInitialId) {
                startTypewriterForSession(
                    targetInitialId,
                    fallbackAssistantMsg.id,
                    fallbackAssistantMsg.content
                );
            }
        } finally {
            setIsSubmittingSend(false);
        }
    };

    const toggleVoiceInput = () => {
        if (isCurrentSessionBusy) return;
        const SpeechRecognitionCtor =
            (window as any).SpeechRecognition ||
            (window as any).webkitSpeechRecognition;
        if (!SpeechRecognitionCtor) {
            return;
        }

        if (isListening && recognitionRef.current) {
            recognitionRef.current.stop();
            setIsListening(false);
            return;
        }

        const recognition = new SpeechRecognitionCtor();
        recognition.lang = isEn ? 'en-US' : 'pt-BR';
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;

        recognition.onstart = () => setIsListening(true);
        recognition.onend = () => setIsListening(false);
        recognition.onerror = () => setIsListening(false);
        recognition.onresult = (event: any) => {
            const transcript = event.results?.[0]?.[0]?.transcript || '';
            if (transcript) {
                setInputText((prev) =>
                    (prev ? `${prev} ${transcript}` : transcript).slice(
                        0,
                        maxInputChars
                    )
                );
            }
        };

        recognitionRef.current = recognition;
        recognition.start();
    };

    // Agrupar conversas por período ("Hoje", "Últimos 7 dias" e "Anteriores")
    const groupedSessions = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        const filtered = sessions.filter((s) =>
            !q ? true : s.title.toLowerCase().includes(q)
        );

        const now = new Date();
        const todayPrefix = now.toISOString().slice(0, 10);
        const weekCutoffMs = now.getTime() - 7 * 86_400_000;
        const todayList: ClientAiSession[] = [];
        const weekList: ClientAiSession[] = [];
        const olderList: ClientAiSession[] = [];

        filtered.forEach((s) => {
            const rawDate = String(s.updatedAt || s.createdAt || '');
            const dateStr = rawDate.slice(0, 10);
            const itemMs = new Date(rawDate).getTime();
            if (dateStr === todayPrefix) {
                todayList.push(s);
            } else if (!Number.isNaN(itemMs) && itemMs >= weekCutoffMs) {
                weekList.push(s);
            } else {
                olderList.push(s);
            }
        });

        return { todayList, weekList, olderList };
    }, [sessions, searchQuery]);

    const creditPercent = useMemo(() => {
        if (!credits || credits.dailyLimit <= 0) return 0;
        return Math.min(
            100,
            Math.max(
                0,
                Math.round((credits.creditsRemaining / credits.dailyLimit) * 100)
            )
        );
    }, [credits]);

    const visibleSpinnerInfo = activePendingJob
        ? {
              stages: activePendingJob.stages,
              stageIndex: activePendingJob.stageIndex,
          }
        : draftStageInfo;

    const isEmptyChat =
        activeMessages.length === 0 && !isLoadingSession && !visibleSpinnerInfo;

    useEffect(() => {
        const el = inputRef.current;
        if (!el) return;
        el.style.height = 'auto';
        const nextHeight = Math.min(Math.max(el.scrollHeight, 24), 144);
        el.style.height = `${nextHeight}px`;
    }, [inputText, isEmptyChat]);

    const handleChatScroll = useCallback(() => {
        const el = chatScrollContainerRef.current;
        if (!el) return;
        const distanceFromBottom =
            el.scrollHeight - el.scrollTop - el.clientHeight;
        setShowScrollBottomBtn(distanceFromBottom > 180);
    }, []);

    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        setShowScrollBottomBtn(false);
    }, []);

    const renderSessionRow = (sess: ClientAiSession) => {
        const active = activeSessionId === sess.id;
        const isBgProcessing = Boolean(pendingJobsBySession[sess.id]);
        const hasUnreadReady = Boolean(unreadReadySessions[sess.id]);
        const relDate = formatRelativeSessionDate(
            sess.updatedAt || sess.createdAt,
            isEn
        );

        return (
            <div
                key={sess.id}
                onClick={() => void handleSelectSession(sess.id)}
                className={`group relative flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl text-xs transition-all cursor-pointer ${
                    active
                        ? 'bg-surface-2 text-fg font-medium border border-line shadow-sm'
                        : 'text-fg-muted hover:text-fg hover:bg-surface border border-transparent'
                }`}
            >
                {active && (
                    <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r bg-accent" />
                )}

                <div className="flex items-center gap-2 min-w-0 flex-1 pl-0.5">
                    {isBgProcessing ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-accent shrink-0" />
                    ) : hasUnreadReady ? (
                        <span
                            className="w-2 h-2 rounded-full bg-accent animate-pulse shrink-0"
                            title={isEn ? 'New reply ready' : 'Nova resposta pronta'}
                        />
                    ) : (
                        <MessageSquare
                            className={`w-3.5 h-3.5 shrink-0 ${
                                active ? 'text-accent-fg' : 'text-fg-subtle'
                            }`}
                        />
                    )}
                    <span className="truncate leading-snug">{sess.title}</span>
                </div>

                <div className="flex items-center shrink-0">
                    {relDate && (
                        <span className="text-[10px] font-mono tabular-nums text-fg-subtle group-hover:hidden">
                            {relDate}
                        </span>
                    )}
                    <button
                        type="button"
                        onClick={(e) => void handleDeleteSession(e, sess.id)}
                        className="hidden group-hover:flex p-1 rounded-md text-fg-subtle hover:text-danger-fg hover:bg-danger/10 transition-colors cursor-pointer"
                        title={isEn ? 'Delete conversation' : 'Excluir conversa'}
                    >
                        <Trash2 className="w-3 h-3" />
                    </button>
                </div>
            </div>
        );
    };

    const renderSessionGroup = (label: string, items: ClientAiSession[]) => {
        if (items.length === 0) return null;
        return (
            <div>
                <div className="px-2.5 pb-1.5 flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
                        {label}
                    </span>
                    <span className="text-[10px] font-mono tabular-nums text-fg-subtle/80">
                        {items.length}
                    </span>
                </div>
                <div className="space-y-0.5">{items.map(renderSessionRow)}</div>
            </div>
        );
    };

    const HistorySidebarContent = (
        <div className="h-full flex flex-col bg-canvas-subtle border-r border-line-subtle select-none">
            {/* Cabeçalho da Sidebar Torex AI */}
            <div className="px-3.5 pt-3.5 pb-3 border-b border-line-subtle flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-xl bg-surface border border-line flex items-center justify-center shrink-0 shadow-sm overflow-hidden">
                        <img
                            src={TOREX_LOGO_URL}
                            alt="Torex AI"
                            className="w-5 h-5 rounded object-contain"
                        />
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold tracking-wide text-fg leading-none">
                                TOREX AI
                            </span>
                            <span className="px-1.5 py-0.5 rounded bg-accent/12 border border-accent/25 text-[9px] font-mono font-semibold text-accent-fg leading-none">
                                COACH
                            </span>
                        </div>
                        <div className="text-[10px] text-fg-subtle mt-1 truncate">
                            {isEn
                                ? 'Trading Intelligence'
                                : 'Inteligência Operacional'}
                        </div>
                    </div>
                </div>

                <button
                    type="button"
                    onClick={() => {
                        setIsHistoryOpen(false);
                        setIsMobileDrawerOpen(false);
                    }}
                    className="p-1.5 rounded-lg text-fg-subtle hover:text-fg hover:bg-surface-2 transition-colors cursor-pointer"
                    title={isEn ? 'Hide history' : 'Ocultar histórico'}
                >
                    <PanelLeftClose className="w-4 h-4" />
                </button>
            </div>

            {/* Ação Primária + Busca */}
            <div className="px-3 pt-3 pb-2.5 space-y-2.5">
                <button
                    type="button"
                    onClick={handleStartNewChat}
                    disabled={isSubmittingSend}
                    className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-accent-on text-xs font-semibold shadow-sm transition-all disabled:opacity-50 cursor-pointer"
                >
                    <span className="inline-flex items-center gap-2">
                        <Plus className="w-4 h-4" />
                        <span>{isEn ? 'New Thread' : 'Nova Conversa'}</span>
                    </span>
                    <Sparkles className="w-3.5 h-3.5 opacity-80" />
                </button>

                <div className="relative">
                    <Search className="w-3.5 h-3.5 text-fg-subtle absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={
                            isEn ? 'Search threads...' : 'Buscar conversas...'
                        }
                        className="w-full bg-surface border border-line focus:border-line-strong rounded-xl pl-8 pr-8 py-2 text-xs text-fg placeholder:text-fg-subtle focus:outline-none transition-colors"
                    />
                    {searchQuery && (
                        <button
                            type="button"
                            onClick={() => setSearchQuery('')}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-fg-subtle hover:text-fg cursor-pointer"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>
            </div>

            {/* Lista de Conversas Agrupada */}
            <div className="flex-1 overflow-y-auto px-2.5 py-1 space-y-4 no-scrollbar">
                {renderSessionGroup(
                    isEn ? 'Today' : 'Hoje',
                    groupedSessions.todayList
                )}
                {renderSessionGroup(
                    isEn ? 'Previous 7 Days' : 'Últimos 7 dias',
                    groupedSessions.weekList
                )}
                {renderSessionGroup(
                    isEn ? 'Older' : 'Anteriores',
                    groupedSessions.olderList
                )}

                {groupedSessions.todayList.length === 0 &&
                    groupedSessions.weekList.length === 0 &&
                    groupedSessions.olderList.length === 0 && (
                        <div className="mx-1 mt-3 p-4 rounded-xl bg-surface/60 border border-line-subtle text-center space-y-1.5">
                            <MessageSquare className="w-4 h-4 text-fg-subtle mx-auto" />
                            <div className="text-[11px] font-medium text-fg-muted">
                                {searchQuery.trim()
                                    ? isEn
                                        ? 'No matching threads'
                                        : 'Nenhuma conversa encontrada'
                                    : isEn
                                    ? 'No saved threads yet'
                                    : 'Nenhuma análise salva ainda'}
                            </div>
                            <div className="text-[10px] text-fg-subtle leading-relaxed">
                                {searchQuery.trim()
                                    ? isEn
                                        ? 'Try another search keyword.'
                                        : 'Tente outro termo de busca.'
                                    : isEn
                                    ? 'Start a thread to audit your execution and risk metrics.'
                                    : 'Inicie uma conversa para auditar sua execução e risco.'}
                            </div>
                        </div>
                    )}
            </div>

            {/* Saldo de Créditos & Capacidade AI */}
            {credits && credits.dailyLimit > 0 && (
                <div className="p-3 border-t border-line-subtle">
                    <div className="rounded-xl bg-surface border border-line p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-fg">
                                <Zap className="w-3.5 h-3.5 text-accent shrink-0" />
                                <span>
                                    {isEn ? 'AI Capacity' : 'Créditos Diários'}
                                </span>
                            </span>
                            {credits.planTier && (
                                <span className="px-1.5 py-0.5 rounded bg-surface-2 border border-line text-[9px] font-mono uppercase tracking-wider text-fg-muted">
                                    {credits.planTier}
                                </span>
                            )}
                        </div>

                        <div className="w-full h-1.5 rounded-full bg-canvas-subtle overflow-hidden">
                            <div
                                className={`h-full rounded-full transition-all duration-300 ${
                                    creditPercent <= 15
                                        ? 'bg-danger'
                                        : creditPercent <= 35
                                        ? 'bg-warning'
                                        : 'bg-accent'
                                }`}
                                style={{ width: `${creditPercent}%` }}
                            />
                        </div>

                        <div className="flex items-center justify-between text-[10px] font-mono tabular-nums text-fg-subtle">
                            <span>
                                {credits.creditsRemaining.toLocaleString(
                                    isEn ? 'en-US' : 'pt-BR'
                                )}{' '}
                                /{' '}
                                {credits.dailyLimit.toLocaleString(
                                    isEn ? 'en-US' : 'pt-BR'
                                )}
                            </span>
                            <span>{creditPercent}%</span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );

    const renderComposer = (variant: 'hero' | 'dock') => {
        const isNearCap = inputText.length >= Math.floor(maxInputChars * 0.9);
        const placeholderText = !isOnline
            ? isEn
                ? 'Available online only...'
                : 'Disponível apenas online...'
            : variant === 'hero'
            ? isEn
                ? 'Ask about your executions, expectancy, risk leaks, or workflow...'
                : 'Pergunte sobre suas operações, Edge, disciplina ou como usar a plataforma...'
            : isEn
            ? 'Ask a follow-up question to Torex AI...'
            : 'Escreva uma pergunta ou continuação para o Torex AI...';

        return (
            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    void handleSendPrompt();
                }}
                className={`w-full rounded-2xl bg-surface border border-line focus-within:border-accent/55 focus-within:shadow-focus-accent transition-all ${
                    variant === 'hero' ? 'p-3 sm:p-3.5 shadow-sm' : 'p-2.5 sm:p-3'
                }`}
            >
                <textarea
                    ref={inputRef}
                    rows={1}
                    value={inputText}
                    disabled={!isOnline}
                    maxLength={maxInputChars}
                    onChange={(e) =>
                        setInputText(e.target.value.slice(0, maxInputChars))
                    }
                    onKeyDown={(e) => {
                        if (
                            e.key === 'Enter' &&
                            !e.shiftKey &&
                            !e.nativeEvent.isComposing
                        ) {
                            e.preventDefault();
                            if (
                                isOnline &&
                                inputText.trim() &&
                                !isCurrentSessionBusy
                            ) {
                                void handleSendPrompt();
                            }
                        }
                    }}
                    placeholder={placeholderText}
                    className="w-full resize-none bg-transparent text-[13px] sm:text-sm text-fg placeholder:text-fg-subtle focus:outline-none px-1 py-0.5 leading-relaxed max-h-36 overflow-y-auto disabled:opacity-60"
                />

                <div className="mt-2 pt-2 border-t border-line-subtle flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-surface-2 border border-line text-[10px] font-medium text-fg-muted max-w-[170px] sm:max-w-[220px]">
                            <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                            <span className="truncate">{currentAccountLabel}</span>
                        </span>

                        <span className="hidden md:inline text-[10px] text-fg-subtle">
                            {isEn
                                ? 'Enter to send · Shift+Enter newline'
                                : 'Enter enviar · Shift+Enter quebrar linha'}
                        </span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                        <span
                            className={`text-[10px] font-mono tabular-nums px-1.5 ${
                                isNearCap ? 'text-warning font-semibold' : 'text-fg-subtle'
                            }`}
                        >
                            {inputText.length}/{maxInputChars}
                        </span>

                        <button
                            type="button"
                            onClick={toggleVoiceInput}
                            disabled={!isOnline || isCurrentSessionBusy}
                            className={`p-2 rounded-xl transition-colors cursor-pointer disabled:opacity-40 ${
                                isListening
                                    ? 'bg-danger/15 text-danger-fg animate-pulse'
                                    : 'text-fg-subtle hover:text-fg hover:bg-surface-2'
                            }`}
                            title={
                                isEn ? 'Voice dictation' : 'Ditar pergunta por voz'
                            }
                        >
                            {isListening ? (
                                <MicOff className="w-4 h-4" />
                            ) : (
                                <Mic className="w-4 h-4" />
                            )}
                        </button>

                        <button
                            type="submit"
                            disabled={
                                !isOnline ||
                                !inputText.trim() ||
                                isCurrentSessionBusy
                            }
                            className="h-8 px-3 rounded-xl bg-accent hover:bg-accent-hover text-accent-on text-xs font-semibold inline-flex items-center gap-1.5 transition-all disabled:opacity-40 disabled:pointer-events-none cursor-pointer shrink-0"
                            title={isEn ? 'Send' : 'Enviar'}
                        >
                            {isCurrentSessionBusy ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                                <>
                                    <span className="hidden sm:inline">
                                        {isEn ? 'Send' : 'Enviar'}
                                    </span>
                                    <SendHorizontal className="w-3.5 h-3.5" />
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </form>
        );
    };

    const headlineText = humanFirstName
        ? isEn
            ? `Hello, ${humanFirstName}. What are we auditing today?`
            : `Olá, ${humanFirstName}. O que vamos auditar hoje?`
        : isEn
        ? 'What edge are we auditing today?'
        : 'O que vamos auditar no seu operacional hoje?';

    return (
        <div className="w-full h-full min-h-0 flex overflow-hidden bg-canvas relative">
            {/* Drawer Mobile do Histórico */}
            {isMobileDrawerOpen && (
                <div
                    className="lg:hidden fixed inset-0 z-40 bg-canvas/80 backdrop-blur-sm"
                    onClick={() => setIsMobileDrawerOpen(false)}
                >
                    <div
                        className="w-72 max-w-[85vw] h-full shadow-panel"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {HistorySidebarContent}
                    </div>
                </div>
            )}

            {/* Coluna Lateral Desktop de Histórico */}
            {isHistoryOpen && (
                <aside className="hidden lg:block w-72 h-full shrink-0">
                    {HistorySidebarContent}
                </aside>
            )}

            {/* Palco Principal do Torex AI */}
            <div className="flex-1 flex flex-col min-w-0 h-full relative">
                {/* Barra de Contexto Superior */}
                <header className="h-14 px-4 sm:px-6 border-b border-line-subtle bg-canvas/90 backdrop-blur-md flex items-center justify-between gap-3 shrink-0 z-10">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <button
                            type="button"
                            onClick={() => {
                                if (window.innerWidth < 1024) {
                                    setIsMobileDrawerOpen(true);
                                } else {
                                    setIsHistoryOpen((prev) => !prev);
                                }
                            }}
                            className={`p-2 rounded-xl bg-surface hover:bg-surface-2 border border-line text-fg-muted hover:text-fg transition-colors cursor-pointer ${
                                isHistoryOpen ? 'lg:hidden' : ''
                            }`}
                            title={
                                isEn ? 'Thread history' : 'Histórico de conversas'
                            }
                        >
                            <PanelLeftOpen className="w-4 h-4" />
                        </button>

                        <div className="min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                                <span className="text-xs sm:text-[13px] font-semibold text-fg truncate">
                                    {!isEmptyChat && activeSessionTitle
                                        ? activeSessionTitle
                                        : isEn
                                        ? 'Torex AI · Performance Desk'
                                        : 'Torex AI · Auditoria & Performance'}
                                </span>
                                {visibleSpinnerInfo && (
                                    <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/12 border border-accent/30 text-[10px] font-medium text-accent-fg shrink-0">
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                        <span>
                                            {visibleSpinnerInfo.stages[
                                                visibleSpinnerInfo.stageIndex
                                            ] || visibleSpinnerInfo.stages[0]}
                                        </span>
                                    </span>
                                )}
                            </div>
                            <div className="sm:hidden flex items-center gap-1.5 text-[10px] text-fg-subtle truncate">
                                <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                                <span className="truncate">{currentAccountLabel}</span>
                            </div>
                        </div>
                    </div>

                    {/* Telemetria Rápida da Conta & Nova Conversa */}
                    <div className="flex items-center gap-2 shrink-0">
                        <div className="hidden md:flex items-center gap-1.5">
                            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-surface border border-line text-[11px] text-fg-muted">
                                <Compass className="w-3.5 h-3.5 text-accent shrink-0" />
                                <span className="truncate max-w-[160px] font-medium text-fg">
                                    {currentAccountLabel}
                                </span>
                                {accountSummary && (
                                    <span className="text-fg-subtle font-mono tabular-nums">
                                        · {accountSummary.totalTrades} trades
                                    </span>
                                )}
                            </div>

                            {accountSummary && accountSummary.totalTrades > 0 && (
                                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-surface border border-line text-[11px] font-mono tabular-nums">
                                    <span
                                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                            accountSummary.netPnl > 0
                                                ? 'bg-data-pos'
                                                : accountSummary.netPnl < 0
                                                ? 'bg-data-neg'
                                                : 'bg-fg-subtle'
                                        }`}
                                    />
                                    <span
                                        className={`font-semibold ${
                                            accountSummary.netPnl > 0
                                                ? 'text-accent-fg'
                                                : accountSummary.netPnl < 0
                                                ? 'text-danger-fg'
                                                : 'text-fg'
                                        }`}
                                    >
                                        {formatSignedUsd(
                                            accountSummary.netPnl,
                                            isEn
                                        )}
                                    </span>
                                </div>
                            )}

                            {accountSummary &&
                                accountSummary.totalTrades > 0 &&
                                typeof accountSummary.winRate === 'number' && (
                                    <div className="hidden xl:inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-surface border border-line text-[11px] font-mono tabular-nums text-fg-muted">
                                        <span>WR</span>
                                        <span className="font-semibold text-fg">
                                            {accountSummary.winRate.toFixed(1)}%
                                        </span>
                                    </div>
                                )}
                        </div>

                        {credits && credits.dailyLimit > 0 && (
                            <div
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-surface border border-line text-[11px] font-mono tabular-nums text-fg-muted ${
                                    isHistoryOpen ? 'lg:hidden' : ''
                                }`}
                            >
                                <Zap className="w-3.5 h-3.5 text-accent shrink-0" />
                                <span className="font-semibold text-fg">
                                    {credits.creditsRemaining.toLocaleString(
                                        isEn ? 'en-US' : 'pt-BR'
                                    )}
                                </span>
                            </div>
                        )}

                        {!isEmptyChat && (
                            <button
                                type="button"
                                onClick={handleStartNewChat}
                                disabled={isSubmittingSend}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface hover:bg-surface-2 border border-line text-xs font-medium text-fg transition-colors disabled:opacity-50 cursor-pointer"
                            >
                                <Plus className="w-3.5 h-3.5 text-accent" />
                                <span className="hidden sm:inline">
                                    {isEn ? 'New Thread' : 'Nova Conversa'}
                                </span>
                            </button>
                        )}
                    </div>
                </header>

                {!isOnline && (
                    <div className="mx-4 sm:mx-6 mt-3 px-4 py-2.5 rounded-xl bg-warning/10 border border-warning/30 text-warning text-xs flex items-center gap-2 shrink-0">
                        <WifiOff className="w-4 h-4 shrink-0" />
                        <span>
                            {isEn
                                ? 'You are offline. Previous conversations remain readable, and new messages require an internet connection.'
                                : 'Você está offline. O histórico anterior continua disponível para leitura e o envio de novas mensagens requer conexão com a internet.'}
                        </span>
                    </div>
                )}

                {/* ESTADO INICIAL — COMMAND CENTER */}
                {isEmptyChat ? (
                    <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 sm:py-10 flex flex-col items-center justify-center relative">
                        <div className="pointer-events-none absolute top-12 left-1/2 -translate-x-1/2 w-[360px] h-[220px] rounded-full bg-accent/10 blur-3xl opacity-60" />

                        <div className="w-full max-w-3xl flex flex-col items-center relative z-10">
                            {/* Identidade & Eyebrow */}
                            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface border border-line shadow-sm mb-4">
                                <img
                                    src={TOREX_LOGO_URL}
                                    alt="Torex AI Logo"
                                    className="w-4 h-4 rounded object-contain"
                                />
                                <span className="text-[10px] font-mono font-bold tracking-widest uppercase text-accent-fg">
                                    {isEn
                                        ? 'TOREX AI · PERFORMANCE DESK'
                                        : 'TOREX AI · MESA DE PERFORMANCE'}
                                </span>
                            </div>

                            {/* Título & Subtítulo */}
                            <h1 className="text-2xl sm:text-3xl font-bold text-fg tracking-tight text-center leading-tight">
                                {headlineText}
                            </h1>
                            <div className="mb-6" />

                            {/* Composer Principal */}
                            {renderComposer('hero')}

                            {/* Perguntas Rápidas & Suporte */}
                            <div className="mt-5 pt-4 border-t border-line-subtle w-full">
                                <div className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle mb-2 px-1">
                                    {isEn
                                        ? 'Quick queries & platform guide'
                                        : 'Consultas rápidas & suporte da plataforma'}
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                                    {quickPrompts.map((qPrompt) => (
                                        <button
                                            key={qPrompt}
                                            type="button"
                                            disabled={
                                                !isOnline || isCurrentSessionBusy
                                            }
                                            onClick={() =>
                                                void handleSendPrompt(qPrompt)
                                            }
                                            className="flex items-center gap-2 px-3 py-2 rounded-xl text-left text-xs text-fg-muted hover:text-fg bg-transparent hover:bg-surface border border-transparent hover:border-line transition-all disabled:opacity-50 cursor-pointer"
                                        >
                                            <CornerDownRight className="w-3.5 h-3.5 text-accent shrink-0" />
                                            <span className="truncate">
                                                {qPrompt}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    /* ESTADO DE CONVERSA ATIVA */
                    <>
                        <div
                            ref={chatScrollContainerRef}
                            onScroll={handleChatScroll}
                            className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 relative"
                        >
                            <div className="max-w-3xl mx-auto space-y-6">
                                {isLoadingSession ? (
                                    <div className="py-16 flex flex-col items-center justify-center gap-2.5 text-xs text-fg-muted">
                                        <div className="w-9 h-9 rounded-xl bg-surface border border-line flex items-center justify-center">
                                            <Loader2 className="w-4 h-4 animate-spin text-accent" />
                                        </div>
                                        <span>
                                            {isEn
                                                ? 'Restoring conversation...'
                                                : 'A carregar conversa...'}
                                        </span>
                                    </div>
                                ) : (
                                    activeMessages.map((msg, idx) => {
                                        const msgTime = formatMessageTimestamp(
                                            msg.createdAt,
                                            isEn
                                        );

                                        if (msg.role === 'user') {
                                            return (
                                                <div
                                                    key={msg.id}
                                                    className="flex items-start justify-end gap-3 animate-fade-in-up"
                                                >
                                                    <div className="flex flex-col items-end gap-1 max-w-[82%] min-w-0">
                                                        <div className="flex items-center gap-2 px-1 text-[10px] text-fg-subtle">
                                                            <span>
                                                                {isEn
                                                                    ? 'You'
                                                                    : 'Você'}
                                                            </span>
                                                            {msgTime && (
                                                                <span className="font-mono tabular-nums">
                                                                    {msgTime}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="bg-surface-2 text-fg border border-line-strong rounded-2xl rounded-tr-sm px-4 py-3 text-[13px] sm:text-[13.5px] leading-relaxed shadow-sm whitespace-pre-wrap break-words">
                                                            {msg.content}
                                                        </div>
                                                    </div>

                                                    <div
                                                        className="w-8 h-8 rounded-xl border border-line-strong bg-surface-3 text-fg text-[11px] font-bold flex items-center justify-center shrink-0 mt-5 overflow-hidden shadow-sm"
                                                        title={displayName}
                                                    >
                                                        {user?.avatarUrl &&
                                                        !avatarLoadError ? (
                                                            <img
                                                                src={
                                                                    user.avatarUrl
                                                                }
                                                                alt={displayName}
                                                                onError={() =>
                                                                    setAvatarLoadError(
                                                                        true
                                                                    )
                                                                }
                                                                className="w-full h-full object-cover"
                                                            />
                                                        ) : (
                                                            <span>
                                                                {userInitials}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        }

                                        const isCurrentlyTyping =
                                            activeTypingState?.messageId ===
                                            msg.id;
                                        const renderedContent = isCurrentlyTyping
                                            ? activeTypingState.fullText.slice(
                                                  0,
                                                  activeTypingState.visibleLength
                                              )
                                            : msg.content;

                                        const metrics: ClientAiMetricCard[] =
                                            !isCurrentlyTyping &&
                                            Array.isArray(msg.metadata?.metrics)
                                                ? msg.metadata.metrics
                                                : [];

                                        const actionLinks = !isCurrentlyTyping
                                            ? msg.metadata?.actions || []
                                            : [];

                                        const suggestions =
                                            !isCurrentlyTyping &&
                                            !visibleSpinnerInfo &&
                                            idx === activeMessages.length - 1
                                                ? msg.metadata?.suggestions || []
                                                : [];

                                        const assistantBadge =
                                            resolveAssistantBadge(msg, isEn);

                                        const canRateMessage =
                                            !isCurrentlyTyping &&
                                            msg.intent !== 'support_fallback' &&
                                            msg.provider !==
                                                'support_fallback' &&
                                            isPersistedMessageUuid(msg.id);
                                        const currentFeedback =
                                            msg.metadata?.userFeedback || null;
                                        const isFeedbackOpen =
                                            openFeedbackMsgId === msg.id;

                                        const negativeReasons = isEn
                                            ? [
                                                  {
                                                      code: 'INACCURATE',
                                                      label: 'Inaccurate data',
                                                  },
                                                  {
                                                      code: 'WRONG_INTENT',
                                                      label:
                                                          'Misunderstood intent',
                                                  },
                                                  {
                                                      code: 'GENERIC',
                                                      label: 'Too generic',
                                                  },
                                                  {
                                                      code: 'INCOMPLETE',
                                                      label: 'Incomplete',
                                                  },
                                              ]
                                            : [
                                                  {
                                                      code: 'INACCURATE',
                                                      label:
                                                          'Informação incorreta',
                                                  },
                                                  {
                                                      code: 'WRONG_INTENT',
                                                      label:
                                                          'Não entendeu a pergunta',
                                                  },
                                                  {
                                                      code: 'GENERIC',
                                                      label: 'Muito genérica',
                                                  },
                                                  {
                                                      code: 'INCOMPLETE',
                                                      label: 'Incompleta',
                                                  },
                                              ];

                                        return (
                                            <div
                                                key={msg.id}
                                                className="flex items-start gap-3 animate-fade-in-up"
                                            >
                                                <div className="w-8 h-8 rounded-xl border border-accent/35 bg-surface flex items-center justify-center shrink-0 mt-0.5 shadow-sm">
                                                    <img
                                                        src={TOREX_LOGO_URL}
                                                        alt="Torex AI"
                                                        className="w-5 h-5 rounded object-contain"
                                                    />
                                                </div>

                                                <div className="flex-1 min-w-0 space-y-2.5">
                                                    {/* Cabeçalho do Analista Torex AI */}
                                                    <div className="flex flex-wrap items-center gap-2 px-0.5">
                                                        <span className="text-xs font-semibold text-fg">
                                                            Torex AI
                                                        </span>
                                                        {assistantBadge && (
                                                            <span className="px-2 py-0.5 rounded-md bg-surface-2 border border-line text-[10px] font-medium text-fg-muted">
                                                                {assistantBadge}
                                                            </span>
                                                        )}
                                                        {msgTime && (
                                                            <span className="text-[10px] font-mono tabular-nums text-fg-subtle">
                                                                {msgTime}
                                                            </span>
                                                        )}
                                                    </div>

                                                    {/* Corpo Estruturado da Resposta */}
                                                    <div className="bg-surface border border-line rounded-2xl rounded-tl-sm px-4 sm:px-5 py-3.5 sm:py-4 shadow-sm">
                                                        {renderFormattedText(
                                                            renderedContent,
                                                            isCurrentlyTyping,
                                                            isEn
                                                        )}
                                                    </div>

                                                    {/* Cards Estruturados de Métricas (quando enviados pela IA) */}
                                                    {metrics.length > 0 && (
                                                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                                            {metrics.map(
                                                                (
                                                                    metric,
                                                                    mIdx
                                                                ) => {
                                                                    const isPos =
                                                                        metric.tone ===
                                                                        'positive';
                                                                    const isNeg =
                                                                        metric.tone ===
                                                                        'negative';
                                                                    return (
                                                                        <div
                                                                            key={`${msg.id}-m-${mIdx}`}
                                                                            className="rounded-xl bg-surface border border-line px-3 py-2.5 shadow-sm"
                                                                        >
                                                                            <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-fg-subtle">
                                                                                <span
                                                                                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                                                                        isPos
                                                                                            ? 'bg-data-pos'
                                                                                            : isNeg
                                                                                            ? 'bg-data-neg'
                                                                                            : 'bg-data-1'
                                                                                    }`}
                                                                                />
                                                                                <span className="truncate">
                                                                                    {
                                                                                        metric.label
                                                                                    }
                                                                                </span>
                                                                            </div>
                                                                            <div
                                                                                className={`mt-1 text-sm font-mono font-bold tabular-nums ${
                                                                                    isPos
                                                                                        ? 'text-accent-fg'
                                                                                        : isNeg
                                                                                        ? 'text-danger-fg'
                                                                                        : 'text-fg'
                                                                                }`}
                                                                            >
                                                                                {
                                                                                    metric.value
                                                                                }
                                                                            </div>
                                                                            {metric.subtext && (
                                                                                <div className="mt-0.5 text-[10px] text-fg-subtle truncate">
                                                                                    {
                                                                                        metric.subtext
                                                                                    }
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    );
                                                                }
                                                            )}
                                                        </div>
                                                    )}

                                                    {/* Botões Diretos de Navegação na Plataforma */}
                                                    {actionLinks.length > 0 && (
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            {actionLinks.map(
                                                                (act) => (
                                                                    <Link
                                                                        key={`${msg.id}-${act.route}`}
                                                                        to={
                                                                            act.route
                                                                        }
                                                                        onClick={() =>
                                                                            sendMessageSignal(
                                                                                msg.id,
                                                                                'ACTION_CLICK'
                                                                            )
                                                                        }
                                                                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-accent/10 hover:bg-accent/20 border border-accent/35 text-xs font-semibold text-accent-fg transition-colors"
                                                                    >
                                                                        <span>
                                                                            {
                                                                                act.label
                                                                            }
                                                                        </span>
                                                                        <ArrowUpRight className="w-3.5 h-3.5 shrink-0" />
                                                                    </Link>
                                                                )
                                                            )}
                                                        </div>
                                                    )}

                                                    {/* Barra de Ações & Feedback da Resposta */}
                                                    {!isCurrentlyTyping && (
                                                        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    handleCopyMessage(
                                                                        msg.id,
                                                                        msg.content
                                                                    )
                                                                }
                                                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] text-fg-subtle hover:text-fg hover:bg-surface border border-transparent hover:border-line transition-colors cursor-pointer"
                                                                title={
                                                                    isEn
                                                                        ? 'Copy response'
                                                                        : 'Copiar resposta'
                                                                }
                                                            >
                                                                {copiedMessageId ===
                                                                msg.id ? (
                                                                    <>
                                                                        <Check className="w-3 h-3 text-accent-fg" />
                                                                        <span className="text-accent-fg font-medium">
                                                                            {isEn
                                                                                ? 'Copied'
                                                                                : 'Copiado'}
                                                                        </span>
                                                                    </>
                                                                ) : (
                                                                    <>
                                                                        <Copy className="w-3 h-3" />
                                                                        <span>
                                                                            {isEn
                                                                                ? 'Copy'
                                                                                : 'Copiar'}
                                                                        </span>
                                                                    </>
                                                                )}
                                                            </button>

                                                            {canRateMessage && (
                                                                <>
                                                                    {msg.metadata
                                                                        ?.askFeedback &&
                                                                        !currentFeedback && (
                                                                            <span className="ml-1 text-[11px] font-medium text-accent-fg">
                                                                                {isEn
                                                                                    ? 'Did this answer help?'
                                                                                    : 'Esta resposta ajudou?'}
                                                                            </span>
                                                                        )}
                                                                    <button
                                                                        type="button"
                                                                        disabled={Boolean(
                                                                            feedbackSubmittingIds[
                                                                                msg
                                                                                    .id
                                                                            ]
                                                                        )}
                                                                        onClick={() =>
                                                                            void handleVoteMessage(
                                                                                msg,
                                                                                1,
                                                                                {
                                                                                    toggleOffIfSame:
                                                                                        true,
                                                                                }
                                                                            )
                                                                        }
                                                                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] border transition-colors cursor-pointer disabled:opacity-50 ${
                                                                            currentFeedback?.rating ===
                                                                            1
                                                                                ? 'bg-accent/12 border-accent/35 text-accent-fg font-medium'
                                                                                : 'text-fg-subtle hover:text-accent-fg hover:bg-surface border-transparent hover:border-line'
                                                                        }`}
                                                                        title={
                                                                            isEn
                                                                                ? 'Helpful'
                                                                                : 'Resposta útil'
                                                                        }
                                                                    >
                                                                        <ThumbsUp className="w-3 h-3" />
                                                                        {currentFeedback?.rating ===
                                                                            1 && (
                                                                            <span>
                                                                                {isEn
                                                                                    ? 'Helpful'
                                                                                    : 'Útil'}
                                                                            </span>
                                                                        )}
                                                                    </button>

                                                                    <button
                                                                        type="button"
                                                                        disabled={Boolean(
                                                                            feedbackSubmittingIds[
                                                                                msg
                                                                                    .id
                                                                            ]
                                                                        )}
                                                                        onClick={() => {
                                                                            setOpenFeedbackMsgId(
                                                                                (
                                                                                    prev
                                                                                ) =>
                                                                                    prev ===
                                                                                    msg.id
                                                                                        ? null
                                                                                        : msg.id
                                                                            );
                                                                            if (
                                                                                currentFeedback?.rating !==
                                                                                -1
                                                                            ) {
                                                                                void handleVoteMessage(
                                                                                    msg,
                                                                                    -1,
                                                                                    {
                                                                                        reasonCode:
                                                                                            'OTHER',
                                                                                    }
                                                                                );
                                                                            }
                                                                        }}
                                                                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] border transition-colors cursor-pointer disabled:opacity-50 ${
                                                                            currentFeedback?.rating ===
                                                                            -1
                                                                                ? 'bg-warning/15 border-warning/35 text-warning font-medium'
                                                                                : 'text-fg-subtle hover:text-warning hover:bg-surface border-transparent hover:border-line'
                                                                        }`}
                                                                        title={
                                                                            isEn
                                                                                ? 'Needs improvement'
                                                                                : 'Precisa melhorar'
                                                                        }
                                                                    >
                                                                        <ThumbsDown className="w-3 h-3" />
                                                                    </button>
                                                                </>
                                                            )}
                                                        </div>
                                                    )}

                                                    {/* Painel Rápido de Detalhes (👎) */}
                                                    {canRateMessage &&
                                                        isFeedbackOpen && (
                                                            <div className="bg-surface border border-line rounded-2xl p-3.5 space-y-3 text-xs shadow-sm">
                                                                <div className="flex items-center justify-between gap-2">
                                                                    <span className="font-semibold text-fg">
                                                                        {isEn
                                                                            ? 'What could be improved?'
                                                                            : 'O que pode melhorar nesta resposta?'}
                                                                    </span>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() =>
                                                                            setOpenFeedbackMsgId(
                                                                                null
                                                                            )
                                                                        }
                                                                        className="text-fg-subtle hover:text-fg cursor-pointer"
                                                                        aria-label="Close feedback"
                                                                    >
                                                                        <X className="w-3.5 h-3.5" />
                                                                    </button>
                                                                </div>

                                                                <div className="flex flex-wrap gap-1.5">
                                                                    {negativeReasons.map(
                                                                        (rc) => {
                                                                            const selected =
                                                                                currentFeedback?.reasonCode ===
                                                                                rc.code;
                                                                            return (
                                                                                <button
                                                                                    key={
                                                                                        rc.code
                                                                                    }
                                                                                    type="button"
                                                                                    onClick={() =>
                                                                                        void handleVoteMessage(
                                                                                            msg,
                                                                                            -1,
                                                                                            {
                                                                                                reasonCode:
                                                                                                    rc.code,
                                                                                                correctionNote:
                                                                                                    feedbackNoteDrafts[
                                                                                                        msg
                                                                                                            .id
                                                                                                    ],
                                                                                            }
                                                                                        )
                                                                                    }
                                                                                    className={`px-2.5 py-1 rounded-full text-[11px] border transition-colors cursor-pointer ${
                                                                                        selected
                                                                                            ? 'bg-warning/15 border-warning/40 text-warning font-medium'
                                                                                            : 'bg-canvas border-line text-fg-muted hover:text-fg'
                                                                                    }`}
                                                                                >
                                                                                    {
                                                                                        rc.label
                                                                                    }
                                                                                </button>
                                                                            );
                                                                        }
                                                                    )}
                                                                </div>

                                                                <div className="flex items-center gap-2">
                                                                    <input
                                                                        type="text"
                                                                        maxLength={
                                                                            240
                                                                        }
                                                                        value={
                                                                            feedbackNoteDrafts[
                                                                                msg
                                                                                    .id
                                                                            ] ||
                                                                            ''
                                                                        }
                                                                        onChange={(
                                                                            e
                                                                        ) =>
                                                                            setFeedbackNoteDrafts(
                                                                                (
                                                                                    prev
                                                                                ) => ({
                                                                                    ...prev,
                                                                                    [msg.id]:
                                                                                        e.target.value.slice(
                                                                                            0,
                                                                                            240
                                                                                        ),
                                                                                })
                                                                            )
                                                                        }
                                                                        placeholder={
                                                                            isEn
                                                                                ? 'Optional correction note (no passwords/tokens)...'
                                                                                : 'Sugestão curta opcional (sem senhas ou tokens)...'
                                                                        }
                                                                        className="flex-1 px-3 py-1.5 rounded-xl bg-canvas border border-line text-[11px] text-fg placeholder:text-fg-subtle focus:outline-none focus:border-line-strong"
                                                                    />
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => {
                                                                            void handleVoteMessage(
                                                                                msg,
                                                                                -1,
                                                                                {
                                                                                    reasonCode:
                                                                                        currentFeedback?.reasonCode ||
                                                                                        'OTHER',
                                                                                    correctionNote:
                                                                                        feedbackNoteDrafts[
                                                                                            msg
                                                                                                .id
                                                                                        ] ||
                                                                                        '',
                                                                                }
                                                                            );
                                                                            setOpenFeedbackMsgId(
                                                                                null
                                                                            );
                                                                        }}
                                                                        className="px-3 py-1.5 rounded-xl bg-accent hover:bg-accent-hover text-accent-on text-[11px] font-semibold cursor-pointer"
                                                                    >
                                                                        {isEn
                                                                            ? 'Save'
                                                                            : 'Enviar'}
                                                                    </button>
                                                                    {currentFeedback?.rating ===
                                                                        -1 && (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() =>
                                                                                void handleVoteMessage(
                                                                                    msg,
                                                                                    -1,
                                                                                    {
                                                                                        toggleOffIfSame:
                                                                                            true,
                                                                                    }
                                                                                )
                                                                            }
                                                                            className="text-[11px] text-fg-subtle hover:text-danger-fg cursor-pointer"
                                                                        >
                                                                            {isEn
                                                                                ? 'Remove'
                                                                                : 'Remover'}
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        )}

                                                    {/* Sugestões Contextuais de Continuação */}
                                                    {suggestions.length > 0 && (
                                                        <div className="pt-1 flex flex-wrap items-center gap-2">
                                                            {suggestions.map(
                                                                (sug) => (
                                                                    <button
                                                                        key={sug}
                                                                        type="button"
                                                                        disabled={
                                                                            isCurrentSessionBusy
                                                                        }
                                                                        onClick={() =>
                                                                            void handleSendPrompt(
                                                                                sug
                                                                            )
                                                                        }
                                                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface hover:bg-surface-2 border border-line hover:border-accent/40 text-xs text-fg-muted hover:text-fg transition-all disabled:opacity-50 cursor-pointer"
                                                                    >
                                                                        <Sparkles className="w-3 h-3 text-accent shrink-0" />
                                                                        <span>
                                                                            {sug}
                                                                        </span>
                                                                    </button>
                                                                )
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })
                                )}

                                {/* Spinner Interativo em Etapas */}
                                {visibleSpinnerInfo && (
                                    <div className="flex items-start gap-3 animate-fade-in-up">
                                        <div className="w-8 h-8 rounded-xl border border-accent/45 bg-surface flex items-center justify-center shrink-0 mt-0.5 shadow-sm">
                                            <Loader2 className="w-4 h-4 animate-spin text-accent" />
                                        </div>

                                        <div className="bg-surface border border-line rounded-2xl rounded-tl-sm px-4 py-3.5 space-y-2.5 min-w-[260px] max-w-md shadow-sm">
                                            <div className="flex items-center justify-between gap-4">
                                                <span className="text-xs font-medium text-fg">
                                                    {visibleSpinnerInfo.stages[
                                                        visibleSpinnerInfo
                                                            .stageIndex
                                                    ] ||
                                                        visibleSpinnerInfo
                                                            .stages[0]}
                                                </span>
                                                <span className="text-[10px] font-mono tabular-nums text-fg-subtle">
                                                    {Math.min(
                                                        visibleSpinnerInfo.stageIndex +
                                                            1,
                                                        visibleSpinnerInfo
                                                            .stages.length
                                                    )}
                                                    /
                                                    {
                                                        visibleSpinnerInfo.stages
                                                            .length
                                                    }
                                                </span>
                                            </div>

                                            <div className="flex items-center gap-1.5">
                                                {visibleSpinnerInfo.stages.map(
                                                    (_, sIdx) => (
                                                        <span
                                                            key={`stage-dot-${sIdx}`}
                                                            className={`h-1.5 rounded-full transition-all duration-300 ${
                                                                sIdx <=
                                                                visibleSpinnerInfo.stageIndex
                                                                    ? 'flex-1 bg-accent'
                                                                    : 'w-4 bg-surface-3'
                                                            }`}
                                                        />
                                                    )
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                <div ref={messagesEndRef} />
                            </div>

                            {showScrollBottomBtn && (
                                <div className="sticky bottom-2 flex justify-center pointer-events-none">
                                    <button
                                        type="button"
                                        onClick={scrollToBottom}
                                        className="pointer-events-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-raised border border-line-strong shadow-panel text-xs font-medium text-fg hover:border-accent/50 transition-colors cursor-pointer"
                                    >
                                        <ArrowDown className="w-3.5 h-3.5 text-accent" />
                                        <span>
                                            {isEn
                                                ? 'Jump to latest'
                                                : 'Ir para o final'}
                                        </span>
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Composer Fixo Inferior */}
                        <div className="px-4 sm:px-6 pb-3.5 pt-2.5 border-t border-line-subtle bg-canvas/95 backdrop-blur-md shrink-0">
                            <div className="max-w-3xl mx-auto">
                                {renderComposer('dock')}
                                <div className="mt-1.5 text-center text-[10px] text-fg-subtle">
                                    {isEn
                                        ? 'Educational performance diagnostics grounded on your verified account metrics. Not financial advice.'
                                        : 'Diagnósticos baseados nos dados da sua conta. Conteúdo educativo — não constitui recomendação financeira.'}
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};
