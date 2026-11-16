import React from 'react';
import { ShieldAlert, ShieldCheck, CheckCircle2, XCircle } from 'lucide-react';

export interface TradeBehaviorMlInfo {
    modelVersion?: string;
    modelStatus?: 'TRAINED_PYTORCH' | 'BOOTSTRAP_PYTORCH';
    analyzedAt?: string;
    anomalyScore: number;
    riskLevel: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL' | string;
    activeFlags?: string[];
    probabilities?: Record<string, number>;
    effectiveStrategy?: string;
    effectiveSession?: string;
    executionMode?: string;
    reasons?: string[];
}

export interface TradeBehaviorFeedbackInfo {
    verdict: 'CONFIRM' | 'FALSE_POSITIVE';
    correctedFlags?: string[];
    note?: string | null;
    updatedAt?: string;
}

export const BEHAVIOR_PATTERN_LABELS: Record<string, { pt: string; en: string; shortPt: string; shortEn: string }> = {
    revenge_trading: {
        pt: 'Revenge Trading',
        en: 'Revenge Trading',
        shortPt: 'Revenge',
        shortEn: 'Revenge',
    },
    overtrading_fomo: {
        pt: 'Overtrading / FOMO',
        en: 'Overtrading / FOMO',
        shortPt: 'FOMO',
        shortEn: 'FOMO',
    },
    tilt_risk_escalation: {
        pt: 'Escalamento de Risco (Tilt)',
        en: 'Tilt Risk Escalation',
        shortPt: 'Tilt Risco',
        shortEn: 'Tilt Risk',
    },
    overconfidence_euphoria: {
        pt: 'Excesso de Confiança',
        en: 'Overconfidence / Euphoria',
        shortPt: 'Euforia',
        shortEn: 'Euphoria',
    },
    strategy_session_drift: {
        pt: 'Fuga de Estratégia / Sessão',
        en: 'Strategy / Session Drift',
        shortPt: 'Fuga Padrão',
        shortEn: 'Drift',
    },
    prop_guardrail_breach_risk: {
        pt: 'Risco Limite Prop Firm',
        en: 'Prop Guardrail Risk',
        shortPt: 'Prop Risk',
        shortEn: 'Prop Risk',
    },
};

export function formatBehaviorPatternLabel(code: string, isEn: boolean, short = false): string {
    const entry = BEHAVIOR_PATTERN_LABELS[code];
    if (!entry) return code;
    if (short) return isEn ? entry.shortEn : entry.shortPt;
    return isEn ? entry.en : entry.pt;
}

export function extractTradeBehaviorFlags(raw: any): {
    behavioralMl: TradeBehaviorMlInfo | null;
    behavioralFeedback: TradeBehaviorFeedbackInfo | null;
} {
    const qf = raw?.qualityFlags && typeof raw.qualityFlags === 'object' ? raw.qualityFlags : null;
    const ml = raw?.behavioralMl || qf?.behavioralMl || null;
    const fb = raw?.behavioralFeedback || qf?.behavioralFeedback || null;
    return {
        behavioralMl: ml && typeof ml === 'object' && ml.riskLevel ? (ml as TradeBehaviorMlInfo) : null,
        behavioralFeedback:
            fb && typeof fb === 'object' && (fb.verdict === 'CONFIRM' || fb.verdict === 'FALSE_POSITIVE')
                ? (fb as TradeBehaviorFeedbackInfo)
                : null,
    };
}

interface BehaviorMlBadgeProps {
    ml?: TradeBehaviorMlInfo | null;
    feedback?: TradeBehaviorFeedbackInfo | null;
    isEn?: boolean;
    compact?: boolean;
    hideWhenClean?: boolean;
}

export const BehaviorMlBadge: React.FC<BehaviorMlBadgeProps> = ({
    ml,
    feedback,
    isEn = false,
    compact = true,
    hideWhenClean = true,
}) => {
    if (!ml) {
        if (hideWhenClean) return null;
        return (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium text-fg-subtle bg-surface-2/60 border border-line-subtle">
                —
            </span>
        );
    }

    if (feedback?.verdict === 'FALSE_POSITIVE') {
        if (hideWhenClean) return null;
        return (
            <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface-2 text-fg-subtle border border-line line-through"
                title={isEn ? 'Marked as False Positive by trader' : 'Marcado como Falso Positivo pelo trader'}
            >
                <XCircle className="w-2.5 h-2.5 shrink-0 no-underline" />
                <span>{isEn ? 'False Pos.' : 'Falso Pos.'}</span>
            </span>
        );
    }

    const risk = String(ml.riskLevel || 'LOW').toUpperCase();
    const activeFlags = Array.isArray(ml.activeFlags) ? ml.activeFlags : [];
    const primaryFlag = activeFlags[0];
    const score = Math.round(Number(ml.anomalyScore) || 0);
    const reasonTooltip =
        Array.isArray(ml.reasons) && ml.reasons.length > 0
            ? ml.reasons.join(' · ')
            : `${risk} (${score}/100)`;

    const isAlert = risk === 'CRITICAL' || risk === 'HIGH' || risk === 'MODERATE' || activeFlags.length > 0;
    if (!isAlert) {
        if (hideWhenClean) return null;
        return (
            <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-accent/10 text-accent-fg border border-accent/20"
                title={reasonTooltip}
            >
                <ShieldCheck className="w-3 h-3 shrink-0" />
                <span>{compact ? (isEn ? 'Clean' : 'Disciplinado') : `${isEn ? 'Clean' : 'Disciplinado'} (${score})`}</span>
            </span>
        );
    }

    const toneClass =
        risk === 'CRITICAL'
            ? 'bg-danger/15 text-danger-fg border-danger/30'
            : risk === 'HIGH'
              ? 'bg-warning/15 text-warning border-warning/30'
              : 'bg-warning/10 text-warning border-warning/25';

    const label = primaryFlag
        ? formatBehaviorPatternLabel(primaryFlag, isEn, compact)
        : risk === 'CRITICAL'
          ? isEn
              ? 'Critical Anom.'
              : 'Anomalia Crít.'
          : isEn
            ? 'Behavior Alert'
            : 'Alerta IA';

    return (
        <span
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold border whitespace-nowrap ${toneClass}`}
            title={reasonTooltip}
        >
            <ShieldAlert className="w-3 h-3 shrink-0" />
            <span>{compact ? label : `${label} · ${score}/100`}</span>
            {feedback?.verdict === 'CONFIRM' && (
                <CheckCircle2
                    className="w-2.5 h-2.5 shrink-0 opacity-90"
                    aria-label={isEn ? 'Confirmed by trader' : 'Confirmado pelo trader'}
                />
            )}
        </span>
    );
};
