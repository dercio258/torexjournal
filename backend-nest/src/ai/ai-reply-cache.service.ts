import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { createHash } from 'crypto';
import { AiActionLink } from './ai-chat.entity';

export interface CachedAiReplyEntry {
    content: string;
    intent: string;
    actions: AiActionLink[];
    suggestions: string[];
    expiresAt: number;
}

const MEMORY_MAX_ENTRIES = 600;
const GENERATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Reply cache shared by every backend instance (Redis through the global CacheModule),
 * surviving restarts. Falls back to an in-process map when Redis is unavailable.
 *
 * Per-user invalidation (after a 👎) bumps a generation counter instead of scanning keys:
 * entries written under an older generation are simply never read again and expire.
 */
@Injectable()
export class AiReplyCacheService {
    private readonly logger = new Logger(AiReplyCacheService.name);
    private readonly memory = new Map<string, CachedAiReplyEntry>();
    private readonly memoryGenerations = new Map<string, number>();
    private redisWarned = false;

    constructor(@Optional() @Inject(CACHE_MANAGER) private readonly cache?: Cache) {}

    private hash(raw: string): string {
        return createHash('sha256').update(raw).digest('hex').slice(0, 40);
    }

    private generationKey(userId: string): string {
        return `torexai:replygen:${this.hash(userId)}`;
    }

    private onRedisError(err: unknown): void {
        if (!this.redisWarned) {
            this.redisWarned = true;
            this.logger.warn(`Reply cache using in-process fallback: ${(err as Error)?.message || err}`);
        }
    }

    private async generation(userId: string): Promise<number> {
        if (this.cache) {
            try {
                const g = await this.cache.get<number>(this.generationKey(userId));
                return Number(g) || 0;
            } catch (err) {
                this.onRedisError(err);
            }
        }
        return this.memoryGenerations.get(userId) || 0;
    }

    private async entryKey(userId: string, key: string): Promise<string> {
        return `torexai:reply:${this.hash(userId)}:g${await this.generation(userId)}:${this.hash(key)}`;
    }

    async get(userId: string, key: string): Promise<CachedAiReplyEntry | null> {
        const fullKey = await this.entryKey(userId, key);
        let entry: CachedAiReplyEntry | null | undefined = null;
        if (this.cache) {
            try {
                entry = await this.cache.get<CachedAiReplyEntry>(fullKey);
            } catch (err) {
                this.onRedisError(err);
                entry = this.memory.get(fullKey);
            }
        } else {
            entry = this.memory.get(fullKey);
        }
        if (!entry) return null;
        if (entry.expiresAt <= Date.now()) {
            this.memory.delete(fullKey);
            return null;
        }
        return entry;
    }

    async set(userId: string, key: string, entry: CachedAiReplyEntry): Promise<void> {
        const fullKey = await this.entryKey(userId, key);
        const ttl = Math.max(1000, entry.expiresAt - Date.now());
        if (this.cache) {
            try {
                await this.cache.set(fullKey, entry, ttl);
                return;
            } catch (err) {
                this.onRedisError(err);
            }
        }
        if (this.memory.size >= MEMORY_MAX_ENTRIES) {
            const oldest = this.memory.keys().next().value;
            if (oldest) this.memory.delete(oldest);
        }
        this.memory.set(fullKey, entry);
    }

    /** Drops every cached reply of one user (e.g. after negative feedback). */
    async invalidateUser(userId: string): Promise<void> {
        const next = (await this.generation(userId)) + 1;
        this.memoryGenerations.set(userId, next);
        if (this.cache) {
            try {
                await this.cache.set(this.generationKey(userId), next, GENERATION_TTL_MS);
            } catch (err) {
                this.onRedisError(err);
            }
        }
    }
}
