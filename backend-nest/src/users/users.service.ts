import { Injectable, BadRequestException, Inject, OnModuleInit, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { createHash, randomBytes, randomInt } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { UserEntity } from './user.entity';
import { maskEmailAddress, maskPhoneNumber } from '../common/security/payload-envelope.util';
import { CloudflareR2StorageService } from '../common/security/cloudflare-r2-storage.service';

export interface AuthGuardUserSnapshot {
    id: string;
    isBlocked: boolean;
    twoFactorEnabled: boolean;
    isTwoFactorConfirmed: boolean;
}

const AUTH_GUARD_CACHE_TTL_MS = 120_000; // 2 minutes
const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_ATTRIBUTION_KEYS = [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_term',
    'utm_content',
    'utm_id',
    'fbclid',
    'gclid',
    'ttclid',
    'msclkid',
    'src',
    'sck',
    'xcod',
    'subid',
    'ref',
    'aff',
    'coupon',
    'promo',
    'ctaTag',
    'cta_tag',
    'intent',
    'channel',
    'visitorId',
    'sessionId',
    'referrer',
    'landingPath',
    'firstSeenAt',
    'lastSeenAt',
    'browserLanguage',
    'timezone',
] as const;

const TOUCH_PARAM_KEYS = [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_term',
    'utm_content',
    'utm_id',
    'fbclid',
    'gclid',
    'ttclid',
    'msclkid',
    'src',
    'sck',
    'xcod',
    'subid',
    'ref',
    'aff',
    'coupon',
    'promo',
    'intent',
    'cta_tag',
    'ctaTag',
] as const;

function sanitizeStringField(val: unknown, maxLen = 256): string | undefined {
    if (typeof val !== 'string') return undefined;
    const trimmed = val.trim().slice(0, maxLen);
    return trimmed || undefined;
}

function sanitizeTouchRecord(raw: unknown): Record<string, any> | undefined {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const src = raw as Record<string, unknown>;
    const touch: Record<string, any> = {};

    const paramsRaw =
        src.params && typeof src.params === 'object' && !Array.isArray(src.params)
            ? (src.params as Record<string, unknown>)
            : undefined;
    if (paramsRaw) {
        const cleanParams: Record<string, string> = {};
        for (const key of TOUCH_PARAM_KEYS) {
            const cleaned = sanitizeStringField(paramsRaw[key], 256);
            if (cleaned) cleanParams[key] = cleaned;
        }
        if (Object.keys(cleanParams).length > 0) {
            touch.params = cleanParams;
        }
    }

    const stringFields: Array<[string, number]> = [
        ['landingPath', 512],
        ['referrer', 1024],
        ['channel', 64],
        ['timestamp', 64],
        ['ctaTag', 120],
        ['intent', 120],
    ];
    for (const [key, maxLen] of stringFields) {
        const cleaned = sanitizeStringField(src[key], maxLen);
        if (cleaned) touch[key] = cleaned;
    }

    return Object.keys(touch).length > 0 ? touch : undefined;
}

export function inferSourceFromReferrerOrClickId(
    params: Record<string, string | undefined>,
    referrer?: string,
): string | undefined {
    let refHost = '';
    if (referrer) {
        try {
            refHost = new URL(referrer).hostname.replace(/^www\./, '').toLowerCase();
        } catch {
            // Invalid referrer URL; fallback below
        }
    }

    if (params.utm_source) {
        const cleanUtm = params.utm_source.toLowerCase().trim();
        if (cleanUtm === 'ig' || cleanUtm === 'instagram' || cleanUtm === 'l.instagram.com' || cleanUtm === 'instagram.com') {
            return 'instagram';
        }
        if (cleanUtm === 'fb' || cleanUtm === 'facebook' || cleanUtm === 'l.facebook.com' || cleanUtm === 'lm.facebook.com' || cleanUtm === 'm.facebook.com') {
            return 'facebook';
        }
        return params.utm_source;
    }
    if (params.fbclid) {
        if (refHost.includes('instagram.') || refHost === 'ig.me') return 'instagram';
        if (refHost.includes('facebook.') || refHost.includes('fb.')) return 'facebook';
        return 'meta_ads';
    }
    if (params.gclid) return 'google_ads';
    if (params.ttclid) return 'tiktok_ads';
    if (params.msclkid) return 'microsoft_ads';
    if (params.ref || params.aff) return 'referral';
    if (params.src) return params.src;
    if (refHost) {
        if (refHost.includes('google.')) return 'google_organic';
        if (refHost.includes('instagram.') || refHost === 'ig.me') return 'instagram';
        if (refHost.includes('facebook.') || refHost.includes('fb.')) return 'facebook';
        if (refHost.includes('youtube.') || refHost.includes('youtu.be')) return 'youtube';
        if (refHost.includes('tiktok.')) return 'tiktok';
        if (refHost.includes('t.me') || refHost.includes('telegram')) return 'telegram';
        if (refHost.includes('whatsapp')) return 'whatsapp';
        return refHost.slice(0, 120);
    }
    return undefined;
}

function detectImageExtensionByMagicBytes(buffer: Buffer): 'jpg' | 'png' | 'webp' | 'gif' | null {
    if (!buffer || buffer.length < 12) return null;
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
    if (
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47 &&
        buffer[4] === 0x0d &&
        buffer[5] === 0x0a &&
        buffer[6] === 0x1a &&
        buffer[7] === 0x0a
    ) {
        return 'png';
    }
    if (
        buffer[0] === 0x47 &&
        buffer[1] === 0x49 &&
        buffer[2] === 0x46 &&
        buffer[3] === 0x38 &&
        (buffer[4] === 0x37 || buffer[4] === 0x39) &&
        buffer[5] === 0x61
    ) {
        return 'gif';
    }
    if (
        buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
        buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
        return 'webp';
    }
    return null;
}

export function sanitizeAttributionPayload(raw: unknown): Record<string, any> | undefined {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const src = raw as Record<string, unknown>;
    const clean: Record<string, any> = {};

    for (const key of ALLOWED_ATTRIBUTION_KEYS) {
        const maxLen = key === 'referrer' ? 1024 : key === 'landingPath' ? 512 : 256;
        const cleaned = sanitizeStringField(src[key], maxLen);
        if (cleaned) clean[key] = cleaned;
    }

    const firstTouch = sanitizeTouchRecord(src.firstTouch);
    const lastTouch = sanitizeTouchRecord(src.lastTouch);
    if (firstTouch) clean.firstTouch = firstTouch;
    if (lastTouch) clean.lastTouch = lastTouch;

    // Flatten canonical UTM / click / CTA values from firstTouch & lastTouch so callers can read top-level keys directly
    const primaryParams: Record<string, string | undefined> = {
        ...(firstTouch?.params || {}),
        ...(lastTouch?.params || {}),
    };
    for (const key of TOUCH_PARAM_KEYS) {
        if (!clean[key]) {
            const val = primaryParams[key];
            if (val) clean[key] = val;
        }
    }
    if (!clean.utm_source && (firstTouch?.params?.utm_source || lastTouch?.params?.utm_source)) {
        clean.utm_source = lastTouch?.params?.utm_source || firstTouch?.params?.utm_source;
    }
    if (!clean.landingPath) {
        clean.landingPath = firstTouch?.landingPath || lastTouch?.landingPath;
    }
    if (!clean.referrer) {
        clean.referrer = firstTouch?.referrer || lastTouch?.referrer;
    }
    if (!clean.channel) {
        clean.channel = lastTouch?.channel || firstTouch?.channel;
    }
    if (!clean.ctaTag) {
        clean.ctaTag = clean.cta_tag || lastTouch?.ctaTag || firstTouch?.ctaTag || lastTouch?.params?.utm_content || firstTouch?.params?.utm_content;
    }
    if (!clean.intent) {
        clean.intent = lastTouch?.intent || firstTouch?.intent || lastTouch?.params?.utm_term || firstTouch?.params?.utm_term;
    }
    if (!clean.firstSeenAt && firstTouch?.timestamp) {
        clean.firstSeenAt = firstTouch.timestamp;
    }
    if (!clean.lastSeenAt && lastTouch?.timestamp) {
        clean.lastSeenAt = lastTouch.timestamp;
    }
    if (typeof src.utcOffsetMinutes === 'number' && Number.isFinite(src.utcOffsetMinutes)) {
        clean.utcOffsetMinutes = Math.trunc(src.utcOffsetMinutes);
    }

    return Object.keys(clean).length > 0 ? clean : undefined;
}

export interface ResolvedAcquisitionFields {
    visitorId: string | null;
    acquisitionSource: string | null;
    acquisitionMedium: string | null;
    acquisitionCampaign: string | null;
    acquisitionContent: string | null;
    acquisitionTerm: string | null;
    landingPath: string | null;
    referrer: string | null;
}

export function resolveAcquisitionFields(
    raw: unknown,
    fallbackVisitorId?: string | null,
): ResolvedAcquisitionFields {
    const clean = sanitizeAttributionPayload(raw);
    const firstParams = (clean?.firstTouch?.params || {}) as Record<string, string | undefined>;
    const lastParams = (clean?.lastTouch?.params || {}) as Record<string, string | undefined>;

    const mergedParams: Record<string, string | undefined> = {
        utm_source: clean?.utm_source || firstParams.utm_source || lastParams.utm_source,
        utm_medium: clean?.utm_medium || firstParams.utm_medium || lastParams.utm_medium,
        utm_campaign: clean?.utm_campaign || firstParams.utm_campaign || lastParams.utm_campaign,
        utm_content: clean?.utm_content || lastParams.utm_content || firstParams.utm_content || clean?.ctaTag,
        utm_term: clean?.utm_term || lastParams.utm_term || firstParams.utm_term || clean?.intent,
        fbclid: clean?.fbclid || firstParams.fbclid || lastParams.fbclid,
        gclid: clean?.gclid || firstParams.gclid || lastParams.gclid,
        ttclid: clean?.ttclid || firstParams.ttclid || lastParams.ttclid,
        msclkid: clean?.msclkid || firstParams.msclkid || lastParams.msclkid,
        ref: clean?.ref || firstParams.ref || lastParams.ref,
        aff: clean?.aff || firstParams.aff || lastParams.aff,
        src: clean?.src || firstParams.src || lastParams.src,
    };

    const referrer = clean?.referrer || clean?.firstTouch?.referrer || clean?.lastTouch?.referrer || null;
    const landingPath = clean?.landingPath || clean?.firstTouch?.landingPath || clean?.lastTouch?.landingPath || null;

    const inferredSource =
        inferSourceFromReferrerOrClickId(mergedParams, referrer || undefined) ||
        clean?.channel ||
        'direct';

    const visitorId =
        sanitizeStringField(clean?.visitorId || fallbackVisitorId, 120) || null;

    return {
        visitorId,
        acquisitionSource: inferredSource ? inferredSource.slice(0, 160) : null,
        acquisitionMedium: mergedParams.utm_medium ? mergedParams.utm_medium.slice(0, 160) : null,
        acquisitionCampaign: mergedParams.utm_campaign ? mergedParams.utm_campaign.slice(0, 200) : null,
        acquisitionContent: mergedParams.utm_content ? mergedParams.utm_content.slice(0, 200) : null,
        acquisitionTerm: mergedParams.utm_term ? mergedParams.utm_term.slice(0, 200) : null,
        landingPath: landingPath ? String(landingPath).slice(0, 512) : null,
        referrer: referrer ? String(referrer).slice(0, 1024) : null,
    };
}

export function hashRefreshToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
}

@Injectable()
export class UsersService implements OnModuleInit {
    private readonly logger = new Logger(UsersService.name);

    constructor(
        @InjectRepository(UserEntity)
        private usersRepository: Repository<UserEntity>,
        @Inject(CACHE_MANAGER)
        private cacheManager: Cache,
        @Optional()
        private readonly r2Storage?: CloudflareR2StorageService,
    ) {}

    async onModuleInit(): Promise<void> {
        if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) {
            return;
        }
        await this.ensureAllUsersHaveSafeUsernames().catch((err) => {
            this.logger.warn(`Username backfill skipped: ${err?.message || err}`);
        });
    }

    extractFirstNameSlug(nameOrEmail?: string | null): string {
        const raw = String(nameOrEmail || '').trim();
        if (!raw) return 'trader';
        const firstToken = raw.includes('@')
            ? raw.split('@')[0].split(/[._+\-\s]+/)[0]
            : raw.split(/\s+/)[0];
        const cleaned = firstToken
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '')
            .slice(0, 18);
        return cleaned.length >= 2 ? cleaned : 'trader';
    }

    isSafePublicHandle(handle?: string | null): boolean {
        if (!handle || typeof handle !== 'string') return false;
        const trimmed = handle.trim();
        if (trimmed.includes('@') || /\s/.test(trimmed)) return false;
        return /^[a-z0-9_]{2,32}$/.test(trimmed);
    }

    async isUsernameAvailable(candidate: string, excludeUserId?: string): Promise<boolean> {
        const clean = String(candidate || '').trim().toLowerCase();
        if (!clean) return false;
        const qb = this.usersRepository
            .createQueryBuilder('u')
            .select(['u.id'])
            .where('LOWER(u.username) = :candidate', { candidate: clean });
        if (excludeUserId) {
            qb.andWhere('u.id != :excludeUserId', { excludeUserId });
        }
        const existing = await qb.getOne();
        return !existing;
    }

    async generateUniqueUsername(
        preferredSeed?: string | null,
        excludeUserId?: string,
    ): Promise<string> {
        const base = this.extractFirstNameSlug(preferredSeed);
        if (await this.isUsernameAvailable(base, excludeUserId)) {
            return base;
        }

        for (let attempt = 0; attempt < 16; attempt++) {
            const suffix =
                attempt < 10 ? String(randomInt(1000, 9999)) : String(randomInt(10000, 999999));
            const candidate = `${base.slice(0, 24)}${suffix}`;
            if (await this.isUsernameAvailable(candidate, excludeUserId)) {
                return candidate;
            }
        }

        return `${base.slice(0, 18)}${Date.now().toString(36)}${randomInt(10, 99)}`;
    }

    async ensureAllUsersHaveSafeUsernames(): Promise<number> {
        const allUsers = await this.usersRepository.find({
            select: ['id', 'name', 'email', 'username', 'createdAt'],
            order: { createdAt: 'ASC' },
        });
        const usedHandles = new Set<string>();
        let updatedCount = 0;

        for (const u of allUsers) {
            const current = (u.username || '').trim();
            if (this.isSafePublicHandle(current) && !usedHandles.has(current.toLowerCase())) {
                usedHandles.add(current.toLowerCase());
                continue;
            }
            const base = this.extractFirstNameSlug(u.name || u.email);
            let candidate = base;
            while (usedHandles.has(candidate.toLowerCase())) {
                candidate = `${base.slice(0, 22)}${randomInt(1000, 99999)}`;
            }
            usedHandles.add(candidate.toLowerCase());
            await this.usersRepository.update(u.id, { username: candidate });
            updatedCount++;
        }

        if (updatedCount > 0) {
            this.logger.log(`[Privacy] Normalized/generated unique @username for ${updatedCount} legacy user(s).`);
        }
        return updatedCount;
    }

    private getAuthGuardCacheKey(userId: string): string {
        return `auth:guard:user:${userId}`;
    }

    async invalidateAuthGuardCache(userId: string): Promise<void> {
        if (!userId) return;
        try {
            await this.cacheManager.del(this.getAuthGuardCacheKey(userId));
        } catch {
            // Non-critical cache invalidation error
        }
    }

    async getAuthGuardSnapshot(userId: string): Promise<AuthGuardUserSnapshot | null> {
        const cacheKey = this.getAuthGuardCacheKey(userId);
        try {
            const cached = await this.cacheManager.get<AuthGuardUserSnapshot>(cacheKey);
            if (cached && cached.id === userId) {
                return cached;
            }
        } catch {
            // Fall through to DB lookup if Redis fails
        }

        const user = await this.usersRepository.findOne({
            where: { id: userId },
            select: ['id', 'isBlocked', 'twoFactorEnabled', 'isTwoFactorConfirmed'],
        });

        if (!user) return null;

        const snapshot: AuthGuardUserSnapshot = {
            id: user.id,
            isBlocked: Boolean(user.isBlocked),
            twoFactorEnabled: Boolean(user.twoFactorEnabled),
            isTwoFactorConfirmed: Boolean(user.isTwoFactorConfirmed),
        };

        try {
            await this.cacheManager.set(cacheKey, snapshot, AUTH_GUARD_CACHE_TTL_MS);
        } catch {
            // Non-critical cache write error
        }

        return snapshot;
    }

    toSafeProfileResponse(user?: UserEntity | null) {
        if (!user) return null;
        return {
            id: user.id,
            name: user.name,
            username: user.username,
            email: maskEmailAddress(user.email),
            avatarUrl: user.avatarUrl || null,
            whatsapp: maskPhoneNumber(user.whatsapp),
            dailyLossLimit: user.dailyLossLimit,
            twoFactorEnabled: user.twoFactorEnabled,
            onboardingCompleted: user.onboardingCompleted,
            preferredLocale: user.preferredLocale,
            timezone: user.timezone,
        };
    }

    private async deleteAvatarFileIfLocal(avatarUrl?: string | null): Promise<void> {
        if (!avatarUrl || typeof avatarUrl !== 'string') {
            return;
        }

        if (this.r2Storage) {
            const removed = await this.r2Storage.deleteByUrl(avatarUrl);
            if (removed) return;
        }

        const expectedPrefix = '/uploads/avatars/';
        if (!avatarUrl.startsWith(expectedPrefix)) {
            return;
        }

        const rawFilename = avatarUrl.slice(expectedPrefix.length).split('?')[0];
        if (!rawFilename || rawFilename.includes('..') || rawFilename.includes('/') || rawFilename.includes('\\')) {
            return;
        }

        const avatarsDir = path.resolve(process.cwd(), 'uploads', 'avatars');
        const targetPath = path.resolve(avatarsDir, rawFilename);
        if (!targetPath.startsWith(avatarsDir)) {
            return;
        }

        try {
            await fs.promises.unlink(targetPath);
        } catch {
            // Ignore missing file errors
        }
    }

    private async syncLeaderboardAvatar(userId: string, avatarUrl: string | null): Promise<void> {
        try {
            await this.usersRepository.manager.query(
                'UPDATE leaderboard_ranks SET "avatarUrl" = $1 WHERE user_id = $2',
                [avatarUrl, userId],
            );
        } catch {
            // Non-critical sync if leaderboard table is not yet populated
        }
    }

    async findOneByEmail(email: string): Promise<UserEntity | undefined> {
        return this.usersRepository.findOne({ where: { email: String(email || '').trim().toLowerCase() } });
    }

    async findOneByGoogleId(googleId: string): Promise<UserEntity | undefined> {
        return this.usersRepository.findOne({ where: { googleId } });
    }

    async findOneByGithubId(githubId: string): Promise<UserEntity | undefined> {
        return this.usersRepository.findOne({ where: { githubId } });
    }

    async findOneById(id: string): Promise<UserEntity | undefined> {
        return this.usersRepository.findOne({ where: { id } });
    }

    async findOneByRefreshToken(refreshToken: string): Promise<UserEntity | undefined> {
        if (!refreshToken || typeof refreshToken !== 'string') return undefined;
        const hashed = hashRefreshToken(refreshToken);
        // Support both hashed storage (new) and legacy unhashed rows during seamless transition
        return this.usersRepository.findOne({
            where: [{ refreshToken: hashed }, { refreshToken }],
        });
    }

    async create(userData: Partial<UserEntity>): Promise<UserEntity> {
        const normalizedEmail = userData.email ? userData.email.trim().toLowerCase() : userData.email;
        const safeSeed =
            userData.username && this.isSafePublicHandle(userData.username.trim().toLowerCase())
                ? userData.username.trim().toLowerCase()
                : userData.name || normalizedEmail;
        const resolvedUsername = await this.generateUniqueUsername(safeSeed);

        const user = this.usersRepository.create({
            ...userData,
            email: normalizedEmail,
            username: resolvedUsername,
        });
        return this.usersRepository.save(user);
    }

    async uploadAvatar(userId: string, file: any): Promise<{ avatarUrl: string }> {
        if (!file || !file.buffer || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
            throw new BadRequestException('Nenhuma imagem foi enviada.');
        }

        if (file.buffer.length > MAX_AVATAR_BYTES) {
            throw new BadRequestException('A imagem excede o limite máximo de 5MB.');
        }

        const ext = detectImageExtensionByMagicBytes(file.buffer);
        if (!ext) {
            throw new BadRequestException('Formato inválido. Envie uma imagem JPG, PNG, WEBP ou GIF válida.');
        }

        let newAvatarUrl: string;
        if (this.r2Storage) {
            const stored = await this.r2Storage.uploadPublicObject({
                folder: 'avatars',
                buffer: file.buffer,
                ext,
            });
            newAvatarUrl = stored.url;
        } else {
            const opaqueOwnerTag = createHash('sha256')
                .update(`torex-avatar:${userId}`)
                .digest('hex')
                .slice(0, 12);
            const randomSuffix = randomBytes(12).toString('hex');
            const filename = `av_${opaqueOwnerTag}_${randomSuffix}.${ext}`;

            const avatarsDir = path.join(process.cwd(), 'uploads', 'avatars');
            await fs.promises.mkdir(avatarsDir, { recursive: true });
            await fs.promises.writeFile(path.join(avatarsDir, filename), file.buffer);
            newAvatarUrl = `/uploads/avatars/${filename}`;
        }

        const currentUser = await this.findOneById(userId);
        if (currentUser?.avatarUrl && currentUser.avatarUrl !== newAvatarUrl) {
            await this.deleteAvatarFileIfLocal(currentUser.avatarUrl);
        }

        await this.usersRepository.update(userId, { avatarUrl: newAvatarUrl });
        await this.syncLeaderboardAvatar(userId, newAvatarUrl);

        return { avatarUrl: newAvatarUrl };
    }

    async deleteAvatar(userId: string): Promise<{ avatarUrl: null }> {
        const currentUser = await this.findOneById(userId);
        if (currentUser?.avatarUrl) {
            await this.deleteAvatarFileIfLocal(currentUser.avatarUrl);
        }

        await this.usersRepository.update(userId, { avatarUrl: null });
        await this.syncLeaderboardAvatar(userId, null);

        return { avatarUrl: null };
    }

    async updateProfile(
        userId: string,
        data: {
            name?: string;
            username?: string;
            avatarUrl?: string | null;
            dailyLossLimit?: number;
        },
    ) {
        const payload: Record<string, any> = {};
        if (data.name !== undefined) payload.name = data.name;
        if (data.username !== undefined) {
            const cleanUsername = String(data.username || '')
                .trim()
                .replace(/^@+/, '')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLowerCase()
                .replace(/[^a-z0-9_]/g, '');
            if (cleanUsername.length < 2 || cleanUsername.length > 32) {
                throw new BadRequestException('O @username deve ter entre 2 e 32 caracteres alfanuméricos.');
            }
            const available = await this.isUsernameAvailable(cleanUsername, userId);
            if (!available) {
                throw new BadRequestException('Este @username já está em uso. Escolha outro identificador.');
            }
            payload.username = cleanUsername;
        }
        if (data.dailyLossLimit !== undefined) payload.dailyLossLimit = data.dailyLossLimit;
        if (data.avatarUrl !== undefined) {
            const currentUser = await this.findOneById(userId);
            if (currentUser?.avatarUrl && currentUser.avatarUrl !== data.avatarUrl) {
                await this.deleteAvatarFileIfLocal(currentUser.avatarUrl);
            }
            payload.avatarUrl = data.avatarUrl || null;
        }

        if (Object.keys(payload).length > 0) {
            await this.usersRepository.update(userId, payload);
            void this.recordUserActivity(userId, {
                actionType: 'profile_updated',
                label: 'Atualizou perfil da conta',
                pagePath: '/configuration',
            });
        }

        if (data.avatarUrl !== undefined) {
            await this.syncLeaderboardAvatar(userId, data.avatarUrl || null);
        }

        const updated = await this.findOneById(userId);
        return this.toSafeProfileResponse(updated);
    }

    async update(user: UserEntity): Promise<UserEntity> {
        const saved = await this.usersRepository.save(user);
        await this.invalidateAuthGuardCache(saved.id);
        return saved;
    }

    async updateContact(userId: string, whatsapp: string) {
        const cleanWhatsapp = String(whatsapp || '').trim().slice(0, 32);
        await this.usersRepository.update(userId, { whatsapp: cleanWhatsapp });
        void this.recordUserActivity(userId, {
            actionType: 'contact_updated',
            label: 'Atualizou contacto WhatsApp',
            pagePath: '/configuration',
        });
        await this.invalidateAuthGuardCache(userId);
        const saved = await this.findOneById(userId);
        return {
            success: true,
            whatsapp: maskPhoneNumber(saved?.whatsapp || cleanWhatsapp),
            user: this.toSafeProfileResponse(saved),
        };
    }

    async updatePreferences(
        userId: string,
        data: {
            preferredLocale?: string;
            timezone?: string;
            attributionData?: any;
        },
    ) {
        const payload: Record<string, any> = {};
        if (data.preferredLocale === 'en' || data.preferredLocale === 'pt') {
            payload.preferredLocale = data.preferredLocale;
        }
        if (typeof data.timezone === 'string' && data.timezone.trim()) {
            payload.timezone = data.timezone.trim().slice(0, 64);
        }
        const safeAttribution = sanitizeAttributionPayload(data.attributionData);
        if (safeAttribution) {
            const current = await this.findOneById(userId);
            const resolved = resolveAcquisitionFields(safeAttribution, current?.visitorId);
            if (!current?.attributionData) {
                payload.attributionData = safeAttribution;
            }
            if (resolved.visitorId && !current?.visitorId) {
                payload.visitorId = resolved.visitorId;
            }
            if (resolved.acquisitionSource && (!current?.acquisitionSource || current.acquisitionSource === 'direct')) {
                payload.acquisitionSource = resolved.acquisitionSource;
            }
            if (resolved.acquisitionMedium && !current?.acquisitionMedium) {
                payload.acquisitionMedium = resolved.acquisitionMedium;
            }
            if (resolved.acquisitionCampaign && !current?.acquisitionCampaign) {
                payload.acquisitionCampaign = resolved.acquisitionCampaign;
            }
            if (resolved.acquisitionContent && !current?.acquisitionContent) {
                payload.acquisitionContent = resolved.acquisitionContent;
            }
            if (resolved.acquisitionTerm && !current?.acquisitionTerm) {
                payload.acquisitionTerm = resolved.acquisitionTerm;
            }
            if (resolved.landingPath && !current?.landingPath) {
                payload.landingPath = resolved.landingPath;
            }
            if (resolved.referrer && !current?.referrer) {
                payload.referrer = resolved.referrer;
            }
        }
        if (Object.keys(payload).length > 0) {
            await this.usersRepository.update(userId, payload);
            void this.recordUserActivity(userId, {
                actionType: 'profile_updated',
                label: 'Atualizou perfil da conta',
                pagePath: '/configuration',
            });
        }
        return {
            success: true,
            preferredLocale: payload.preferredLocale,
            timezone: payload.timezone,
        };
    }

    async updateRefreshToken(userId: string, refreshToken: string | null): Promise<void> {
        const storedValue = refreshToken ? hashRefreshToken(refreshToken) : null;
        await this.usersRepository.update(userId, { refreshToken: storedValue });
    }

    async recordUserActivity(
        userId: string,
        activity: {
            actionType: string;
            label?: string | null;
            pagePath?: string | null;
            isLogin?: boolean;
            markEmailVerified?: boolean;
        },
    ): Promise<void> {
        if (!userId) return;
        try {
            const now = new Date();
            const payload: Record<string, any> = {
                lastActiveAt: now,
                lastActionType: String(activity.actionType || 'activity').slice(0, 64),
            };
            if (activity.label !== undefined) {
                payload.lastActionLabel = activity.label ? String(activity.label).slice(0, 180) : null;
            }
            if (activity.pagePath !== undefined) {
                payload.lastActionPath = activity.pagePath ? String(activity.pagePath).slice(0, 255) : null;
            }
            if (activity.isLogin) {
                payload.lastLoginAt = now;
            }
            if (activity.markEmailVerified) {
                payload.emailVerifiedAt = now;
            }
            await this.usersRepository.update(userId, payload);
        } catch {
            // Non-blocking activity capture
        }
    }

    async findAll(options?: {
        page?: number;
        limit?: number;
        search?: string;
        source?: string;
        paginated?: boolean;
    }): Promise<any> {
        const qb = this.usersRepository
            .createQueryBuilder('u')
            .leftJoinAndSelect('u.subscriptions', 's')
            .leftJoinAndSelect('s.planConfig', 'pc')
            .orderBy('u.createdAt', 'DESC');

        if (options?.search && options.search.trim()) {
            const term = `%${options.search.trim().toLowerCase()}%`;
            qb.andWhere(
                '(LOWER(u.email) LIKE :term OR LOWER(COALESCE(u.name, \'\')) LIKE :term OR LOWER(COALESCE(u.username, \'\')) LIKE :term OR LOWER(COALESCE(u.acquisition_source, \'\')) LIKE :term OR LOWER(COALESCE(u.acquisition_campaign, \'\')) LIKE :term)',
                { term },
            );
        }

        if (options?.source && options.source.trim()) {
            const normalizedSource = options.source.trim().toLowerCase();
            if (normalizedSource === 'direct') {
                qb.andWhere('(u.acquisition_source IS NULL OR LOWER(u.acquisition_source) = :src)', { src: 'direct' });
            } else {
                qb.andWhere('LOWER(COALESCE(u.acquisition_source, \'\')) = :src', { src: normalizedSource });
            }
        }

        if (options?.paginated) {
            const page = Math.max(1, Number(options.page) || 1);
            const limit = Math.min(200, Math.max(1, Number(options.limit) || 50));
            qb.skip((page - 1) * limit).take(limit);
            const [users, total] = await qb.getManyAndCount();
            const safeItems = users.map(
                ({ passwordHash, refreshToken, twoFactorSecret, apiToken, ...safeUser }) => safeUser,
            );
            return {
                items: safeItems,
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            };
        }

        if (options?.limit) {
            qb.take(Math.min(500, Math.max(1, Number(options.limit))));
        }

        const users = await qb.getMany();
        return users.map(({ passwordHash, refreshToken, twoFactorSecret, apiToken, ...safeUser }) => safeUser);
    }
}
