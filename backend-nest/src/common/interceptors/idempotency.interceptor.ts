import {
    CallHandler,
    ConflictException,
    ExecutionContext,
    Injectable,
    Logger,
    NestInterceptor,
} from '@nestjs/common';
import { Observable, of, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { RedisSecurityService } from '../security/redis-security.service';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const VALID_IDEMPOTENCY_KEY_RE = /^[a-zA-Z0-9_.:-]{8,128}$/;
const IN_PROGRESS_TTL_MS = 30_000;
const COMPLETED_TTL_MS = 86_400_000; // 24 hours

interface CachedIdempotencyRecord {
    status: 'IN_PROGRESS' | 'COMPLETED';
    startedAt?: number;
    statusCode?: number;
    body?: any;
}

/**
 * Global HTTP idempotency interceptor backed by RedisSecurityService (with memory fallback).
 * Deduplicates retried offline-sync mutations carrying X-Idempotency-Key.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
    private readonly logger = new Logger(IdempotencyInterceptor.name);

    constructor(private readonly redisSecurity: RedisSecurityService) {}

    async intercept(
        context: ExecutionContext,
        next: CallHandler,
    ): Promise<Observable<any>> {
        if (context.getType() !== 'http') {
            return next.handle();
        }

        const http = context.switchToHttp();
        const req = http.getRequest<any>();
        const reply = http.getResponse<any>();

        const method = String(req?.method || '').toUpperCase();
        if (!MUTATING_METHODS.has(method)) {
            return next.handle();
        }

        const contentType = String(req?.headers?.['content-type'] || '').toLowerCase();
        if (contentType.includes('multipart/form-data')) {
            return next.handle();
        }

        const rawHeader = req?.headers?.['x-idempotency-key'];
        const rawKey = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
        if (!rawKey || typeof rawKey !== 'string') {
            return next.handle();
        }

        const idemKey = rawKey.trim();
        if (!VALID_IDEMPOTENCY_KEY_RE.test(idemKey)) {
            return next.handle();
        }

        const userScope = String(req?.user?.id || req?.user?.userId || 'anon');
        const cleanPath = String(req?.url || '/').split('?')[0];
        const cacheKey = `idem:${userScope}:${method}:${cleanPath}:${idemKey}`;

        const existingRaw = await this.redisSecurity.getValue(cacheKey);
        if (existingRaw) {
            try {
                const parsed = JSON.parse(existingRaw) as CachedIdempotencyRecord;
                if (parsed.status === 'COMPLETED') {
                    if (reply && typeof reply.header === 'function') {
                        reply.header('X-Idempotency-Replayed', 'true');
                    }
                    if (parsed.statusCode && reply && typeof reply.code === 'function') {
                        reply.code(parsed.statusCode);
                    }
                    return of(parsed.body ?? null);
                }
                if (parsed.status === 'IN_PROGRESS') {
                    throw new ConflictException(
                        'Mutação idempotente já em processamento.',
                    );
                }
            } catch (err) {
                if (err instanceof ConflictException) {
                    throw err;
                }
                this.logger.warn(
                    `Invalid idempotency cache entry for ${cacheKey}: ${(err as Error).message}`,
                );
            }
        }

        const lockAcquired = await this.redisSecurity.setIfAbsent(
            cacheKey,
            JSON.stringify({
                status: 'IN_PROGRESS',
                startedAt: Date.now(),
            } satisfies CachedIdempotencyRecord),
            IN_PROGRESS_TTL_MS,
        );

        if (!lockAcquired) {
            const raceRaw = await this.redisSecurity.getValue(cacheKey);
            if (raceRaw) {
                try {
                    const parsed = JSON.parse(raceRaw) as CachedIdempotencyRecord;
                    if (parsed.status === 'COMPLETED') {
                        if (reply && typeof reply.header === 'function') {
                            reply.header('X-Idempotency-Replayed', 'true');
                        }
                        if (parsed.statusCode && reply && typeof reply.code === 'function') {
                            reply.code(parsed.statusCode);
                        }
                        return of(parsed.body ?? null);
                    }
                } catch {
                    // Fall through to conflict exception
                }
            }
            throw new ConflictException('Mutação idempotente já em processamento.');
        }

        return next.handle().pipe(
            tap((data) => {
                const statusCode = Number(reply?.statusCode) || 200;
                const record: CachedIdempotencyRecord = {
                    status: 'COMPLETED',
                    statusCode,
                    body: data ?? null,
                };
                void this.redisSecurity
                    .setValue(cacheKey, JSON.stringify(record), COMPLETED_TTL_MS)
                    .catch((err) => {
                        this.logger.warn(
                            `Failed to persist idempotency response for ${cacheKey}: ${(err as Error).message}`,
                        );
                    });
            }),
            catchError((err) => {
                void this.redisSecurity.deleteKey(cacheKey).catch(() => undefined);
                return throwError(() => err);
            }),
        );
    }
}
