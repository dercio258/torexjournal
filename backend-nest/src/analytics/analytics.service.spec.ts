import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AnalyticsService, TRANSPARENT_1X1_GIF } from './analytics.service';
import { resolveAcquisitionFields, sanitizeAttributionPayload } from '../users/users.service';

describe('Attribution & Analytics Tracking', () => {
    describe('sanitizeAttributionPayload & resolveAcquisitionFields', () => {
        it('preserves nested firstTouch/lastTouch UTMs and flattens canonical fields', () => {
            const payload = {
                firstTouch: {
                    params: {
                        utm_source: 'facebook',
                        utm_medium: 'cpc',
                        utm_campaign: 'torex_launch_pt',
                        fbclid: 'fb_click_123',
                    },
                    landingPath: '/pt',
                    referrer: 'https://www.instagram.com/',
                    capturedAt: '2026-11-13T10:00:00.000Z',
                },
                lastTouch: {
                    params: {
                        utm_content: 'lp_pt_hero_start_trial',
                        utm_term: 'free_trial',
                        cta_tag: 'lp_pt_hero_start_trial',
                        intent: 'free_trial',
                    },
                    landingPath: '/register',
                    referrer: 'https://torexjournal.com/pt',
                    capturedAt: '2026-11-13T10:02:00.000Z',
                },
                visitorId: 'vis_abc123',
                timezone: 'Africa/Maputo',
                utcOffsetMinutes: 120,
                browserLanguage: 'pt-PT',
            };

            const sanitized = sanitizeAttributionPayload(payload);
            expect(sanitized).toBeDefined();
            expect(sanitized?.firstTouch?.params?.utm_source).toBe('facebook');
            expect(sanitized?.utm_source).toBe('facebook');
            expect(sanitized?.utm_medium).toBe('cpc');
            expect(sanitized?.utm_campaign).toBe('torex_launch_pt');
            expect(sanitized?.ctaTag).toBe('lp_pt_hero_start_trial');
            expect(sanitized?.intent).toBe('free_trial');

            const resolved = resolveAcquisitionFields(sanitized);
            expect(resolved.visitorId).toBe('vis_abc123');
            expect(resolved.acquisitionSource).toBe('facebook');
            expect(resolved.acquisitionMedium).toBe('cpc');
            expect(resolved.acquisitionCampaign).toBe('torex_launch_pt');
            expect(resolved.acquisitionContent).toBe('lp_pt_hero_start_trial');
            expect(resolved.acquisitionTerm).toBe('free_trial');
            expect(resolved.landingPath).toBe('/pt');
        });

        it('infers source from click IDs or external referrer when utm_source is absent', () => {
            const resolved = resolveAcquisitionFields({
                lastTouch: {
                    params: { gclid: 'gclid_999' },
                    landingPath: '/en',
                    referrer: 'https://www.google.com/',
                },
            });
            expect(resolved.acquisitionSource).toBe('google_ads');
            expect(resolved.landingPath).toBe('/en');
        });
    });

    describe('AnalyticsService Email Tracking & Redirect Signing', () => {
        const savedEmails: any[] = [];
        const trackedEvents: any[] = [];
        let lastUpdatedEmail: any = null;

        const createMockRepo = (store?: any[]) => ({
            findOne: jest.fn(async (opts?: any) => {
                if (opts?.where?.key === 'default') {
                    return {
                        key: 'default',
                        enableFirstPartyTracking: true,
                        enableEmailTracking: true,
                        enableCtaAutoTracking: true,
                    };
                }
                if (opts?.where?.token) {
                    return store?.find((r) => r.token === opts.where.token) || {
                        token: opts.where.token,
                        template: 'WELCOME_EMAIL',
                        utmMedium: 'transactional',
                        utmCampaign: 'WELCOME_EMAIL',
                        userId: 'user-1',
                    };
                }
                return null;
            }),
            create: jest.fn((data: any) => ({ ...data })),
            save: jest.fn(async (data: any) => {
                if (store) store.push(data);
                return data;
            }),
            createQueryBuilder: jest.fn(() => {
                const qb: any = {
                    update: () => qb,
                    set: (patch: any) => {
                        lastUpdatedEmail = patch;
                        return qb;
                    },
                    where: () => qb,
                    execute: async () => ({ affected: 1 }),
                };
                return qb;
            }),
        });

        const buildService = () => {
            const eventsRepo = createMockRepo(trackedEvents) as any;
            const emailLogsRepo = createMockRepo(savedEmails) as any;
            const configRepo = createMockRepo() as any;
            const usersRepo = createMockRepo() as any;
            const configService = {
                get: (key: string) => {
                    if (key === 'JWT_SECRET') return 'unit-test-jwt-secret-key-at-least-32-chars';
                    return undefined;
                },
            } as unknown as ConfigService;

            return new AnalyticsService(
                eventsRepo,
                emailLogsRepo,
                configRepo,
                usersRepo,
                configService,
            );
        };

        beforeEach(() => {
            savedEmails.length = 0;
            trackedEvents.length = 0;
            lastUpdatedEmail = null;
            process.env.FRONTEND_URL = 'https://torexjournal.com';
        });

        it('decorates HTML emails with 1x1 open pixel, UTMs, and valid HMAC click tracking links', async () => {
            const service = buildService();
            const html = `<!doctype html><html><body><p>Olá</p><a href="https://torexjournal.com/dashboard">Acessar Conta</a></body></html>`;

            const decorated = await service.createEmailTrackingTokenAndDecorateHtml({
                to: 'trader@example.com',
                template: 'WELCOME_EMAIL',
                subject: 'Bem-vindo',
                html,
            });

            expect(decorated.token).toBeTruthy();
            expect(decorated.html).toContain(`/api/track/email/open/${decorated.token}.gif`);
            expect(decorated.html).toContain('/api/track/email/click?');
            expect(TRANSPARENT_1X1_GIF.length).toBeGreaterThan(20);

            const match = decorated.html.match(/href="([^"]*\/api\/track\/email\/click[^"]*)"/);
            expect(match).toBeTruthy();
            const parsedRedirect = new URL(match![1]);
            const token = parsedRedirect.searchParams.get('t')!;
            const destUrl = parsedRedirect.searchParams.get('u')!;
            const sig = parsedRedirect.searchParams.get('sig')!;
            const cta = parsedRedirect.searchParams.get('cta')!;

            const innerUrl = new URL(destUrl);
            expect(innerUrl.searchParams.get('utm_source')).toBe('email');
            expect(innerUrl.searchParams.get('utm_campaign')).toBe('WELCOME_EMAIL');

            const resolvedDest = await service.trackEmailClick(token, destUrl, sig, cta);
            expect(resolvedDest).toBe(destUrl);
            expect(lastUpdatedEmail).toBeTruthy();
        });

        it('rejects tampered click redirect signatures or non-http URLs', async () => {
            const service = buildService();
            await expect(
                service.trackEmailClick('abc123', 'https://evil.example/phish', 'deadbeef', 'cta'),
            ).rejects.toThrow(BadRequestException);
        });
    });
});
