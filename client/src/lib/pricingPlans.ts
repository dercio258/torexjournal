export type WorkspacePlanTier = 'BASIC' | 'PRO' | 'PREMIUM';

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

export function normalizeWorkspaceTierClient(rawTier?: string | null): WorkspacePlanTier | null {
    const clean = String(rawTier || '').trim().toUpperCase();
    if (clean === 'BASIC' || clean === 'BASICO') return 'BASIC';
    if (clean === 'PRO') return 'PRO';
    if (clean === 'PREMIUM') return 'PREMIUM';
    return null;
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
        monthlyDiscountPercent: 20,
        quarterlyDiscountPercent: 5,
        annualDiscountPercent: 25,
        biennialDiscountPercent: 29,
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
        monthlyDiscountPercent: 20,
        quarterlyDiscountPercent: 9,
        annualDiscountPercent: 35,
        biennialDiscountPercent: 44,
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
        monthlyDiscountPercent: 20,
        quarterlyDiscountPercent: 19,
        annualDiscountPercent: 49,
        biennialDiscountPercent: 51,
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

        const source = chosen || fallback;
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

        result.push({
            id: String(source.id || fallback.id),
            tier,
            monthlyPrice,
            annualMonthlyPrice: isLegacyOverpricedBasic
                ? fallback.annualMonthlyPrice
                : source.annualMonthlyPrice !== null && source.annualMonthlyPrice !== undefined
                  ? Number(source.annualMonthlyPrice)
                  : fallback.annualMonthlyPrice,
            compareAtPrice:
                isLegacyOverpricedBasic || Number(source.compareAtPrice || 0) >= 8 && tier === 'BASIC'
                    ? fallback.compareAtPrice
                    : source.compareAtPrice !== null && source.compareAtPrice !== undefined
                      ? Number(source.compareAtPrice)
                      : monthlyPrice,
            promoDiscountPercent: Number(
                isLegacyOverpricedBasic
                    ? fallback.promoDiscountPercent
                    : (source.promoDiscountPercent ?? fallback.promoDiscountPercent ?? 0),
            ),
            monthlyDiscountPercent: Number(
                isLegacyOverpricedBasic
                    ? fallback.monthlyDiscountPercent
                    : (source.monthlyDiscountPercent ?? fallback.monthlyDiscountPercent),
            ),
            quarterlyDiscountPercent: Number(
                isLegacyOverpricedBasic
                    ? fallback.quarterlyDiscountPercent
                    : (source.quarterlyDiscountPercent ?? fallback.quarterlyDiscountPercent),
            ),
            annualDiscountPercent: Number(
                isLegacyOverpricedBasic
                    ? fallback.annualDiscountPercent
                    : (source.annualDiscountPercent ?? fallback.annualDiscountPercent),
            ),
            biennialDiscountPercent: Number(
                isLegacyOverpricedBasic
                    ? fallback.biennialDiscountPercent
                    : (source.biennialDiscountPercent ?? fallback.biennialDiscountPercent),
            ),
            maxTradingAccounts: maxAccounts,
            monthlyBacktestsLimit: Number(
                source.monthlyBacktestsLimit ?? fallback.monthlyBacktestsLimit ?? 0,
            ),
            trialEnabled: Boolean(source.trialEnabled),
            trialDays: Number(source.trialDays || 0),
            aiDailyCredits: aiCredits,
            description: getPlanSubtitleForTier(tier, isEn),
            features: getDefaultFeaturesForTier(tier, aiCredits, isEn),
        });
    }

    return result;
}
