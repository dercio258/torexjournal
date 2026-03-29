import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from '../users/user.entity';
import { DashboardService } from './dashboard.service';
import { EmailService } from '../email/email.service';

@Injectable()
export class WeeklyReportService {
    private readonly logger = new Logger(WeeklyReportService.name);

    constructor(
        @InjectRepository(UserEntity)
        private userRepo: Repository<UserEntity>,
        private dashboardService: DashboardService,
        private emailService: EmailService,
    ) { }

    @Cron('0 9 * * 0') // Sunday at 09:00 AM
    async handleWeeklyReport() {
        this.logger.log('Starting weekly performance reports...');
        
        const users = await this.userRepo.find();
        
        for (const user of users) {
            if (!user.email) continue;

            try {
                const summary = await this.dashboardService.getWeeklySummary(user.id);
                if (!summary || summary.totalTrades === 0) {
                    this.logger.debug(`Skipping weekly report for user ${user.id} (no trades)`);
                    continue;
                }

                await this.emailService.sendTemplatedEmail(
                    user.email,
                    'WEEKLY_SUMMARY',
                    {
                        userName: user.name || user.username || 'Trader',
                        ...summary,
                        subject: `Relatório Semanal: ${summary.totalPnL >= 0 ? 'Lucro' : 'Prejuízo'} de ${summary.totalPnL.toFixed(2)} MT`
                    }
                );
                
                this.logger.log(`Weekly report sent to ${user.email}`);
            } catch (error) {
                this.logger.error(`Failed to send weekly report to ${user.id}: ${error.message}`);
            }
        }
        
        this.logger.log('Weekly performance reports completed.');
    }
}
