import { ConflictException, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { RedisSecurityService } from '../security/redis-security.service';

describe('IdempotencyInterceptor', () => {
    let store: Map<string, string>;
    let redisSecurity: jest.Mocked<
        Pick<RedisSecurityService, 'getValue' | 'setIfAbsent' | 'setValue' | 'deleteKey'>
    >;
    let interceptor: IdempotencyInterceptor;

    const buildContext = (overrides?: {
        method?: string;
        url?: string;
        headers?: Record<string, any>;
        user?: { id?: string };
    }) => {
        const replyHeaders: Record<string, string> = {};
        let replyCode = 200;
        const req = {
            method: overrides?.method ?? 'PUT',
            url: overrides?.url ?? '/api/dashboard/journal/daily/2026-11-14',
            headers: overrides?.headers ?? {},
            user: overrides?.user ?? { id: 'user-1' },
        };
        const reply = {
            get statusCode() {
                return replyCode;
            },
            code: jest.fn((code: number) => {
                replyCode = code;
                return reply;
            }),
            header: jest.fn((name: string, val: string) => {
                replyHeaders[name] = val;
                return reply;
            }),
        };

        const ctx = {
            getType: () => 'http',
            switchToHttp: () => ({
                getRequest: () => req,
                getResponse: () => reply,
            }),
        } as unknown as ExecutionContext;

        return { ctx, reply, replyHeaders };
    };

    beforeEach(() => {
        store = new Map<string, string>();
        redisSecurity = {
            getValue: jest.fn(async (key: string) => store.get(key) ?? null),
            setIfAbsent: jest.fn(async (key: string, val: string, _ttlMs: number) => {
                if (store.has(key)) return false;
                store.set(key, val);
                return true;
            }),
            setValue: jest.fn(async (key: string, val: string, _ttlMs: number) => {
                store.set(key, val);
            }),
            deleteKey: jest.fn(async (key: string) => {
                store.delete(key);
            }),
        };
        interceptor = new IdempotencyInterceptor(
            redisSecurity as unknown as RedisSecurityService,
        );
    });

    it('passes through when X-Idempotency-Key header is missing', async () => {
        const { ctx } = buildContext({ headers: {} });
        const nextHandle = jest.fn(() => of({ ok: true }));
        const obs = await interceptor.intercept(ctx, { handle: nextHandle });
        const result = await lastValueFrom(obs);

        expect(result).toEqual({ ok: true });
        expect(nextHandle).toHaveBeenCalledTimes(1);
        expect(redisSecurity.setIfAbsent).not.toHaveBeenCalled();
    });

    it('caches completed mutation and replays cached response without re-executing handler', async () => {
        const key = 'mut-12345678-abcd';
        const handler = jest.fn(() => of({ id: 'note-1', saved: true }));

        const first = buildContext({ headers: { 'x-idempotency-key': key } });
        const obs1 = await interceptor.intercept(first.ctx, { handle: handler });
        const res1 = await lastValueFrom(obs1);

        expect(res1).toEqual({ id: 'note-1', saved: true });
        expect(handler).toHaveBeenCalledTimes(1);

        // Give microtask a tick for async tap persistence
        await Promise.resolve();

        const second = buildContext({ headers: { 'x-idempotency-key': key } });
        const obs2 = await interceptor.intercept(second.ctx, { handle: handler });
        const res2 = await lastValueFrom(obs2);

        expect(res2).toEqual({ id: 'note-1', saved: true });
        expect(handler).toHaveBeenCalledTimes(1);
        expect(second.replyHeaders['X-Idempotency-Replayed']).toBe('true');
    });

    it('throws ConflictException while matching mutation is IN_PROGRESS', async () => {
        const key = 'mut-inflight-1234';
        const cacheKey = 'idem:user-1:PUT:/api/dashboard/journal/daily/2026-11-14:mut-inflight-1234';
        store.set(
            cacheKey,
            JSON.stringify({ status: 'IN_PROGRESS', startedAt: Date.now() }),
        );

        const { ctx } = buildContext({ headers: { 'x-idempotency-key': key } });
        await expect(
            interceptor.intercept(ctx, { handle: () => of({ ok: true }) }),
        ).rejects.toThrow(ConflictException);
    });

    it('clears lock key on handler error so subsequent retries succeed', async () => {
        const key = 'mut-retry-123456';
        const first = buildContext({ headers: { 'x-idempotency-key': key } });
        const failingHandler = jest.fn(() => throwError(() => new Error('DB down')));

        const obs1 = await interceptor.intercept(first.ctx, { handle: failingHandler });
        await expect(lastValueFrom(obs1)).rejects.toThrow('DB down');
        await Promise.resolve();

        expect(redisSecurity.deleteKey).toHaveBeenCalledTimes(1);

        const second = buildContext({ headers: { 'x-idempotency-key': key } });
        const okHandler = jest.fn(() => of({ recovered: true }));
        const obs2 = await interceptor.intercept(second.ctx, { handle: okHandler });
        const res2 = await lastValueFrom(obs2);
        expect(res2).toEqual({ recovered: true });
    });
});
