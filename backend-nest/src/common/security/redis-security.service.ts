import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';

interface MemoryCounterEntry {
    count: number;
    expiresAt: number;
}

interface MemoryValueEntry {
    value: string;
    expiresAt: number;
}

const INCREMENT_WINDOW_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local pttl = redis.call('PTTL', KEYS[1])
if pttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  pttl = tonumber(ARGV[1])
end
return { current, pttl }
`;

const CONSUME_ONCE_LUA = `
local val = redis.call('GET', KEYS[1])
if val then
  redis.call('DEL', KEYS[1])
end
return val
`;

const RELEASE_LOCK_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

@Injectable()
export class RedisSecurityService implements OnModuleDestroy {
    private readonly logger = new Logger(RedisSecurityService.name);
    private readonly redis: Redis | null = null;
    private redisReady = false;
    private readonly keyPrefix: string;

    // Resilience fallback when Redis is unavailable in local dev/test
    private readonly memCounters = new Map<string, MemoryCounterEntry>();
    private readonly memValues = new Map<string, MemoryValueEntry>();

    constructor(private readonly configService: ConfigService) {
        const host = this.configService.get<string>('REDIS_HOST');
        const port = Number(this.configService.get<number>('REDIS_PORT') || 6379);
        const password = this.configService.get<string>('REDIS_PASSWORD');
        this.keyPrefix = `${this.configService.get<string>('REDIS_PREFIX', 'torex')}:sec:`;

        if (host) {
            this.redis = new Redis({
                host,
                port,
                password: password || undefined,
                maxRetriesPerRequest: 2,
                enableReadyCheck: true,
                lazyConnect: false,
                retryStrategy: (times) => Math.min(times * 250, 3000),
            });

            this.redis.on('ready', () => {
                this.redisReady = true;
            });
            this.redis.on('error', (err) => {
                this.redisReady = false;
                this.logger.warn(`RedisSecurityService degraded to memory fallback: ${err.message}`);
            });
            this.redis.on('close', () => {
                this.redisReady = false;
            });
        }
    }

    async onModuleDestroy() {
        if (this.redis) {
            try {
                await this.redis.quit();
            } catch {
                this.redis.disconnect();
            }
        }
    }

    private prefix(key: string): string {
        return `${this.keyPrefix}${key}`;
    }

    private gcMemory() {
        const now = Date.now();
        if (this.memCounters.size > 5000) {
            for (const [k, v] of this.memCounters.entries()) {
                if (v.expiresAt <= now) this.memCounters.delete(k);
            }
        }
        if (this.memValues.size > 5000) {
            for (const [k, v] of this.memValues.entries()) {
                if (v.expiresAt <= now) this.memValues.delete(k);
            }
        }
    }

    /**
     * Atomically increments a counter within a fixed sliding window (milliseconds).
     * Eliminates race conditions where concurrent requests read count=0 simultaneously.
     */
    async incrementWithWindow(
        key: string,
        ttlMs: number,
    ): Promise<{ count: number; ttlMs: number }> {
        const fullKey = this.prefix(key);

        if (this.redis && this.redisReady) {
            try {
                const res = (await this.redis.eval(
                    INCREMENT_WINDOW_LUA,
                    1,
                    fullKey,
                    String(ttlMs),
                )) as [number, number];
                return {
                    count: Number(res[0] || 1),
                    ttlMs: Math.max(0, Number(res[1] || ttlMs)),
                };
            } catch (err: any) {
                this.logger.warn(`Redis incrementWithWindow failed (${key}): ${err.message}`);
            }
        }

        this.gcMemory();
        const now = Date.now();
        const existing = this.memCounters.get(fullKey);
        if (!existing || existing.expiresAt <= now) {
            const entry = { count: 1, expiresAt: now + ttlMs };
            this.memCounters.set(fullKey, entry);
            return { count: 1, ttlMs };
        }
        existing.count += 1;
        return { count: existing.count, ttlMs: Math.max(0, existing.expiresAt - now) };
    }

    /**
     * Stores a string value with TTL (ms).
     */
    async setValue(key: string, value: string, ttlMs: number): Promise<void> {
        const fullKey = this.prefix(key);

        if (this.redis && this.redisReady) {
            try {
                await this.redis.set(fullKey, value, 'PX', ttlMs);
                return;
            } catch (err: any) {
                this.logger.warn(`Redis setValue failed (${key}): ${err.message}`);
            }
        }

        this.gcMemory();
        this.memValues.set(fullKey, { value, expiresAt: Date.now() + ttlMs });
    }

    /**
     * Atomically sets a key only if it does not already exist (NX + PX TTL).
     */
    async setIfAbsent(key: string, value: string, ttlMs: number): Promise<boolean> {
        const fullKey = this.prefix(key);

        if (this.redis && this.redisReady) {
            try {
                const result = await this.redis.set(fullKey, value, 'PX', ttlMs, 'NX');
                return result === 'OK';
            } catch (err: any) {
                this.logger.warn(`Redis setIfAbsent failed (${key}): ${err.message}`);
            }
        }

        this.gcMemory();
        const now = Date.now();
        const existing = this.memValues.get(fullKey);
        if (existing && existing.expiresAt > now) {
            return false;
        }
        this.memValues.set(fullKey, { value, expiresAt: now + ttlMs });
        return true;
    }

    /**
     * Reads a string value without consuming it.
     */
    async getValue(key: string): Promise<string | null> {
        const fullKey = this.prefix(key);

        if (this.redis && this.redisReady) {
            try {
                return await this.redis.get(fullKey);
            } catch (err: any) {
                this.logger.warn(`Redis getValue failed (${key}): ${err.message}`);
            }
        }

        const existing = this.memValues.get(fullKey);
        if (!existing || existing.expiresAt <= Date.now()) {
            this.memValues.delete(fullKey);
            return null;
        }
        return existing.value;
    }

    /**
     * Atomically gets and deletes a single-use value (OTP, OAuth exchange code, reset token).
     * Prevents concurrent replay race conditions.
     */
    async consumeOnce(key: string): Promise<string | null> {
        const fullKey = this.prefix(key);

        if (this.redis && this.redisReady) {
            try {
                const val = await this.redis.eval(CONSUME_ONCE_LUA, 1, fullKey);
                return typeof val === 'string' ? val : null;
            } catch (err: any) {
                this.logger.warn(`Redis consumeOnce failed (${key}): ${err.message}`);
            }
        }

        const existing = this.memValues.get(fullKey);
        this.memValues.delete(fullKey);
        if (!existing || existing.expiresAt <= Date.now()) {
            return null;
        }
        return existing.value;
    }

    async deleteKey(key: string): Promise<void> {
        const fullKey = this.prefix(key);
        this.memCounters.delete(fullKey);
        this.memValues.delete(fullKey);

        if (this.redis && this.redisReady) {
            try {
                await this.redis.del(fullKey);
            } catch (err: any) {
                this.logger.warn(`Redis deleteKey failed (${key}): ${err.message}`);
            }
        }
    }

    /**
     * Executes an async operation under a short-lived distributed lock.
     */
    async withLock<T>(
        lockKey: string,
        ttlMs: number,
        fn: () => Promise<T>,
    ): Promise<{ acquired: boolean; result?: T }> {
        const token = randomUUID();
        const fullLockKey = `lock:${lockKey}`;
        const acquired = await this.setIfAbsent(fullLockKey, token, ttlMs);
        if (!acquired) {
            return { acquired: false };
        }

        try {
            const result = await fn();
            return { acquired: true, result };
        } finally {
            const prefixed = this.prefix(fullLockKey);
            if (this.redis && this.redisReady) {
                try {
                    await this.redis.eval(RELEASE_LOCK_LUA, 1, prefixed, token);
                } catch {
                    // Lock expires naturally via TTL
                }
            } else {
                const existing = this.memValues.get(prefixed);
                if (existing?.value === token) {
                    this.memValues.delete(prefixed);
                }
            }
        }
    }
}
