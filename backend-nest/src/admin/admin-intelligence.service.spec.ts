import {
    classifySubscriptionStatus,
    classifyUserOrigin,
    computeJourneySummary,
} from './admin-intelligence.service';
import { SubscriptionStatus, SubscriptionCycle } from '../payment/subscription.entity';

describe('AdminIntelligenceService helpers', () => {
    describe('classifyUserOrigin', () => {
        it('separates Instagram traffic from Facebook traffic cleanly', () => {
            const igByUtm = classifyUserOrigin({ acquisitionSource: 'ig' });
            expect(igByUtm.channelKey).toBe('instagram');
            expect(igByUtm.channelLabel).toBe('Instagram');
            expect(igByUtm.isSocial).toBe(true);
            expect(igByUtm.networkGroup).toBe('social');

            const igByReferrerAndFbclid = classifyUserOrigin({
                referrer: 'https://l.instagram.com/',
                attributionData: {
                    firstTouch: {
                        referrer: 'https://l.instagram.com/',
                        params: { fbclid: 'IwAR123456' },
                    },
                },
            });
            expect(igByReferrerAndFbclid.channelKey).toBe('instagram');
            expect(igByReferrerAndFbclid.clickIdType).toBe('fbclid');
            expect(igByReferrerAndFbclid.isSocial).toBe(true);

            const fbByUtm = classifyUserOrigin({ acquisitionSource: 'facebook' });
            expect(fbByUtm.channelKey).toBe('facebook');
            expect(fbByUtm.channelLabel).toBe('Facebook');
            expect(fbByUtm.isSocial).toBe(true);

            const fbByReferrerAndFbclid = classifyUserOrigin({
                referrer: 'https://m.facebook.com/story.php?id=1',
                attributionData: {
                    firstTouch: {
                        params: { fbclid: 'IwAR999' },
                    },
                },
            });
            expect(fbByReferrerAndFbclid.channelKey).toBe('facebook');
            expect(fbByReferrerAndFbclid.isSocial).toBe(true);
        });

        it('classifies Meta Ads, TikTok, Google Ads, Google Organic, and Direct', () => {
            const metaFallback = classifyUserOrigin({
                attributionData: { firstTouch: { params: { fbclid: 'fb-only-click' } } },
            });
            expect(metaFallback.channelKey).toBe('meta_ads');
            expect(metaFallback.isSocial).toBe(true);

            const tiktok = classifyUserOrigin({
                attributionData: { firstTouch: { params: { ttclid: 'tt123' } } },
            });
            expect(tiktok.channelKey).toBe('tiktok');
            expect(tiktok.channelLabel).toBe('TikTok');
            expect(tiktok.isSocial).toBe(true);

            const gAds = classifyUserOrigin({
                attributionData: { firstTouch: { params: { gclid: 'gclid-1' } } },
            });
            expect(gAds.channelKey).toBe('google_ads');
            expect(gAds.networkGroup).toBe('paid_ads');
            expect(gAds.isSocial).toBe(false);

            const gOrg = classifyUserOrigin({
                referrer: 'https://www.google.com/search?q=torex+journal',
            });
            expect(gOrg.channelKey).toBe('google_organic');
            expect(gOrg.networkGroup).toBe('search');

            const direct = classifyUserOrigin({});
            expect(direct.channelKey).toBe('direct');
            expect(direct.channelLabel).toBe('Direto / Orgânico');
            expect(direct.isSocial).toBe(false);
        });
    });

    describe('classifySubscriptionStatus', () => {
        const now = new Date('2026-11-14T12:00:00.000Z');

        it('identifies an active non-expired plan accurately', () => {
            const res = classifySubscriptionStatus(
                [
                    {
                        id: 'sub-1',
                        status: SubscriptionStatus.ACTIVE,
                        cycle: SubscriptionCycle.MONTHLY,
                        currentPeriodEnd: new Date('2026-11-24T12:00:00.000Z'),
                        paymentMethod: 'mpesa',
                        planConfig: { tier: 'PRO' },
                    },
                ],
                1,
                now,
            );
            expect(res.planStatus).toBe('ACTIVE');
            expect(res.statusLabel).toBe('ATIVO');
            expect(res.isActivePlan).toBe(true);
            expect(res.isExpiredPlan).toBe(false);
            expect(res.hasEverConverted).toBe(true);
            expect(res.planTier).toBe('PRO');
            expect(res.daysLeft).toBe(10);
            expect(res.expiredDaysAgo).toBeNull();
        });

        it('marks stale ACTIVE subscriptions with past currentPeriodEnd as EXPIRED (JÁ EXPIRADO)', () => {
            const res = classifySubscriptionStatus(
                [
                    {
                        id: 'sub-old',
                        status: SubscriptionStatus.ACTIVE,
                        cycle: SubscriptionCycle.MONTHLY,
                        currentPeriodEnd: new Date('2026-11-09T12:00:00.000Z'),
                        paymentMethod: 'emola',
                        planConfig: { tier: 'BASIC' },
                    },
                ],
                1,
                now,
            );
            expect(res.planStatus).toBe('EXPIRED');
            expect(res.statusLabel).toBe('JÁ EXPIRADO');
            expect(res.isActivePlan).toBe(false);
            expect(res.isExpiredPlan).toBe(true);
            expect(res.hasEverConverted).toBe(true);
            expect(res.expiredDaysAgo).toBe(5);
            expect(res.daysLeft).toBe(0);
        });

        it('prefers active plan when user also has historical expired subscriptions', () => {
            const res = classifySubscriptionStatus(
                [
                    {
                        id: 'sub-expired',
                        status: SubscriptionStatus.EXPIRED,
                        currentPeriodEnd: new Date('2026-10-01T12:00:00.000Z'),
                        planConfig: { tier: 'BASIC' },
                    },
                    {
                        id: 'sub-active',
                        status: SubscriptionStatus.ACTIVE,
                        currentPeriodEnd: new Date('2026-12-01T12:00:00.000Z'),
                        planConfig: { tier: 'PREMIUM' },
                    },
                ],
                2,
                now,
            );
            expect(res.planStatus).toBe('ACTIVE');
            expect(res.planTier).toBe('PREMIUM');
            expect(res.isActivePlan).toBe(true);
        });

        it('distinguishes PENDING checkouts and FREE users', () => {
            const pending = classifySubscriptionStatus(
                [
                    {
                        id: 'sub-pend',
                        status: SubscriptionStatus.APPROVAL_PENDING,
                        createdAt: new Date('2026-11-13T12:00:00.000Z'),
                        planConfig: { tier: 'PRO' },
                    },
                ],
                0,
                now,
            );
            expect(pending.planStatus).toBe('PENDING');
            expect(pending.statusLabel).toBe('CHECKOUT PENDENTE');
            expect(pending.hasEverConverted).toBe(false);

            const free = classifySubscriptionStatus([], 0, now);
            expect(free.planStatus).toBe('FREE');
            expect(free.statusLabel).toBe('SEM PLANO (FREE)');
            expect(free.hasEverConverted).toBe(false);
        });
    });

    describe('computeJourneySummary', () => {
        it('computes 8-point checklist, score, stage, and actionable CS recommendations', () => {
            const paidActive = computeJourneySummary({
                emailVerified: true,
                hasLoggedIn: true,
                onboardingCompleted: true,
                visitedPagesCount: 8,
                visitedPricingOrCheckout: true,
                clickedCtaCount: 5,
                importedTradesCount: 42,
                importsTotalCount: 3,
                accountsConnectedCount: 1,
                journalEntriesCount: 6,
                backtestSessionsCount: 2,
                aiSessionsCount: 1,
                pushSubscribed: true,
                emailOpensCount: 3,
                planStatus: 'ACTIVE',
                expiredDaysAgo: null,
                daysLeft: 20,
                daysSinceSignup: 15,
                daysSinceLastActive: 0,
                failedImportsCount: 0,
                hasWhatsapp: true,
            });
            expect(paidActive.funnelStage).toBe('PAYING');
            expect(paidActive.engagementScore).toBe(100);
            expect(Object.values(paidActive.checklist).every(Boolean)).toBe(true);

            const churned = computeJourneySummary({
                emailVerified: true,
                hasLoggedIn: true,
                onboardingCompleted: false,
                visitedPagesCount: 3,
                visitedPricingOrCheckout: true,
                clickedCtaCount: 1,
                importedTradesCount: 0,
                importsTotalCount: 1,
                accountsConnectedCount: 0,
                journalEntriesCount: 0,
                backtestSessionsCount: 0,
                aiSessionsCount: 0,
                pushSubscribed: false,
                emailOpensCount: 0,
                planStatus: 'EXPIRED',
                expiredDaysAgo: 4,
                daysLeft: 0,
                daysSinceSignup: 35,
                daysSinceLastActive: 5,
                failedImportsCount: 1,
                hasWhatsapp: true,
            });
            expect(churned.funnelStage).toBe('CHURNED');
            expect(churned.checklist.importedTrades).toBe(false);
            expect(churned.checklist.convertedPaid).toBe(true);
            expect(churned.recommendations.some((r) => r.includes('expirado há 4 dia'))).toBe(true);
            expect(churned.recommendations.some((r) => r.includes('falha na importação'))).toBe(true);
        });
    });
});
