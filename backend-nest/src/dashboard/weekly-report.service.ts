import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountEntity } from '../account/account.entity';
import { EmailProducerService } from '../email/email-producer.service';
import { EmailTemplatePayloadMap } from '../email/templates';
import { UserEntity } from '../users/user.entity';
import { DashboardService } from './dashboard.service';

@Injectable()
export class WeeklyReportService {
    private readonly logger = new Logger(WeeklyReportService.name);

    constructor(
        @InjectRepository(UserEntity)
        private readonly userRepo: Repository<UserEntity>,
        @InjectRepository(AccountEntity)
        private readonly accountRepo: Repository<AccountEntity>,
        private readonly dashboardService: DashboardService,
        private readonly emailProducer: EmailProducerService,
    ) {}

    @Cron('0 9 * * 0') // Sunday at 09:00 AM
    async handleWeeklyReport() {
        if (process.env.MT5_DEDICATED_SERVER === 'true') return;
        this.logger.log('Preparing weekly performance reports for Redis dispatch...');

        const users = await this.userRepo.find();
        const weekKey = new Date().toISOString().slice(0, 10);
        const batch: Array<{
            to: string;
            template: 'WEEKLY_SUMMARY';
            data: EmailTemplatePayloadMap['WEEKLY_SUMMARY'];
            jobId: string;
        }> = [];

        for (const user of users) {
            if (!user.email) continue;

            try {
                const summary = await this.dashboardService.getWeeklySummary(user.id);
                if (!summary || summary.totalTrades === 0) {
                    continue;
                }

                const primaryAccount = await this.accountRepo.findOne({
                    where: [
                        { userId: user.id, isPrimary: true, isArchived: false },
                        { userId: user.id, isArchived: false },
                    ],
                });
                const currency = primaryAccount?.currency || 'USD';

                batch.push({
                    to: user.email,
                    template: 'WEEKLY_SUMMARY',
                    data: {
                        userName: user.name || user.username || undefined,
                        totalPnL: Number(summary.totalPnL || 0),
                        currency,
                        winRate: Number(summary.winRate || 0),
                        totalTrades: Number(summary.totalTrades || 0),
                        topLessons: summary.topLessons || [],
                        period: summary.period,
                    },
                    jobId: `weekly-summary:${user.id}:${weekKey}`,
                });
            } catch (error: any) {
                this.logger.error(
                    `Failed to compute weekly summary for user ${user.id}: ${error?.message || error}`,
                );
            }
        }

        if (batch.length > 0) {
            const queued = await this.emailProducer.enqueueBulk(batch, { priority: 3 });
            this.logger.log(`Enqueued ${queued} weekly performance reports in Redis.`);
        } else {
            this.logger.log('Weekly report run finished: 0 eligible users with trades this week.');
        }
    }
}
