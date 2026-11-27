export type WorkspacePlanTier = 'BASIC' | 'PRO' | 'PREMIUM';
export type WorkspaceBillingCycle = 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'BIENNIAL';

export const WORKSPACE_BILLING_CYCLES: WorkspaceBillingCycle[] = [
    'MONTHLY',
    'QUARTERLY',
    'YEARLY',
    'BIENNIAL',
];

export interface WorkspacePlanConfig {
    id: string;
    tier: WorkspacePlanTier | string;
    monthlyPrice: number;
    annualMonthlyPrice?: number | null;
    compareAtPrice?: number | null;
    promoDiscountPercent?: number;
    monthlyDiscountPercent: number;
    quarterlyDiscountPercent: number;
    annualDiscountPercent: number;
    biennialDiscountPercent: number;
    maxTradingAccounts?: number;
    monthlyBacktestsLimit?: number;
    trialEnabled: boolean;
    trialDays: number;
    aiDailyCredits: number;
    description?: string;
    features?: string[];
}

export interface CyclePricingBreakdown {
    cycle: WorkspaceBillingCycle;
    months: number;
    baseMonthlyUsd: number;
    effectiveMonthlyUsd: number;
    subtotalUsd: number;
    totalUsd: number;
    discountUsd: number;
    discountPercent: number;
}

export function normalizeWorkspaceTierClient(rawTier?: string | null): WorkspacePlanTier | null {
    const clean = String(rawTier || '').trim().toUpperCase();
    if (clean === 'BASIC' || clean === 'BASICO') return 'BASIC';
    if (clean === 'PRO') return 'PRO';
    if (clean === 'PREMIUM') return 'PREMIUM';
    return null;
}

export function normalizeBillingCycle(
    rawCycle?: string | null,
    fallback: WorkspaceBillingCycle = 'MONTHLY',
): WorkspaceBillingCycle {
    const clean = String(rawCycle || '').trim().toUpperCase();
    if (clean === 'MONTHLY' || clean === 'QUARTERLY' || clean === 'YEARLY' || clean === 'BIENNIAL') {
        return clean;
    }
    if (clean === 'ANNUAL') return 'YEARLY';
    return fallback;
}

export function getCycleMonths(cycle: WorkspaceBillingCycle | string): number {
    const normalized = normalizeBillingCycle(cycle);
    if (normalized === 'BIENNIAL') return 24;
    if (normalized === 'YEARLY') return 12;
    if (normalized === 'QUARTERLY') return 3;
    return 1;
}

export function getCycleDisplayLabel(
    cycle: WorkspaceBillingCycle | string,
    isEn: boolean,
    compact = false,
): string {
    const normalized = normalizeBillingCycle(cycle);
    if (compact) {
        if (isEn) {
            if (normalized === 'BIENNIAL') return 'Biennial (2Y)';
            if (normalized === 'YEARLY') return 'Annual';
            if (normalized === 'QUARTERLY') return 'Quarterly';
            return 'Monthly';
        }
        if (normalized === 'BIENNIAL') return 'Bianual (2A)';
        if (normalized === 'YEARLY') return 'Anual';
        if (normalized === 'QUARTERLY') return 'Trimestral';
        return 'Mensal';
    }
    if (isEn) {
        if (normalized === 'BIENNIAL') return 'Biennial Billing (24m)';
        if (normalized === 'YEARLY') return 'Annual Billing (12m)';
        if (normalized === 'QUARTERLY') return 'Quarterly Billing (3m)';
        return 'Monthly Billing';
    }
    if (normalized === 'BIENNIAL') return 'Cobrança Bianual (24 meses)';
    if (normalized === 'YEARLY') return 'Cobrança Anual (12 meses)';
    if (normalized === 'QUARTERLY') return 'Cobrança Trimestral (3 meses)';
    return 'Cobrança Mensal';
}

export function getDefaultCreditsForTier(tier: string): number {
    const normalized = normalizeWorkspaceTierClient(tier);
    if (normalized === 'PREMIUM') return 4000;
    if (normalized === 'PRO') return 1500;
    return 100;
}

export function getPlanSubtitleForTier(tier: string, isEn: boolean): string {
    const normalized = normalizeWorkspaceTierClient(tier) ?? 'BASIC';
    if (isEn) {
        if (normalized === 'BASIC') return 'For traders building consistency';
        if (normalized === 'PRO') return 'For active, disciplined traders';
        return 'Maximum performance with AI & backtesting';
    }
    if (normalized === 'BASIC') return 'Para quem está começando no trading';
    if (normalized === 'PRO') return 'Para traders ativos e consistentes';
    return 'Performance máxima com IA e backteste';
}

export function getDefaultFeaturesForTier(
    tier: string,
    credits: number,
    isEn: boolean,
): string[] {
    const resolvedCredits =
        Number.isFinite(credits) && credits > 0 ? credits : getDefaultCreditsForTier(tier);
    const formattedCredits = resolvedCredits.toLocaleString(isEn ? 'en-US' : 'pt-BR');
    const normalized = normalizeWorkspaceTierClient(tier) ?? 'BASIC';

    if (isEn) {
        if (normalized === 'BASIC') {
            return [
                '3 Active Trading Accounts',
                `${formattedCredits} AI Credits / month`,
                'Torex AI',
                'Automated Journal',
                'Community',
                'Complete operational reports',
            ];
        }
        if (normalized === 'PRO') {
            return [
                'Unlimited Trading Accounts',
                `${formattedCredits} AI Credits / month`,
                'AI Coach',
                '10 Backtesting Sessions / month',
                'Unlimited Strategy Testing',
                'Trade Replay',
                'Mentor Mode',
                'Monthly reports',
                'Offline Mode',
            ];
        }
        return [
            'Everything in Pro',
            `${formattedCredits} AI Credits / month`,
            'AI Coach',
            '100 Backtesting Sessions / month',
            'Mentor Mode with unlimited invites',
            'Weekly reports',
            'Priority Support',
            'Full Offline Mode',
        ];
    }

    if (normalized === 'BASIC') {
        return [
            '3 Contas de Trading ativas',
            `${formattedCredits} Créditos IA / mês`,
            'Torex AI',
            'Diário Automatizado',
            'Comunidade',
            'Relatórios operacionais completos',
        ];
    }
    if (normalized === 'PRO') {
        return [
            'Contas de Trading ilimitadas',
            `${formattedCredits} Créditos IA / mês`,
            'AI Coach',
            '10 Sessões de Backteste / mês',
            'Teste de Estratégias ilimitado',
            'Replay de Mercado',
            'Modo Mentor',
            'Relatórios mensais',
            'Modo Offline',
        ];
    }
    return [
        'Tudo do Plano Pro',
        `${formattedCredits} Créditos IA / mês`,
        'AI Coach',
        '100 Sessões de Backteste / mês',
        'Modo Mentor com convites ilimitados',
        'Relatórios semanais',
        'Suporte Prioritário',
        'Modo Offline completo',
    ];
}

export const FALLBACK_WORKSPACE_PLANS: WorkspacePlanConfig[] = [
    {
        id: 'fallback-basic',
        tier: 'BASIC',
        monthlyPrice: 2.99,
        annualMonthlyPrice: 2.24,
        compareAtPrice: 2.99,
        promoDiscountPercent: 25,
        monthlyDiscountPercent: 0,
        quarterlyDiscountPercent: 10,
        annualDiscountPercent: 25,
        biennialDiscountPercent: 30,
        maxTradingAccounts: 3,
        monthlyBacktestsLimit: 0,
        trialEnabled: true,
        trialDays: 30,
        aiDailyCredits: 100,
    },
    {
        id: 'fallback-pro',
        tier: 'PRO',
        monthlyPrice: 19.99,
        annualMonthlyPrice: 12.99,
        compareAtPrice: 19.99,
        promoDiscountPercent: 35,
        monthlyDiscountPercent: 0,
        quarterlyDiscountPercent: 15,
        annualDiscountPercent: 35,
        biennialDiscountPercent: 45,
        maxTradingAccounts: -1,
        monthlyBacktestsLimit: 10,
        trialEnabled: true,
        trialDays: 14,
        aiDailyCredits: 1500,
    },
    {
        id: 'fallback-premium',
        tier: 'PREMIUM',
        monthlyPrice: 39.99,
        annualMonthlyPrice: 20.39,
        compareAtPrice: 39.99,
        promoDiscountPercent: 49,
        monthlyDiscountPercent: 0,
        quarterlyDiscountPercent: 20,
        annualDiscountPercent: 49,
        biennialDiscountPercent: 55,
        maxTradingAccounts: -1,
        monthlyBacktestsLimit: 100,
        trialEnabled: true,
        trialDays: 7,
        aiDailyCredits: 4000,
    },
];

const FALLBACK_BY_TIER: Record<WorkspacePlanTier, WorkspacePlanConfig> = {
    BASIC: FALLBACK_WORKSPACE_PLANS[0],
    PRO: FALLBACK_WORKSPACE_PLANS[1],
    PREMIUM: FALLBACK_WORKSPACE_PLANS[2],
};

const CANONICAL_ORDER: WorkspacePlanTier[] = ['BASIC', 'PRO', 'PREMIUM'];

/**
 * Resolves the configured discount percentage for a plan & billing cycle,
 * respecting explicit 0% values and falling back to tier-specific defaults only when absent.
 */
export function getCycleDiscountPercent(
    plan: Partial<WorkspacePlanConfig> | null | undefined,
    rawCycle: WorkspaceBillingCycle | string,
): number {
    const cycle = normalizeBillingCycle(rawCycle);
    const tier = normalizeWorkspaceTierClient(plan?.tier) ?? 'BASIC';
    const fallback = FALLBACK_BY_TIER[tier];

    const pickNumeric = (val: unknown, fb: number): number => {
        if (val === null || val === undefined || val === '') return fb;
        const parsed = Number(val);
        return Number.isFinite(parsed) ? Math.max(0, Math.min(90, parsed)) : fb;
    };

    if (cycle === 'MONTHLY') {
        return pickNumeric(plan?.monthlyDiscountPercent, fallback.monthlyDiscountPercent);
    }
    if (cycle === 'QUARTERLY') {
        return pickNumeric(plan?.quarterlyDiscountPercent, fallback.quarterlyDiscountPercent);
    }
    if (cycle === 'BIENNIAL') {
        return pickNumeric(plan?.biennialDiscountPercent, fallback.biennialDiscountPercent);
    }
    return pickNumeric(plan?.annualDiscountPercent, fallback.annualDiscountPercent);
}

/**
 * Single source of truth mirroring backend `SubscriptionService.getAmountUsd`
 * so Pricing Modal, Checkout Summary, and Payment Gateways always compute identical USD totals.
 */
export function calculatePlanCyclePricing(
    plan: Partial<WorkspacePlanConfig> | null | undefined,
    rawCycle: WorkspaceBillingCycle | string,
): CyclePricingBreakdown {
    const cycle = normalizeBillingCycle(rawCycle);
    const months = getCycleMonths(cycle);
    const tier = normalizeWorkspaceTierClient(plan?.tier) ?? 'BASIC';
    const fallback = FALLBACK_BY_TIER[tier];

    const rawBase = Number(plan?.monthlyPrice);
    const baseMonthlyUsd = Number(
        (Number.isFinite(rawBase) && rawBase > 0 ? rawBase : fallback.monthlyPrice).toFixed(2),
    );
    const subtotalUsd = Number((baseMonthlyUsd * months).toFixed(2));

    let discountPercent = getCycleDiscountPercent(plan, cycle);
    let effectiveMonthlyUsd: number;

    if (cycle === 'YEARLY' && discountPercent === 0) {
        const explicitAnnualMonthly = Number(plan?.annualMonthlyPrice || 0);
        if (
            Number.isFinite(explicitAnnualMonthly) &&
            explicitAnnualMonthly > 0 &&
            explicitAnnualMonthly < baseMonthlyUsd
        ) {
            effectiveMonthlyUsd = Number(explicitAnnualMonthly.toFixed(2));
            discountPercent = Math.round((1 - effectiveMonthlyUsd / baseMonthlyUsd) * 100);
        } else {
            effectiveMonthlyUsd = baseMonthlyUsd;
        }
    } else {
        effectiveMonthlyUsd = Number((baseMonthlyUsd * (1 - discountPercent / 100)).toFixed(2));
    }

    const totalUsd = Number((effectiveMonthlyUsd * months).toFixed(2));
    const discountUsd = Math.max(0, Number((subtotalUsd - totalUsd).toFixed(2)));

    return {
        cycle,
        months,
        baseMonthlyUsd,
        effectiveMonthlyUsd,
        subtotalUsd,
        totalUsd,
        discountUsd,
        discountPercent,
    };
}

export function getMaxDiscountForCycle(
    plans: WorkspacePlanConfig[],
    cycle: WorkspaceBillingCycle,
): { max: number; uniform: boolean } {
    const list = plans.length > 0 ? plans : FALLBACK_WORKSPACE_PLANS;
    const values = list.map((p) => calculatePlanCyclePricing(p, cycle).discountPercent);
    const max = values.length > 0 ? Math.max(...values) : 0;
    const min = values.length > 0 ? Math.min(...values) : 0;
    return { max, uniform: max === min };
}

function buildNormalizedTierPlan(
    tier: WorkspacePlanTier,
    source: any,
    isEn: boolean,
): WorkspacePlanConfig {
    const fallback = FALLBACK_BY_TIER[tier];
    const rawCredits =
        source.aiDailyCredits !== null && source.aiDailyCredits !== undefined
            ? Number(source.aiDailyCredits)
            : fallback.aiDailyCredits;
    const aiCredits =
        tier === 'BASIC' && (!Number.isFinite(rawCredits) || rawCredits <= 0)
            ? 100
            : rawCredits;

    const isLegacyOverpricedBasic = tier === 'BASIC' && Number(source.monthlyPrice) >= 8;
    const monthlyPrice = isLegacyOverpricedBasic
        ? fallback.monthlyPrice
        : Number(source.monthlyPrice || fallback.monthlyPrice);

    const maxAccounts =
        tier === 'BASIC'
            ? Math.max(3, Number(source.maxTradingAccounts ?? 3))
            : Number(source.maxTradingAccounts ?? fallback.maxTradingAccounts ?? -1);

    const rawMonthlyDisc = Number(
        source.monthlyDiscountPercent ?? fallback.monthlyDiscountPercent,
    );
    const rawQuarterlyDisc = Number(
        source.quarterlyDiscountPercent ?? fallback.quarterlyDiscountPercent,
    );
    const rawAnnualDisc = Number(
        source.annualDiscountPercent ?? fallback.annualDiscountPercent,
    );
    const rawBiennialDisc = Number(
        source.biennialDiscountPercent ?? fallback.biennialDiscountPercent,
    );

    // Guard against legacy inverted discount rows (e.g. Monthly 20% > Quarterly 5%)
    const hasInvertedLegacyDiscounts =
        rawMonthlyDisc > rawQuarterlyDisc ||
        rawQuarterlyDisc > rawAnnualDisc ||
        rawAnnualDisc > rawBiennialDisc;

    const useFallbackDiscounts = isLegacyOverpricedBasic || hasInvertedLegacyDiscounts;

    return {
        id: String(source.id || fallback.id),
        tier,
        monthlyPrice,
        annualMonthlyPrice: useFallbackDiscounts
            ? Number((monthlyPrice * (1 - fallback.annualDiscountPercent / 100)).toFixed(2))
            : source.annualMonthlyPrice !== null && source.annualMonthlyPrice !== undefined
              ? Number(source.annualMonthlyPrice)
              : Number((monthlyPrice * (1 - rawAnnualDisc / 100)).toFixed(2)),
        compareAtPrice:
            isLegacyOverpricedBasic || (Number(source.compareAtPrice || 0) >= 8 && tier === 'BASIC')
                ? fallback.compareAtPrice
                : source.compareAtPrice !== null && source.compareAtPrice !== undefined
                  ? Number(source.compareAtPrice)
                  : monthlyPrice,
        promoDiscountPercent: Number(
            useFallbackDiscounts
                ? fallback.promoDiscountPercent
                : (source.promoDiscountPercent ?? fallback.promoDiscountPercent ?? 0),
        ),
        monthlyDiscountPercent: useFallbackDiscounts
            ? fallback.monthlyDiscountPercent
            : rawMonthlyDisc,
        quarterlyDiscountPercent: useFallbackDiscounts
            ? fallback.quarterlyDiscountPercent
            : rawQuarterlyDisc,
        annualDiscountPercent: useFallbackDiscounts
            ? fallback.annualDiscountPercent
            : rawAnnualDisc,
        biennialDiscountPercent: useFallbackDiscounts
            ? fallback.biennialDiscountPercent
            : rawBiennialDisc,
        maxTradingAccounts: maxAccounts,
        monthlyBacktestsLimit: Number(
            source.monthlyBacktestsLimit ?? fallback.monthlyBacktestsLimit ?? 0,
        ),
        trialEnabled: Boolean(source.trialEnabled),
        trialDays: Number(source.trialDays || 0),
        aiDailyCredits: aiCredits,
        description: getPlanSubtitleForTier(tier, isEn),
        features: getDefaultFeaturesForTier(tier, aiCredits, isEn),
    };
}

/**
 * Normalizes a SINGLE selected plan without collapsing PRO or PREMIUM into BASIC.
 */
export function normalizeSingleWorkspacePlan(
    rawPlan: any,
    isEn: boolean,
): WorkspacePlanConfig | null {
    if (!rawPlan) return null;
    const tier = normalizeWorkspaceTierClient(rawPlan?.tier);
    if (!tier) return rawPlan as WorkspacePlanConfig;
    return buildNormalizedTierPlan(tier, rawPlan, isEn);
}

/**
 * Deduplicates legacy tiers (e.g. duplicate $9/$10 BASIC/BASICO rows) so only one
 * BASIC ($2.99 / 100 AI credits / 3 accounts), PRO, and PREMIUM plan exist,
 * with locale-strict descriptions and feature labels.
 */
export function normalizeWorkspacePlansCatalog(
    rawPlans: any[] | null | undefined,
    isEn: boolean,
): WorkspacePlanConfig[] {
    const grouped = new Map<WorkspacePlanTier, any[]>();
    for (const plan of rawPlans || []) {
        const tier = normalizeWorkspaceTierClient(plan?.tier);
        if (!tier) continue;
        const list = grouped.get(tier) || [];
        list.push(plan);
        grouped.set(tier, list);
    }

    const result: WorkspacePlanConfig[] = [];
    for (const tier of CANONICAL_ORDER) {
        const candidates = grouped.get(tier) || [];
        const fallback = FALLBACK_BY_TIER[tier];

        let chosen: any = null;
        if (candidates.length > 0) {
            const ranked = [...candidates].sort((a, b) => {
                const aExact = String(a?.tier || '').trim().toUpperCase() === tier ? 0 : 1;
                const bExact = String(b?.tier || '').trim().toUpperCase() === tier ? 0 : 1;
                if (aExact !== bExact) return aExact - bExact;

                const aPriceMatch =
                    Math.abs(Number(a?.monthlyPrice || 0) - fallback.monthlyPrice) < 0.05 ? 0 : 1;
                const bPriceMatch =
                    Math.abs(Number(b?.monthlyPrice || 0) - fallback.monthlyPrice) < 0.05 ? 0 : 1;
                if (aPriceMatch !== bPriceMatch) return aPriceMatch - bPriceMatch;

                return Number(a?.monthlyPrice || 0) - Number(b?.monthlyPrice || 0);
            });
            chosen = ranked[0];
        }

        result.push(buildNormalizedTierPlan(tier, chosen || fallback, isEn));
    }

    return result;
}
