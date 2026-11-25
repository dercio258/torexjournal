import {
    CanActivate,
    ExecutionContext,
    Injectable,
    UnauthorizedException,
    Logger,
    OnModuleInit,
    Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { RedisSecurityService } from '../../common/security/redis-security.service';

const WORKER_HMAC_MAX_SKEW_MS = 5 * 60 * 1000; // +/- 5 minutes
const WORKER_NONCE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export function computeWorkerRequestHmac(
    secret: string,
    method: string,
    path: string,
    timestamp: string,
    nonce: string,
    rawBody: Buffer | string,
): string {
    const bodyHash = createHash('sha256')
        .update(typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody || Buffer.alloc(0))
        .digest('hex');
    const canonical = [
        String(method || 'GET').toUpperCase(),
        String(path || '/').split('?')[0],
        String(timestamp || '').trim(),
        String(nonce || '').trim(),
        bodyHash,
    ].join('\n');
    return createHmac('sha256', secret).update(canonical, 'utf8').digest('hex');
}

function safeEqualUtf8(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

@Injectable()
export class WorkerAuthGuard implements CanActivate, OnModuleInit {
    private readonly logger = new Logger(WorkerAuthGuard.name);

    constructor(
        private readonly configService: ConfigService,
        @Optional() private readonly redisSecurity?: RedisSecurityService,
    ) {}

    private isStrictMode(): boolean {
        return (
            this.configService.get<string>('NODE_ENV') === 'production' ||
            this.configService.get<string>('STRICT_WORKER_KEY') === 'true'
        );
    }

    private isStrictHmacRequired(): boolean {
        return this.configService.get<string>('STRICT_WORKER_HMAC') === 'true';
    }

    private getAcceptedKeys(): string[] {
        const strictMode = this.isStrictMode();
        const primary = (
            this.configService.get<string>('WORKER_KEY') ||
            this.configService.get<string>('MT5_WORKER_KEY') ||
            ''
        ).trim();
        const previous = (
            this.configService.get<string>('WORKER_KEY_PREVIOUS') ||
            this.configService.get<string>('MT5_WORKER_KEY_PREVIOUS') ||
            ''
        ).trim();

        const keys: string[] = [];
        if (primary && (!strictMode || primary !== 'secret_worker_key_change_me')) {
            keys.push(primary);
        } else if (!strictMode && !primary) {
            keys.push('secret_worker_key_change_me');
        }
        if (previous && previous !== 'secret_worker_key_change_me' && !keys.includes(previous)) {
            keys.push(previous);
        }
        return keys;
    }

    onModuleInit() {
        const strictMode = this.isStrictMode();
        const configuredKey =
            this.configService.get<string>('WORKER_KEY') ||
            this.configService.get<string>('MT5_WORKER_KEY');
        if (!configuredKey || configuredKey === 'secret_worker_key_change_me') {
            this.logger.warn(
                'SECURITY WARNING: WORKER_KEY está usando o valor padrão ou está ausente! ' +
                    'Defina uma WORKER_KEY forte (64 hex) em backend-nest/.env e mt5-server/.env.',
            );
            if (strictMode) {
                throw new Error(
                    'FATAL: WORKER_KEY segura é obrigatória em produção ou quando STRICT_WORKER_KEY=true.',
                );
            }
        }
    }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const req = context.switchToHttp().getRequest();
        const headers = req.headers || {};

        const workerId = String(headers['x-worker-id'] || 'unknown-worker').trim().slice(0, 120);
        const workerKey = headers['x-worker-key'] ? String(headers['x-worker-key']).trim() : '';
        const acceptedKeys = this.getAcceptedKeys();

        if (acceptedKeys.length === 0 || !workerKey) {
            this.logger.warn(
                `Tentativa de acesso não autorizada ao MT5 Worker (chave ausente/inválida). ID: ${workerId}`,
            );
            throw new UnauthorizedException('Invalid or missing X-Worker-Key');
        }

        const matchedKey = acceptedKeys.find((expected) => safeEqualUtf8(workerKey, expected));
        if (!matchedKey) {
            this.logger.warn(`Tentativa de acesso não autorizada ao MT5 Worker. ID: ${workerId}`);
            throw new UnauthorizedException('Invalid or missing X-Worker-Key');
        }

        // Per-request HMAC-SHA256 verification (mandatory when STRICT_WORKER_HMAC=true or whenever signature headers are sent)
        const sigHeader = headers['x-worker-signature']
            ? String(headers['x-worker-signature']).trim()
            : '';
        const tsHeader = headers['x-worker-timestamp']
            ? String(headers['x-worker-timestamp']).trim()
            : '';
        const nonceHeader = headers['x-worker-nonce']
            ? String(headers['x-worker-nonce']).trim()
            : '';

        if (sigHeader || this.isStrictHmacRequired()) {
            if (!sigHeader || !tsHeader || !nonceHeader) {
                this.logger.warn(`Worker HMAC incompleto rejeitado. ID: ${workerId}`);
                throw new UnauthorizedException('Missing worker HMAC headers');
            }

            const tsNum = /^\d{10}$/.test(tsHeader)
                ? Number(tsHeader) * 1000
                : /^\d{13}$/.test(tsHeader)
                  ? Number(tsHeader)
                  : NaN;
            if (!Number.isFinite(tsNum) || Math.abs(Date.now() - tsNum) > WORKER_HMAC_MAX_SKEW_MS) {
                this.logger.warn(`Worker HMAC timestamp expirado/inválido. ID: ${workerId}`);
                throw new UnauthorizedException('Expired worker request timestamp');
            }

            const rawBody: Buffer | string =
                req.rawBody !== undefined
                    ? req.rawBody
                    : req.body && Object.keys(req.body).length > 0
                      ? JSON.stringify(req.body)
                      : '';
            const reqPath = (req.raw?.url || req.url || '/').split('?')[0];
            const expectedSig = computeWorkerRequestHmac(
                matchedKey,
                req.method || 'GET',
                reqPath,
                tsHeader,
                nonceHeader,
                rawBody,
            );
            const normalizedSig = sigHeader.replace(/^sha256=/i, '');
            if (!safeEqualUtf8(normalizedSig, expectedSig)) {
                this.logger.warn(`Assinatura HMAC do Worker inválida. ID: ${workerId}`);
                throw new UnauthorizedException('Invalid worker HMAC signature');
            }

            if (this.redisSecurity) {
                const nonceKey = `worker_nonce:${workerId}:${nonceHeader.slice(0, 64)}`;
                const fresh = await this.redisSecurity.setIfAbsent(
                    nonceKey,
                    '1',
                    WORKER_NONCE_TTL_MS,
                );
                if (!fresh) {
                    this.logger.warn(`Replay de nonce do Worker bloqueado. ID: ${workerId}`);
                    throw new UnauthorizedException('Replayed worker request nonce');
                }
            }
        }

        req.workerId = workerId;
        return true;
    }
}
