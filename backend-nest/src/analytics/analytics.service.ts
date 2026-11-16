import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { In, Repository } from 'typeorm';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { TrackingEventEntity } from './entities/tracking-event.entity';
import { EmailTrackingLogEntity } from './entities/email-tracking-log.entity';
import { TrackingConfigEntity } from './entities/tracking-config.entity';
import { UserEntity } from '../users/user.entity';
import { resolveAcquisitionFields, sanitizeAttributionPayload } from '../users/users.service';
import { getJwtSecret } from '../common/security/security.config';
import { resolveFrontendUrl } from '../email/templates/utils';
import { RecordUserActivityDto, TrackEventDto, UpdatePixelConfigDto } from './dto/analytics.dto';

// Standard 1x1 transparent GIF (43 bytes)
export const TRANSPARENT_1X1_GIF = Buffer.from(
    'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    'base64',
);

export interface DecorateEmailTrackingInput {
    to: string;
    template: string;
    subject: string;
    html: string;
    userId?: string | null;
    broadcastId?: string | null;
    utmCampaign?: string | null;
    utmMedium?: string | null;
    metadata?: Record<string, any> | null;
}

@Injectable()
export class AnalyticsService {
    private readonly logger = new Logger(AnalyticsService.name);

    constructor(
        @InjectRepository(TrackingEventEntity)
        private readonly eventsRepo: Repository<TrackingEventEntity>,
        @InjectRepository(EmailTrackingLogEntity)
        private readonly emailLogsRepo: Repository<EmailTrackingLogEntity>,
        @InjectRepository(TrackingConfigEntity)
        private readonly configRepo: Repository<TrackingConfigEntity>,
        @InjectRepository(UserEntity)
        private readonly usersRepo: Repository<UserEntity>,
        private readonly configService: ConfigService,
    ) {}

    private async ensureConfigRow(): Promise<TrackingConfigEntity> {
        let cfg = await this.configRepo.findOne({ where: { key: 'default' } });
        if (!cfg) {
            cfg = this.configRepo.create({
                key: 'default',
                metaPixelId: this.configService.get<string>('META_PIXEL_ID') || null,
                metaCapiAccessToken: this.configService.get<string>('META_CAPI_ACCESS_TOKEN') || null,
                ga4MeasurementId: this.configService.get<string>('GA4_MEASUREMENT_ID') || null,
                gtmContainerId: this.configService.get<string>('GTM_CONTAINER_ID') || null,
                tiktokPixelId: this.configService.get<string>('TIKTOK_PIXEL_ID') || null,
                utmifyPixelId: this.configService.get<string>('UTMIFY_PIXEL_ID') || null,
                enableFirstPartyTracking: true,
                enableEmailTracking: true,
                enableCtaAutoTracking: true,
                customHeadScript: null,
            });
            cfg = await this.configRepo.save(cfg);
        }
        return cfg;
    }

    async getPublicPixelConfig() {
        const cfg = await this.ensureConfigRow();
        return {
            metaPixelId: cfg.metaPixelId || this.configService.get<string>('META_PIXEL_ID') || null,
            ga4MeasurementId: cfg.ga4MeasurementId || this.configService.get<string>('GA4_MEASUREMENT_ID') || null,
            gtmContainerId: cfg.gtmContainerId || this.configService.get<string>('GTM_CONTAINER_ID') || null,
            tiktokPixelId: cfg.tiktokPixelId || this.configService.get<string>('TIKTOK_PIXEL_ID') || null,
            utmifyPixelId: cfg.utmifyPixelId || this.configService.get<string>('UTMIFY_PIXEL_ID') || null,
            enableFirstPartyTracking: cfg.enableFirstPartyTracking ?? true,
            enableEmailTracking: cfg.enableEmailTracking ?? true,
            enableCtaAutoTracking: cfg.enableCtaAutoTracking ?? true,
            customHeadScript: cfg.customHeadScript || null,
        };
    }

    async getAdminPixelConfig() {
        const cfg = await this.ensureConfigRow();
        return {
            metaPixelId: cfg.metaPixelId || '',
            hasMetaCapiAccessToken: Boolean(cfg.metaCapiAccessToken || this.configService.get<string>('META_CAPI_ACCESS_TOKEN')),
            metaCapiAccessTokenPreview: cfg.metaCapiAccessToken
                ? `${cfg.metaCapiAccessToken.slice(0, 6)}...${cfg.metaCapiAccessToken.slice(-4)}`
                : '',
            ga4MeasurementId: cfg.ga4MeasurementId || '',
            gtmContainerId: cfg.gtmContainerId || '',
            tiktokPixelId: cfg.tiktokPixelId || '',
            utmifyPixelId: cfg.utmifyPixelId || '',
            enableFirstPartyTracking: cfg.enableFirstPartyTracking ?? true,
            enableEmailTracking: cfg.enableEmailTracking ?? true,
            enableCtaAutoTracking: cfg.enableCtaAutoTracking ?? true,
            customHeadScript: cfg.customHeadScript || '',
            updatedAt: cfg.updatedAt,
        };
    }

    async updateAdminPixelConfig(dto: UpdatePixelConfigDto) {
        const cfg = await this.ensureConfigRow();
        const cleanId = (val?: string) => (typeof val === 'string' ? val.trim().slice(0, 120) || null : undefined);

        if (dto.metaPixelId !== undefined) cfg.metaPixelId = cleanId(dto.metaPixelId) ?? null;
        if (dto.ga4MeasurementId !== undefined) cfg.ga4MeasurementId = cleanId(dto.ga4MeasurementId) ?? null;
        if (dto.gtmContainerId !== undefined) cfg.gtmContainerId = cleanId(dto.gtmContainerId) ?? null;
        if (dto.tiktokPixelId !== undefined) cfg.tiktokPixelId = cleanId(dto.tiktokPixelId) ?? null;
        if (dto.utmifyPixelId !== undefined) cfg.utmifyPixelId = cleanId(dto.utmifyPixelId) ?? null;
        if (dto.metaCapiAccessToken !== undefined) {
            const trimmed = dto.metaCapiAccessToken.trim();
            // Only overwrite if user entered a new non-masked token (or explicitly cleared it)
            if (!trimmed) {
                cfg.metaCapiAccessToken = null;
            } else if (!trimmed.includes('...')) {
                cfg.metaCapiAccessToken = trimmed.slice(0, 512);
            }
        }
        if (dto.enableFirstPartyTracking !== undefined) cfg.enableFirstPartyTracking = dto.enableFirstPartyTracking;
        if (dto.enableEmailTracking !== undefined) cfg.enableEmailTracking = dto.enableEmailTracking;
        if (dto.enableCtaAutoTracking !== undefined) cfg.enableCtaAutoTracking = dto.enableCtaAutoTracking;
        if (dto.customHeadScript !== undefined) {
            cfg.customHeadScript = dto.customHeadScript.trim() || null;
        }

        await this.configRepo.save(cfg);
        return this.getAdminPixelConfig();
    }

    private hashIp(ip?: string): string | null {
        if (!ip) return null;
        const salt = getJwtSecret(this.configService);
        return createHash('sha256').update(`${ip}|${salt}`).digest('hex').slice(0, 32);
    }

    private cleanStr(value: unknown, maxLen: number): string | null {
        if (typeof value !== 'string') return null;
        const trimmed = value.trim();
        return trimmed ? trimmed.slice(0, maxLen) : null;
    }

    private isAdminPath(pagePath?: string | null): boolean {
        if (!pagePath) return false;
        const normalized = pagePath.toLowerCase();
        return normalized === '/admin' || normalized.startsWith('/admin/');
    }

    private sanitizeEventInput(
        dto: Partial<TrackEventDto>,
        context?: { userId?: string | null; ip?: string; userAgent?: string },
    ): Partial<TrackingEventEntity> | null {
        const pagePath = this.cleanStr(dto.pagePath, 512);
        const eventType = this.cleanStr(dto.eventType, 32) || 'custom';

        // Exclude backoffice /admin browsing & clicks from public acquisition analytics
        if (this.isAdminPath(pagePath) && (eventType === 'pageview' || eventType === 'button_click')) {
            return null;
        }

        const eventName = this.cleanStr(dto.eventName, 120);
        const visitorId = this.cleanStr(dto.visitorId, 120);
        if (!eventName || !visitorId) return null;

        return {
            eventName,
            eventType,
            visitorId,
            sessionId: this.cleanStr(dto.sessionId, 120),
            userId: context?.userId || null,
            pagePath,
            pageTitle: this.cleanStr(dto.pageTitle, 256),
            elementId: this.cleanStr(dto.elementId, 120),
            elementLabel: this.cleanStr(dto.elementLabel, 256),
            ctaTag: this.cleanStr(dto.ctaTag, 120) || this.cleanStr(dto.utmContent, 120),
            intent: this.cleanStr(dto.intent, 120) || this.cleanStr(dto.utmTerm, 120),
            targetUrl: this.cleanStr(dto.targetUrl, 1024),
            referrer: this.cleanStr(dto.referrer, 1024),
            utmSource: this.cleanStr(dto.utmSource, 160),
            utmMedium: this.cleanStr(dto.utmMedium, 160),
            utmCampaign: this.cleanStr(dto.utmCampaign, 200),
            utmContent: this.cleanStr(dto.utmContent, 200),
            utmTerm: this.cleanStr(dto.utmTerm, 200),
            utmId: this.cleanStr(dto.utmId, 160),
            clickId: this.cleanStr(dto.clickId, 200),
            locale: this.cleanStr(dto.locale, 16),
            deviceType: this.cleanStr(dto.deviceType, 32),
            ipHash: this.hashIp(context?.ip),
            userAgent: this.cleanStr(context?.userAgent, 512),
            revenue: typeof dto.revenue === 'number' && Number.isFinite(dto.revenue) ? dto.revenue : null,
            currency: this.cleanStr(dto.currency, 16),
            metadata: dto.metadata && typeof dto.metadata === 'object' ? dto.metadata : null,
        };
    }

    private async resolveVisitorUserIds(visitorIds: string[]): Promise<Map<string, string>> {
        const result = new Map<string, string>();
        const unique = Array.from(new Set(visitorIds.filter(Boolean))).slice(0, 50);
        if (unique.length === 0) return result;
        try {
            const matchedUsers = await this.usersRepo.find({
                select: ['id', 'visitorId'],
                where: { visitorId: In(unique) },
            });
            for (const u of matchedUsers) {
                if (u.visitorId) result.set(u.visitorId, u.id);
            }
        } catch {
            // Ignore lookup failures
        }
        return result;
    }

    private describeTrackingEvent(
        ev: Pick<TrackingEventEntity, 'eventName' | 'eventType' | 'pagePath' | 'pageTitle' | 'elementLabel' | 'ctaTag'>,
    ): { actionType: string; label: string; pagePath: string | null } {
        const cleanPath = this.cleanStr(ev.pagePath, 255);
        if (
            ev.eventType === 'conversion' ||
            ['signup', 'trial_start', 'purchase', 'checkout_started', 'lead'].includes(ev.eventName)
        ) {
            const convMap: Record<string, string> = {
                signup: 'Criou conta na plataforma',
                trial_start: 'Iniciou período de teste (Trial)',
                checkout_started: 'Abriu checkout de pagamento',
                purchase: 'Concluiu pagamento de assinatura',
                lead: 'Enviou contacto / lead',
            };
            return {
                actionType: ev.eventName,
                label: convMap[ev.eventName] || `Conversão: ${ev.eventName}`,
                pagePath: cleanPath,
            };
        }
        if (ev.eventType === 'button_click') {
            const lbl = this.cleanStr(ev.elementLabel, 140) || this.cleanStr(ev.ctaTag, 120) || 'Botão';
            return {
                actionType: 'button_click',
                label: `Clicou: ${lbl}`.slice(0, 180),
                pagePath: cleanPath,
            };
        }
        if (ev.eventType === 'pageview') {
            const routeLabels: Array<[RegExp, string]> = [
                [/^\/dashboard/i, 'Acessou Dashboard'],
                [/^\/journal/i, 'Acessou Diário de Trades'],
                [/^\/analytics/i, 'Acessou Analytics'],
                [/^\/backtest/i, 'Acessou Backtest'],
                [/^\/ai/i, 'Acessou Assistente IA'],
                [/^\/add-trades/i, 'Abriu Importação de Trades'],
                [/^\/trades/i, 'Acessou Histórico de Trades'],
                [/^\/academy/i, 'Acessou Academia'],
                [/^\/pricing|^\/plans/i, 'Visualizou Planos & Preços'],
                [/^\/checkout/i, 'Abriu Checkout'],
                [/^\/configuration/i, 'Acessou Configurações'],
                [/^\/register/i, 'Visitou Página de Registo'],
                [/^\/login/i, 'Visitou Página de Login'],
                [/^\/$/i, 'Visitou Página Inicial'],
            ];
            const matched = cleanPath ? routeLabels.find(([re]) => re.test(cleanPath)) : undefined;
            const label = matched
                ? matched[1]
                : cleanPath
                  ? `Visitou ${cleanPath}`
                  : this.cleanStr(ev.pageTitle, 160) || 'Navegou na plataforma';
            return {
                actionType: 'page_view',
                label: label.slice(0, 180),
                pagePath: cleanPath,
            };
        }
        if (ev.eventName === 'login') {
            return {
                actionType: 'login',
                label: 'Entrou na plataforma',
                pagePath: cleanPath || '/dashboard',
            };
        }
        return {
            actionType: this.cleanStr(ev.eventName, 64) || 'activity',
            label: (
                this.cleanStr(ev.elementLabel, 160) ||
                this.cleanStr(ev.ctaTag, 160) ||
                ev.eventName
            ).slice(0, 180),
            pagePath: cleanPath,
        };
    }

    private async touchUserLastActivity(
        userId: string,
        actionType: string,
        label: string | null,
        pagePath: string | null,
        occurredAt?: Date,
    ): Promise<void> {
        if (!userId) return;
        try {
            const ts = occurredAt || new Date();
            await this.usersRepo.update(userId, {
                lastActiveAt: ts,
                lastActionType: this.cleanStr(actionType, 64) || 'activity',
                lastActionLabel: this.cleanStr(label, 180),
                lastActionPath: this.cleanStr(pagePath, 255),
            });
        } catch {
            // Non-blocking activity snapshot update
        }
    }

    async recordAuthenticatedActivity(
        userId: string,
        dto: RecordUserActivityDto,
        context?: { ip?: string; userAgent?: string },
    ): Promise<{ ok: boolean }> {
        if (!userId || !dto?.actionType) return { ok: false };
        const cleanType = this.cleanStr(dto.actionType, 64) || 'activity';
        const cleanLabel = this.cleanStr(dto.label, 180) || cleanType;
        const cleanPath = this.cleanStr(dto.pagePath, 255);

        await this.touchUserLastActivity(userId, cleanType, cleanLabel, cleanPath);

        try {
            const user = await this.usersRepo.findOne({
                select: ['id', 'visitorId'],
                where: { id: userId },
            });
            await this.recordEvent(
                {
                    eventName: cleanType,
                    eventType: 'custom',
                    visitorId: user?.visitorId || `user-${userId}`,
                    pagePath: cleanPath || undefined,
                    elementLabel: cleanLabel || undefined,
                    metadata: dto.metadata,
                },
                {
                    userId,
                    ip: context?.ip,
                    userAgent: context?.userAgent,
                },
            );
        } catch {
            // Non-blocking
        }
        return { ok: true };
    }

    async recordEvent(
        dto: Partial<TrackEventDto>,
        context?: { userId?: string | null; ip?: string; userAgent?: string; email?: string | null },
    ): Promise<void> {
        try {
            const cfg = await this.ensureConfigRow();
            if (!cfg.enableFirstPartyTracking) return;

            const row = this.sanitizeEventInput(dto, context);
            if (!row) return;

            if (!row.userId && row.visitorId) {
                const map = await this.resolveVisitorUserIds([row.visitorId]);
                const resolvedUser = map.get(row.visitorId);
                if (resolvedUser) row.userId = resolvedUser;
            }

            const entity = this.eventsRepo.create(row);
            const saved = await this.eventsRepo.save(entity);

            if (saved.userId && saved.eventType !== 'email_open') {
                const summary = this.describeTrackingEvent(saved);
                void this.touchUserLastActivity(
                    saved.userId,
                    summary.actionType,
                    summary.label,
                    summary.pagePath,
                    saved.createdAt,
                );
            }

            if (row.eventType === 'conversion') {
                void this.forwardMetaConversionApi(saved, cfg, context?.email, context?.ip, context?.userAgent);
            }
        } catch (err: any) {
            this.logger.warn(`Failed to record tracking event ${dto?.eventName}: ${err?.message || err}`);
        }
    }

    async recordEventsBatch(
        events: TrackEventDto[],
        context?: { userId?: string | null; ip?: string; userAgent?: string },
    ): Promise<{ accepted: number }> {
        try {
            const cfg = await this.ensureConfigRow();
            if (!cfg.enableFirstPartyTracking || !Array.isArray(events) || events.length === 0) {
                return { accepted: 0 };
            }

            const slice = events.slice(0, 50);
            const rows: Partial<TrackingEventEntity>[] = [];
            const missingVisitorIds: string[] = [];
            for (const dto of slice) {
                const row = this.sanitizeEventInput(dto, context);
                if (row) {
                    rows.push(row);
                    if (!row.userId && row.visitorId) {
                        missingVisitorIds.push(row.visitorId);
                    }
                }
            }

            if (rows.length === 0) return { accepted: 0 };

            const visitorUserMap = await this.resolveVisitorUserIds(missingVisitorIds);
            const entities: TrackingEventEntity[] = [];
            for (const row of rows) {
                if (!row.userId && row.visitorId) {
                    const matchedId = visitorUserMap.get(row.visitorId);
                    if (matchedId) row.userId = matchedId;
                }
                entities.push(this.eventsRepo.create(row));
            }

            const saved = await this.eventsRepo.save(entities);

            const bestEventByUser = new Map<string, TrackingEventEntity>();
            for (const ev of saved) {
                if (!ev.userId || ev.eventType === 'email_open') continue;
                const prev = bestEventByUser.get(ev.userId);
                if (!prev) {
                    bestEventByUser.set(ev.userId, ev);
                    continue;
                }
                const prevIsConversion = prev.eventType === 'conversion';
                const currIsConversion = ev.eventType === 'conversion';
                if (currIsConversion || !prevIsConversion) {
                    bestEventByUser.set(ev.userId, ev);
                }
            }

            for (const [uid, bestEv] of bestEventByUser.entries()) {
                const summary = this.describeTrackingEvent(bestEv);
                void this.touchUserLastActivity(
                    uid,
                    summary.actionType,
                    summary.label,
                    summary.pagePath,
                    bestEv.createdAt,
                );
            }

            for (const ev of saved) {
                if (ev.eventType === 'conversion') {
                    void this.forwardMetaConversionApi(ev, cfg, undefined, context?.ip, context?.userAgent);
                }
            }
            return { accepted: saved.length };
        } catch (err: any) {
            this.logger.warn(`Failed to record batch events: ${err?.message || err}`);
            return { accepted: 0 };
        }
    }

    private async forwardMetaConversionApi(
        event: TrackingEventEntity,
        cfg: TrackingConfigEntity,
        email?: string | null,
        ip?: string,
        userAgent?: string,
    ): Promise<void> {
        const pixelId = cfg.metaPixelId || this.configService.get<string>('META_PIXEL_ID');
        const accessToken = cfg.metaCapiAccessToken || this.configService.get<string>('META_CAPI_ACCESS_TOKEN');
        if (!pixelId || !accessToken) return;

        try {
            const mappedName =
                event.eventName === 'signup'
                    ? 'CompleteRegistration'
                    : event.eventName === 'purchase'
                      ? 'Purchase'
                      : event.eventName === 'trial_start'
                        ? 'StartTrial'
                        : event.eventName === 'checkout_started'
                          ? 'InitiateCheckout'
                          : event.eventName;

            const userData: Record<string, any> = {};
            if (email) {
                userData.em = [createHash('sha256').update(email.trim().toLowerCase()).digest('hex')];
            }
            if (ip) userData.client_ip_address = ip;
            if (userAgent) userData.client_user_agent = userAgent;
            if (event.clickId) userData.fbc = event.clickId;

            const payload = {
                data: [
                    {
                        event_name: mappedName,
                        event_time: Math.floor(Date.now() / 1000),
                        event_id: event.id,
                        action_source: 'website',
                        event_source_url: event.pagePath ? `${resolveFrontendUrl()}${event.pagePath}` : resolveFrontendUrl(),
                        user_data: userData,
                        custom_data: {
                            currency: event.currency || 'MZN',
                            value: event.revenue || 0,
                            utm_source: event.utmSource,
                            utm_campaign: event.utmCampaign,
                            cta_tag: event.ctaTag,
                        },
                    },
                ],
            };

            const res = await fetch(
                `https://graph.facebook.com/v19.0/${encodeURIComponent(pixelId)}/events?access_token=${encodeURIComponent(accessToken)}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                },
            );
            if (!res.ok) {
                const body = await res.text().catch(() => '');
                this.logger.warn(`Meta CAPI error (${res.status}): ${body.slice(0, 200)}`);
            }
        } catch (err: any) {
            this.logger.warn(`Meta CAPI dispatch failed: ${err?.message || err}`);
        }
    }

    async identifyVisitor(
        userId: string,
        visitorId: string,
        rawAttribution?: Record<string, any>,
    ): Promise<{ linkedEvents: number; updatedAttribution: boolean }> {
        const cleanVisitorId = this.cleanStr(visitorId, 120);
        if (!cleanVisitorId) return { linkedEvents: 0, updatedAttribution: false };

        const updateResult = await this.eventsRepo
            .createQueryBuilder()
            .update(TrackingEventEntity)
            .set({ userId })
            .where('visitor_id = :visitorId AND user_id IS NULL', { visitorId: cleanVisitorId })
            .execute();

        let updatedAttribution = false;
        const user = await this.usersRepo.findOne({ where: { id: userId } });
        if (user) {
            const patch: Partial<UserEntity> = {};
            if (!user.visitorId) {
                patch.visitorId = cleanVisitorId;
            }
            const cleanAttr = sanitizeAttributionPayload(rawAttribution);
            if (cleanAttr) {
                const resolved = resolveAcquisitionFields(cleanAttr, cleanVisitorId);
                if (!user.attributionData) {
                    patch.attributionData = cleanAttr;
                }
                if (!user.acquisitionSource || user.acquisitionSource === 'direct') {
                    if (resolved.acquisitionSource && resolved.acquisitionSource !== 'direct') {
                        patch.acquisitionSource = resolved.acquisitionSource;
                    } else if (!user.acquisitionSource) {
                        patch.acquisitionSource = resolved.acquisitionSource || 'direct';
                    }
                }
                if (!user.acquisitionMedium && resolved.acquisitionMedium) patch.acquisitionMedium = resolved.acquisitionMedium;
                if (!user.acquisitionCampaign && resolved.acquisitionCampaign) patch.acquisitionCampaign = resolved.acquisitionCampaign;
                if (!user.acquisitionContent && resolved.acquisitionContent) patch.acquisitionContent = resolved.acquisitionContent;
                if (!user.acquisitionTerm && resolved.acquisitionTerm) patch.acquisitionTerm = resolved.acquisitionTerm;
                if (!user.landingPath && resolved.landingPath) patch.landingPath = resolved.landingPath;
                if (!user.referrer && resolved.referrer) patch.referrer = resolved.referrer;
            }
            if (Object.keys(patch).length > 0) {
                await this.usersRepo.update(user.id, patch);
                updatedAttribution = true;
            }
        }

        return {
            linkedEvents: updateResult.affected || 0,
            updatedAttribution,
        };
    }

    async recordAuthOrBillingConversion(params: {
        eventName: 'signup' | 'login' | 'trial_start' | 'purchase' | 'checkout_started';
        userId: string;
        email?: string | null;
        visitorId?: string | null;
        revenue?: number | null;
        currency?: string | null;
        attributionData?: any;
        metadata?: Record<string, any>;
    }): Promise<void> {
        const resolved = resolveAcquisitionFields(params.attributionData, params.visitorId);
        await this.recordEvent(
            {
                eventName: params.eventName,
                eventType: params.eventName === 'login' ? 'custom' : 'conversion',
                visitorId: resolved.visitorId || `user-${params.userId}`,
                pagePath: params.eventName === 'signup' ? '/register' : params.eventName === 'purchase' ? '/checkout' : '/',
                utmSource: resolved.acquisitionSource || undefined,
                utmMedium: resolved.acquisitionMedium || undefined,
                utmCampaign: resolved.acquisitionCampaign || undefined,
                utmContent: resolved.acquisitionContent || undefined,
                utmTerm: resolved.acquisitionTerm || undefined,
                ctaTag: resolved.acquisitionContent || undefined,
                intent: resolved.acquisitionTerm || undefined,
                referrer: resolved.referrer || undefined,
                revenue: params.revenue ?? undefined,
                currency: params.currency ?? undefined,
                metadata: params.metadata,
            },
            {
                userId: params.userId,
                email: params.email,
            },
        );
    }

    private signEmailRedirect(token: string, destUrl: string): string {
        const secret = getJwtSecret(this.configService);
        return createHmac('sha256', secret)
            .update(`${token}|${destUrl}`)
            .digest('hex')
            .slice(0, 32);
    }

    private verifyEmailRedirectSignature(token: string, destUrl: string, sig: string): boolean {
        if (!token || !destUrl || !sig) return false;
        const expected = this.signEmailRedirect(token, destUrl);
        try {
            const a = Buffer.from(expected, 'utf8');
            const b = Buffer.from(sig, 'utf8');
            return a.length === b.length && timingSafeEqual(a, b);
        } catch {
            return false;
        }
    }

    private deriveEmailLinkCtaTag(rawHref: string, innerHtml: string, index: number): string {
        const cleanText = innerHtml
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 40);
        if (cleanText) return `email_${cleanText}`;
        try {
            const parsed = new URL(rawHref);
            const pathPart = parsed.pathname
                .replace(/^\/+|\/+$/g, '')
                .replace(/[^a-z0-9]+/gi, '_')
                .toLowerCase()
                .slice(0, 40);
            if (pathPart) return `email_${pathPart}`;
        } catch {
            // ignore
        }
        return `email_cta_${index + 1}`;
    }

    async createEmailTrackingTokenAndDecorateHtml(
        input: DecorateEmailTrackingInput,
    ): Promise<{ html: string; token: string | null }> {
        try {
            const cfg = await this.ensureConfigRow();
            if (!cfg.enableEmailTracking || !input.html) {
                return { html: input.html, token: null };
            }

            const token = randomBytes(16).toString('hex');
            const utmMedium = input.utmMedium || (input.broadcastId ? 'broadcast' : 'transactional');
            const utmCampaign = input.utmCampaign || input.template || 'system';

            await this.emailLogsRepo.save(
                this.emailLogsRepo.create({
                    token,
                    recipientEmail: input.to.trim().toLowerCase().slice(0, 320),
                    userId: input.userId || null,
                    template: (input.template || 'raw_html').slice(0, 120),
                    subject: input.subject ? input.subject.slice(0, 320) : null,
                    broadcastId: input.broadcastId ? input.broadcastId.slice(0, 120) : null,
                    utmCampaign: utmCampaign.slice(0, 200),
                    utmMedium: utmMedium.slice(0, 120),
                    metadata: input.metadata || null,
                }),
            );

            const baseUrl = resolveFrontendUrl();
            let frontendHost = '';
            try {
                frontendHost = new URL(baseUrl).hostname.toLowerCase();
            } catch {
                frontendHost = '';
            }

            let linkIndex = 0;
            const rewrittenHtml = input.html.replace(
                /<a\b([^>]*?)\bhref=(["'])([^"']+)\2([^>]*)>([\s\S]*?)<\/a>/gi,
                (fullMatch, beforeAttr, quote, rawHref, afterAttr, innerHtml) => {
                    const trimmedHref = rawHref.trim();
                    if (
                        !/^https?:\/\//i.test(trimmedHref) ||
                        trimmedHref.includes('/api/track/email/')
                    ) {
                        return fullMatch;
                    }

                    const ctaTag = this.deriveEmailLinkCtaTag(trimmedHref, innerHtml, linkIndex++);
                    let finalDestUrl = trimmedHref;

                    try {
                        const parsed = new URL(trimmedHref);
                        const isSamePlatform =
                            !frontendHost ||
                            parsed.hostname.toLowerCase() === frontendHost ||
                            parsed.hostname.toLowerCase().endsWith('torexjournal.com');
                        if (isSamePlatform) {
                            if (!parsed.searchParams.has('utm_source')) parsed.searchParams.set('utm_source', 'email');
                            if (!parsed.searchParams.has('utm_medium')) parsed.searchParams.set('utm_medium', utmMedium);
                            if (!parsed.searchParams.has('utm_campaign')) parsed.searchParams.set('utm_campaign', utmCampaign);
                            if (!parsed.searchParams.has('utm_content')) parsed.searchParams.set('utm_content', ctaTag);
                            finalDestUrl = parsed.toString();
                        }
                    } catch {
                        return fullMatch;
                    }

                    const sig = this.signEmailRedirect(token, finalDestUrl);
                    const trackedHref = `${baseUrl}/api/track/email/click?t=${encodeURIComponent(token)}&cta=${encodeURIComponent(ctaTag)}&u=${encodeURIComponent(finalDestUrl)}&sig=${encodeURIComponent(sig)}`;
                    return `<a${beforeAttr} href=${quote}${trackedHref}${quote}${afterAttr}>${innerHtml}</a>`;
                },
            );

            const pixelImg = `<img src="${baseUrl}/api/track/email/open/${token}.gif" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:0;overflow:hidden;" />`;
            const withPixel = /<\/body>/i.test(rewrittenHtml)
                ? rewrittenHtml.replace(/<\/body>/i, `${pixelImg}</body>`)
                : `${rewrittenHtml}${pixelImg}`;

            return { html: withPixel, token };
        } catch (err: any) {
            this.logger.warn(`Failed to decorate email with tracking: ${err?.message || err}`);
            return { html: input.html, token: null };
        }
    }

    async trackEmailOpen(rawToken: string, ip?: string, userAgent?: string): Promise<void> {
        const token = (rawToken || '').replace(/\.gif$/i, '').trim().slice(0, 64);
        if (!token) return;

        try {
            await this.emailLogsRepo
                .createQueryBuilder()
                .update(EmailTrackingLogEntity)
                .set({
                    openedAt: () => 'COALESCE("opened_at", NOW())',
                    openCount: () => '"open_count" + 1',
                })
                .where('token = :token', { token })
                .execute();

            const log = await this.emailLogsRepo.findOne({ where: { token } });
            if (log) {
                await this.recordEvent(
                    {
                        eventName: 'email_open',
                        eventType: 'email_open',
                        visitorId: `email-${token}`,
                        pagePath: `/email/${log.template}`,
                        utmSource: 'email',
                        utmMedium: log.utmMedium || 'transactional',
                        utmCampaign: log.utmCampaign || log.template,
                        ctaTag: log.template,
                    },
                    { userId: log.userId, ip, userAgent },
                );
            }
        } catch (err: any) {
            this.logger.warn(`Failed to track email open (${token}): ${err?.message || err}`);
        }
    }

    async trackEmailClick(
        token: string,
        rawUrl: string,
        sig: string,
        cta?: string,
        ip?: string,
        userAgent?: string,
    ): Promise<string> {
        const cleanToken = (token || '').trim().slice(0, 64);
        const destUrl = (rawUrl || '').trim();
        if (!cleanToken || !destUrl || !this.verifyEmailRedirectSignature(cleanToken, destUrl, sig)) {
            throw new BadRequestException('Invalid email tracking signature');
        }

        let parsed: URL;
        try {
            parsed = new URL(destUrl);
        } catch {
            throw new BadRequestException('Invalid destination URL');
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            throw new BadRequestException('Unsupported URL scheme');
        }

        const safeCta = this.cleanStr(cta, 160) || 'email_cta';

        try {
            await this.emailLogsRepo
                .createQueryBuilder()
                .update(EmailTrackingLogEntity)
                .set({
                    openedAt: () => 'COALESCE("opened_at", NOW())',
                    firstClickedAt: () => 'COALESCE("first_clicked_at", NOW())',
                    clickCount: () => '"click_count" + 1',
                    lastClickedUrl: destUrl.slice(0, 1024),
                    lastCtaTag: safeCta,
                })
                .where('token = :token', { token: cleanToken })
                .execute();

            const log = await this.emailLogsRepo.findOne({ where: { token: cleanToken } });
            await this.recordEvent(
                {
                    eventName: 'email_link_click',
                    eventType: 'email_click',
                    visitorId: `email-${cleanToken}`,
                    pagePath: `/email/${log?.template || 'unknown'}`,
                    elementLabel: safeCta,
                    ctaTag: safeCta,
                    targetUrl: destUrl.slice(0, 1024),
                    utmSource: 'email',
                    utmMedium: log?.utmMedium || 'transactional',
                    utmCampaign: log?.utmCampaign || log?.template || undefined,
                    utmContent: safeCta,
                },
                { userId: log?.userId || null, ip, userAgent },
            );
        } catch (err: any) {
            this.logger.warn(`Failed to record email click (${cleanToken}): ${err?.message || err}`);
        }

        return parsed.toString();
    }

    private resolveDateWindow(days?: number): { days: number; since: Date } {
        const clampedDays = Math.min(365, Math.max(1, Number(days) || 30));
        const since = new Date(Date.now() - clampedDays * 86_400_000);
        return { days: clampedDays, since };
    }

    async getOverviewAnalytics(filters?: { days?: number; utmSource?: string; deviceType?: string }) {
        const { days, since } = this.resolveDateWindow(filters?.days);
        const utmSourceFilter = filters?.utmSource?.trim() || null;
        const deviceTypeFilter = filters?.deviceType?.trim() || null;

        const baseParams: any[] = [since];
        const eventClauses = ['created_at >= $1'];
        if (utmSourceFilter) {
            baseParams.push(utmSourceFilter.toLowerCase());
            eventClauses.push(`LOWER(COALESCE(utm_source, 'direct')) = $${baseParams.length}`);
        }
        if (deviceTypeFilter) {
            baseParams.push(deviceTypeFilter.toLowerCase());
            eventClauses.push(`LOWER(COALESCE(device_type, 'unknown')) = $${baseParams.length}`);
        }
        const whereSql = eventClauses.join(' AND ');

        const [
            summaryRows,
            timelineRows,
            topPagesRows,
            topButtonsRows,
            topIntentsRows,
            utmSourcesRows,
            utmCampaignsRows,
            deviceRows,
            emailSummaryRows,
            emailByTemplateRows,
            emailByBroadcastRows,
            emailTimelineRows,
            userSignupsSummaryRows,
            recentEventsRows,
        ] = await Promise.all([
            this.eventsRepo.query(
                `SELECT
                    COUNT(*) FILTER (WHERE event_type = 'pageview')::int AS total_page_views,
                    COUNT(DISTINCT visitor_id)::int AS unique_visitors,
                    COUNT(*) FILTER (WHERE event_type = 'button_click')::int AS total_button_clicks,
                    COUNT(*) FILTER (WHERE event_type = 'conversion' AND event_name = 'signup')::int AS tracked_signups,
                    COUNT(*) FILTER (WHERE event_type = 'conversion' AND event_name = 'checkout_started')::int AS checkout_started,
                    COUNT(*) FILTER (WHERE event_type = 'conversion' AND event_name = 'trial_start')::int AS trials_started,
                    COUNT(*) FILTER (WHERE event_type = 'conversion' AND event_name = 'purchase')::int AS total_purchases,
                    COALESCE(SUM(revenue) FILTER (WHERE event_type = 'conversion' AND event_name = 'purchase'), 0)::double precision AS total_revenue
                 FROM tracking_events
                 WHERE ${whereSql}`,
                baseParams,
            ),
            this.eventsRepo.query(
                `SELECT
                    TO_CHAR(DATE_TRUNC('day', created_at), 'YYYY-MM-DD') AS day,
                    COUNT(*) FILTER (WHERE event_type = 'pageview')::int AS page_views,
                    COUNT(*) FILTER (WHERE event_type = 'button_click')::int AS button_clicks,
                    COUNT(*) FILTER (WHERE event_type = 'conversion' AND event_name = 'signup')::int AS signups,
                    COUNT(*) FILTER (WHERE event_type = 'conversion' AND event_name = 'purchase')::int AS purchases
                 FROM tracking_events
                 WHERE ${whereSql}
                 GROUP BY 1
                 ORDER BY 1 ASC`,
                baseParams,
            ),
            this.eventsRepo.query(
                `SELECT
                    COALESCE(page_path, '/') AS page_path,
                    COUNT(*) FILTER (WHERE event_type = 'pageview')::int AS views,
                    COUNT(DISTINCT visitor_id)::int AS unique_visitors,
                    COUNT(*) FILTER (WHERE event_type = 'button_click')::int AS button_clicks,
                    COUNT(*) FILTER (WHERE event_type = 'conversion' AND event_name = 'signup')::int AS signups
                 FROM tracking_events
                 WHERE ${whereSql} AND page_path IS NOT NULL
                 GROUP BY 1
                 ORDER BY views DESC, button_clicks DESC
                 LIMIT 30`,
                baseParams,
            ),
            this.eventsRepo.query(
                `WITH cta_users AS (
                    SELECT LOWER(COALESCE(acquisition_content, '')) AS cta_key, COUNT(*)::int AS user_signups
                    FROM users
                    WHERE "createdAt" >= $1 AND acquisition_content IS NOT NULL
                    GROUP BY 1
                )
                SELECT
                    COALESCE(te.cta_tag, te.element_id, te.element_label, 'unnamed_cta') AS cta_tag,
                    MAX(te.element_label) AS element_label,
                    MAX(te.intent) AS intent,
                    MAX(te.page_path) AS top_page,
                    COUNT(*)::int AS clicks,
                    COUNT(DISTINCT te.visitor_id)::int AS unique_visitors,
                    COALESCE(MAX(cu.user_signups), 0)::int AS attributed_signups
                FROM tracking_events te
                LEFT JOIN cta_users cu ON cu.cta_key = LOWER(COALESCE(te.cta_tag, te.element_id, ''))
                WHERE ${whereSql} AND te.event_type = 'button_click'
                GROUP BY 1
                ORDER BY clicks DESC
                LIMIT 40`,
                baseParams,
            ),
            this.eventsRepo.query(
                `SELECT
                    COALESCE(intent, cta_tag, 'general') AS intent,
                    COUNT(*)::int AS clicks,
                    COUNT(DISTINCT visitor_id)::int AS unique_visitors
                 FROM tracking_events
                 WHERE ${whereSql} AND event_type = 'button_click' AND (intent IS NOT NULL OR cta_tag IS NOT NULL)
                 GROUP BY 1
                 ORDER BY clicks DESC
                 LIMIT 20`,
                baseParams,
            ),
            this.eventsRepo.query(
                `SELECT
                    COALESCE(NULLIF(utm_source, ''), 'direct') AS source,
                    COALESCE(NULLIF(utm_medium, ''), '-') AS medium,
                    COUNT(*) FILTER (WHERE event_type = 'pageview')::int AS page_views,
                    COUNT(DISTINCT visitor_id)::int AS unique_visitors,
                    COUNT(*) FILTER (WHERE event_type = 'button_click')::int AS button_clicks,
                    COUNT(*) FILTER (WHERE event_type = 'conversion' AND event_name = 'signup')::int AS signups,
                    COUNT(*) FILTER (WHERE event_type = 'conversion' AND event_name = 'purchase')::int AS purchases
                 FROM tracking_events
                 WHERE ${whereSql}
                 GROUP BY 1, 2
                 ORDER BY unique_visitors DESC, page_views DESC
                 LIMIT 30`,
                baseParams,
            ),
            this.eventsRepo.query(
                `SELECT
                    utm_campaign AS campaign,
                    COALESCE(NULLIF(utm_source, ''), 'direct') AS source,
                    COALESCE(NULLIF(utm_medium, ''), '-') AS medium,
                    COUNT(*) FILTER (WHERE event_type = 'pageview')::int AS page_views,
                    COUNT(DISTINCT visitor_id)::int AS unique_visitors,
                    COUNT(*) FILTER (WHERE event_type = 'button_click')::int AS button_clicks,
                    COUNT(*) FILTER (WHERE event_type = 'conversion' AND event_name = 'signup')::int AS signups
                 FROM tracking_events
                 WHERE ${whereSql} AND utm_campaign IS NOT NULL AND utm_campaign <> ''
                 GROUP BY 1, 2, 3
                 ORDER BY unique_visitors DESC
                 LIMIT 30`,
                baseParams,
            ),
            this.eventsRepo.query(
                `SELECT
                    COALESCE(NULLIF(device_type, ''), 'unknown') AS device_type,
                    COUNT(DISTINCT visitor_id)::int AS visitors,
                    COUNT(*)::int AS events
                 FROM tracking_events
                 WHERE ${whereSql}
                 GROUP BY 1
                 ORDER BY visitors DESC`,
                baseParams,
            ),
            this.emailLogsRepo.query(
                `SELECT
                    COUNT(*)::int AS emails_sent,
                    COUNT(*) FILTER (WHERE opened_at IS NOT NULL)::int AS emails_opened,
                    COALESCE(SUM(open_count), 0)::int AS total_opens,
                    COUNT(*) FILTER (WHERE first_clicked_at IS NOT NULL)::int AS emails_clicked,
                    COALESCE(SUM(click_count), 0)::int AS total_clicks
                 FROM email_tracking_logs
                 WHERE sent_at >= $1`,
                [since],
            ),
            this.emailLogsRepo.query(
                `SELECT
                    template,
                    utm_medium,
                    COUNT(*)::int AS sent,
                    COUNT(*) FILTER (WHERE opened_at IS NOT NULL)::int AS unique_opens,
                    COALESCE(SUM(open_count), 0)::int AS total_opens,
                    COUNT(*) FILTER (WHERE first_clicked_at IS NOT NULL)::int AS unique_clicks,
                    COALESCE(SUM(click_count), 0)::int AS total_clicks
                 FROM email_tracking_logs
                 WHERE sent_at >= $1
                 GROUP BY 1, 2
                 ORDER BY sent DESC
                 LIMIT 30`,
                [since],
            ),
            this.emailLogsRepo.query(
                `SELECT
                    broadcast_id,
                    MAX(subject) AS subject,
                    COUNT(*)::int AS sent,
                    COUNT(*) FILTER (WHERE opened_at IS NOT NULL)::int AS unique_opens,
                    COUNT(*) FILTER (WHERE first_clicked_at IS NOT NULL)::int AS unique_clicks
                 FROM email_tracking_logs
                 WHERE sent_at >= $1 AND broadcast_id IS NOT NULL
                 GROUP BY 1
                 ORDER BY sent DESC
                 LIMIT 20`,
                [since],
            ),
            this.emailLogsRepo.query(
                `SELECT
                    TO_CHAR(DATE_TRUNC('day', sent_at), 'YYYY-MM-DD') AS day,
                    COUNT(*)::int AS sent,
                    COUNT(*) FILTER (WHERE opened_at IS NOT NULL)::int AS opened,
                    COUNT(*) FILTER (WHERE first_clicked_at IS NOT NULL)::int AS clicked
                 FROM email_tracking_logs
                 WHERE sent_at >= $1
                 GROUP BY 1
                 ORDER BY 1 ASC`,
                [since],
            ),
            this.usersRepo.query(
                `SELECT COUNT(*)::int AS registered_users FROM users WHERE "createdAt" >= $1`,
                [since],
            ),
            this.eventsRepo.query(
                `SELECT
                    id, event_name, event_type, visitor_id, user_id, page_path, element_label,
                    cta_tag, intent, utm_source, utm_medium, utm_campaign, utm_content,
                    device_type, locale, revenue, currency, created_at
                 FROM tracking_events
                 WHERE ${whereSql}
                 ORDER BY created_at DESC
                 LIMIT 40`,
                baseParams,
            ),
        ]);

        const s = summaryRows[0] || {};
        const es = emailSummaryRows[0] || {};
        const registeredUsers = Number(userSignupsSummaryRows[0]?.registered_users || 0);
        const totalSignups = Math.max(Number(s.tracked_signups || 0), registeredUsers);
        const uniqueVisitors = Number(s.unique_visitors || 0);
        const emailsSent = Number(es.emails_sent || 0);
        const emailsOpened = Number(es.emails_opened || 0);
        const emailsClicked = Number(es.emails_clicked || 0);

        // Merge email timeline into daily timeline
        const dayMap = new Map<string, any>();
        for (const r of timelineRows) {
            dayMap.set(r.day, {
                date: r.day,
                pageViews: Number(r.page_views || 0),
                buttonClicks: Number(r.button_clicks || 0),
                signups: Number(r.signups || 0),
                purchases: Number(r.purchases || 0),
                emailsSent: 0,
                emailsOpened: 0,
                emailsClicked: 0,
            });
        }
        for (const er of emailTimelineRows) {
            const existing = dayMap.get(er.day) || {
                date: er.day,
                pageViews: 0,
                buttonClicks: 0,
                signups: 0,
                purchases: 0,
                emailsSent: 0,
                emailsOpened: 0,
                emailsClicked: 0,
            };
            existing.emailsSent = Number(er.sent || 0);
            existing.emailsOpened = Number(er.opened || 0);
            existing.emailsClicked = Number(er.clicked || 0);
            dayMap.set(er.day, existing);
        }
        const timeline = Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date));

        return {
            windowDays: days,
            summary: {
                totalPageViews: Number(s.total_page_views || 0),
                uniqueVisitors,
                totalButtonClicks: Number(s.total_button_clicks || 0),
                registeredUsers,
                trackedSignups: Number(s.tracked_signups || 0),
                checkoutStarted: Number(s.checkout_started || 0),
                trialsStarted: Number(s.trials_started || 0),
                totalPurchases: Number(s.total_purchases || 0),
                totalRevenue: Number(s.total_revenue || 0),
                conversionRate: uniqueVisitors > 0 ? Number(((totalSignups / uniqueVisitors) * 100).toFixed(2)) : 0,
                emailsSent,
                emailsOpened,
                totalOpens: Number(es.total_opens || 0),
                emailOpenRate: emailsSent > 0 ? Number(((emailsOpened / emailsSent) * 100).toFixed(2)) : 0,
                emailsClicked,
                totalEmailClicks: Number(es.total_clicks || 0),
                emailCtr: emailsSent > 0 ? Number(((emailsClicked / emailsSent) * 100).toFixed(2)) : 0,
            },
            funnel: [
                { step: 'Visitantes Únicos', count: uniqueVisitors },
                { step: 'Cliques em CTAs', count: Number(s.total_button_clicks || 0) },
                { step: 'Cadastros', count: totalSignups },
                { step: 'Checkout Iniciado', count: Number(s.checkout_started || 0) },
                { step: 'Compras / Assinaturas', count: Number(s.total_purchases || 0) },
            ],
            timeline,
            topPages: topPagesRows.map((r: any) => ({
                pagePath: r.page_path,
                views: Number(r.views || 0),
                uniqueVisitors: Number(r.unique_visitors || 0),
                buttonClicks: Number(r.button_clicks || 0),
                signups: Number(r.signups || 0),
            })),
            topButtons: topButtonsRows.map((r: any) => ({
                ctaTag: r.cta_tag,
                elementLabel: r.element_label || r.cta_tag,
                intent: r.intent || null,
                topPage: r.top_page || '/',
                clicks: Number(r.clicks || 0),
                uniqueVisitors: Number(r.unique_visitors || 0),
                attributedSignups: Number(r.attributed_signups || 0),
            })),
            topIntents: topIntentsRows.map((r: any) => ({
                intent: r.intent,
                clicks: Number(r.clicks || 0),
                uniqueVisitors: Number(r.unique_visitors || 0),
            })),
            utmSources: utmSourcesRows.map((r: any) => ({
                source: r.source,
                medium: r.medium,
                pageViews: Number(r.page_views || 0),
                uniqueVisitors: Number(r.unique_visitors || 0),
                buttonClicks: Number(r.button_clicks || 0),
                signups: Number(r.signups || 0),
                purchases: Number(r.purchases || 0),
            })),
            utmCampaigns: utmCampaignsRows.map((r: any) => ({
                campaign: r.campaign,
                source: r.source,
                medium: r.medium,
                pageViews: Number(r.page_views || 0),
                uniqueVisitors: Number(r.unique_visitors || 0),
                buttonClicks: Number(r.button_clicks || 0),
                signups: Number(r.signups || 0),
            })),
            deviceBreakdown: deviceRows.map((r: any) => ({
                deviceType: r.device_type,
                visitors: Number(r.visitors || 0),
                events: Number(r.events || 0),
            })),
            emailStats: {
                byTemplate: emailByTemplateRows.map((r: any) => {
                    const sent = Number(r.sent || 0);
                    const opens = Number(r.unique_opens || 0);
                    const clicks = Number(r.unique_clicks || 0);
                    return {
                        template: r.template,
                        utmMedium: r.utm_medium,
                        sent,
                        uniqueOpens: opens,
                        totalOpens: Number(r.total_opens || 0),
                        openRate: sent > 0 ? Number(((opens / sent) * 100).toFixed(2)) : 0,
                        uniqueClicks: clicks,
                        totalClicks: Number(r.total_clicks || 0),
                        ctr: sent > 0 ? Number(((clicks / sent) * 100).toFixed(2)) : 0,
                    };
                }),
                byBroadcast: emailByBroadcastRows.map((r: any) => {
                    const sent = Number(r.sent || 0);
                    const opens = Number(r.unique_opens || 0);
                    const clicks = Number(r.unique_clicks || 0);
                    return {
                        broadcastId: r.broadcast_id,
                        subject: r.subject || 'Broadcast',
                        sent,
                        uniqueOpens: opens,
                        openRate: sent > 0 ? Number(((opens / sent) * 100).toFixed(2)) : 0,
                        uniqueClicks: clicks,
                        ctr: sent > 0 ? Number(((clicks / sent) * 100).toFixed(2)) : 0,
                    };
                }),
            },
            recentEvents: recentEventsRows,
        };
    }

    async getUserSourcesAnalytics(filters?: { days?: number; source?: string; search?: string }) {
        const { days, since } = this.resolveDateWindow(filters?.days);
        const sourceFilter = filters?.source?.trim().toLowerCase() || null;
        const searchFilter = filters?.search?.trim().toLowerCase() || null;

        const userClauses = ['u."createdAt" >= $1'];
        const params: any[] = [since];
        if (sourceFilter) {
            if (sourceFilter === 'direct') {
                userClauses.push('(u.acquisition_source IS NULL OR LOWER(u.acquisition_source) = \'direct\')');
            } else {
                params.push(sourceFilter);
                userClauses.push(`LOWER(COALESCE(u.acquisition_source, 'direct')) = $${params.length}`);
            }
        }
        if (searchFilter) {
            params.push(`%${searchFilter}%`);
            userClauses.push(
                `(LOWER(COALESCE(u.email, '')) LIKE $${params.length} OR LOWER(COALESCE(u.name, '')) LIKE $${params.length} OR LOWER(COALESCE(u.acquisition_campaign, '')) LIKE $${params.length})`,
            );
        }
        const whereSql = userClauses.join(' AND ');

        const [bySourceRows, byCampaignRows, byCtaRows, byLandingRows, byReferrerRows, usersSampleRows] =
            await Promise.all([
                this.usersRepo.query(
                    `SELECT
                        COALESCE(NULLIF(u.acquisition_source, ''), NULLIF(u.attribution_data->>'utm_source', ''), 'direct') AS source,
                        COUNT(DISTINCT u.id)::int AS users_count,
                        COUNT(DISTINCT CASE WHEN s.status IN ('ACTIVE', 'APPROVED') THEN u.id END)::int AS paid_users_count
                     FROM users u
                     LEFT JOIN subscriptions s ON s."userId" = u.id
                     WHERE ${whereSql}
                     GROUP BY 1
                     ORDER BY users_count DESC
                     LIMIT 30`,
                    params,
                ),
                this.usersRepo.query(
                    `SELECT
                        COALESCE(NULLIF(u.acquisition_campaign, ''), NULLIF(u.attribution_data->>'utm_campaign', ''), 'sem_campanha') AS campaign,
                        COALESCE(NULLIF(u.acquisition_source, ''), 'direct') AS source,
                        COALESCE(NULLIF(u.acquisition_medium, ''), '-') AS medium,
                        COUNT(DISTINCT u.id)::int AS users_count,
                        COUNT(DISTINCT CASE WHEN s.status IN ('ACTIVE', 'APPROVED') THEN u.id END)::int AS paid_users_count
                     FROM users u
                     LEFT JOIN subscriptions s ON s."userId" = u.id
                     WHERE ${whereSql}
                     GROUP BY 1, 2, 3
                     ORDER BY users_count DESC
                     LIMIT 30`,
                    params,
                ),
                this.usersRepo.query(
                    `SELECT
                        COALESCE(NULLIF(u.acquisition_content, ''), NULLIF(u.attribution_data->>'ctaTag', ''), NULLIF(u.attribution_data->>'utm_content', ''), 'sem_tag') AS cta_tag,
                        COALESCE(NULLIF(u.acquisition_term, ''), NULLIF(u.attribution_data->>'intent', ''), '-') AS intent,
                        COUNT(*)::int AS users_count
                     FROM users u
                     WHERE ${whereSql}
                     GROUP BY 1, 2
                     ORDER BY users_count DESC
                     LIMIT 30`,
                    params,
                ),
                this.usersRepo.query(
                    `SELECT
                        COALESCE(NULLIF(u.landing_path, ''), NULLIF(u.attribution_data->>'landingPath', ''), '/') AS landing_path,
                        COUNT(*)::int AS users_count
                     FROM users u
                     WHERE ${whereSql}
                     GROUP BY 1
                     ORDER BY users_count DESC
                     LIMIT 25`,
                    params,
                ),
                this.usersRepo.query(
                    `SELECT
                        COALESCE(NULLIF(u.referrer, ''), NULLIF(u.attribution_data->>'referrer', ''), 'Acesso Direto') AS referrer,
                        COUNT(*)::int AS users_count
                     FROM users u
                     WHERE ${whereSql}
                     GROUP BY 1
                     ORDER BY users_count DESC
                     LIMIT 25`,
                    params,
                ),
                this.usersRepo.query(
                    `SELECT
                        u.id,
                        u.email,
                        u.name,
                        u.username,
                        COALESCE(NULLIF(u.acquisition_source, ''), NULLIF(u.attribution_data->>'utm_source', ''), 'direct') AS acquisition_source,
                        COALESCE(u.acquisition_medium, u.attribution_data->>'utm_medium') AS acquisition_medium,
                        COALESCE(u.acquisition_campaign, u.attribution_data->>'utm_campaign') AS acquisition_campaign,
                        COALESCE(u.acquisition_content, u.attribution_data->>'ctaTag', u.attribution_data->>'utm_content') AS acquisition_content,
                        COALESCE(u.acquisition_term, u.attribution_data->>'intent', u.attribution_data->>'utm_term') AS acquisition_term,
                        COALESCE(u.landing_path, u.attribution_data->>'landingPath') AS landing_path,
                        COALESCE(u.referrer, u.attribution_data->>'referrer') AS referrer,
                        u.preferred_locale,
                        u."createdAt" AS created_at,
                        MAX(s.status::text) AS subscription_status
                     FROM users u
                     LEFT JOIN subscriptions s ON s."userId" = u.id
                     WHERE ${whereSql}
                     GROUP BY u.id
                     ORDER BY u."createdAt" DESC
                     LIMIT 100`,
                    params,
                ),
            ]);

        return {
            windowDays: days,
            bySource: bySourceRows.map((r: any) => {
                const count = Number(r.users_count || 0);
                const paid = Number(r.paid_users_count || 0);
                return {
                    source: r.source,
                    usersCount: count,
                    paidUsersCount: paid,
                    conversionRate: count > 0 ? Number(((paid / count) * 100).toFixed(2)) : 0,
                };
            }),
            byCampaign: byCampaignRows.map((r: any) => ({
                campaign: r.campaign,
                source: r.source,
                medium: r.medium,
                usersCount: Number(r.users_count || 0),
                paidUsersCount: Number(r.paid_users_count || 0),
            })),
            byCtaTag: byCtaRows.map((r: any) => ({
                ctaTag: r.cta_tag,
                intent: r.intent,
                usersCount: Number(r.users_count || 0),
            })),
            byLandingPath: byLandingRows.map((r: any) => ({
                landingPath: r.landing_path,
                usersCount: Number(r.users_count || 0),
            })),
            byReferrer: byReferrerRows.map((r: any) => ({
                referrer: r.referrer,
                usersCount: Number(r.users_count || 0),
            })),
            users: usersSampleRows,
        };
    }
}
