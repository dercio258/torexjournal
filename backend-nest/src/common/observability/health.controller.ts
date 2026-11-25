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
        let criticalDown = false;

        // 1. PostgreSQL
        try {
            await this.dataSource.query('SELECT 1');
        } catch (err: any) {
            criticalDown = true;
            this.telemetry.recordTechnicalError({
                domain: 'SYS',
                severity: 'critical',
                statusCode: HttpStatus.SERVICE_UNAVAILABLE,
                method: 'GET',
                path: '/api/health/ready',
                exceptionName: err?.name || 'PostgresHealthError',
                errorCode: err?.code ? String(err.code) : null,
                technicalMessage: `PostgreSQL readiness check failed: ${err?.message || 'Query failed'}`,
                publicMessage: 'Service temporarily degraded',
                wasSanitized: true,
            });
        }

        // 2. Redis (via cache-manager store)
        try {
            if (this.cacheManager) {
                const probeKey = 'health:probe';
                await this.cacheManager.set(probeKey, 'ok', 5000);
                const val = await this.cacheManager.get(probeKey);
                if (val !== 'ok') criticalDown = true;
            }
        } catch (err: any) {
            criticalDown = true;
            this.telemetry.recordTechnicalError({
                domain: 'SYS',
                severity: 'critical',
                statusCode: HttpStatus.SERVICE_UNAVAILABLE,
                method: 'GET',
                path: '/api/health/ready',
                exceptionName: err?.name || 'RedisHealthError',
                errorCode: err?.code ? String(err.code) : null,
                technicalMessage: `Redis readiness check failed: ${err?.message || 'Redis unreachable'}`,
                publicMessage: 'Service temporarily degraded',
                wasSanitized: true,
            });
        }

        const httpStatus = criticalDown ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.OK;
        return reply.status(httpStatus).send({
            status: criticalDown ? 'degraded' : 'ready',
            timestamp: new Date().toISOString(),
        });
    }
}
