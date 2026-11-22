import { BadRequestException, ForbiddenException, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountEntity } from '../account/account.entity';
import { EmailProducerService } from '../email/email-producer.service';
import { EmailTemplatePayloadMap } from '../email/templates';
import { UserEntity } from '../users/user.entity';
import { DashboardService } from './dashboard.service';
import { RedisSecurityService } from '../common/security/redis-security.service';
import { PlanPermissionService, PlanTier } from '../payment/plan-permission.service';

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
        @Optional()
        private readonly redisSecurity?: RedisSecurityService,
        @Optional()
        private readonly planPermissionService?: PlanPermissionService,
    ) {}

    private async dispatchScheduledPeriodReports(params: {
        frequency: 'WEEKLY' | 'MONTHLY';
        allowedTier: PlanTier;
    }) {
        const users = await this.userRepo.find();
        const periodKey =
            params.frequency === 'WEEKLY'
                ? new Date().toISOString().slice(0, 10)
                : new Date().toISOString().slice(0, 7);

        const templateName = params.frequency === 'WEEKLY' ? 'WEEKLY_SUMMARY' : 'MONTHLY_SUMMARY';
        const batch: Array<{
            to: string;
            template: 'WEEKLY_SUMMARY' | 'MONTHLY_SUMMARY';
            data: EmailTemplatePayloadMap['WEEKLY_SUMMARY'];
            jobId: string;
        }> = [];

        for (const user of users) {
            if (!user.email) continue;

            try {
                if (this.planPermissionService) {
                    const tier = await this.planPermissionService.getUserPlan(user.id);
                    if (tier !== params.allowedTier) {
                        continue;
                    }
                }

                const summary =
                    params.frequency === 'WEEKLY'
                        ? await this.dashboardService.getWeeklySummary(user.id)
                        : await this.dashboardService.getMonthlySummary(user.id);
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
                    template: templateName,
                    data: {
                        userName: user.name || user.username || undefined,
                        totalPnL: Number(summary.totalPnL || 0),
                        currency,
                        winRate: Number(summary.winRate || 0),
                        totalTrades: Number(summary.totalTrades || 0),
                        topLessons: summary.topLessons || [],
                        period: summary.period,
                    },
                    jobId: `${params.frequency === 'WEEKLY' ? 'weekly' : 'monthly'}-summary:${user.id}:${periodKey}`,
                });
            } catch (error: any) {
                this.logger.error(
                    `Failed to compute ${params.frequency.toLowerCase()} summary for user ${user.id}: ${error?.message || error}`,
                );
            }
        }

        if (batch.length > 0) {
            const queued = await this.emailProducer.enqueueBulk(batch as any, { priority: 3 });
            this.logger.log(
                `Enqueued ${queued} ${params.frequency.toLowerCase()} performance reports (${params.allowedTier}) in Redis.`,
            );
        } else {
            this.logger.log(
                `${params.frequency} report run finished: 0 eligible ${params.allowedTier} users with trades in period.`,
            );
        }
    }

    @Cron('0 9 * * 0') // Sunday at 09:00 AM — Exclusive to PREMIUM plan
    async handleWeeklyReport() {
        if (process.env.MT5_DEDICATED_SERVER === 'true') return;
        const exec = async () => {
            this.logger.log('Preparing weekly performance reports (PREMIUM only) for Redis dispatch...');
            await this.dispatchScheduledPeriodReports({
                frequency: 'WEEKLY',
                allowedTier: PlanTier.PREMIUM,
            });
        };

        if (this.redisSecurity) {
            await this.redisSecurity.withLock('cron:weekly_report', 30 * 60_000, exec);
        } else {
            await exec();
        }
    }

    @Cron('0 9 1 * *') // 1st day of month at 09:00 AM — Exclusive to PRO plan
    async handleMonthlyReport() {
        if (process.env.MT5_DEDICATED_SERVER === 'true') return;
        const exec = async () => {
            this.logger.log('Preparing monthly performance reports (PRO only) for Redis dispatch...');
            await this.dispatchScheduledPeriodReports({
                frequency: 'MONTHLY',
                allowedTier: PlanTier.PRO,
            });
        };

        if (this.redisSecurity) {
            await this.redisSecurity.withLock('cron:monthly_report', 30 * 60_000, exec);
        } else {
            await exec();
        }
    }

    async sendReportEmailOnDemand(
        userId: string,
        frequency: 'WEEKLY' | 'MONTHLY',
        accountId?: string,
    ) {
        const tier = this.planPermissionService
            ? await this.planPermissionService.getUserPlan(userId)
            : PlanTier.FREE;

        if (tier === PlanTier.FREE || tier === PlanTier.BASIC) {
            throw new ForbiddenException({
                statusCode: 403,
                code: 'PLAN_UPGRADE_REQUIRED',
                requiredTier: 'PRO',
                message:
                    'No plano Básico os relatórios operacionais são visualizados e baixados diretamente no website. Faça upgrade para Pro (relatório mensal por e-mail) ou Premium (relatório semanal por e-mail).',
            });
        }

        if (frequency === 'WEEKLY' && tier !== PlanTier.PREMIUM) {
            throw new ForbiddenException({
                statusCode: 403,
                code: 'PLAN_UPGRADE_REQUIRED',
                requiredTier: 'PREMIUM',
                message:
                    'O relatório operacional semanal por e-mail é exclusivo do plano Premium (o plano Pro inclui relatório mensal por e-mail).',
            });
        }

        const user = await this.userRepo.findOne({ where: { id: userId } });
        if (!user?.email) {
            throw new BadRequestException('Usuário sem endereço de e-mail válido.');
        }

        const summary =
            frequency === 'WEEKLY'
                ? await this.dashboardService.getWeeklySummary(userId, accountId)
                : await this.dashboardService.getMonthlySummary(userId, accountId);

        if (!summary || summary.totalTrades === 0) {
            throw new BadRequestException(
                frequency === 'WEEKLY'
                    ? 'Sem operações encerradas nos últimos 7 dias para gerar o relatório semanal.'
                    : 'Sem operações encerradas nos últimos 30 dias para gerar o relatório mensal.',
            );
        }

        const primaryAccount = await this.accountRepo.findOne({
            where: accountId
                ? { id: accountId, userId }
                : [
                      { userId, isPrimary: true, isArchived: false },
                      { userId, isArchived: false },
                  ],
        });
        const currency = primaryAccount?.currency || 'USD';
        const template = frequency === 'WEEKLY' ? 'WEEKLY_SUMMARY' : 'MONTHLY_SUMMARY';

        await this.emailProducer.enqueue(user.email, template, {
            userName: user.name || user.username || undefined,
            totalPnL: Number(summary.totalPnL || 0),
            currency,
            winRate: Number(summary.winRate || 0),
            totalTrades: Number(summary.totalTrades || 0),
            topLessons: summary.topLessons || [],
            period: summary.period,
        });

        return {
            success: true,
            frequency,
            tier,
        };
    }
}
