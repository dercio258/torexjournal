import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class WorkerAuthGuard implements CanActivate, OnModuleInit {
    private readonly logger = new Logger(WorkerAuthGuard.name);

    constructor(private readonly configService: ConfigService) { }

    onModuleInit() {
        const configuredKey = this.configService.get<string>('WORKER_KEY')
            || this.configService.get<string>('MT5_WORKER_KEY');
        if (!configuredKey || configuredKey === 'secret_worker_key_change_me') {
            this.logger.warn(
                'SECURITY WARNING: WORKER_KEY não está definida com um segredo forte no .env! ' +
                'Defina WORKER_KEY no backend-nest/.env e no mt5-server/.env.'
            );
            if (this.configService.get<string>('STRICT_WORKER_KEY') === 'true') {
                throw new Error('FATAL: WORKER_KEY deve estar configurada quando STRICT_WORKER_KEY=true.');
            }
        }
    }

    canActivate(context: ExecutionContext): boolean {
        const req = context.switchToHttp().getRequest();
        const headers = req.headers || {};

        const workerId = headers['x-worker-id'];
        const workerKey = headers['x-worker-key'];

        const configuredKey = this.configService.get<string>('WORKER_KEY')
            || this.configService.get<string>('MT5_WORKER_KEY');

        const expectedKey = configuredKey || (
            this.configService.get<string>('STRICT_WORKER_KEY') === 'true'
                ? null
                : 'secret_worker_key_change_me'
        );

        if (!expectedKey || !workerKey || workerKey !== expectedKey) {
            this.logger.warn(`Tentativa de acesso não autorizada ao MT5 Worker. ID: ${workerId}`);
            throw new UnauthorizedException('Invalid or missing X-Worker-Key');
        }

        req.workerId = workerId || 'unknown-worker';
        return true;
    }
}
