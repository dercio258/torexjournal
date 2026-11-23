import { trackButtonClick } from './tracking';

export type PlanTierClient = 'FREE' | 'BASIC' | 'PRO' | 'PREMIUM';

export const TRIAL_DAYS_BY_TIER_CLIENT: Record<'BASIC' | 'PRO' | 'PREMIUM', number> = {
    BASIC: 30,
    PRO: 14,
    PREMIUM: 7,
};

export const RESTRICTED_BASIC_BROKER_KEYS = [
    'deriv',
    'ftmo',
    'fundednext',
    'fundingpips',
    'goatfunded',
    'fivepercent',
    '5ers',
    'alphacapital',
    'maven',
    'e8markets',
    'blueguardian',
    'fxify',
    'thefundedtrader',
    'topstep',
] as const;

export function normalizePlanTier(rawTier?: string | null): PlanTierClient {
    const clean = String(rawTier || '').trim().toUpperCase();
    if (clean === 'PREMIUM' || clean === 'ELITE' || clean === 'VIP' || clean === 'ENTERPRISE') {
        return 'PREMIUM';
    }
    if (clean === 'PRO') {
        return 'PRO';
    }
    if (clean === 'BASIC' || clean === 'BASICO') {
        return 'BASIC';
    }
    return 'FREE';
}

export function isBasicPlanTier(rawTier?: string | null): boolean {
    const normalized = normalizePlanTier(rawTier);
    return normalized === 'BASIC' || normalized === 'FREE';
}

export function isProOrHigherPlanTier(rawTier?: string | null): boolean {
    const normalized = normalizePlanTier(rawTier);
    return normalized === 'PRO' || normalized === 'PREMIUM';
}

export function getStoredUserPlanTier(): PlanTierClient {
    try {
        if (typeof localStorage === 'undefined') return 'FREE';
        const raw = localStorage.getItem('torex_user_cache');
        if (!raw) return 'FREE';
        const parsed = JSON.parse(raw);
        return normalizePlanTier(parsed?.tier);
    } catch {
        return 'FREE';
    }
}

export function canUseGeneralOfflineMode(rawTier?: string | null): boolean {
    const normalized = normalizePlanTier(rawTier);
    return normalized === 'PRO' || normalized === 'PREMIUM';
}

export function canUseReplayOfflineMode(rawTier?: string | null): boolean {
    return normalizePlanTier(rawTier) === 'PREMIUM';
}

export function isRestrictedBasicBrokerName(broker?: string | null): boolean {
    const normalized = String(broker || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!normalized) return false;
    return (
        normalized.includes('propfirm') ||
        RESTRICTED_BASIC_BROKER_KEYS.some((key) => normalized.includes(key))
    );
}

export function openWorkspacePlansModal(
    sourceFeature: string,
    extraDetail?: Record<string, any>,
): void {
    const cleanSource = String(sourceFeature || 'workspace').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_');
    trackButtonClick({
        ctaTag: `upgrade_lock_${cleanSource}`,
        intent: 'upgrade_prompt',
        label: sourceFeature,
        metadata: { sourceFeature: cleanSource, ...(extraDetail || {}) },
    });

    if (typeof window !== 'undefined') {
        window.dispatchEvent(
            new CustomEvent('torex:open-plans-modal', {
                detail: { source: cleanSource, ...(extraDetail || {}) },
            }),
        );
    }
}

export type PricingModalCloseAction = 'LOGOUT' | 'CLOSE_TO_CURRENT_VIEW' | 'NAVIGATE_FALLBACK';

export function resolvePricingModalCloseAction(params: {
    isAuthenticated: boolean;
    hasActivePlan: boolean;
    hasOnClose: boolean;
}): PricingModalCloseAction {
    if (params.isAuthenticated && !params.hasActivePlan) {
        return 'LOGOUT';
    }
    if (params.hasOnClose) {
        return 'CLOSE_TO_CURRENT_VIEW';
    }
    return 'NAVIGATE_FALLBACK';
}
