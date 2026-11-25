import { AuditLogService } from './audit-log.service';

describe('AuditLogService', () => {
    const createMockRepo = () => ({
        create: jest.fn((payload) => payload),
        save: jest.fn(async (entity) => ({ id: 'log-1', ...entity })),
    });

    it('preserves valid UUID userId without modifying metadata', async () => {
        const repo = createMockRepo();
        const service = new AuditLogService(repo as any);
        const validUuid = '50f4649c-5380-4e2b-b2eb-b62feeb37466';

        const saved = await service.log(
            validUuid,
            'LOGIN_SUCCESS',
            { ip: '127.0.0.1' },
            '127.0.0.1',
            'Mozilla/5.0',
        );

        expect(repo.create).toHaveBeenCalledWith({
            userId: validUuid,
            action: 'LOGIN_SUCCESS',
            metadata: { ip: '127.0.0.1' },
            ip: '127.0.0.1',
            userAgent: 'Mozilla/5.0',
        });
        expect(saved?.userId).toBe(validUuid);
    });

    it('normalizes non-UUID userId (such as an email) to null and stores actorIdentifier in metadata', async () => {
        const repo = createMockRepo();
        const service = new AuditLogService(repo as any);

        const saved = await service.log(
            'proprioff7@gmail.com',
            'REGISTRATION_INITIATED',
            { email: 'proprioff7@gmail.com' },
            '10.0.0.1',
            'Chrome',
        );

        expect(repo.create).toHaveBeenCalledWith({
            userId: null,
            action: 'REGISTRATION_INITIATED',
            metadata: {
                email: 'proprioff7@gmail.com',
                actorIdentifier: 'proprioff7@gmail.com',
            },
            ip: '10.0.0.1',
            userAgent: 'Chrome',
        });
        expect(saved?.userId).toBeNull();
    });

    it('accepts null userId cleanly', async () => {
        const repo = createMockRepo();
        const service = new AuditLogService(repo as any);

        const saved = await service.log(
            null,
            'REGISTRATION_INITIATED',
            { email: 'proprioff7@gmail.com' },
        );

        expect(repo.create).toHaveBeenCalledWith({
            userId: null,
            action: 'REGISTRATION_INITIATED',
            metadata: { email: 'proprioff7@gmail.com' },
            ip: undefined,
            userAgent: undefined,
        });
        expect(saved?.userId).toBeNull();
    });

    it('does not throw when persistence fails', async () => {
        const repo = createMockRepo();
        repo.save.mockRejectedValueOnce(new Error('DB connection lost'));
        const service = new AuditLogService(repo as any);

        await expect(
            service.log(null, 'REGISTRATION_INITIATED', { email: 'test@example.com' }),
        ).resolves.toBeNull();
    });
});
