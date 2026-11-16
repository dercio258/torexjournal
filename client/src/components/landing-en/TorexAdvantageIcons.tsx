import React, { useId } from 'react';

export interface TorexAdvantageIconProps {
    className?: string;
}

export type TorexAdvantageIconKey =
    | 'replay'
    | 'edge-radar'
    | 'behavioral-guard'
    | 'zero-latency-ui'
    | 'mfe-mae-journal'
    | 'autonomous-agent'
    | 'broker-mesh'
    | 'audit-integrity'
    | 'unified-suite'
    | 'trader-concierge';

/**
 * Custom 18x18 verified shield SVG used inside the institutional trust strip.
 */
export const VerifiedShieldIcon: React.FC<TorexAdvantageIconProps> = ({
    className = 'h-[18px] w-[18px] shrink-0',
}) => {
    const uid = useId().replace(/:/g, '');
    const gradId = `shield-grad-${uid}`;

    return (
        <svg
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
            className={className}
        >
            <defs>
                <linearGradient id={gradId} x1="2" y1="2" x2="18" y2="18" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#34D399" />
                    <stop offset="55%" stopColor="#10B981" />
                    <stop offset="100%" stopColor="#38BDF8" />
                </linearGradient>
            </defs>
            <path
                d="M10 2.2L16.5 4.8V9.6C16.5 13.7 13.7 16.9 10 18.1C6.3 16.9 3.5 13.7 3.5 9.6V4.8L10 2.2Z"
                fill={`url(#${gradId})`}
                fillOpacity="0.14"
                stroke={`url(#${gradId})`}
                strokeWidth="1.4"
                strokeLinejoin="round"
            />
            <path
                d="M7.2 10.1L9.1 12L13.1 8"
                stroke="#34D399"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
};

/**
 * 1. Candle-by-Candle Market Replay: viewport frame, 3 OHLC candles, play marker & execution dashed line.
 */
export const ReplayPrecisionIcon: React.FC<TorexAdvantageIconProps> = ({
    className = 'h-10 w-10',
}) => {
    const uid = useId().replace(/:/g, '');
    const gradId = `replay-grad-${uid}`;

    return (
        <svg viewBox="0 0 40 40" fill="none" aria-hidden="true" className={className}>
            <defs>
                <linearGradient id={gradId} x1="4" y1="6" x2="36" y2="34" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#34D399" />
                    <stop offset="55%" stopColor="#10B981" />
                    <stop offset="100%" stopColor="#38BDF8" />
                </linearGradient>
            </defs>
            {/* Layer 1: Structural viewport frame */}
            <rect
                x="4.5"
                y="7"
                width="31"
                height="24"
                rx="4.5"
                fill={`url(#${gradId})`}
                fillOpacity="0.10"
                stroke="rgba(255,255,255,0.18)"
                strokeWidth="1"
            />
            <line
                x1="7.5"
                y1="21.5"
                x2="32.5"
                y2="21.5"
                stroke="rgba(255,255,255,0.22)"
                strokeWidth="1"
                strokeDasharray="2.2 2.2"
            />
            {/* Layer 2: OHLC Candles & play marker */}
            <path
                d="M11.5 11.5V26.5M18 10V24.5"
                stroke={`url(#${gradId})`}
                strokeWidth="1.45"
                strokeLinecap="round"
            />
            <rect
                x="9.5"
                y="14.5"
                width="4"
                height="8"
                rx="1"
                fill={`url(#${gradId})`}
                fillOpacity="0.16"
                stroke={`url(#${gradId})`}
                strokeWidth="1.45"
            />
            <rect
                x="16"
                y="12.5"
                width="4"
                height="7.5"
                rx="1"
                fill={`url(#${gradId})`}
                fillOpacity="0.16"
                stroke={`url(#${gradId})`}
                strokeWidth="1.45"
            />
            <path
                d="M24.5 15V21.8"
                stroke={`url(#${gradId})`}
                strokeWidth="1.45"
                strokeLinecap="round"
            />
            <path
                d="M24.5 23.5L32.5 28L24.5 32.5V23.5Z"
                fill={`url(#${gradId})`}
                fillOpacity="0.16"
                stroke={`url(#${gradId})`}
                strokeWidth="1.45"
                strokeLinejoin="round"
            />
            {/* Layer 3: Telemetry nodes */}
            <circle cx="11.5" cy="11.5" r="1.6" fill="#34D399" />
            <circle cx="24.5" cy="15" r="1.6" fill="#38BDF8" />
        </svg>
    );
};

/**
 * 2. 5-Axis Edge Scoring: calibrated concentric pentagon with translucent gradient polygon & vertex nodes.
 */
export const EdgeRadarIcon: React.FC<TorexAdvantageIconProps> = ({
    className = 'h-10 w-10',
}) => {
    const uid = useId().replace(/:/g, '');
    const gradId = `radar-grad-${uid}`;

    return (
        <svg viewBox="0 0 40 40" fill="none" aria-hidden="true" className={className}>
            <defs>
                <linearGradient id={gradId} x1="6" y1="5" x2="34" y2="35" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#34D399" />
                    <stop offset="50%" stopColor="#10B981" />
                    <stop offset="100%" stopColor="#38BDF8" />
                </linearGradient>
            </defs>
            {/* Layer 1: Concentric pentagon grid & axes */}
            <polygon
                points="20,4.5 34.5,15 29,32.5 11,32.5 5.5,15"
                stroke="rgba(255,255,255,0.18)"
                strokeWidth="1"
                strokeLinejoin="round"
            />
            <polygon
                points="20,10.5 28.8,17 25.5,27.5 14.5,27.5 11.2,17"
                stroke="rgba(255,255,255,0.14)"
                strokeWidth="1"
                strokeLinejoin="round"
            />
            <path
                d="M20 20V4.5M20 20L34.5 15M20 20L29 32.5M20 20L11 32.5M20 20L5.5 15"
                stroke="rgba(255,255,255,0.12)"
                strokeWidth="1"
            />
            {/* Layer 2: Active Edge Score polygon */}
            <polygon
                points="20,7.5 32,16.5 26.8,29.5 13.8,26.8 9.2,16.2"
                fill={`url(#${gradId})`}
                fillOpacity="0.16"
                stroke={`url(#${gradId})`}
                strokeWidth="1.45"
                strokeLinejoin="round"
            />
            {/* Layer 3: Vertex telemetry nodes */}
            <circle cx="20" cy="7.5" r="1.6" fill="#34D399" />
            <circle cx="32" cy="16.5" r="1.6" fill="#38BDF8" />
            <circle cx="26.8" cy="29.5" r="1.6" fill="#34D399" />
            <circle cx="9.2" cy="16.2" r="1.6" fill="#38BDF8" />
        </svg>
    );
};

/**
 * 3. AI Behavioral Leak Detection: minimalist neural mesh crossing a drawdown pulse line with alert node.
 */
export const BehavioralGuardIcon: React.FC<TorexAdvantageIconProps> = ({
    className = 'h-10 w-10',
}) => {
    const uid = useId().replace(/:/g, '');
    const gradId = `behavior-grad-${uid}`;

    return (
        <svg viewBox="0 0 40 40" fill="none" aria-hidden="true" className={className}>
            <defs>
                <linearGradient id={gradId} x1="5" y1="8" x2="35" y2="32" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#34D399" />
                    <stop offset="50%" stopColor="#10B981" />
                    <stop offset="100%" stopColor="#38BDF8" />
                </linearGradient>
            </defs>
            {/* Layer 1: Neural lattice backdrop */}
            <circle
                cx="20"
                cy="20"
                r="14"
                fill={`url(#${gradId})`}
                fillOpacity="0.10"
                stroke="rgba(255,255,255,0.18)"
                strokeWidth="1"
            />
            <path
                d="M11 13L20 10L29 14M11 27L20 30L29 26M11 13V27M29 14V26"
                stroke="rgba(255,255,255,0.18)"
                strokeWidth="1"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            {/* Layer 2: Pulse / drawdown intercept trajectory */}
            <path
                d="M5.5 21H12.5L16 14.5L21 26.5L24.5 18.5L28 21H34.5"
                stroke={`url(#${gradId})`}
                strokeWidth="1.45"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <circle
                cx="21"
                cy="26.5"
                r="3.2"
                fill={`url(#${gradId})`}
                fillOpacity="0.16"
                stroke={`url(#${gradId})`}
                strokeWidth="1.45"
            />
            {/* Layer 3: Nodal detectors */}
            <circle cx="11" cy="13" r="1.6" fill="#34D399" />
            <circle cx="29" cy="14" r="1.6" fill="#38BDF8" />
            <circle cx="21" cy="26.5" r="1.6" fill="#34D399" />
        </svg>
    );
};

/**
 * 4. Engineered for Focus: two clean overlapping windows in crisp isometric depth with command bar.
 */
export const ZeroLatencyUiIcon: React.FC<TorexAdvantageIconProps> = ({
    className = 'h-10 w-10',
}) => {
    const uid = useId().replace(/:/g, '');
    const gradId = `ui-grad-${uid}`;

    return (
        <svg viewBox="0 0 40 40" fill="none" aria-hidden="true" className={className}>
            <defs>
                <linearGradient id={gradId} x1="6" y1="6" x2="34" y2="34" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#34D399" />
                    <stop offset="55%" stopColor="#10B981" />
                    <stop offset="100%" stopColor="#38BDF8" />
                </linearGradient>
            </defs>
            {/* Layer 1: Rear secondary panel */}
            <rect
                x="11"
                y="6.5"
                width="23.5"
                height="18.5"
                rx="3.5"
                fill={`url(#${gradId})`}
                fillOpacity="0.10"
                stroke="rgba(255,255,255,0.18)"
                strokeWidth="1"
            />
            {/* Layer 2: Foreground focused command workspace */}
            <rect
                x="5.5"
                y="13.5"
                width="24"
                height="19.5"
                rx="3.5"
                fill="#02040A"
                fillOpacity="0.82"
            />
            <rect
                x="5.5"
                y="13.5"
                width="24"
                height="19.5"
                rx="3.5"
                fill={`url(#${gradId})`}
                fillOpacity="0.14"
                stroke={`url(#${gradId})`}
                strokeWidth="1.45"
            />
            <path
                d="M5.5 19H29.5M11.5 24H23.5M11.5 28H19"
                stroke={`url(#${gradId})`}
                strokeWidth="1.45"
                strokeLinecap="round"
            />
            {/* Layer 3: Calibrated corner dots */}
            <circle cx="9.5" cy="16.3" r="1.6" fill="#34D399" />
            <circle cx="30" cy="10.2" r="1.6" fill="#38BDF8" />
        </svg>
    );
};

/**
 * 5. Structured Trade Debriefing: technical sheet with Before/After split marker & MFE/MAE excursion bars.
 */
export const MfeMaeJournalIcon: React.FC<TorexAdvantageIconProps> = ({
    className = 'h-10 w-10',
}) => {
    const uid = useId().replace(/:/g, '');
    const gradId = `journal-grad-${uid}`;

    return (
        <svg viewBox="0 0 40 40" fill="none" aria-hidden="true" className={className}>
            <defs>
                <linearGradient id={gradId} x1="7" y1="5" x2="33" y2="35" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#34D399" />
                    <stop offset="55%" stopColor="#10B981" />
                    <stop offset="100%" stopColor="#38BDF8" />
                </linearGradient>
            </defs>
            {/* Layer 1: Technical debrief frame */}
            <rect
                x="7"
                y="5.5"
                width="26"
                height="29"
                rx="4"
                fill={`url(#${gradId})`}
                fillOpacity="0.10"
                stroke="rgba(255,255,255,0.18)"
                strokeWidth="1"
            />
            {/* Before/After vertical chart split */}
            <line
                x1="20"
                y1="9"
                x2="20"
                y2="21.5"
                stroke="rgba(255,255,255,0.25)"
                strokeWidth="1"
                strokeDasharray="2 2"
            />
            {/* Layer 2: Chart curves & MFE/MAE excursion bars */}
            <path
                d="M11 19L15.5 14L20 16.5L24.5 10.5L29 12.5"
                stroke={`url(#${gradId})`}
                strokeWidth="1.45"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <path
                d="M11.5 26H22.5M11.5 30H28.5"
                stroke={`url(#${gradId})`}
                strokeWidth="1.45"
                strokeLinecap="round"
            />
            <path
                d="M25.5 26H28.5"
                stroke="rgba(255,255,255,0.28)"
                strokeWidth="1.45"
                strokeLinecap="round"
            />
            {/* Layer 3: Excursion nodal markers */}
            <circle cx="24.5" cy="10.5" r="1.6" fill="#34D399" />
            <circle cx="15.5" cy="14" r="1.6" fill="#38BDF8" />
        </svg>
    );
};

/**
 * 6. Automated Risk Guardrails: faceted geometric shield with active core & calibrated drawdown limit arc.
 */
export const AutonomousAgentIcon: React.FC<TorexAdvantageIconProps> = ({
    className = 'h-10 w-10',
}) => {
    const uid = useId().replace(/:/g, '');
    const gradId = `agent-grad-${uid}`;

    return (
        <svg viewBox="0 0 40 40" fill="none" aria-hidden="true" className={className}>
            <defs>
                <linearGradient id={gradId} x1="7" y1="4" x2="33" y2="35" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#34D399" />
                    <stop offset="50%" stopColor="#10B981" />
                    <stop offset="100%" stopColor="#38BDF8" />
                </linearGradient>
            </defs>
            {/* Layer 1: Faceted geometric shield */}
            <path
                d="M20 4.5L32.5 9.5V19.5C32.5 27 27.1 32.8 20 35.5C12.9 32.8 7.5 27 7.5 19.5V9.5L20 4.5Z"
                fill={`url(#${gradId})`}
                fillOpacity="0.12"
                stroke="rgba(255,255,255,0.18)"
                strokeWidth="1"
                strokeLinejoin="round"
            />
            {/* Layer 2: Guardrail drawdown limit arc & active core */}
            <path
                d="M12.8 21.2C12.8 17.2 16 14 20 14C24 14 27.2 17.2 27.2 21.2"
                stroke={`url(#${gradId})`}
                strokeWidth="1.45"
                strokeLinecap="round"
            />
            <circle
                cx="20"
                cy="21.5"
                r="4.2"
                fill={`url(#${gradId})`}
                fillOpacity="0.16"
                stroke={`url(#${gradId})`}
                strokeWidth="1.45"
            />
            {/* Layer 3: Calibration nodes */}
            <circle cx="20" cy="21.5" r="1.6" fill="#34D399" />
            <circle cx="27.2" cy="21.2" r="1.6" fill="#38BDF8" />
        </svg>
    );
};

/**
 * 7. 80+ Native Integrations: central hub connected by curved vectors to 3 satellite terminals.
 */
export const BrokerMeshIcon: React.FC<TorexAdvantageIconProps> = ({
    className = 'h-10 w-10',
}) => {
    const uid = useId().replace(/:/g, '');
    const gradId = `mesh-grad-${uid}`;

    return (
        <svg viewBox="0 0 40 40" fill="none" aria-hidden="true" className={className}>
            <defs>
                <linearGradient id={gradId} x1="6" y1="6" x2="34" y2="34" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#34D399" />
                    <stop offset="55%" stopColor="#10B981" />
                    <stop offset="100%" stopColor="#38BDF8" />
                </linearGradient>
            </defs>
            {/* Layer 1: Orbital ring & satellite containers */}
            <circle
                cx="20"
                cy="20"
                r="13.5"
                stroke="rgba(255,255,255,0.16)"
                strokeWidth="1"
                strokeDasharray="2.5 2.5"
            />
            <rect
                x="5"
                y="15.5"
                width="7.5"
                height="7.5"
                rx="2"
                fill={`url(#${gradId})`}
                fillOpacity="0.12"
                stroke="rgba(255,255,255,0.22)"
                strokeWidth="1"
            />
            <rect
                x="27.5"
                y="7"
                width="7.5"
                height="7.5"
                rx="2"
                fill={`url(#${gradId})`}
                fillOpacity="0.12"
                stroke="rgba(255,255,255,0.22)"
                strokeWidth="1"
            />
            <rect
                x="26.5"
                y="26.5"
                width="7.5"
                height="7.5"
                rx="2"
                fill={`url(#${gradId})`}
                fillOpacity="0.12"
                stroke="rgba(255,255,255,0.22)"
                strokeWidth="1"
            />
            {/* Layer 2: Curved sync vectors + central node */}
            <path
                d="M12.5 19.2C15 19.2 15.8 20 17 20M23 18.2C24.5 14.5 25.5 12.2 27.5 11.2M23 22C24.5 24.8 25 27.2 26.5 29.2"
                stroke={`url(#${gradId})`}
                strokeWidth="1.45"
                strokeLinecap="round"
            />
            <circle
                cx="20"
                cy="20"
                r="4.2"
                fill={`url(#${gradId})`}
                fillOpacity="0.16"
                stroke={`url(#${gradId})`}
                strokeWidth="1.45"
            />
            {/* Layer 3: Sync dots */}
            <circle cx="8.8" cy="19.2" r="1.6" fill="#34D399" />
            <circle cx="31.2" cy="10.8" r="1.6" fill="#38BDF8" />
            <circle cx="30.2" cy="30.2" r="1.6" fill="#34D399" />
        </svg>
    );
};

/**
 * 8. Audit-Grade Telemetry: octagonal institutional seal enclosing an ascending equity curve.
 */
export const AuditIntegrityIcon: React.FC<TorexAdvantageIconProps> = ({
    className = 'h-10 w-10',
}) => {
    const uid = useId().replace(/:/g, '');
    const gradId = `audit-grad-${uid}`;

    return (
        <svg viewBox="0 0 40 40" fill="none" aria-hidden="true" className={className}>
            <defs>
                <linearGradient id={gradId} x1="6" y1="6" x2="34" y2="34" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#34D399" />
                    <stop offset="55%" stopColor="#10B981" />
                    <stop offset="100%" stopColor="#38BDF8" />
                </linearGradient>
            </defs>
            {/* Layer 1: Octagonal outer seal */}
            <polygon
                points="14,5.5 26,5.5 34.5,14 34.5,26 26,34.5 14,34.5 5.5,26 5.5,14"
                fill={`url(#${gradId})`}
                fillOpacity="0.10"
                stroke="rgba(255,255,255,0.18)"
                strokeWidth="1"
                strokeLinejoin="round"
            />
            {/* Layer 2: Inner calibrated ring & ascending equity curve */}
            <polygon
                points="15.5,9 24.5,9 31,15.5 31,24.5 24.5,31 15.5,31 9,24.5 9,15.5"
                stroke={`url(#${gradId})`}
                strokeWidth="1.2"
                strokeOpacity="0.55"
                strokeLinejoin="round"
            />
            <path
                d="M12.5 24.5L17.2 20L21.2 22L27.5 14.5"
                stroke={`url(#${gradId})`}
                strokeWidth="1.45"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            {/* Layer 3: Audit vertex dots */}
            <circle cx="12.5" cy="24.5" r="1.6" fill="#38BDF8" />
            <circle cx="27.5" cy="14.5" r="1.6" fill="#34D399" />
        </svg>
    );
};

/**
 * 9. All-in-One Architecture: modular open cube / orbital ring seamlessly linking 4 symmetric quadrants.
 */
export const UnifiedSuiteIcon: React.FC<TorexAdvantageIconProps> = ({
    className = 'h-10 w-10',
}) => {
    const uid = useId().replace(/:/g, '');
    const gradId = `suite-grad-${uid}`;

    return (
        <svg viewBox="0 0 40 40" fill="none" aria-hidden="true" className={className}>
            <defs>
                <linearGradient id={gradId} x1="6" y1="6" x2="34" y2="34" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#34D399" />
                    <stop offset="55%" stopColor="#10B981" />
                    <stop offset="100%" stopColor="#38BDF8" />
                </linearGradient>
            </defs>
            {/* Layer 1: Seamless orbital ring */}
            <circle
                cx="20"
                cy="20"
                r="14"
                stroke="rgba(255,255,255,0.18)"
                strokeWidth="1"
            />
            {/* Layer 2: 4 modular connected quadrants */}
            <rect
                x="8.5"
                y="8.5"
                width="9.5"
                height="9.5"
                rx="2.5"
                fill={`url(#${gradId})`}
                fillOpacity="0.16"
                stroke={`url(#${gradId})`}
                strokeWidth="1.45"
            />
            <rect
                x="22"
                y="8.5"
                width="9.5"
                height="9.5"
                rx="2.5"
                fill={`url(#${gradId})`}
                fillOpacity="0.10"
                stroke={`url(#${gradId})`}
                strokeWidth="1.45"
            />
            <rect
                x="8.5"
                y="22"
                width="9.5"
                height="9.5"
                rx="2.5"
                fill={`url(#${gradId})`}
                fillOpacity="0.10"
                stroke={`url(#${gradId})`}
                strokeWidth="1.45"
            />
            <rect
                x="22"
                y="22"
                width="9.5"
                height="9.5"
                rx="2.5"
                fill={`url(#${gradId})`}
                fillOpacity="0.16"
                stroke={`url(#${gradId})`}
                strokeWidth="1.45"
            />
            {/* Layer 3: Center lock node */}
            <circle cx="20" cy="20" r="1.6" fill="#34D399" />
            <circle cx="26.75" cy="13.25" r="1.6" fill="#38BDF8" />
        </svg>
    );
};

/**
 * 10. Dedicated Support & Network: sleek communication arc with live signal wave & active status dot.
 */
export const TraderConciergeIcon: React.FC<TorexAdvantageIconProps> = ({
    className = 'h-10 w-10',
}) => {
    const uid = useId().replace(/:/g, '');
    const gradId = `support-grad-${uid}`;

    return (
        <svg viewBox="0 0 40 40" fill="none" aria-hidden="true" className={className}>
            <defs>
                <linearGradient id={gradId} x1="6" y1="6" x2="34" y2="34" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#34D399" />
                    <stop offset="55%" stopColor="#10B981" />
                    <stop offset="100%" stopColor="#38BDF8" />
                </linearGradient>
            </defs>
            {/* Layer 1: Outer communication field */}
            <path
                d="M7.5 18.5C7.5 11.6 13.1 6 20 6C26.9 6 32.5 11.6 32.5 18.5C32.5 25.4 26.9 31 20 31H11.5L7.5 34.5V18.5Z"
                fill={`url(#${gradId})`}
                fillOpacity="0.11"
                stroke="rgba(255,255,255,0.18)"
                strokeWidth="1"
                strokeLinejoin="round"
            />
            {/* Layer 2: Sleek arc & live micro-wave signal */}
            <path
                d="M12.8 18.8H16L18.2 14.5L21.5 22.8L23.8 18.8H27.2"
                stroke={`url(#${gradId})`}
                strokeWidth="1.45"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <path
                d="M27.5 9.2C29.8 10.8 31.4 13.2 32 16"
                stroke={`url(#${gradId})`}
                strokeWidth="1.45"
                strokeLinecap="round"
            />
            {/* Layer 3: Active status nodes */}
            <circle cx="29.5" cy="9.5" r="1.6" fill="#34D399" />
            <circle cx="12.8" cy="18.8" r="1.6" fill="#38BDF8" />
        </svg>
    );
};

export const TOREX_ADVANTAGE_ICONS: Record<
    TorexAdvantageIconKey,
    React.ComponentType<TorexAdvantageIconProps>
> = {
    replay: ReplayPrecisionIcon,
    'edge-radar': EdgeRadarIcon,
    'behavioral-guard': BehavioralGuardIcon,
    'zero-latency-ui': ZeroLatencyUiIcon,
    'mfe-mae-journal': MfeMaeJournalIcon,
    'autonomous-agent': AutonomousAgentIcon,
    'broker-mesh': BrokerMeshIcon,
    'audit-integrity': AuditIntegrityIcon,
    'unified-suite': UnifiedSuiteIcon,
    'trader-concierge': TraderConciergeIcon,
};
