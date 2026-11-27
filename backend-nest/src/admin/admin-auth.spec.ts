jest.mock('../users/users.service', () => ({ UsersService: class {} }));
jest.mock('../payment/subscription.service', () => ({ SubscriptionService: class {} }));
jest.mock('./admin-intelligence.service', () => ({ AdminIntelligenceService: class {} }));
jest.mock('../network/video-lesson.service', () => ({ NetworkAcademyService: class {} }));
jest.mock('../mt5/worker/mt5-worker.service', () => ({ Mt5WorkerService: class {} }));
jest.mock('../mt5/worker/mt5-cluster-balancer.service', () => ({ Mt5ClusterBalancerService: class {} }));
jest.mock('../economic-calendar/economic-calendar.service', () => ({ EconomicCalendarService: class {} }));
jest.mock('../ai/ai-training-report.service', () => ({ AiTrainingReportService: class {} }));
jest.mock('../ai/ai-semantic-memory.service', () => ({ AiSemanticMemoryService: class {} }));
jest.mock('../ai/ai-feedback-signals.service', () => ({ AiFeedbackSignalsService: class {} }));
jest.mock('../email/email-producer.service', () => ({ EmailProducerService: class {} }));
jest.mock('../email/email.service', () => ({ EmailService: class {} }));
jest.mock('../common/observability/telemetry.service', () => ({ TelemetryService: class {} }));
jest.mock('./admin-audit.service', () => ({ AdminAuditService: class {} }));
jest.mock('ioredis', () => ({ __esModule: true, default: jest.fn() }));

import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AdminController } from './admin.controller';
import { AdminAuthGuard } from './admin-auth.guard';
import { RedisSecurityService } from '../common/security/redis-security.service';
import { TurnstileService } from '../common/security/turnstile.service';

function makeConfig(values: Record<string, string | undefined>): ConfigService {
    return {
        get: (key: string) => values[key],
    } as unknown as ConfigService;
}

describe('Admin Authentication Flow', () => {
    it('accepts valid admin credentials even when ADMIN_PASS in .env has CRLF/quotes, falls back to direct SMTP, verifies OTP, and passes AdminAuthGuard', async () => {
        const configService = makeConfig({
            NODE_ENV: 'test',
            JWT_SECRET: 'user_jwt_secret_for_admin_test_32_chars',
            ADMIN_JWT_SECRET: 'admin_jwt_secret_distinct_from_user_32_chars',
            ADMIN_EMAIL: '  Admin@TorexJournal.com\r',
            ADMIN_PASS: '"SuperAdmin!2026"\r',
            // Misconfigured Turnstile: secret set without site key must not lock out admin login
            TURNSTILE_SECRET_KEY: 'secret-without-site-key',
        });

        const redisSecurity = new RedisSecurityService(makeConfig({}));
        const jwtService = new JwtService({});
        const turnstileService = new TurnstileService(configService, redisSecurity);

        const emailProducer: any = {
            enqueue: jest.fn().mockResolvedValue(false), // simulate Bull queue timeout
        };
        const emailService: any = {
            sendTemplatedEmail: jest.fn().mockResolvedValue(true),
        };

        const controller = new AdminController(
            configService,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            jwtService,
            emailProducer,
            {} as any,
            redisSecurity,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            turnstileService,
            emailService,
        );

        const loginRes = await controller.login(
            {
                email: 'admin@torexjournal.com',
                pass: 'SuperAdmin!2026',
                date: '27/11/2026',
            },
            { ip: '127.0.0.1', headers: {} },
        );

        expect(loginRes.success).toBe(true);
        expect(loginRes.otpRequired).toBe(true);
        expect(emailProducer.enqueue).toHaveBeenCalledTimes(1);
        expect(emailService.sendTemplatedEmail).toHaveBeenCalledTimes(1);

        const sentOtp = emailService.sendTemplatedEmail.mock.calls[0][2].otp;
        expect(sentOtp).toMatch(/^\d{6}$/);

        const headers: Record<string, any> = {};
        const mockReply: any = {
            getHeader: (k: string) => headers[k.toLowerCase()],
            header: (k: string, v: any) => {
                headers[k.toLowerCase()] = v;
            },
        };

        const verifyRes = await controller.verifyOtp(
            { email: 'admin@torexjournal.com', otp: sentOtp },
            { ip: '127.0.0.1', protocol: 'https', headers: {} },
            mockReply,
        );

        expect(verifyRes.success).toBe(true);
        expect(typeof verifyRes.token).toBe('string');

        const guard = new AdminAuthGuard(jwtService, configService, redisSecurity);
        const req: any = {
            ip: '127.0.0.1',
            headers: { authorization: `Bearer ${verifyRes.token}` },
        };
        const ctx: any = {
            switchToHttp: () => ({ getRequest: () => req }),
        };

        await expect(guard.canActivate(ctx)).resolves.toBe(true);
        expect(req.admin?.role).toBe('admin');
        expect(req.admin?.email).toBe('admin@torexjournal.com');
    });

    it('rejects wrong password and tracks failed attempts', async () => {
        const configService = makeConfig({
            NODE_ENV: 'test',
            ADMIN_EMAIL: 'admin@torexjournal.com',
            ADMIN_PASS: 'CorrectPass!2026',
        });
        const redisSecurity = new RedisSecurityService(makeConfig({}));
        const controller = new AdminController(
            configService,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            new JwtService({}),
            { enqueue: jest.fn().mockResolvedValue(true) } as any,
            {} as any,
            redisSecurity,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
        );

        await expect(
            controller.login(
                { email: 'admin@torexjournal.com', pass: 'WrongPass' },
                { ip: '127.0.0.1', headers: {} },
            ),
        ).rejects.toThrow(UnauthorizedException);
    });
});
