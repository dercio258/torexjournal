import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';

@Injectable()
export class WorkerAuthGuard implements CanActivate, OnModuleInit {
    private readonly logger = new Logger(WorkerAuthGuard.name);

    constructor(private readonly configService: ConfigService) { }

    onModuleInit() {
        const configuredKey = this.configService.get<string>('WORKER_KEY')
            || this.configService.get<string>('MT5_WORKER_KEY');
        if (!configuredKey || configuredKey === 'secret_worker_key_change_me') {
            this.logger.warn(
                'SECURITY WARNING: WORKER_KEY está usando o valor padrão! ' +
                'Defina uma WORKER_KEY forte (64 hex) em backend-nest/.env e mt5-server/.env e ative STRICT_WORKER_KEY=true.'
            );
            if (this.configService.get<string>('STRICT_WORKER_KEY') === 'true') {
                throw new Error('FATAL: WORKER_KEY segura é obrigatória quando STRICT_WORKER_KEY=true.');
            }
        }
    }

    canActivate(context: ExecutionContext): boolean {
        const req = context.switchToHttp().getRequest();
        const headers = req.headers || {};

        const workerId = headers['x-worker-id'];
        const workerKey = headers['x-worker-key'];

        const strictMode = this.configService.get<string>('STRICT_WORKER_KEY') === 'true';
        const configuredKey = this.configService.get<string>('WORKER_KEY')
            || this.configService.get<string>('MT5_WORKER_KEY');

        const expectedKey = configuredKey || (strictMode ? null : 'secret_worker_key_change_me');
        if (!expectedKey || (strictMode && expectedKey === 'secret_worker_key_change_me') || !workerKey) {
            this.logger.warn(`Tentativa de acesso não autorizada ao MT5 Worker (chave ausente/inválida). ID: ${workerId}`);
            throw new UnauthorizedException('Invalid or missing X-Worker-Key');
        }

        const bufProvided = Buffer.from(String(workerKey), 'utf8');
        const bufExpected = Buffer.from(String(expectedKey), 'utf8');

        if (bufProvided.length !== bufExpected.length || !timingSafeEqual(bufProvided, bufExpected)) {
            this.logger.warn(`Tentativa de acesso não autorizada ao MT5 Worker. ID: ${workerId}`);
            throw new UnauthorizedException('Invalid or missing X-Worker-Key');
        }

        req.workerId = workerId || 'unknown-worker';
        return true;
    }
}
