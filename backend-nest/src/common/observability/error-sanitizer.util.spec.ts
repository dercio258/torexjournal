import { BadRequestException, HttpStatus } from '@nestjs/common';
import { GenericExceptionFilter } from '../filters/generic-exception.filter';
import { TelemetryService } from './telemetry.service';
import {
    SUPPORT_EMAIL,
    buildErrorReference,
    containsTechnicalLeak,
    redactSensitiveMetadata,
    sanitizePublicErrorResponse,
} from './error-sanitizer.util';

describe('error-sanitizer.util', () => {
    it('builds structured domain-scoped error references from correlationId', () => {
        expect(buildErrorReference('/api/auth/register/initiate', '9f7d6b81')).toBe(
            'TRX-REG-9F7D6B81',
        );
        expect(buildErrorReference('/api/subscription/subscribe/mpesa', 'a1b2c3d4')).toBe(
            'TRX-PAY-A1B2C3D4',
        );
        expect(buildErrorReference('/api/import/report', 'deadbeef')).toBe(
            'TRX-IMP-DEADBEEF',
        );
        expect(buildErrorReference('/api/tradingview/candles', '12345678')).toBe(
            'TRX-MKT-12345678',
        );
    });

    it('detects technical database, infra, provider, and validation jargon leaks', () => {
        expect(
            containsTechnicalLeak(
                'QueryFailedError: invalid input syntax for type uuid: "proprioff7@gmail.com"',
            ),
        ).toBe(true);
        expect(
            containsTechnicalLeak('Feed TradingView indisponível: ECONNREFUSED 127.0.0.1:443'),
        ).toBe(true);
        expect(
            containsTechnicalLeak('Multipart parsing failed: Unexpected end of form'),
        ).toBe(true);
        expect(
            containsTechnicalLeak('property isAdmin should not exist'),
        ).toBe(true);
        expect(
            containsTechnicalLeak('Falha no Gemini Analyst (HTTP 404: models/gemini-2.5-flash-lite)'),
        ).toBe(true);
    });

    it('sanitizes 5xx errors into non-technical support messages with reference and support email', () => {
        const res = sanitizePublicErrorResponse({
            status: HttpStatus.INTERNAL_SERVER_ERROR,
            rawMessage: 'QueryFailedError: invalid input syntax for type uuid: "user@test.com"',
            path: '/api/auth/register/initiate',
            correlationId: '9f7d6b81',
        });

        expect(res.wasSanitized).toBe(true);
        expect(res.errorRef).toBe('TRX-REG-9F7D6B81');
        expect(res.publicMessage).toContain(SUPPORT_EMAIL);
        expect(res.publicMessage).toContain('TRX-REG-9F7D6B81');
        expect(res.publicMessage).not.toMatch(/uuid|QueryFailedError|postgres/i);
    });

    it('sanitizes 4xx responses that accidentally contain technical leaks', () => {
        const res = sanitizePublicErrorResponse({
            status: HttpStatus.BAD_REQUEST,
            rawMessage: 'Failed to parse MT5 CSV: Cannot read properties of undefined (reading split)',
            path: '/api/market-data/upload-mt5',
            correlationId: 'abcd1234',
        });

        expect(res.wasSanitized).toBe(true);
        expect(res.errorRef).toBe('TRX-IMP-ABCD1234');
        expect(res.publicMessage).toContain(SUPPORT_EMAIL);
        expect(res.publicMessage).not.toContain('Cannot read properties');
    });

    it('preserves clean, intentional user-facing 4xx validation messages while attaching errorRef', () => {
        const res = sanitizePublicErrorResponse({
            status: HttpStatus.BAD_REQUEST,
            rawMessage: 'A senha deve incluir pelo menos uma letra maiúscula (A-Z).',
            path: '/api/auth/register/initiate',
            correlationId: '11223344',
        });

        expect(res.wasSanitized).toBe(false);
        expect(res.errorRef).toBe('TRX-REG-11223344');
        expect(res.publicMessage).toBe(
            'A senha deve incluir pelo menos uma letra maiúscula (A-Z).',
        );
    });

    it('redacts JWTs and password/secret parameters before storing admin technical diagnostics', () => {
        const cleaned = redactSensitiveMetadata(
            'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123def456 password=MySecret99!',
        );
        expect(cleaned).not.toContain('eyJhbGciOiJIUzI1NiJ9');
        expect(cleaned).not.toContain('MySecret99!');
        expect(cleaned).toContain('[REDACTED_JWT]');
        expect(cleaned).toContain('[REDACTED]');
    });

    describe('GenericExceptionFilter + TelemetryService end-to-end sanitization', () => {
        const makeHost = (url: string, method = 'POST', cid = '9f7d6b81') => {
            const headers: Record<string, string> = {};
            let sentStatus = 0;
            let sentBody: any = null;
            const reply = {
                header: jest.fn((k: string, v: string) => {
                    headers[k.toLowerCase()] = v;
                    return reply;
                }),
                status: jest.fn((code: number) => {
                    sentStatus = code;
                    return reply;
                }),
                send: jest.fn((body: any) => {
                    sentBody = body;
                    return reply;
                }),
            };
            const request = {
                method,
                url,
                raw: { url },
                headers: { 'x-correlation-id': cid },
                user: { id: 'user-123' },
            };
            const host: any = {
                switchToHttp: () => ({
                    getResponse: () => reply,
                    getRequest: () => request,
                }),
            };
            return { host, getResult: () => ({ status: sentStatus, body: sentBody, headers }) };
        };

        it('hides Postgres QueryFailedError from user, emits TRX-REG reference, and stores technical details for Admin', async () => {
            const telemetry = new TelemetryService();
            const filter = new GenericExceptionFilter(telemetry);
            const { host, getResult } = makeHost('/api/auth/register/initiate', 'POST', '9f7d6b81');

            const pgErr: any = new Error('invalid input syntax for type uuid: "proprioff7@gmail.com"');
            pgErr.name = 'QueryFailedError';
            pgErr.code = '22P02';

            filter.catch(pgErr, host);
            const { status, body, headers } = getResult();

            expect(status).toBe(500);
            expect(headers['x-error-ref']).toBe('TRX-REG-9F7D6B81');
            expect(body.errorRef).toBe('TRX-REG-9F7D6B81');
            expect(body.supportEmail).toBe(SUPPORT_EMAIL);
            expect(body.message).toContain(SUPPORT_EMAIL);
            expect(body.message).toContain('TRX-REG-9F7D6B81');
            expect(body.message).not.toMatch(/QueryFailedError|uuid|22P02|proprioff7/i);

            const adminList = await telemetry.listTechnicalErrors({ search: 'TRX-REG-9F7D6B81' });
            expect(adminList.items).toHaveLength(1);
            expect(adminList.items[0].exceptionName).toBe('QueryFailedError');
            expect(adminList.items[0].errorCode).toBe('22P02');
            expect(adminList.items[0].technicalMessage).toContain('invalid input syntax for type uuid');
            expect(adminList.items[0].wasSanitized).toBe(true);
            expect(adminList.items[0].publicMessage).toBe(body.message);
        });

        it('sanitizes technical 400 exceptions while keeping technical cause in Admin telemetry', async () => {
            const telemetry = new TelemetryService();
            const filter = new GenericExceptionFilter(telemetry);
            const { host, getResult } = makeHost('/api/import/report', 'POST', 'abcd5678');

            const leaked400 = new BadRequestException(
                'Failed to parse XML: Cannot read properties of undefined',
            );

            filter.catch(leaked400, host);
            const { status, body } = getResult();

            expect(status).toBe(400);
            expect(body.errorRef).toBe('TRX-IMP-ABCD5678');
            expect(body.message).toContain(SUPPORT_EMAIL);
            expect(body.message).not.toContain('Cannot read properties');

            const adminList = await telemetry.listTechnicalErrors({ domain: 'IMP' });
            expect(adminList.items[0].severity).toBe('error');
            expect(adminList.items[0].technicalMessage).toContain('Failed to parse XML');
        });
    });
});
