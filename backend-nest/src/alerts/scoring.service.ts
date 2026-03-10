import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { AlertEntity, AlertSeverity } from './alert.entity';

@Injectable()
export class ScoringService {
    private readonly logger = new Logger(ScoringService.name);

    constructor(
        @InjectRepository(AlertEntity)
        private alertRepo: Repository<AlertEntity>,
    ) { }

    async calculateHealthScore(userId: string): Promise<{ score: number; details: any }> {
        // Calculate score based on alerts from the last 7 days
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const alerts = await this.alertRepo.find({
            where: {
                userId,
                createdAt: Between(sevenDaysAgo, new Date()),
                resolved: false // Only unresolved alerts penalize the current "live" score? 
                // Actually, professional scores usually look at total discipline. 
                // Let's count all alerts in the window, but resolved ones might have less weight?
                // For now, let's penalize all alerts in the window to encourage discipline.
            }
        });

        let score = 100;
        const penalties = {
            critical: 0,
            warning: 0,
            info: 0
        };

        alerts.forEach(alert => {
            if (alert.severity === AlertSeverity.CRITICAL) {
                score -= 15;
                penalties.critical++;
            } else if (alert.severity === AlertSeverity.WARNING) {
                score -= 5;
                penalties.warning++;
            } else {
                score -= 2;
                penalties.info++;
            }
        });

        // Clamp score between 0 and 100
        score = Math.max(0, Math.min(100, score));

        return {
            score,
            details: {
                totalAlerts: alerts.length,
                penalties,
                period: 'últimos 7 dias'
            }
        };
    }
}
