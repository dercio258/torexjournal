import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { UserEntity } from '../users/user.entity';
import { Subscription, SubscriptionStatus } from '../payment/subscription.entity';

export type NetworkGroup =
    | 'social'
    | 'paid_ads'
    | 'search'
    | 'messaging'
    | 'referral'
    | 'direct'
    | 'other';

export interface ClassifiedOrigin {
    channelKey: string;
    channelLabel: string;
    networkGroup: NetworkGroup;
    isSocial: boolean;
    rawSource: string | null;
    medium: string | null;
    campaign: string | null;
    content: string | null;
    term: string | null;
    clickIdType: 'fbclid' | 'gclid' | 'ttclid' | 'msclkid' | null;
    clickId: string | null;
    landingPath: string | null;
    referrerHost: string | null;
    utmSummary: string | null;
}

export type AdminPlanStatus = 'ACTIVE' | 'EXPIRED' | 'PENDING' | 'FREE';

export interface PlanClassification {
    planStatus: AdminPlanStatus;
    statusLabel: string;
    isActivePlan: boolean;
    isExpiredPlan: boolean;
    hasEverConverted: boolean;
    planTier: string | null;
    expiresAt: string | null;
    daysLeft: number | null;
    expiredDaysAgo: number | null;
    cycle: string | null;
    paymentMethod: string | null;
    latestSubscriptionId: string | null;
}

export interface JourneySignalsInput {
    emailVerified: boolean;
    hasLoggedIn: boolean;
    onboardingCompleted: boolean;
    visitedPagesCount: number;
    visitedPricingOrCheckout: boolean;
    clickedCtaCount: number;
    importedTradesCount: number;
    importsTotalCount: number;
    accountsConnectedCount: number;
    journalEntriesCount: number;
    backtestSessionsCount: number;
    aiSessionsCount: number;
    whatsappLinked: boolean;
    emailOpensCount: number;
    planStatus: AdminPlanStatus;
    expiredDaysAgo: number | null;
    daysLeft: number | null;
    daysSinceSignup: number;
    daysSinceLastActive: number | null;
    failedImportsCount: number;
    hasWhatsapp: boolean;
}

export interface JourneyChecklist {
    emailVerified: boolean;
    hasLoggedIn: boolean;
    completedOnboarding: boolean;
    visitedPricingOrCheckout: boolean;
    clickedCta: boolean;
    importedTrades: boolean;
    usedProductTools: boolean;
    convertedPaid: boolean;
}

export interface JourneySummary {
    engagementScore: number;
    funnelStage: 'REGISTERED' | 'EXPLORING' | 'ACTIVATED' | 'CHECKOUT_INTENT' | 'PAYING' | 'CHURNED';
    funnelLabel: string;
    checklist: JourneyChecklist;
    recommendations: string[];
}

export interface OriginPerformanceMetric {
    channelKey: string;
    channelLabel: string;
    networkGroup: NetworkGroup;
    isSocial: boolean;
    users: number;
    verified: number;
    imported: number;
    converted: number;
    activePlans: number;
    expiredPlans: number;
    conversionRatePct: number;
    activationRatePct: number;
    revenue: number;
}

function cleanStr(val: any, maxLen = 200): string | null {
    if (typeof val !== 'string') return null;
    const trimmed = val.trim();
    return trimmed ? trimmed.slice(0, maxLen) : null;
}

function extractHost(rawUrl?: string | null): string | null {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    try {
        return new URL(rawUrl).hostname.replace(/^www\./, '').toLowerCase();
    } catch {
        return null;
    }
}

export function classifyUserOrigin(input: {
    acquisitionSource?: string | null;
    acquisitionMedium?: string | null;
    acquisitionCampaign?: string | null;
    acquisitionContent?: string | null;
    acquisitionTerm?: string | null;
    landingPath?: string | null;
    referrer?: string | null;
    attributionData?: any;
}): ClassifiedOrigin {
    const firstTouch = input.attributionData?.firstTouch || {};
    const lastTouch = input.attributionData?.lastTouch || {};
    const params: Record<string, string> = {
        ...(typeof firstTouch?.params === 'object' && firstTouch?.params ? firstTouch.params : {}),
        ...(typeof lastTouch?.params === 'object' && lastTouch?.params ? lastTouch.params : {}),
    };

    const rawSource = cleanStr(input.acquisitionSource, 160) || cleanStr(params.utm_source, 160);
    const medium = cleanStr(input.acquisitionMedium, 160) || cleanStr(params.utm_medium, 160);
    const campaign = cleanStr(input.acquisitionCampaign, 200) || cleanStr(params.utm_campaign, 200);
    const content = cleanStr(input.acquisitionContent, 200) || cleanStr(params.utm_content, 200);
    const term = cleanStr(input.acquisitionTerm, 200) || cleanStr(params.utm_term, 200);
    const landingPath = cleanStr(input.landingPath, 512) || cleanStr(firstTouch?.landingPath, 512);
    const referrerHost = extractHost(input.referrer) || extractHost(firstTouch?.referrer);

    let clickIdType: ClassifiedOrigin['clickIdType'] = null;
    let clickId: string | null = null;
    if (params.fbclid) {
        clickIdType = 'fbclid';
        clickId = cleanStr(params.fbclid, 200);
    } else if (params.gclid) {
        clickIdType = 'gclid';
        clickId = cleanStr(params.gclid, 200);
    } else if (params.ttclid) {
        clickIdType = 'ttclid';
        clickId = cleanStr(params.ttclid, 200);
    } else if (params.msclkid) {
        clickIdType = 'msclkid';
        clickId = cleanStr(params.msclkid, 200);
    }

    const srcNorm = (rawSource || '').toLowerCase();
    const medNorm = (medium || '').toLowerCase();
    const campNorm = (campaign || '').toLowerCase();
    const contNorm = (content || '').toLowerCase();
    const refNorm = (referrerHost || '').toLowerCase();
    const combinedMeta = `${srcNorm} ${medNorm} ${campNorm} ${contNorm} ${refNorm}`;

    let channelKey = 'direct';
    let channelLabel = 'Direto / Orgânico';
    let networkGroup: NetworkGroup = 'direct';
    let isSocial = false;

    const mentionsInstagram =
        srcNorm === 'ig' ||
        srcNorm === 'instagram' ||
        srcNorm === 'instagram_ads' ||
        refNorm.includes('instagram.') ||
        refNorm === 'ig.me' ||
        /\b(ig|instagram|reels|stories)\b/i.test(combinedMeta);

    const mentionsFacebook =
        srcNorm === 'fb' ||
        srcNorm === 'facebook' ||
        srcNorm === 'facebook_ads' ||
        refNorm.includes('facebook.') ||
        refNorm.includes('fb.') ||
        /\b(fb|facebook|feed_fb)\b/i.test(combinedMeta);

    if (mentionsInstagram && !srcNorm.includes('tiktok') && !srcNorm.includes('google')) {
        channelKey = 'instagram';
        channelLabel = 'Instagram';
        networkGroup = 'social';
        isSocial = true;
    } else if (mentionsFacebook && !srcNorm.includes('tiktok') && !srcNorm.includes('google')) {
        channelKey = 'facebook';
        channelLabel = 'Facebook';
        networkGroup = 'social';
        isSocial = true;
    } else if (
        srcNorm === 'meta_ads' ||
        srcNorm === 'meta' ||
        srcNorm === 'instagram_facebook' ||
        clickIdType === 'fbclid'
    ) {
        channelKey = 'meta_ads';
        channelLabel = 'Meta Ads (FB/IG)';
        networkGroup = 'social';
        isSocial = true;
    } else if (srcNorm.includes('tiktok') || clickIdType === 'ttclid' || refNorm.includes('tiktok.')) {
        channelKey = 'tiktok';
        channelLabel = 'TikTok';
        networkGroup = 'social';
        isSocial = true;
    } else if (srcNorm.includes('youtube') || refNorm.includes('youtube.') || refNorm.includes('youtu.be')) {
        channelKey = 'youtube';
        channelLabel = 'YouTube';
        networkGroup = 'social';
        isSocial = true;
    } else if (srcNorm.includes('whatsapp') || srcNorm === 'wa' || refNorm.includes('whatsapp')) {
        channelKey = 'whatsapp';
        channelLabel = 'WhatsApp';
        networkGroup = 'messaging';
        isSocial = true;
    } else if (srcNorm.includes('telegram') || refNorm.includes('t.me') || refNorm.includes('telegram')) {
        channelKey = 'telegram';
        channelLabel = 'Telegram';
        networkGroup = 'messaging';
        isSocial = true;
    } else if (srcNorm === 'twitter' || srcNorm === 'x' || refNorm.includes('twitter.') || refNorm === 'x.com' || refNorm === 't.co') {
        channelKey = 'x_twitter';
        channelLabel = 'X / Twitter';
        networkGroup = 'social';
        isSocial = true;
    } else if (srcNorm.includes('linkedin') || refNorm.includes('linkedin.')) {
        channelKey = 'linkedin';
        channelLabel = 'LinkedIn';
        networkGroup = 'social';
        isSocial = true;
    } else if (
        srcNorm === 'google_ads' ||
        clickIdType === 'gclid' ||
        ((srcNorm === 'google' || refNorm.includes('google.')) &&
            /(cpc|ppc|paid|adwords|pmax)/i.test(medNorm))
    ) {
        channelKey = 'google_ads';
        channelLabel = 'Google Ads';
        networkGroup = 'paid_ads';
    } else if (srcNorm === 'google_organic' || srcNorm === 'google' || refNorm.includes('google.')) {
        channelKey = 'google_organic';
        channelLabel = 'Google Orgânico';
        networkGroup = 'search';
    } else if (srcNorm === 'microsoft_ads' || clickIdType === 'msclkid' || srcNorm.includes('bing') || refNorm.includes('bing.')) {
        channelKey = 'microsoft_bing';
        channelLabel = clickIdType === 'msclkid' ? 'Microsoft Ads' : 'Bing';
        networkGroup = clickIdType === 'msclkid' ? 'paid_ads' : 'search';
    } else if (srcNorm === 'referral' || srcNorm === 'affiliate' || srcNorm === 'aff' || srcNorm === 'partner' || Boolean(params.ref) || Boolean(params.aff)) {
        channelKey = 'referral';
        channelLabel = 'Indicação / Afiliado';
        networkGroup = 'referral';
    } else if (srcNorm.includes('email') || medNorm === 'email' || srcNorm === 'newsletter') {
        channelKey = 'email';
        channelLabel = 'E-mail / CRM';
        networkGroup = 'other';
    } else if (srcNorm && srcNorm !== 'direct') {
        channelKey = srcNorm.replace(/[^a-z0-9._-]+/g, '_').slice(0, 64) || 'other';
        channelLabel = rawSource || 'Outro Canal';
        networkGroup = 'other';
    } else if (refNorm) {
        channelKey = refNorm.slice(0, 64);
        channelLabel = refNorm;
        networkGroup = 'referral';
    }

    const utmParts = [
        rawSource ? `src=${rawSource}` : null,
        medium ? `med=${medium}` : null,
        campaign ? `cmp=${campaign}` : null,
        content ? `cnt=${content}` : null,
    ].filter(Boolean);

    return {
        channelKey,
        channelLabel,
        networkGroup,
        isSocial,
        rawSource,
        medium,
        campaign,
        content,
        term,
        clickIdType,
        clickId,
        landingPath,
        referrerHost,
        utmSummary: utmParts.length > 0 ? utmParts.join(' · ') : null,
    };
}

export function classifySubscriptionStatus(
    subscriptions: Array<Omit<Partial<Subscription>, 'planConfig'> & { planConfig?: { tier?: string } | null }>,
    approvedPaymentsCount: number,
    now: Date = new Date(),
): PlanClassification {
    const subs = Array.isArray(subscriptions) ? subscriptions : [];
    const nowMs = now.getTime();
    const DAY_MS = 24 * 60 * 60 * 1000;

    const activeCandidates = subs.filter((s) => {
        if (s.status !== SubscriptionStatus.ACTIVE && s.status !== SubscriptionStatus.APPROVED) {
            return false;
        }
        if (!s.currentPeriodEnd) return true;
        return new Date(s.currentPeriodEnd).getTime() > nowMs;
    });

    if (activeCandidates.length > 0) {
        const bestActive = [...activeCandidates].sort((a, b) => {
            const endA = a.currentPeriodEnd ? new Date(a.currentPeriodEnd).getTime() : Number.MAX_SAFE_INTEGER;
            const endB = b.currentPeriodEnd ? new Date(b.currentPeriodEnd).getTime() : Number.MAX_SAFE_INTEGER;
            return endB - endA;
        })[0];

        const endDate = bestActive.currentPeriodEnd ? new Date(bestActive.currentPeriodEnd) : null;
        const daysLeft = endDate ? Math.max(0, Math.ceil((endDate.getTime() - nowMs) / DAY_MS)) : null;

        return {
            planStatus: 'ACTIVE',
            statusLabel: 'ATIVO',
            isActivePlan: true,
            isExpiredPlan: false,
            hasEverConverted: true,
            planTier: bestActive.planConfig?.tier || 'PRO',
            expiresAt: endDate ? endDate.toISOString() : null,
            daysLeft,
            expiredDaysAgo: null,
            cycle: bestActive.cycle || null,
            paymentMethod: bestActive.paymentMethod || null,
            latestSubscriptionId: bestActive.id || null,
        };
    }

    const pastSubs = subs.filter(
        (s) =>
            s.status === SubscriptionStatus.ACTIVE ||
            s.status === SubscriptionStatus.APPROVED ||
            s.status === SubscriptionStatus.EXPIRED ||
            s.status === SubscriptionStatus.CANCELLED ||
            s.status === SubscriptionStatus.SUSPENDED,
    );

    if (pastSubs.length > 0) {
        const latestPast = [...pastSubs].sort((a, b) => {
            const endA = a.currentPeriodEnd
                ? new Date(a.currentPeriodEnd).getTime()
                : new Date(a.createdAt || 0).getTime();
            const endB = b.currentPeriodEnd
                ? new Date(b.currentPeriodEnd).getTime()
                : new Date(b.createdAt || 0).getTime();
            return endB - endA;
        })[0];

        const endDate = latestPast.currentPeriodEnd
            ? new Date(latestPast.currentPeriodEnd)
            : latestPast.createdAt
              ? new Date(latestPast.createdAt)
              : null;
        const expiredDaysAgo = endDate ? Math.max(0, Math.floor((nowMs - endDate.getTime()) / DAY_MS)) : 0;

        return {
            planStatus: 'EXPIRED',
            statusLabel: 'JÁ EXPIRADO',
            isActivePlan: false,
            isExpiredPlan: true,
            hasEverConverted: true,
            planTier: latestPast.planConfig?.tier || 'BASIC',
            expiresAt: endDate ? endDate.toISOString() : null,
            daysLeft: 0,
            expiredDaysAgo,
            cycle: latestPast.cycle || null,
            paymentMethod: latestPast.paymentMethod || null,
            latestSubscriptionId: latestPast.id || null,
        };
    }

    const pendingSubs = subs.filter((s) => s.status === SubscriptionStatus.APPROVAL_PENDING);
    if (pendingSubs.length > 0) {
        const latestPending = [...pendingSubs].sort(
            (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
        )[0];

        return {
            planStatus: 'PENDING',
            statusLabel: 'CHECKOUT PENDENTE',
            isActivePlan: false,
            isExpiredPlan: false,
            hasEverConverted: approvedPaymentsCount > 0,
            planTier: latestPending.planConfig?.tier || null,
            expiresAt: null,
            daysLeft: null,
            expiredDaysAgo: null,
            cycle: latestPending.cycle || null,
            paymentMethod: latestPending.paymentMethod || null,
            latestSubscriptionId: latestPending.id || null,
        };
    }

    return {
        planStatus: 'FREE',
        statusLabel: 'SEM PLANO (FREE)',
        isActivePlan: false,
        isExpiredPlan: false,
        hasEverConverted: approvedPaymentsCount > 0,
        planTier: null,
        expiresAt: null,
        daysLeft: null,
        expiredDaysAgo: null,
        cycle: null,
        paymentMethod: null,
        latestSubscriptionId: null,
    };
}

export function computeJourneySummary(input: JourneySignalsInput): JourneySummary {
    const importedTrades = input.importedTradesCount > 0 || input.accountsConnectedCount > 0;
    const usedProductTools =
        input.journalEntriesCount > 0 || input.backtestSessionsCount > 0 || input.aiSessionsCount > 0;
    const convertedPaid = input.planStatus === 'ACTIVE' || input.planStatus === 'EXPIRED';

    const checklist: JourneyChecklist = {
        emailVerified: input.emailVerified,
        hasLoggedIn: input.hasLoggedIn,
        completedOnboarding: input.onboardingCompleted,
        visitedPricingOrCheckout: input.visitedPricingOrCheckout,
        clickedCta: input.clickedCtaCount > 0,
        importedTrades,
        usedProductTools,
        convertedPaid,
    };

    let score = 0;
    if (checklist.emailVerified) score += 10;
    if (checklist.hasLoggedIn) score += 10;
    if (checklist.completedOnboarding) score += 10;
    if (input.visitedPagesCount >= 2) score += 5;
    if (input.visitedPagesCount >= 5) score += 5;
    if (checklist.clickedCta) score += 10;
    if (checklist.importedTrades) score += 20;
    if (checklist.usedProductTools) score += 15;
    if (checklist.convertedPaid) score += 15;
    if (input.whatsappLinked) score += 5;
    const engagementScore = Math.min(100, Math.max(0, score));

    let funnelStage: JourneySummary['funnelStage'] = 'REGISTERED';
    let funnelLabel = 'Recém Registado';
    if (input.planStatus === 'ACTIVE') {
        funnelStage = 'PAYING';
        funnelLabel = 'Assinante Ativo';
    } else if (input.planStatus === 'EXPIRED') {
        funnelStage = 'CHURNED';
        funnelLabel = 'Plano Já Expirado';
    } else if (input.planStatus === 'PENDING' || input.visitedPricingOrCheckout) {
        funnelStage = 'CHECKOUT_INTENT';
        funnelLabel = 'Intenção de Compra';
    } else if (importedTrades) {
        funnelStage = 'ACTIVATED';
        funnelLabel = 'Ativado (Com Trades)';
    } else if (input.hasLoggedIn || input.visitedPagesCount > 0 || input.clickedCtaCount > 0) {
        funnelStage = 'EXPLORING';
        funnelLabel = 'Explorando Plataforma';
    }

    const recommendations: string[] = [];
    if (input.planStatus === 'EXPIRED') {
        recommendations.push(
            `Plano expirado há ${input.expiredDaysAgo ?? 0} dia(s) — enviar proposta de renovação${input.hasWhatsapp ? ' via WhatsApp' : ' por e-mail'}.`,
        );
    } else if (input.planStatus === 'ACTIVE' && input.daysLeft !== null && input.daysLeft <= 7) {
        recommendations.push(`Assinatura vence em ${input.daysLeft} dia(s) — acionar lembrete preventivo de renovação.`);
    } else if (input.planStatus === 'PENDING') {
        recommendations.push('Checkout iniciado/pendente sem confirmação — oferecer apoio no pagamento M-Pesa/eMola/Cartão.');
    } else if (input.visitedPricingOrCheckout && input.planStatus === 'FREE') {
        recommendations.push('Visitou preços/checkout mas não converteu — lead quente para abordagem comercial.');
    }

    if (input.failedImportsCount > 0 && !importedTrades) {
        recommendations.push('Registo de falha na importação de trades — prestar suporte técnico para conectar MT5/CSV.');
    } else if (!importedTrades && input.daysSinceSignup >= 1) {
        recommendations.push('Ainda não importou nenhum trade — enviar guia rápido de importação MT5 / CSV.');
    }

    if (!input.emailVerified) {
        recommendations.push('Conta ainda sem confirmação de verificação de e-mail registada.');
    }
    if (input.planStatus === 'ACTIVE' && !usedProductTools) {
        recommendations.push('Assinante ativo sem uso de Diário/Backtest/IA — sugerir onboarding guiado de retenção.');
    }
    if (recommendations.length === 0) {
        recommendations.push('Conta saudável e ativa dentro do esperado.');
    }

    return {
        engagementScore,
        funnelStage,
        funnelLabel,
        checklist,
        recommendations,
    };
}

@Injectable()
export class AdminIntelligenceService {
    private readonly logger = new Logger(AdminIntelligenceService.name);

    constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

    private async safeQuery<T = any>(sql: string, params: any[] = []): Promise<T[]> {
        try {
            const rows = await this.dataSource.query(sql, params);
            return Array.isArray(rows) ? rows : [];
        } catch (err: any) {
            this.logger.warn(`Intelligence query skipped/fallback: ${err?.message || err}`);
            return [];
        }
    }

    private formatActionLabel(raw?: {
        lastActionType?: string | null;
        lastActionLabel?: string | null;
        lastActionPath?: string | null;
    }): { type: string | null; label: string | null; path: string | null } {
        if (!raw) return { type: null, label: null, path: null };
        const label = cleanStr(raw.lastActionLabel, 180) || cleanStr(raw.lastActionType, 64);
        return {
            type: cleanStr(raw.lastActionType, 64),
            label,
            path: cleanStr(raw.lastActionPath, 255),
        };
    }

    private async buildEnrichedUsersDataset() {
        const now = new Date();
        const DAY_MS = 24 * 60 * 60 * 1000;

        const usersRaw = await this.dataSource.getRepository(UserEntity).find({
            order: { createdAt: 'DESC' },
        });
        const subsRaw = await this.dataSource.getRepository(Subscription).find({
            relations: ['planConfig'],
            order: { createdAt: 'DESC' },
        });

        const [
            paymentsAgg,
            sessionsAgg,
            auditLoginAgg,
            importsAgg,
            latestImports,
            accountsAgg,
            tradesAgg,
            trackingAgg,
            latestTracking,
            backtestAgg,
            dailyNotesAgg,
            tradeNotesAgg,
            aiChatsAgg,
            whatsappLinksAgg,
            emailTrackingAgg,
        ] = await Promise.all([
            this.safeQuery(
                `SELECT LOWER(TRIM("email")) AS email_key,
                        COUNT(*) FILTER (WHERE LOWER(COALESCE("status", '')) IN ('aprovada', 'approved', 'paid', 'completed', 'active'))::int AS approved_count,
                        COALESCE(SUM(CASE WHEN LOWER(COALESCE("status", '')) IN ('aprovada', 'approved', 'paid', 'completed', 'active') THEN "preco"::numeric ELSE 0 END), 0)::float8 AS approved_total,
                        COUNT(*)::int AS attempts_count,
                        MAX("dataHora") AS last_payment_at
                 FROM "payments"
                 GROUP BY LOWER(TRIM("email"))`,
            ),
            this.safeQuery(
                `SELECT "userId" AS user_id, COUNT(*)::int AS sessions_count, MAX("createdAt") AS last_session_at
                 FROM "sessions"
                 GROUP BY "userId"`,
            ),
            this.safeQuery(
                `SELECT "user_id", COUNT(*)::int AS login_audits_count, MAX("timestamp") AS last_audit_login_at
                 FROM "audit_logs"
                 WHERE "action" = 'LOGIN_SUCCESS' AND "user_id" IS NOT NULL
                 GROUP BY "user_id"`,
            ),
            this.safeQuery(
                `SELECT "userId" AS user_id,
                        COUNT(*)::int AS total_imports,
                        COUNT(*) FILTER (WHERE "status" = 'SUCCESS')::int AS success_imports,
                        COUNT(*) FILTER (WHERE "status" = 'FAILED')::int AS failed_imports,
                        COALESCE(SUM("tradesCount"), 0)::int AS imported_trades_sum,
                        MAX("createdAt") AS last_import_at
                 FROM "import_logs"
                 WHERE "userId" IS NOT NULL
                 GROUP BY "userId"`,
            ),
            this.safeQuery(
                `SELECT DISTINCT ON ("userId")
                        "userId" AS user_id, "method", "status", "tradesCount" AS trades_count, "details", "createdAt" AS created_at
                 FROM "import_logs"
                 WHERE "userId" IS NOT NULL
                 ORDER BY "userId", "createdAt" DESC`,
            ),
            this.safeQuery(
                `SELECT "user_id",
                        COUNT(*) FILTER (WHERE COALESCE("is_archived", false) = false)::int AS accounts_count,
                        COUNT(*) FILTER (WHERE COALESCE("is_connected", false) = true)::int AS connected_accounts_count,
                        MAX("last_seen") AS last_seen_at
                 FROM "accounts"
                 GROUP BY "user_id"`,
            ),
            this.safeQuery(
                `SELECT a."user_id", COUNT(t."id")::int AS trades_count
                 FROM "trades" t
                 INNER JOIN "accounts" a ON a."id" = t."account_id"
                 GROUP BY a."user_id"`,
            ),
            this.safeQuery(
                `SELECT "user_id",
                        COUNT(*) FILTER (WHERE "event_type" = 'pageview')::int AS pageviews_count,
                        COUNT(DISTINCT "page_path") FILTER (WHERE "event_type" = 'pageview' AND "page_path" IS NOT NULL)::int AS distinct_pages_count,
                        COUNT(*) FILTER (WHERE "event_type" = 'button_click')::int AS clicks_count,
                        COUNT(*) FILTER (WHERE "event_type" = 'conversion')::int AS conversions_count,
                        COUNT(*) FILTER (WHERE LOWER(COALESCE("page_path", '')) ~ '(\/pricing|\/plans|\/checkout|\/subscribe)' OR LOWER(COALESCE("cta_tag", '') || ' ' || COALESCE("intent", '')) ~ '(checkout|upgrade|plan|subscribe|pricing|trial)')::int AS checkout_intent_count,
                        MAX("created_at") FILTER (WHERE "event_type" <> 'email_open') AS last_event_at
                 FROM "tracking_events"
                 WHERE "user_id" IS NOT NULL
                 GROUP BY "user_id"`,
            ),
            this.safeQuery(
                `SELECT DISTINCT ON ("user_id")
                        "user_id", "event_name", "event_type", "element_label", "cta_tag", "page_title", "page_path", "created_at"
                 FROM "tracking_events"
                 WHERE "user_id" IS NOT NULL AND "event_type" <> 'email_open'
                 ORDER BY "user_id", "created_at" DESC`,
            ),
            this.safeQuery(
                `SELECT "user_id", COUNT(*)::int AS cnt FROM "backtest_sessions" GROUP BY "user_id"`,
            ),
            this.safeQuery(
                `SELECT "user_id", COUNT(*)::int AS cnt FROM "daily_notes" GROUP BY "user_id"`,
            ),
            this.safeQuery(
                `SELECT "user_id", COUNT(*)::int AS cnt FROM "trade_notes" GROUP BY "user_id"`,
            ),
            this.safeQuery(
                `SELECT "user_id", COUNT(*)::int AS cnt FROM "ai_chat_sessions" GROUP BY "user_id"`,
            ),
            this.safeQuery(
                `SELECT "user_id", COUNT(*) FILTER (WHERE "is_active" = true)::int AS active_count, MAX("last_interaction_at") AS last_interaction_at
                 FROM "whatsapp_links"
                 GROUP BY "user_id"`,
            ),
            this.safeQuery(
                `SELECT LOWER(TRIM("recipient_email")) AS email_key,
                        COUNT(*)::int AS sent_count,
                        COALESCE(SUM("open_count"), 0)::int AS open_count,
                        COALESCE(SUM("click_count"), 0)::int AS click_count
                 FROM "email_tracking_logs"
                 GROUP BY LOWER(TRIM("recipient_email"))`,
            ),
        ]);

        const subsByUser = new Map<string, Subscription[]>();
        for (const s of subsRaw) {
            if (!subsByUser.has(s.userId)) subsByUser.set(s.userId, []);
            subsByUser.get(s.userId)!.push(s);
        }

        const toMap = (rows: any[], keyField = 'user_id') => {
            const map = new Map<string, any>();
            for (const r of rows) {
                if (r?.[keyField] !== undefined && r?.[keyField] !== null) {
                    map.set(String(r[keyField]), r);
                }
            }
            return map;
        };

        const paymentsByEmail = toMap(paymentsAgg, 'email_key');
        const sessionsByUser = toMap(sessionsAgg);
        const auditsByUser = toMap(auditLoginAgg);
        const importsByUser = toMap(importsAgg);
        const latestImportByUser = toMap(latestImports);
        const accountsByUser = toMap(accountsAgg);
        const tradesByUser = toMap(tradesAgg);
        const trackingByUser = toMap(trackingAgg);
        const latestTrackingByUser = toMap(latestTracking);
        const backtestsByUser = toMap(backtestAgg);
        const dailyNotesByUser = toMap(dailyNotesAgg);
        const tradeNotesByUser = toMap(tradeNotesAgg);
        const aiChatsByUser = toMap(aiChatsAgg);
        const waLinksByUser = toMap(whatsappLinksAgg);
        const emailTrackByEmail = toMap(emailTrackingAgg, 'email_key');

        const originAccumulator = new Map<string, OriginPerformanceMetric>();
        const enrichedUsers: any[] = [];

        for (const u of usersRaw) {
            const emailKey = (u.email || '').trim().toLowerCase();
            const userSubs = subsByUser.get(u.id) || [];
            const payStats = paymentsByEmail.get(emailKey);
            const approvedPaymentsCount = Number(payStats?.approved_count || 0);
            const totalRevenue = Number(payStats?.approved_total || 0);

            const plan = classifySubscriptionStatus(userSubs, approvedPaymentsCount, now);
            const origin = classifyUserOrigin({
                acquisitionSource: u.acquisitionSource,
                acquisitionMedium: u.acquisitionMedium,
                acquisitionCampaign: u.acquisitionCampaign,
                acquisitionContent: u.acquisitionContent,
                acquisitionTerm: u.acquisitionTerm,
                landingPath: u.landingPath,
                referrer: u.referrer,
                attributionData: u.attributionData,
            });

            const sess = sessionsByUser.get(u.id);
            const audit = auditsByUser.get(u.id);
            const imp = importsByUser.get(u.id);
            const latestImp = latestImportByUser.get(u.id);
            const acc = accountsByUser.get(u.id);
            const trd = tradesByUser.get(u.id);
            const trk = trackingByUser.get(u.id);
            const latestTrk = latestTrackingByUser.get(u.id);
            const waLink = waLinksByUser.get(u.id);
            const emailTrk = emailTrackByEmail.get(emailKey);

            const loginDates = [
                u.lastLoginAt ? new Date(u.lastLoginAt).getTime() : 0,
                sess?.last_session_at ? new Date(sess.last_session_at).getTime() : 0,
                audit?.last_audit_login_at ? new Date(audit.last_audit_login_at).getTime() : 0,
            ].filter((t) => t > 0);
            const lastLoginAt = loginDates.length > 0 ? new Date(Math.max(...loginDates)).toISOString() : null;

            const userActiveTs = u.lastActiveAt ? new Date(u.lastActiveAt).getTime() : 0;
            const trkTs = latestTrk?.created_at ? new Date(latestTrk.created_at).getTime() : 0;
            const impTs = latestImp?.created_at ? new Date(latestImp.created_at).getTime() : 0;
            const loginTs = lastLoginAt ? new Date(lastLoginAt).getTime() : 0;

            let lastActionAt: string | null = null;
            let lastActionType: string | null = null;
            let lastActionLabel: string | null = null;
            let lastActionPath: string | null = null;

            const candidates: Array<{ ts: number; type: string; label: string; path: string | null }> = [];
            if (userActiveTs > 0 && (u.lastActionLabel || u.lastActionType)) {
                const formatted = this.formatActionLabel(u);
                candidates.push({
                    ts: userActiveTs,
                    type: formatted.type || 'activity',
                    label: formatted.label || 'Atividade recente',
                    path: formatted.path,
                });
            }
            if (trkTs > 0 && latestTrk) {
                const label =
                    cleanStr(latestTrk.element_label, 160) ||
                    cleanStr(latestTrk.cta_tag, 120) ||
                    cleanStr(latestTrk.page_title, 160) ||
                    (latestTrk.page_path ? `Visitou ${latestTrk.page_path}` : latestTrk.event_name);
                candidates.push({
                    ts: trkTs,
                    type: latestTrk.event_type || latestTrk.event_name || 'activity',
                    label: label || 'Navegou na plataforma',
                    path: cleanStr(latestTrk.page_path, 255),
                });
            }
            if (impTs > 0 && latestImp) {
                candidates.push({
                    ts: impTs,
                    type: 'trade_import',
                    label: `Importou ${Number(latestImp.trades_count || 0)} trades (${latestImp.method})`,
                    path: '/add-trades',
                });
            }
            if (loginTs > 0) {
                candidates.push({
                    ts: loginTs,
                    type: 'login',
                    label: 'Entrou na plataforma',
                    path: '/dashboard',
                });
            }

            if (candidates.length > 0) {
                candidates.sort((a, b) => b.ts - a.ts);
                const winner = candidates[0];
                lastActionAt = new Date(winner.ts).toISOString();
                lastActionType = winner.type;
                lastActionLabel = winner.label;
                lastActionPath = winner.path;
            }

            const emailVerified = Boolean(
                u.emailVerifiedAt ||
                    u.googleId ||
                    u.githubId ||
                    u.isTwoFactorConfirmed ||
                    Number(sess?.sessions_count || 0) > 0 ||
                    Number(audit?.login_audits_count || 0) > 0,
            );
            const hasLoggedIn = Boolean(
                lastLoginAt ||
                    Number(sess?.sessions_count || 0) > 0 ||
                    Number(audit?.login_audits_count || 0) > 0,
            );

            const visitedPagesCount = Number(trk?.pageviews_count || 0);
            const distinctPagesCount = Number(trk?.distinct_pages_count || 0);
            const clickedCtaCount = Number(trk?.clicks_count || 0);
            const visitedPricingOrCheckout =
                Number(trk?.checkout_intent_count || 0) > 0 || plan.planStatus !== 'FREE';
            const totalImports = Number(imp?.total_imports || 0);
            const successImports = Number(imp?.success_imports || 0);
            const failedImports = Number(imp?.failed_imports || 0);
            const importedTradesCount = Math.max(
                Number(imp?.imported_trades_sum || 0),
                Number(trd?.trades_count || 0),
            );
            const accountsCount = Number(acc?.accounts_count || 0);
            const connectedAccountsCount = Number(acc?.connected_accounts_count || 0);
            const journalEntriesCount =
                Number(dailyNotesByUser.get(u.id)?.cnt || 0) +
                Number(tradeNotesByUser.get(u.id)?.cnt || 0);
            const backtestSessionsCount = Number(backtestsByUser.get(u.id)?.cnt || 0);
            const aiSessionsCount = Number(aiChatsByUser.get(u.id)?.cnt || 0);
            const whatsappLinked = Number(waLink?.active_count || 0) > 0;
            const emailOpensCount = Number(emailTrk?.open_count || 0);

            const createdMs = u.createdAt ? new Date(u.createdAt).getTime() : now.getTime();
            const daysSinceSignup = Math.max(0, Math.floor((now.getTime() - createdMs) / DAY_MS));
            const lastActiveMs = lastActionAt ? new Date(lastActionAt).getTime() : null;
            const daysSinceLastActive =
                lastActiveMs !== null ? Math.max(0, Math.floor((now.getTime() - lastActiveMs) / DAY_MS)) : null;

            const journey = computeJourneySummary({
                emailVerified,
                hasLoggedIn,
                onboardingCompleted: Boolean(u.onboardingCompleted),
                visitedPagesCount: Math.max(visitedPagesCount, distinctPagesCount),
                visitedPricingOrCheckout,
                clickedCtaCount,
                importedTradesCount,
                importsTotalCount: totalImports,
                accountsConnectedCount: connectedAccountsCount,
                journalEntriesCount,
                backtestSessionsCount,
                aiSessionsCount,
                whatsappLinked,
                emailOpensCount,
                planStatus: plan.planStatus,
                expiredDaysAgo: plan.expiredDaysAgo,
                daysLeft: plan.daysLeft,
                daysSinceSignup,
                daysSinceLastActive,
                failedImportsCount: failedImports,
                hasWhatsapp: Boolean(u.whatsapp && String(u.whatsapp).trim()),
            });

            // Aggregate per-origin cohort metrics globally
            if (!originAccumulator.has(origin.channelKey)) {
                originAccumulator.set(origin.channelKey, {
                    channelKey: origin.channelKey,
                    channelLabel: origin.channelLabel,
                    networkGroup: origin.networkGroup,
                    isSocial: origin.isSocial,
                    users: 0,
                    verified: 0,
                    imported: 0,
                    converted: 0,
                    activePlans: 0,
                    expiredPlans: 0,
                    conversionRatePct: 0,
                    activationRatePct: 0,
                    revenue: 0,
                });
            }
            const bucket = originAccumulator.get(origin.channelKey)!;
            bucket.users += 1;
            if (emailVerified) bucket.verified += 1;
            if (importedTradesCount > 0 || connectedAccountsCount > 0) bucket.imported += 1;
            if (plan.hasEverConverted) bucket.converted += 1;
            if (plan.isActivePlan) bucket.activePlans += 1;
            if (plan.isExpiredPlan) bucket.expiredPlans += 1;
            bucket.revenue += totalRevenue;

            enrichedUsers.push({
                id: u.id,
                name: u.name,
                username: u.username,
                email: u.email,
                avatarUrl: u.avatarUrl || null,
                whatsapp: u.whatsapp || null,
                preferredMpesa: u.preferredMpesa || null,
                preferredEmola: u.preferredEmola || null,
                lastPaymentMethod: u.lastPaymentMethod || plan.paymentMethod || null,
                preferredLocale: u.preferredLocale || 'pt',
                timezone: u.timezone || null,
                createdAt: u.createdAt ? new Date(u.createdAt).toISOString() : null,
                emailVerified,
                emailVerifiedAt: u.emailVerifiedAt ? new Date(u.emailVerifiedAt).toISOString() : null,
                authProvider: u.googleId ? 'google' : u.githubId ? 'github' : 'email',
                isBlocked: Boolean(u.isBlocked),
                twoFactorEnabled: Boolean(u.twoFactorEnabled && u.isTwoFactorConfirmed),
                onboardingCompleted: Boolean(u.onboardingCompleted),
                hasUsedTrial: Boolean(u.hasUsedTrial),
                lastLoginAt,
                lastActionAt,
                lastActionType,
                lastActionLabel,
                lastActionPath,
                plan,
                origin,
                behavior: {
                    sessionsCount: Number(sess?.sessions_count || 0),
                    loginCount: Number(audit?.login_audits_count || 0),
                    pageviewsCount: visitedPagesCount,
                    distinctPagesCount,
                    clicksCount: clickedCtaCount,
                    visitedPricingOrCheckout,
                    totalImports,
                    successImports,
                    failedImports,
                    tradesCount: Number(trd?.trades_count || 0),
                    importedTradesCount,
                    accountsCount,
                    connectedAccountsCount,
                    journalEntriesCount,
                    backtestSessionsCount,
                    aiSessionsCount,
                    whatsappLinked,
                    emailSentCount: Number(emailTrk?.sent_count || 0),
                    emailOpenCount: emailOpensCount,
                    emailClickCount: Number(emailTrk?.click_count || 0),
                    totalRevenue,
                    paymentsCount: approvedPaymentsCount,
                    lastImportAt: imp?.last_import_at ? new Date(imp.last_import_at).toISOString() : null,
                    lastImportMethod: latestImp?.method || null,
                    lastImportStatus: latestImp?.status || null,
                },
                journey,
                // Backwards-compatible properties referenced by existing modals
                acquisitionSource: u.acquisitionSource,
                acquisitionMedium: u.acquisitionMedium,
                acquisitionCampaign: u.acquisitionCampaign,
                acquisitionContent: u.acquisitionContent,
                acquisitionTerm: u.acquisitionTerm,
                landingPath: u.landingPath,
                referrer: u.referrer,
                subscriptions: userSubs.map((s) => ({
                    id: s.id,
                    status: s.status,
                    cycle: s.cycle,
                    currentPeriodEnd: s.currentPeriodEnd,
                    paymentMethod: s.paymentMethod,
                    createdAt: s.createdAt,
                    planConfig: s.planConfig
                        ? { id: s.planConfig.id, tier: s.planConfig.tier }
                        : null,
                })),
            });
        }

        const originBreakdown: OriginPerformanceMetric[] = Array.from(originAccumulator.values())
            .map((b) => ({
                ...b,
                conversionRatePct: b.users > 0 ? Number(((b.converted / b.users) * 100).toFixed(1)) : 0,
                activationRatePct: b.users > 0 ? Number(((b.imported / b.users) * 100).toFixed(1)) : 0,
                revenue: Number(b.revenue.toFixed(2)),
            }))
            .sort((a, b) => b.users - a.users || b.conversionRatePct - a.conversionRatePct);

        const originMap = new Map(originBreakdown.map((o) => [o.channelKey, o]));
        for (const row of enrichedUsers) {
            const m = originMap.get(row.origin.channelKey);
            row.originStats = {
                channelUsers: m?.users || 1,
                channelConverted: m?.converted || 0,
                channelConversionRatePct: m?.conversionRatePct || 0,
                channelActivationRatePct: m?.activationRatePct || 0,
                channelRevenue: m?.revenue || 0,
            };
        }

        return { users: enrichedUsers, originBreakdown };
    }

    async getAdminUsersOverview(filters?: {
        page?: number;
        limit?: number;
        search?: string;
        source?: string;
        planStatus?: string;
        activityFilter?: string;
        sortBy?: string;
        sortDir?: string;
    }) {
        const { users, originBreakdown } = await this.buildEnrichedUsersDataset();

        const totalUsers = users.length;
        const activeSubscribers = users.filter((u) => u.plan.planStatus === 'ACTIVE').length;
        const expiredSubscribers = users.filter((u) => u.plan.planStatus === 'EXPIRED').length;
        const pendingCheckouts = users.filter((u) => u.plan.planStatus === 'PENDING').length;
        const freeUsers = users.filter((u) => u.plan.planStatus === 'FREE').length;
        const importedUsers = users.filter((u) => u.journey.checklist.importedTrades).length;
        const verifiedUsers = users.filter((u) => u.emailVerified).length;
        const convertedTotal = users.filter((u) => u.plan.hasEverConverted).length;

        let filtered = users;
        if (filters?.search && filters.search.trim()) {
            const q = filters.search.trim().toLowerCase();
            filtered = filtered.filter((u) => {
                const fields = [
                    u.email,
                    u.name,
                    u.username,
                    u.whatsapp,
                    u.origin?.channelLabel,
                    u.origin?.rawSource,
                    u.origin?.campaign,
                    u.lastActionLabel,
                    u.plan?.planTier,
                ];
                return fields.some((f) => typeof f === 'string' && f.toLowerCase().includes(q));
            });
        }

        if (filters?.source && filters.source.trim() && filters.source !== 'ALL') {
            const srcFilter = filters.source.trim().toLowerCase();
            if (srcFilter === 'social') {
                filtered = filtered.filter((u) => u.origin.isSocial);
            } else {
                filtered = filtered.filter((u) => u.origin.channelKey.toLowerCase() === srcFilter);
            }
        }

        if (filters?.planStatus && filters.planStatus.trim() && filters.planStatus !== 'ALL') {
            const ps = filters.planStatus.trim().toUpperCase();
            filtered = filtered.filter((u) => u.plan.planStatus === ps);
        }

        if (filters?.activityFilter && filters.activityFilter.trim() && filters.activityFilter !== 'ALL') {
            switch (filters.activityFilter) {
                case 'IMPORTED':
                    filtered = filtered.filter((u) => u.journey.checklist.importedTrades);
                    break;
                case 'NO_IMPORTS':
                    filtered = filtered.filter((u) => !u.journey.checklist.importedTrades);
                    break;
                case 'CHECKOUT_INTENT':
                    filtered = filtered.filter(
                        (u) => u.plan.planStatus !== 'ACTIVE' && u.behavior.visitedPricingOrCheckout,
                    );
                    break;
                case 'ACTIVE_TODAY': {
                    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
                    filtered = filtered.filter(
                        (u) => u.lastActionAt && new Date(u.lastActionAt).getTime() >= cutoff,
                    );
                    break;
                }
                case 'IMPORT_FAILED':
                    filtered = filtered.filter((u) => u.behavior.failedImports > 0);
                    break;
                default:
                    break;
            }
        }

        const sortBy = filters?.sortBy || 'createdAt';
        const sortDir = filters?.sortDir === 'asc' ? 1 : -1;
        filtered = [...filtered].sort((a, b) => {
            if (sortBy === 'lastLoginAt') {
                return (new Date(a.lastLoginAt || 0).getTime() - new Date(b.lastLoginAt || 0).getTime()) * sortDir;
            }
            if (sortBy === 'lastActionAt') {
                return (new Date(a.lastActionAt || 0).getTime() - new Date(b.lastActionAt || 0).getTime()) * sortDir;
            }
            if (sortBy === 'engagementScore') {
                return (a.journey.engagementScore - b.journey.engagementScore) * sortDir;
            }
            if (sortBy === 'tradesCount') {
                return (a.behavior.importedTradesCount - b.behavior.importedTradesCount) * sortDir;
            }
            return (new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()) * sortDir;
        });

        const page = Math.max(1, Number(filters?.page) || 1);
        const limit = Math.min(200, Math.max(1, Number(filters?.limit) || 50));
        const total = filtered.length;
        const totalPages = Math.max(1, Math.ceil(total / limit));
        const safePage = Math.min(page, totalPages);
        const items = filtered.slice((safePage - 1) * limit, safePage * limit);

        return {
            items,
            total,
            page: safePage,
            limit,
            totalPages,
            summary: {
                totalUsers,
                verifiedUsers,
                activeSubscribers,
                expiredSubscribers,
                pendingCheckouts,
                freeUsers,
                importedUsers,
                overallConversionRatePct:
                    totalUsers > 0 ? Number(((convertedTotal / totalUsers) * 100).toFixed(1)) : 0,
                activationRatePct:
                    totalUsers > 0 ? Number(((importedUsers / totalUsers) * 100).toFixed(1)) : 0,
            },
            originBreakdown,
        };
    }

    async getUser360Intelligence(userId: string) {
        const { users } = await this.buildEnrichedUsersDataset();
        const userRow = users.find((u) => u.id === userId);
        if (!userRow) {
            throw new NotFoundException('Usuário não encontrado');
        }

        const fullEntity = await this.dataSource.getRepository(UserEntity).findOne({
            where: { id: userId },
        });
        const emailLower = (userRow.email || '').trim().toLowerCase();

        const [
            accounts,
            importLogs,
            payments,
            sessions,
            auditLogs,
            pageBreakdown,
            ctaBreakdown,
            recentEvents,
            emailLogs,
        ] = await Promise.all([
            this.safeQuery(
                `SELECT a."id", a."name", a."broker", a."type", a."currency", a."mt5_id" AS "mt5Id",
                        a."balance", a."equity", a."is_primary" AS "isPrimary", a."is_archived" AS "isArchived",
                        a."is_connected" AS "isConnected", a."last_seen" AS "lastSeen",
                        (SELECT COUNT(*)::int FROM "trades" t WHERE t."account_id" = a."id") AS "tradesCount"
                 FROM "accounts" a
                 WHERE a."user_id" = $1
                 ORDER BY a."is_primary" DESC, a."last_seen" DESC NULLS LAST`,
                [userId],
            ),
            this.safeQuery(
                `SELECT "id", "method", "status", "details", "tradesCount" AS "tradesCount",
                        "account_id" AS "accountId", "createdAt" AS "createdAt"
                 FROM "import_logs"
                 WHERE "userId" = $1
                 ORDER BY "createdAt" DESC
                 LIMIT 30`,
                [userId],
            ),
            emailLower
                ? this.safeQuery(
                      `SELECT "id", "produto", "preco"::float8 AS "preco", "status", "vendaId" AS "vendaId",
                              "dataHora" AS "dataHora", "createdAt" AS "createdAt"
                       FROM "payments"
                       WHERE LOWER(TRIM("email")) = $1
                       ORDER BY "dataHora" DESC
                       LIMIT 25`,
                      [emailLower],
                  )
                : Promise.resolve([]),
            this.safeQuery(
                `SELECT "id", "userAgent" AS "userAgent", "ipAddress" AS "ipAddress",
                        "isActive" AS "isActive", "expiresAt" AS "expiresAt", "createdAt" AS "createdAt"
                 FROM "sessions"
                 WHERE "userId" = $1
                 ORDER BY "createdAt" DESC
                 LIMIT 15`,
                [userId],
            ),
            this.safeQuery(
                `SELECT "id", "action", "ip", "user_agent" AS "userAgent", "metadata", "timestamp"
                 FROM "audit_logs"
                 WHERE "user_id" = $1
                 ORDER BY "timestamp" DESC
                 LIMIT 25`,
                [userId],
            ),
            this.safeQuery(
                `SELECT COALESCE("page_path", '/') AS "pagePath",
                        MAX("page_title") AS "pageTitle",
                        COUNT(*)::int AS "visits",
                        MAX("created_at") AS "lastVisitedAt"
                 FROM "tracking_events"
                 WHERE "user_id" = $1 AND "event_type" = 'pageview'
                 GROUP BY COALESCE("page_path", '/')
                 ORDER BY "visits" DESC, "lastVisitedAt" DESC
                 LIMIT 25`,
                [userId],
            ),
            this.safeQuery(
                `SELECT COALESCE("cta_tag", "element_label", "event_name") AS "ctaTag",
                        MAX("element_label") AS "label",
                        MAX("intent") AS "intent",
                        MAX("page_path") AS "pagePath",
                        COUNT(*)::int AS "clicks",
                        MAX("created_at") AS "lastClickedAt"
                 FROM "tracking_events"
                 WHERE "user_id" = $1 AND "event_type" = 'button_click'
                 GROUP BY COALESCE("cta_tag", "element_label", "event_name")
                 ORDER BY "clicks" DESC, "lastClickedAt" DESC
                 LIMIT 25`,
                [userId],
            ),
            this.safeQuery(
                `SELECT "id", "event_name" AS "eventName", "event_type" AS "eventType",
                        "page_path" AS "pagePath", "page_title" AS "pageTitle",
                        "element_label" AS "elementLabel", "cta_tag" AS "ctaTag",
                        "intent", "device_type" AS "deviceType", "revenue", "currency",
                        "created_at" AS "createdAt"
                 FROM "tracking_events"
                 WHERE "user_id" = $1
                 ORDER BY "created_at" DESC
                 LIMIT 60`,
                [userId],
            ),
            emailLower
                ? this.safeQuery(
                      `SELECT "id", "template", "subject", "sent_at" AS "sentAt",
                              "opened_at" AS "openedAt", "open_count" AS "openCount",
                              "first_clicked_at" AS "firstClickedAt", "click_count" AS "clickCount",
                              "last_cta_tag" AS "lastCtaTag"
                       FROM "email_tracking_logs"
                       WHERE LOWER(TRIM("recipient_email")) = $1 OR "user_id" = $2
                       ORDER BY "sent_at" DESC
                       LIMIT 20`,
                      [emailLower, userId],
                  )
                : Promise.resolve([]),
        ]);

        const timeline: Array<{
            id: string;
            category: 'navigation' | 'click' | 'import' | 'auth' | 'billing' | 'email' | 'conversion';
            title: string;
            detail: string | null;
            path: string | null;
            timestamp: string;
        }> = [];

        for (const ev of recentEvents) {
            const cat =
                ev.eventType === 'conversion'
                    ? 'conversion'
                    : ev.eventType === 'button_click'
                      ? 'click'
                      : ev.eventType === 'email_open' || ev.eventType === 'email_click'
                        ? 'email'
                        : 'navigation';
            const title =
                ev.eventType === 'button_click'
                    ? `Clicou: ${ev.elementLabel || ev.ctaTag || 'Botão'}`
                    : ev.eventType === 'conversion'
                      ? `Conversão: ${ev.eventName}`
                      : ev.eventType === 'pageview'
                        ? `Visitou ${ev.pagePath || '/'}`
                        : ev.elementLabel || ev.eventName;
            timeline.push({
                id: `ev-${ev.id}`,
                category: cat,
                title,
                detail: [ev.pageTitle, ev.intent ? `Intent: ${ev.intent}` : null, ev.deviceType]
                    .filter(Boolean)
                    .join(' · ') || null,
                path: ev.pagePath || null,
                timestamp: new Date(ev.createdAt).toISOString(),
            });
        }

        for (const imp of importLogs) {
            timeline.push({
                id: `imp-${imp.id}`,
                category: 'import',
                title: `Importação ${imp.method} · ${imp.status} (${imp.tradesCount} trades)`,
                detail: imp.details || null,
                path: '/add-trades',
                timestamp: new Date(imp.createdAt).toISOString(),
            });
        }

        for (const aud of auditLogs) {
            timeline.push({
                id: `aud-${aud.id}`,
                category: 'auth',
                title: `Segurança/Auth: ${aud.action}`,
                detail: aud.ip ? `IP: ${aud.ip}` : null,
                path: '/login',
                timestamp: new Date(aud.timestamp).toISOString(),
            });
        }

        for (const sub of userRow.subscriptions || []) {
            timeline.push({
                id: `sub-${sub.id}`,
                category: 'billing',
                title: `Assinatura ${sub.planConfig?.tier || ''} · ${sub.status} (${sub.cycle})`,
                detail: sub.paymentMethod ? `Via ${sub.paymentMethod}` : null,
                path: '/plans',
                timestamp: new Date(sub.createdAt).toISOString(),
            });
        }

        for (const p of payments) {
            timeline.push({
                id: `pay-${p.id}`,
                category: 'billing',
                title: `Pagamento ${p.status}: ${p.produto} (${Number(p.preco || 0).toLocaleString('pt-MZ')} MZN)`,
                detail: `Venda ${p.vendaId}`,
                path: '/checkout',
                timestamp: new Date(p.dataHora || p.createdAt).toISOString(),
            });
        }

        for (const em of emailLogs) {
            timeline.push({
                id: `em-${em.id}`,
                category: 'email',
                title: `E-mail: ${em.subject || em.template}`,
                detail: `Aberturas: ${em.openCount} · Cliques: ${em.clickCount}`,
                path: null,
                timestamp: new Date(em.sentAt).toISOString(),
            });
        }

        timeline.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        return {
            user: {
                ...userRow,
                attributionData: fullEntity?.attributionData || null,
                surveyAnswers: fullEntity?.surveyAnswers || null,
                visitorId: fullEntity?.visitorId || null,
                visitorIdsCount: new Set(recentEvents.map((e) => e.pagePath)).size,
            },
            accounts,
            importLogs,
            payments,
            sessions,
            auditLogs,
            pageBreakdown,
            ctaBreakdown,
            emailLogs,
            timeline: timeline.slice(0, 80),
        };
    }

    async getDashboardIntelligence() {
        const { users, originBreakdown } = await this.buildEnrichedUsersDataset();
        const nowMs = Date.now();
        const DAY_MS = 24 * 60 * 60 * 1000;

        const totalUsers = users.length;
        const verifiedUsers = users.filter((u) => u.emailVerified).length;
        const newUsers24h = users.filter(
            (u) => u.createdAt && nowMs - new Date(u.createdAt).getTime() <= DAY_MS,
        ).length;
        const newUsers7d = users.filter(
            (u) => u.createdAt && nowMs - new Date(u.createdAt).getTime() <= 7 * DAY_MS,
        ).length;
        const activeSubscribers = users.filter((u) => u.plan.planStatus === 'ACTIVE').length;
        const expiredSubscribers = users.filter((u) => u.plan.planStatus === 'EXPIRED').length;
        const pendingCheckouts = users.filter((u) => u.plan.planStatus === 'PENDING').length;
        const convertedCount = users.filter((u) => u.plan.hasEverConverted).length;
        const importedUsersCount = users.filter((u) => u.journey.checklist.importedTrades).length;
        const totalTradesCount = users.reduce((sum, u) => sum + Number(u.behavior.tradesCount || 0), 0);
        const totalRevenueAllTime = Number(
            users.reduce((sum, u) => sum + Number(u.behavior.totalRevenue || 0), 0).toFixed(2),
        );

        const churnDenominator = activeSubscribers + expiredSubscribers;
        const churnRatePct =
            churnDenominator > 0 ? Number(((expiredSubscribers / churnDenominator) * 100).toFixed(1)) : 0;
        const overallConversionRatePct =
            totalUsers > 0 ? Number(((convertedCount / totalUsers) * 100).toFixed(1)) : 0;
        const activationRatePct =
            totalUsers > 0 ? Number(((importedUsersCount / totalUsers) * 100).toFixed(1)) : 0;

        const toQueueCard = (u: any, reason: string, priority: 'high' | 'medium') => ({
            id: u.id,
            name: u.name || u.username || u.email?.split('@')[0] || 'Trader',
            email: u.email,
            whatsapp: u.whatsapp,
            originLabel: u.origin.channelLabel,
            originKey: u.origin.channelKey,
            planStatus: u.plan.planStatus,
            planTier: u.plan.planTier,
            expiresAt: u.plan.expiresAt,
            expiredDaysAgo: u.plan.expiredDaysAgo,
            daysLeft: u.plan.daysLeft,
            lastLoginAt: u.lastLoginAt,
            lastActionLabel: u.lastActionLabel,
            lastActionAt: u.lastActionAt,
            engagementScore: u.journey.engagementScore,
            reason,
            priority,
        });

        const checkoutAbandoned = users
            .filter(
                (u) =>
                    !u.plan.isActivePlan &&
                    (u.plan.planStatus === 'PENDING' || u.behavior.visitedPricingOrCheckout),
            )
            .sort(
                (a, b) =>
                    new Date(b.lastActionAt || b.createdAt || 0).getTime() -
                    new Date(a.lastActionAt || a.createdAt || 0).getTime(),
            )
            .slice(0, 15)
            .map((u) =>
                toQueueCard(
                    u,
                    u.plan.planStatus === 'PENDING'
                        ? `Checkout ${u.plan.planTier || ''} pendente sem conclusão`
                        : 'Visitou preços/checkout sem finalizar compra',
                    'high',
                ),
            );

        const recentlyExpired = users
            .filter((u) => u.plan.planStatus === 'EXPIRED')
            .sort((a, b) => (a.plan.expiredDaysAgo ?? 9999) - (b.plan.expiredDaysAgo ?? 9999))
            .slice(0, 15)
            .map((u) =>
                toQueueCard(
                    u,
                    `Plano ${u.plan.planTier || ''} expirou há ${u.plan.expiredDaysAgo ?? 0} dia(s)`,
                    (u.plan.expiredDaysAgo ?? 0) <= 14 ? 'high' : 'medium',
                ),
            );

        const importErrors = users
            .filter((u) => u.behavior.failedImports > 0)
            .sort(
                (a, b) =>
                    new Date(b.behavior.lastImportAt || 0).getTime() -
                    new Date(a.behavior.lastImportAt || 0).getTime(),
            )
            .slice(0, 15)
            .map((u) =>
                toQueueCard(
                    u,
                    `${u.behavior.failedImports} falha(s) na importação de trades`,
                    !u.journey.checklist.importedTrades ? 'high' : 'medium',
                ),
            );

        const expiringSoon = users
            .filter((u) => u.plan.planStatus === 'ACTIVE' && u.plan.daysLeft !== null && u.plan.daysLeft <= 7)
            .sort((a, b) => (a.plan.daysLeft ?? 99) - (b.plan.daysLeft ?? 99))
            .slice(0, 15)
            .map((u) =>
                toQueueCard(
                    u,
                    `Vence em ${u.plan.daysLeft} dia(s) (${u.plan.planTier || 'Plano'})`,
                    (u.plan.daysLeft ?? 7) <= 3 ? 'high' : 'medium',
                ),
            );

        const stalledOnboarding = users
            .filter((u) => {
                if (u.journey.checklist.importedTrades || u.plan.isActivePlan) return false;
                const createdAtMs = u.createdAt ? new Date(u.createdAt).getTime() : nowMs;
                return nowMs - createdAtMs >= DAY_MS && nowMs - createdAtMs <= 30 * DAY_MS;
            })
            .sort(
                (a, b) =>
                    new Date(b.lastActionAt || b.createdAt || 0).getTime() -
                    new Date(a.lastActionAt || a.createdAt || 0).getTime(),
            )
            .slice(0, 15)
            .map((u) =>
                toQueueCard(
                    u,
                    u.onboardingCompleted
                        ? 'Onboarding feito mas ainda sem trades importados'
                        : 'Registou conta há +24h sem concluir importação',
                    u.behavior.clicksCount > 0 ? 'high' : 'medium',
                ),
            );

        const recommendations: Array<{
            id: string;
            severity: 'high' | 'medium' | 'opportunity';
            category: string;
            title: string;
            description: string;
            metric: string;
            actionLabel: string;
            actionPath: string;
        }> = [];

        if (checkoutAbandoned.length > 0) {
            recommendations.push({
                id: 'checkout-recovery',
                severity: 'high',
                category: 'Recuperação de Receita',
                title: `${checkoutAbandoned.length} lead(s) com intenção de compra ou checkout pendente`,
                description:
                    'Usuários que abriram preços/checkout recentemente ou possuem assinatura pendente sem pagamento aprovado. Abordagem direta via WhatsApp costuma recuperar vendas no mesmo dia.',
                metric: `${checkoutAbandoned.length} em aberto`,
                actionLabel: 'Ver leads no /admin/users',
                actionPath: '/admin/users?activityFilter=CHECKOUT_INTENT',
            });
        }

        if (expiredSubscribers > 0) {
            recommendations.push({
                id: 'expired-winback',
                severity: 'high',
                category: 'Retenção & Win-back',
                title: `${expiredSubscribers} conta(s) já expirada(s) aguardando reativação`,
                description:
                    'Ex-assinantes já conhecem o produto e têm histórico na plataforma. Priorize quem venceu nos últimos 14 dias com oferta de retorno.',
                metric: `${churnRatePct}% churn histórico`,
                actionLabel: 'Filtrar expirados',
                actionPath: '/admin/users?planStatus=EXPIRED',
            });
        }

        if (expiringSoon.length > 0) {
            recommendations.push({
                id: 'expiring-soon',
                severity: 'medium',
                category: 'Prevenção de Churn',
                title: `${expiringSoon.length} assinatura(s) vencem nos próximos 7 dias`,
                description:
                    'Acompanhe se esses clientes estão ativos no Diário/MT5 e antecipe a renovação antes da expiração.',
                metric: `${expiringSoon.length} a vencer`,
                actionLabel: 'Revisar vencimentos',
                actionPath: '/admin/users?planStatus=ACTIVE',
            });
        }

        const nonActivatedCount = Math.max(0, totalUsers - importedUsersCount);
        if (totalUsers > 0 && activationRatePct < 55) {
            recommendations.push({
                id: 'onboarding-activation',
                severity: 'medium',
                category: 'Ativação do Produto',
                title: `Taxa de importação em ${activationRatePct}% (${nonActivatedCount} contas sem trades)`,
                description:
                    'Boa parte dos usuários ainda não conectou MT5/Deriv nem importou CSV/HTML. Envie o guia prático para desbloquear o primeiro gráfico de performance.',
                metric: `${importedUsersCount}/${totalUsers} importaram`,
                actionLabel: 'Ver contas sem trades',
                actionPath: '/admin/users?activityFilter=NO_IMPORTS',
            });
        }

        if (importErrors.length > 0) {
            recommendations.push({
                id: 'import-support',
                severity: 'high',
                category: 'Suporte Técnico',
                title: `${importErrors.length} usuário(s) tiveram falha ao importar histórico`,
                description:
                    'Erros de importação geram frustração logo no início da jornada. Ofereça assistência rápida no setup do EA ou formato de extrato.',
                metric: `${importErrors.length} com erro`,
                actionLabel: 'Ver erros de importação',
                actionPath: '/admin/users?activityFilter=IMPORT_FAILED',
            });
        }

        const significantChannels = originBreakdown.filter((o) => o.users >= 3);
        const bestChannel = [...significantChannels].sort(
            (a, b) => b.conversionRatePct - a.conversionRatePct || b.converted - a.converted,
        )[0];
        if (bestChannel && bestChannel.converted > 0) {
            recommendations.push({
                id: 'best-acquisition-channel',
                severity: 'opportunity',
                category: 'Otimização de Aquisição',
                title: `${bestChannel.channelLabel} lidera em conversão (${bestChannel.conversionRatePct}%)`,
                description: `Canal trouxe ${bestChannel.users} usuário(s), ${bestChannel.imported} ativação(ões) e ${bestChannel.converted} conversão(ões) pagas. Considere escalar criativos e verba nesta origem.`,
                metric: `${bestChannel.conversionRatePct}% conv.`,
                actionLabel: `Explorar ${bestChannel.channelLabel}`,
                actionPath: `/admin/users?source=${encodeURIComponent(bestChannel.channelKey)}`,
            });
        }

        return {
            summary: {
                totalUsers,
                verifiedUsers,
                newUsers24h,
                newUsers7d,
                activeSubscribers,
                expiredSubscribers,
                pendingCheckouts,
                churnRatePct,
                overallConversionRatePct,
                activationRatePct,
                importedUsersCount,
                totalTradesCount,
                totalRevenueAllTime,
            },
            originPerformance: originBreakdown,
            supportQueues: {
                checkoutAbandoned,
                recentlyExpired,
                stalledOnboarding,
                importErrors,
                expiringSoon,
            },
            recommendations,
        };
    }
}
