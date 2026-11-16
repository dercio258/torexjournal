import { EventEmitter } from 'events';
import type Redis from 'ioredis';
import type { KeyvStoreAdapter, StoredData } from 'keyv';

export class IoRedisKeyvStore extends EventEmitter implements KeyvStoreAdapter {
    opts: Record<string, any> = {};
    namespace?: string;

    constructor(private readonly client: Redis) {
        super();
        this.client.on('error', (err) => {
            if (this.listenerCount('error') > 0) {
                this.emit('error', err);
            }
        });
    }

    async get<Value>(key: string): Promise<StoredData<Value> | undefined> {
        const val = await this.client.get(key);
        return val === null ? undefined : (val as unknown as StoredData<Value>);
    }

    async set(key: string, value: any, ttl?: number): Promise<boolean> {
        const payload = typeof value === 'string' ? value : JSON.stringify(value);
        if (typeof ttl === 'number' && Number.isFinite(ttl) && ttl > 0) {
            await this.client.set(key, payload, 'PX', Math.max(1, Math.floor(ttl)));
        } else {
            await this.client.set(key, payload);
        }
        return true;
    }

    async delete(key: string): Promise<boolean> {
        const removed = await this.client.del(key);
        return removed > 0;
    }

    async clear(): Promise<void> {
        // Never FLUSHDB shared Redis; Keyv stores keyspace cleanup by pattern if needed.
        const keys = await this.client.keys('backtest:*');
        if (keys.length > 0) {
            await this.client.del(...keys);
        }
    }

    async has(key: string): Promise<boolean> {
        const exists = await this.client.exists(key);
        return exists > 0;
    }

    async getMany<Value>(keys: string[]): Promise<Array<StoredData<Value | undefined>>> {
        if (!keys.length) return [];
        const rows = await this.client.mget(...keys);
        return rows.map((row) => (row === null ? undefined : (row as unknown as StoredData<Value>)));
    }

    async deleteMany(keys: string[]): Promise<boolean> {
        if (!keys.length) return true;
        const removed = await this.client.del(...keys);
        return removed > 0;
    }

    async disconnect(): Promise<void> {
        await this.client.quit();
    }
}
