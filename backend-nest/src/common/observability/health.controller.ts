import { Controller, Get, HttpStatus, Inject, Optional, Res } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { FastifyReply } from 'fastify';
import { TelemetryService } from './telemetry.service';

@Controller('health')
export class HealthController {
    constructor(
        private readonly dataSource: DataSource,
        private readonly configService: ConfigService,
        private readonly telemetry: TelemetryService,
        @Optional() @Inject(CACHE_MANAGER) private readonly cacheManager?: any,
    ) {}

    @Get()
    liveness() {
        const snap = this.telemetry.getSnapshot();
        return {
            status: 'ok',
            service:
                process.env.MT5_DEDICATED_SERVER === 'true'
                    ? 'torex-mt5-dedicated'
                    : 'torex-backend',
            uptimeSeconds: snap.uptimeSeconds,
            timestamp: snap.timestamp,
        };
    }

    @Get('ready')
    async readiness(@Res() reply: FastifyReply) {
        const checks: Record<string, { status: 'up' | 'down' | 'unconfigured'; latencyMs?: number; detail?: string }> = {};
        let criticalDown = false;

        // 1. PostgreSQL
        const pgStart = Date.now();
        try {
            await this.dataSource.query('SELECT 1');
            checks.postgres = { status: 'up', latencyMs: Date.now() - pgStart };
        } catch (err: any) {
            criticalDown = true;
            checks.postgres = {
                status: 'down',
                latencyMs: Date.now() - pgStart,
                detail: err?.message || 'Query failed',
            };
        }

        // 2. Redis (via cache-manager store)
        const redisStart = Date.now();
        try {
            if (this.cacheManager) {
                const probeKey = 'health:probe';
                await this.cacheManager.set(probeKey, 'ok', 5000);
                const val = await this.cacheManager.get(probeKey);
                checks.redis = {
                    status: val === 'ok' ? 'up' : 'down',
                    latencyMs: Date.now() - redisStart,
                };
                if (val !== 'ok') criticalDown = true;
            } else {
                checks.redis = { status: 'unconfigured' };
            }
        } catch (err: any) {
            criticalDown = true;
            checks.redis = {
                status: 'down',
                latencyMs: Date.now() - redisStart,
                detail: err?.message || 'Redis unreachable',
            };
        }

        // 3. SMTP configuration check
        const smtpUser =
            this.configService.get<string>('MAIL_USER') ||
            this.configService.get<string>('Email_notification');
        const smtpPass =
            this.configService.get<string>('MAIL_PASS') ||
            this.configService.get<string>('Email_notification_pass');
        checks.smtp = {
            status: smtpUser && smtpPass ? 'up' : 'unconfigured',
            detail: smtpUser && smtpPass ? 'Configured' : 'Running in mock mode',
        };

        const httpStatus = criticalDown ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.OK;
        return reply.status(httpStatus).send({
            status: criticalDown ? 'degraded' : 'ready',
            timestamp: new Date().toISOString(),
            checks,
        });
    }
}
