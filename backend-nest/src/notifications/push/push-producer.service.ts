import * as crypto from 'crypto';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { PushSubscriptionEntity } from './push-subscription.entity';
import { PushDeliveryLogEntity, PushModerationMode } from './push-delivery-log.entity';
import { UserEntity } from '../../users/user.entity';
import { TechnicalJournal } from '../../dashboard/technical-journal.entity';
import { AccountEntity } from '../../account/account.entity';
import { RedisSecurityService } from '../../common/security/redis-security.service';
import { PushCopyAiService } from './push-copy-ai.service';

export interface WebPushDispatchPayload {
    userId: string;
    title: string;
    body: string;
    url: string;
    tag: string;
    icon?: string;
    clickToken?: string;
    moderationMode?: PushModerationMode;
}

export interface SanitizedPushResult {
    allowed: boolean;
    title: string;
    body: string;
    reason?: string;
}

export interface PushModerationDecision {
    mode: PushModerationMode;
    dailyCap: number;
    cooldownMs: number;
    ignoredStreak: number;
    lastSentAt: number | null;
}

const SENSITIVE_PUSH_BLOCK_REGEX =
    /\b(otp|2fa|two[\s-]?factor|c[oó]digo de verifica[cç][aã]o|redefini[cç][aã]o de senha|password reset|recuperar senha|security alert|login attempt|tentativa de login|recovery code|token de sess[aã]o)\b/i;

export function sanitizeSafePushPayload(
    rawTitle: string,
    rawBody: string,
    category = '',
): SanitizedPushResult {
    const titleStr = String(rawTitle || '').trim();
    const bodyStr = String(rawBody || '').trim();
    const combined = `${category} ${titleStr} ${bodyStr}`;

    if (SENSITIVE_PUSH_BLOCK_REGEX.test(combined)) {
        return {
            allowed: false,
            title: '',
            body: '',
            reason: 'SENSITIVE_SECURITY_CONTENT',
        };
    }

    const redact = (txt: string): string =>
        txt
            .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[privado]')
            .replace(/\+\d{1,3}[\s.-]?(?:\(?\d{1,4}\)?[\s.-]?){2,4}\d{2,4}\b/g, '[privado]')
            .replace(/\b0?\d{2}[\s.-]\d{3}[\s.-]\d{4}\b/g, '[privado]')
            .replace(/(?:saldo|balance|equity|capit[ao]l|margem|margin|ticket|login\s*mt5|conta\s*#?|account\s*#?)\s*[:#]?\s*[-\d.,]+/gi, '[protegido]')
            .replace(/\b(servidor\s+windows|windows\s+server|worker\s+windows|terminal64\.exe)\b/gi, 'sistema')
            .replace(/(?:USD|EUR|MZN|BRL|GBP|R\$|\$|€|£)\s?[+-]?\d[\d.,\s]*/gi, '[valor]')
            .replace(/\b[+-]?\d[\d.,]*\s?(?:USD|EUR|MZN|BRL|MT)\b/gi, '[valor]')
            .replace(/\b\d{6,}\b/g, '[***]')
            .replace(/\s{2,}/g, ' ')
            .trim();

    const safeTitle = redact(titleStr).slice(0, 80);
    const safeBody = redact(bodyStr).slice(0, 180);

    if (!safeTitle || !safeBody) {
        return { allowed: false, title: '', body: '', reason: 'EMPTY_AFTER_SANITIZE' };
    }

    return {
        allowed: true,
        title: safeTitle,
        body: safeBody,
    };
}

const CATEGORY_COOLDOWN_MS: Record<string, number> = {
    'journal-reminder': 4 * 3600_000,
    'community-room': 15 * 60_000,
    'community-post': 30 * 60_000,
    'community-comment': 10 * 60_000,
    'community-dm': 5 * 60_000,
    'broker-connect': 48 * 3600_000,
    'curiosity-insight': 24 * 3600_000,
    'stale-import': 72 * 3600_000,
    'torex-ai-reply': 60_000,
    'idle-account-warning': 24 * 3600_000,
    broadcast: 2 * 3600_000,
    welcome: 365 * 86_400_000,
};

const MAX_DAILY_PUSHES_PER_USER = 4;
const GLOBAL_PUSH_COOLDOWN_MS = 20 * 60_000;
const COMMUNITY_ONLINE_SAMPLE_LIMIT = 8;

@Injectable()
export class PushProducerService {
    private readonly logger = new Logger(PushProducerService.name);

    constructor(
        @InjectQueue('push-queue')
        private readonly pushQueue: Queue,
        @InjectRepository(PushSubscriptionEntity)
        private readonly subRepo: Repository<PushSubscriptionEntity>,
        @InjectRepository(UserEntity)
        private readonly userRepo: Repository<UserEntity>,
        @InjectRepository(TechnicalJournal)
        private readonly journalRepo: Repository<TechnicalJournal>,
        private readonly redisSecurity: RedisSecurityService,
        private readonly copyAi: PushCopyAiService,
        @Optional()
        @InjectRepository(AccountEntity)
        private readonly accountRepo?: Repository<AccountEntity>,
        @Optional()
        @InjectRepository(PushDeliveryLogEntity)
        private readonly deliveryLogRepo?: Repository<PushDeliveryLogEntity>,
    ) {}

    private getTodayKey(): string {
        return new Date().toISOString().slice(0, 10);
    }

    async evaluateUserPushModeration(userId: string): Promise<PushModerationDecision> {
        if (!userId || !this.deliveryLogRepo) {
            return {
                mode: 'ENGAGED',
                dailyCap: MAX_DAILY_PUSHES_PER_USER,
                cooldownMs: GLOBAL_PUSH_COOLDOWN_MS,
                ignoredStreak: 0,
                lastSentAt: null,
            };
        }

        const recent = await this.deliveryLogRepo
            .find({
                where: { userId },
                order: { sentAt: 'DESC' },
                take: 12,
            })
            .catch(() => [] as PushDeliveryLogEntity[]);

        const logs = recent.filter((r) => r.category !== 'welcome');
        let ignoredStreak = 0;
        for (const row of logs) {
            if (row.status === 'CLICKED') break;
            ignoredStreak++;
        }

        const lastSentAt = logs[0]?.sentAt ? new Date(logs[0].sentAt).getTime() : null;

        if (ignoredStreak >= 6) {
            return {
                mode: 'FATIGUE_PAUSED',
                dailyCap: 1,
                cooldownMs: 72 * 3600_000,
                ignoredStreak,
                lastSentAt,
            };
        }

        if (ignoredStreak >= 3) {
            return {
                mode: 'MODERATED',
                dailyCap: 1,
                cooldownMs: 24 * 3600_000,
                ignoredStreak,
                lastSentAt,
            };
        }

        return {
            mode: 'ENGAGED',
            dailyCap: MAX_DAILY_PUSHES_PER_USER,
            cooldownMs: GLOBAL_PUSH_COOLDOWN_MS,
            ignoredStreak,
            lastSentAt,
        };
    }

    private formatRoomLabel(room: string, isEn: boolean): string {
        const map: Record<string, { pt: string; en: string }> = {
            global: { pt: 'Geral Traders', en: 'General Floor' },
            'forex-gold': { pt: 'Forex & XAUUSD', en: 'FX & XAUUSD' },
            'indices-synthetics': { pt: 'Índices & Sintéticos', en: 'Indices & Synthetics' },
            psychology: { pt: 'Gestão & Psicologia', en: 'Risk & Psychology' },
        };
        const hit = map[room];
        if (!hit) return room;
        return isEn ? hit.en : hit.pt;
    }

    private shuffleIds(ids: string[]): string[] {
        const arr = [...ids];
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    async reservePushQuota(
        userId: string,
        category: string,
        options?: { bypassDailyCap?: boolean; bypassGlobalCooldown?: boolean },
    ): Promise<boolean> {
        if (!userId) return false;

        const activeSubs = await this.subRepo.count({ where: { userId, isActive: true } });
        if (activeSubs === 0) return false;

        const moderation = await this.evaluateUserPushModeration(userId);

        if (!options?.bypassGlobalCooldown) {
            const globalCd = await this.redisSecurity.getValue(`push:cd:any:${userId}`);
            if (globalCd) return false;
            if (moderation.lastSentAt && Date.now() - moderation.lastSentAt < moderation.cooldownMs) {
                return false;
            }
        }

        const catCooldownMs = CATEGORY_COOLDOWN_MS[category] ?? 30 * 60_000;
        const catKey = `push:cd:cat:${userId}:${category}`;
        const existingCatCd = await this.redisSecurity.getValue(catKey);
        if (existingCatCd) return false;

        if (!options?.bypassDailyCap) {
            const capKey = `push:cap:${userId}:${this.getTodayKey()}`;
            const rawCap = Number((await this.redisSecurity.getValue(capKey)) || '0');
            if (rawCap >= moderation.dailyCap) {
                return false;
            }
            const { count } = await this.redisSecurity.incrementWithWindow(capKey, 86_400_000);
            if (count > moderation.dailyCap) {
                return false;
            }
        }

        await this.redisSecurity.setValue(catKey, '1', catCooldownMs);
        if (!options?.bypassGlobalCooldown) {
            await this.redisSecurity.setValue(`push:cd:any:${userId}`, '1', moderation.cooldownMs);
        }
        return true;
    }

    async enqueueRawPush(
        payload: WebPushDispatchPayload,
        options?: { jobId?: string; delayMs?: number },
    ): Promise<void> {
        const sanitized = sanitizeSafePushPayload(payload.title, payload.body, payload.tag);
        if (!sanitized.allowed) {
            this.logger.debug(
                `Blocked Web Push for user=${payload.userId} tag=${payload.tag} reason=${sanitized.reason}`,
            );
            return;
        }

        const moderation =
            payload.moderationMode ||
            (await this.evaluateUserPushModeration(payload.userId).then((m) => m.mode));
        const clickToken = payload.clickToken || crypto.randomUUID();

        await this.pushQueue.add(
            'send-web-push',
            {
                ...payload,
                title: sanitized.title,
                body: sanitized.body,
                clickToken,
                moderationMode: moderation,
            },
            {
                jobId: options?.jobId,
                delay: options?.delayMs,
                attempts: 3,
                backoff: { type: 'exponential', delay: 5000 },
                removeOnComplete: 200,
                removeOnFail: 200,
            },
        );
    }

    async enqueueWelcomePushOnce(userId: string, locale?: string): Promise<void> {
        if (!userId) return;
        const welcomeLock = await this.redisSecurity.setIfAbsent(
            `push:welcome:sent:${userId}`,
            '1',
            365 * 86_400_000,
        );
        if (!welcomeLock) return;

        const isEn = locale === 'en';
        await this.enqueueRawPush(
            {
                userId,
                title: isEn ? 'Smart notifications enabled on Torex' : 'Notificações ativas no Torex Journal',
                body: isEn
                    ? 'You will receive alerts for synced trades, 2-min journal prompts, edge insights, and community activity.'
                    : 'Irá receber alertas inteligentes sobre novas operações, lembretes rápidos do diário, insights e comunidade.',
                url: '/dashboard?from=push_welcome',
                tag: 'welcome',
            },
            { jobId: `push-welcome:${userId}` },
        );
    }

    @OnEvent('trades.imported')
    async handleTradesImported(event: {
        userId: string;
        accountId?: string;
        count?: number;
        symbols?: string[];
        netPnl?: number;
        trades?: Array<{ symbol?: string; profit?: number }>;
    }) {
        const userId = String(event?.userId || '').trim();
        if (!userId) return;

        try {
            const eventTrades = Array.isArray(event.trades) ? event.trades : [];
            const batchCount =
                eventTrades.length > 0 ? eventTrades.length : Math.max(1, Number(event.count) || 1);
            const batchSymbol =
                (Array.isArray(event.symbols) && event.symbols[0]) ||
                eventTrades.find((t) => Boolean(t?.symbol))?.symbol ||
                null;
            const batchPnl =
                typeof event.netPnl === 'number' && Number.isFinite(event.netPnl)
                    ? event.netPnl
                    : eventTrades.reduce((sum, t) => sum + (Number(t?.profit) || 0), 0);

            const accKey = `push:import:acc:${userId}`;
            const rawPrev = await this.redisSecurity.getValue(accKey);
            let acc: { count: number; topSymbol: string | null; netPnl: number } = {
                count: 0,
                topSymbol: null,
                netPnl: 0,
            };
            if (rawPrev) {
                try {
                    acc = JSON.parse(rawPrev);
                } catch {
                    acc = { count: 0, topSymbol: null, netPnl: 0 };
                }
            }
            acc.count += batchCount;
            if (!acc.topSymbol && batchSymbol) {
                acc.topSymbol = String(batchSymbol).slice(0, 24);
            }
            if (Number.isFinite(batchPnl)) {
                acc.netPnl += batchPnl;
            }
            await this.redisSecurity.setValue(accKey, JSON.stringify(acc), 180_000);

            const bucket = Math.floor(Date.now() / 45_000);
            await this.pushQueue.add(
                'post-import-journal',
                { userId },
                {
                    jobId: `post-import-journal:${userId}:${bucket}`,
                    delay: 45_000,
                    attempts: 2,
                    removeOnComplete: 200,
                    removeOnFail: 200,
                },
            );
        } catch (err: any) {
            this.logger.warn(`Failed to schedule post-import journal push for ${userId}: ${err?.message || err}`);
        }
    }

    async processPostImportJournalReminder(userId: string): Promise<boolean> {
        const rawAcc = await this.redisSecurity.consumeOnce(`push:import:acc:${userId}`);
        let tradesCount = 1;
        let topSymbol: string | null = null;
        let netPnl: number | null = null;
        if (rawAcc) {
            try {
                const parsed = JSON.parse(rawAcc);
                tradesCount = Math.max(1, Number(parsed?.count) || 1);
                topSymbol = parsed?.topSymbol || null;
                netPnl = typeof parsed?.netPnl === 'number' ? parsed.netPnl : null;
            } catch {
                // fallback defaults
            }
        }

        const todayDateStr = new Date().toISOString().slice(0, 10);
        if (this.accountRepo) {
            const accounts = await this.accountRepo.find({
                where: { userId },
                select: ['id'],
            });
            const accountIds = accounts.map((a) => a.id).filter(Boolean);
            if (accountIds.length > 0) {
                const alreadyJournaledToday = await this.journalRepo.count({
                    where: {
                        accountId: In(accountIds),
                        date: todayDateStr,
                    },
                });
                if (alreadyJournaledToday > 0) {
                    return false;
                }
            }
        }

        const allowed = await this.reservePushQuota(userId, 'journal-reminder');
        if (!allowed) return false;

        const user = await this.userRepo.findOne({
            where: { id: userId },
            select: ['id', 'username', 'preferredLocale'],
        });
        const copy = await this.copyAi.generatePostImportJournalCopy({
            locale: user?.preferredLocale,
            tradesCount,
            topSymbol,
            netPnl,
            username: user?.username,
        });

        await this.enqueueRawPush({
            userId,
            title: copy.title,
            body: copy.body,
            url: '/journal?from=push_import',
            tag: 'journal-reminder',
        });
        return true;
    }

    @OnEvent('network.room.message')
    async handleNetworkRoomMessage(event: {
        authorId: string;
        authorUsername: string;
        room: string;
        excerpt?: string;
        onlineUserIds?: string[];
    }) {
        const candidates = Array.isArray(event?.onlineUserIds)
            ? event.onlineUserIds.filter((id) => id && id !== event.authorId)
            : [];
        if (candidates.length === 0) return;

        const room = String(event.room || 'global').slice(0, 50);
        const roomThrottleOk = await this.redisSecurity.setIfAbsent(
            `push:room:broadcast:${room}`,
            '1',
            15 * 60_000,
        );
        if (!roomThrottleOk) return;

        const activeSubRows = await this.subRepo.find({
            where: { userId: In(candidates), isActive: true },
            select: ['userId'],
        });
        const uniqueSubUserIds = Array.from(new Set(activeSubRows.map((r) => r.userId)));
        if (uniqueSubUserIds.length === 0) return;

        const picked = this.shuffleIds(uniqueSubUserIds).slice(0, COMMUNITY_ONLINE_SAMPLE_LIMIT);
        const users = await this.userRepo.find({
            where: { id: In(picked) },
            select: ['id', 'username', 'preferredLocale'],
        });
        const userMap = new Map(users.map((u) => [u.id, u]));

        for (const recipientId of picked) {
            const allowed = await this.reservePushQuota(recipientId, 'community-room');
            if (!allowed) continue;
            const u = userMap.get(recipientId);
            const isEn = u?.preferredLocale === 'en';
            const handle = u?.username || 'trader';
            const authorHandle = event.authorUsername || 'trader';
            const roomLabel = this.formatRoomLabel(room, isEn);

            await this.enqueueRawPush({
                userId: recipientId,
                title: isEn ? `Room #${roomLabel} active now` : `Sala #${roomLabel} em movimento`,
                body: isEn
                    ? `Hi @${handle}, @${authorHandle} started a discussion in #${roomLabel} — join and engage with other traders!`
                    : `Olá @${handle}, uma nova conversa foi iniciada na sala #${roomLabel} por @${authorHandle} — entre e engaje com outros traders!`,
                url: `/network?tab=chat&room=${encodeURIComponent(room)}`,
                tag: 'community-room',
            });
        }
    }

    @OnEvent('network.post.created')
    async handleNetworkPostCreated(event: {
        postId: number;
        authorId: string;
        authorUsername: string;
        visibility?: string;
        onlineUserIds?: string[];
    }) {
        if (event?.visibility && event.visibility !== 'public') return;
        const candidates = Array.isArray(event?.onlineUserIds)
            ? event.onlineUserIds.filter((id) => id && id !== event.authorId)
            : [];
        if (candidates.length === 0) return;

        const feedThrottleOk = await this.redisSecurity.setIfAbsent(
            'push:feed:broadcast',
            '1',
            20 * 60_000,
        );
        if (!feedThrottleOk) return;

        const activeSubRows = await this.subRepo.find({
            where: { userId: In(candidates), isActive: true },
            select: ['userId'],
        });
        const uniqueSubUserIds = Array.from(new Set(activeSubRows.map((r) => r.userId)));
        if (uniqueSubUserIds.length === 0) return;

        const picked = this.shuffleIds(uniqueSubUserIds).slice(0, COMMUNITY_ONLINE_SAMPLE_LIMIT);
        const users = await this.userRepo.find({
            where: { id: In(picked) },
            select: ['id', 'username', 'preferredLocale'],
        });
        const userMap = new Map(users.map((u) => [u.id, u]));

        for (const recipientId of picked) {
            const allowed = await this.reservePushQuota(recipientId, 'community-post');
            if (!allowed) continue;
            const u = userMap.get(recipientId);
            const isEn = u?.preferredLocale === 'en';
            const handle = u?.username || 'trader';
            const authorHandle = event.authorUsername || 'trader';

            await this.enqueueRawPush({
                userId: recipientId,
                title: isEn ? 'New community insight live' : 'Nova publicação na comunidade',
                body: isEn
                    ? `Hi @${handle}, @${authorHandle} shared a new trade post on Network — check it out and share your view.`
                    : `Olá @${handle}, @${authorHandle} acabou de publicar na comunidade — entre e troque ideias com outros traders.`,
                url: '/network?tab=feed',
                tag: 'community-post',
            });
        }
    }

    @OnEvent('network.post.commented')
    async handlePostCommented(event: {
        postId: number;
        postAuthorId: string;
        commenterId: string;
        commenterUsername: string;
    }) {
        if (!event?.postAuthorId || event.postAuthorId === event.commenterId) return;
        const allowed = await this.reservePushQuota(event.postAuthorId, 'community-comment');
        if (!allowed) return;

        const author = await this.userRepo.findOne({
            where: { id: event.postAuthorId },
            select: ['id', 'username', 'preferredLocale'],
        });
        const isEn = author?.preferredLocale === 'en';
        const handle = author?.username || 'trader';
        const commenterHandle = event.commenterUsername || 'trader';

        await this.enqueueRawPush({
            userId: event.postAuthorId,
            title: isEn ? 'New reply on your post' : 'Nova interação na sua publicação',
            body: isEn
                ? `Hi @${handle}, @${commenterHandle} replied to your community post.`
                : `Olá @${handle}, @${commenterHandle} comentou na sua publicação da comunidade.`,
            url: '/network?tab=feed',
            tag: 'community-comment',
        });
    }

    @OnEvent('network.dm.sent')
    async handleDirectMessage(event: {
        senderId: string;
        senderUsername: string;
        recipientId: string;
    }) {
        if (!event?.recipientId || event.recipientId === event.senderId) return;
        const allowed = await this.reservePushQuota(event.recipientId, 'community-dm');
        if (!allowed) return;

        const recipient = await this.userRepo.findOne({
            where: { id: event.recipientId },
            select: ['id', 'username', 'preferredLocale'],
        });
        const isEn = recipient?.preferredLocale === 'en';
        const handle = recipient?.username || 'trader';
        const senderHandle = event.senderUsername || 'trader';

        await this.enqueueRawPush({
            userId: event.recipientId,
            title: isEn ? `Direct message from @${senderHandle}` : `Mensagem de @${senderHandle}`,
            body: isEn
                ? `Hi @${handle}, @${senderHandle} sent you a direct message in Torex Network.`
                : `Olá @${handle}, @${senderHandle} enviou-lhe uma mensagem direta na comunidade.`,
            url: '/network?tab=chat',
            tag: 'community-dm',
        });
    }

    async sendRetentionBrokerConnect(user: { id: string; preferredLocale?: string }): Promise<boolean> {
        const allowed = await this.reservePushQuota(user.id, 'broker-connect');
        if (!allowed) return false;
        const copy = this.copyAi.buildBrokerConnectTransparencyCopy(user.preferredLocale);
        await this.enqueueRawPush({
            userId: user.id,
            title: copy.title,
            body: copy.body,
            url: '/add-trades',
            tag: 'broker-connect',
        });
        return true;
    }

    async sendStaleImportReminder(
        user: { id: string; preferredLocale?: string },
        daysSinceLastTrade: number,
    ): Promise<boolean> {
        const allowed = await this.reservePushQuota(user.id, 'stale-import');
        if (!allowed) return false;
        const copy = this.copyAi.buildStaleImportCopy(user.preferredLocale, daysSinceLastTrade);
        await this.enqueueRawPush({
            userId: user.id,
            title: copy.title,
            body: copy.body,
            url: '/add-trades',
            tag: 'stale-import',
        });
        return true;
    }

    async sendCuriosityInsight(params: {
        userId: string;
        locale?: string;
        topSymbol: string;
        topSymbolWinRate: number;
        totalRecentTrades: number;
    }): Promise<boolean> {
        const allowed = await this.reservePushQuota(params.userId, 'curiosity-insight');
        if (!allowed) return false;
        const copy = await this.copyAi.generateCuriosityInsightCopy({
            locale: params.locale,
            topSymbol: params.topSymbol,
            topSymbolWinRate: params.topSymbolWinRate,
            totalRecentTrades: params.totalRecentTrades,
        });
        await this.enqueueRawPush({
            userId: params.userId,
            title: copy.title,
            body: copy.body,
            url: '/reports',
            tag: 'curiosity-insight',
        });
        return true;
    }

    @OnEvent('ai.reply.ready_away')
    async handleAiReplyReadyAway(event: {
        userId: string;
        sessionId: string;
        jobId: string;
        locale?: string;
    }): Promise<boolean> {
        const userId = String(event?.userId || '').trim();
        const sessionId = String(event?.sessionId || '').trim();
        if (!userId || !sessionId) return false;

        const allowed = await this.reservePushQuota(userId, 'torex-ai-reply', {
            bypassGlobalCooldown: true,
        });
        if (!allowed) return false;

        const isEn = event?.locale === 'en';
        await this.enqueueRawPush(
            {
                userId,
                title: isEn
                    ? 'Torex AI finished your analysis'
                    : 'Torex AI concluiu a sua análise',
                body: isEn
                    ? 'Your structured response is ready. Tap to open the conversation.'
                    : 'A resposta estruturada para a sua questão já está pronta. Toque para abrir a conversa.',
                url: `/torex-ai/${encodeURIComponent(sessionId)}?from=push_ai_reply`,
                tag: 'torex-ai-reply',
            },
            { jobId: `push-ai-reply:${event.jobId}` },
        );
        return true;
    }

    async sendIdleAccountShutdownWarning(
        userId: string,
        accountName: string,
        locale?: string,
    ): Promise<boolean> {
        if (!userId) return false;
        const allowed = await this.reservePushQuota(userId, 'idle-account-warning', {
            bypassGlobalCooldown: true,
        });
        if (!allowed) return false;

        const isEn = locale === 'en';
        const cleanName = String(accountName || 'Trading')
            .replace(/\b(?:mt5|login|vps|worker|windows)\b/gi, '')
            .replace(/\d{5,}/g, '')
            .trim() || 'Trading';

        await this.enqueueRawPush({
            userId,
            title: isEn
                ? 'Account sync will pause in 24h'
                : 'Sincronização será pausada em 24h',
            body: isEn
                ? `Your account "${cleanName}" has had zero balance for 7 days. Tap here to keep automatic sync active.`
                : `A conta "${cleanName}" está sem saldo movimentado há 7 dias. Toque para manter a sincronização ativa.`,
            url: '/dashboard?keepAccountActive=1',
            tag: 'idle-account-warning',
        });
        return true;
    }
}
