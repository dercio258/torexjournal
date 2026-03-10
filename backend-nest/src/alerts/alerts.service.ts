import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AlertEntity, AlertType, AlertSeverity } from './alert.entity';

@Injectable()
export class AlertsService {
    constructor(
        @InjectRepository(AlertEntity)
        private alertRepo: Repository<AlertEntity>,
    ) { }

    async findAll(userId: string) {
        return this.alertRepo.find({
            where: { userId, resolved: false },
            order: { createdAt: 'DESC' },
        });
    }

    async create(userId: string, data: {
        type: AlertType;
        severity: AlertSeverity;
        title: string;
        description: string;
        tradeId?: string;
        metadata?: any;
    }) {
        const alert = this.alertRepo.create({
            userId,
            ...data
        });
        return this.alertRepo.save(alert);
    }

    async resolve(id: string, userId: string) {
        const alert = await this.alertRepo.findOne({ where: { id, userId } });
        if (!alert) throw new NotFoundException('Alert not found');

        alert.resolved = true;
        return this.alertRepo.save(alert);
    }

    async getStats(userId: string) {
        const alerts = await this.alertRepo.find({ where: { userId } });
        // Simple scoring / summary logic
        const counts = {
            [AlertType.RISK]: 0,
            [AlertType.DISCIPLINE]: 0,
            [AlertType.PSYCHOLOGY]: 0,
            [AlertSeverity.CRITICAL]: 0,
        };

        alerts.forEach(a => {
            if (counts[a.type] !== undefined) counts[a.type]++;
            if (a.severity === AlertSeverity.CRITICAL) counts[AlertSeverity.CRITICAL]++;
        });

        return {
            total: alerts.length,
            counts,
            unresolved: alerts.filter(a => !a.resolved).length
        };
    }
}
