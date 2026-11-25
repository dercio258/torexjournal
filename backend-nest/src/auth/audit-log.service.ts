import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLogEntity } from './audit-log.entity';

const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class AuditLogService {
    private readonly logger = new Logger(AuditLogService.name);

    constructor(
        @InjectRepository(AuditLogEntity)
        private auditLogRepository: Repository<AuditLogEntity>,
    ) {}

    async log(
        userId: string | null | undefined,
        action: string,
        metadata: Record<string, any> = {},
        ip?: string,
        userAgent?: string,
    ) {
        const trimmedUserId = typeof userId === 'string' ? userId.trim() : '';
        const safeUserId =
            trimmedUserId && UUID_REGEX.test(trimmedUserId)
                ? trimmedUserId
                : null;

        const safeMetadata: Record<string, any> =
            metadata && typeof metadata === 'object' ? { ...metadata } : {};
        if (trimmedUserId && !safeUserId && !safeMetadata.actorIdentifier) {
            safeMetadata.actorIdentifier = trimmedUserId;
        }

        try {
            const log = this.auditLogRepository.create({
                userId: safeUserId,
                action,
                metadata: safeMetadata,
                ip,
                userAgent,
            });
            return await this.auditLogRepository.save(log);
        } catch (err: any) {
            this.logger.warn(
                `Falha ao persistir audit log (${action}): ${err?.message || err}`,
            );
            return null;
        }
    }
}
