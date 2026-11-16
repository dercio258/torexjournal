import { Injectable } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import { RedisSecurityService } from '../security/redis-security.service';

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
    constructor(private readonly redisSecurity: RedisSecurityService) {}

    async increment(
        key: string,
        ttl: number,
        limit: number,
        blockDuration: number,
        throttlerName: string,
    ): Promise<ThrottlerStorageRecord> {
        const safeTtlMs = Math.max(1000, ttl);
        const blockKey = `throttle:block:${throttlerName}:${key}`;
        const hitKey = `throttle:hit:${throttlerName}:${key}`;

        const blockedUntilRaw = await this.redisSecurity.getValue(blockKey);
        if (blockedUntilRaw) {
            const blockedUntil = Number(blockedUntilRaw);
            const remainingBlockSec = Math.max(1, Math.ceil((blockedUntil - Date.now()) / 1000));
            return {
                totalHits: limit + 1,
                timeToExpire: remainingBlockSec,
                isBlocked: true,
                timeToBlockExpire: remainingBlockSec,
            };
        }

        const { count, ttlMs } = await this.redisSecurity.incrementWithWindow(hitKey, safeTtlMs);
        const timeToExpire = Math.max(1, Math.ceil(ttlMs / 1000));

        if (count > limit && blockDuration > 0) {
            const blockMs = Math.max(1000, blockDuration);
            await this.redisSecurity.setValue(
                blockKey,
                String(Date.now() + blockMs),
                blockMs,
            );
            return {
                totalHits: count,
                timeToExpire,
                isBlocked: true,
                timeToBlockExpire: Math.ceil(blockMs / 1000),
            };
        }

        return {
            totalHits: count,
            timeToExpire,
            isBlocked: false,
            timeToBlockExpire: 0,
        };
    }
}
