import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLogEntity } from './audit-log.entity';

@Injectable()
export class AuditLogService {
    constructor(
        @InjectRepository(AuditLogEntity)
        private auditLogRepository: Repository<AuditLogEntity>,
    ) {}

    async log(userId: string | null, action: string, metadata: any = {}, ip?: string, userAgent?: string) {
        const log = this.auditLogRepository.create({
            userId,
            action,
            metadata,
            ip,
            userAgent,
        });
        return this.auditLogRepository.save(log);
    }
}
