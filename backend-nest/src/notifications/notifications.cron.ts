import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, LessThanOrEqual } from 'typeorm';
import { TradeEntity } from '../mt5/trade.entity';
import { NotificationsService } from './notifications.service';
import { TechnicalJournal } from '../dashboard/technical-journal.entity';
import { AccountEntity } from '../account/account.entity';
import { AlertsService } from '../alerts/alerts.service';
import { AlertType, AlertSeverity } from '../alerts/alert.entity';
import { UserEntity } from '../users/user.entity';
import { Subscription, SubscriptionStatus } from '../payment/subscription.entity';
import { BroadcastingService } from './broadcast.service';
import { BroadcastNotificationEntity, BroadcastStatus } from './broadcast-notification.entity';
import { EmailProducerService } from '../email/email-producer.service';
import { SmsService } from './sms.service';
import { SmsTemplates } from './sms-templates';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

@Injectable()
export class NotificationsCronService {
    private readonly logger = new Logger(NotificationsCronService.name);

    constructor(
        @InjectRepository(TradeEntity)
        private tradeRepo: Repository<TradeEntity>,
        @InjectRepository(TechnicalJournal)
        private journalRepo: Repository<TechnicalJournal>,
        @InjectRepository(AccountEntity)
        private accountRepo: Repository<AccountEntity>,
        @InjectRepository(UserEntity)
        private userRepo: Repository<UserEntity>,
        @InjectRepository(Subscription)
        private subscriptionRepo: Repository<Subscription>,
        @InjectRepository(BroadcastNotificationEntity)
        private broadcastRepo: Repository<BroadcastNotificationEntity>,
        private alertsService: AlertsService,
        private notificationsService: NotificationsService,
        private broadcastingService: BroadcastingService,
        private emailProducer: EmailProducerService,
        private smsService: SmsService,
        @Inject(CACHE_MANAGER) private cacheManager: Cache,
    ) {}

    // Runs every day at 08:00 AM server time
    @Cron(CronExpression.EVERY_DAY_AT_8AM)
    async checkPendingJournals() {
        this.logger.log('Starting daily check for pending journals...');

        const startOfYesterday = new Date();
        startOfYesterday.setDate(startOfYesterday.getDate() - 1);
        startOfYesterday.setHours(0, 0, 0, 0);

        const endOfYesterday = new Date(startOfYesterday);
        endOfYesterday.setHours(23, 59, 59, 999);

        try {
            const tradesYesterday = await this.tradeRepo.find({
                where: {
                    closeTime: Between(startOfYesterday, endOfYesterday),
                },
            });

            if (tradesYesterday.length === 0) return;

            const accountIds = [...new Set(tradesYesterday.map((t) => t.accountId))];
            const dateStr = startOfYesterday.toISOString().split('T')[0];

            for (const accountId of accountIds) {
                const journal = await this.journalRepo.findOne({
                    where: { accountId, date: dateStr },
                });

                if (!journal) {
                    const account = await this.accountRepo.findOne({ where: { id: accountId } });
                    if (account && account.userId) {
                        await this.alertsService.create(account.userId, {
                            type: AlertType.JOURNAL,
                            severity: AlertSeverity.WARNING,
                            title: 'Diário Técnico Pendente',
                            description:
                                'Você encerrou operações ontem sem preencher o diário técnico. Mantenha seus registros atualizados para preservar a precisão das métricas.',
                            metadata: {
                                date: dateStr,
                                tradesCount: tradesYesterday.filter(
                                    (t) => t.accountId === accountId,
                                ).length,
                            },
                        });
                    }
                }
            }

            this.logger.log('Journal check complete.');
        } catch (error) {
            this.logger.error('Failed to run checkPendingJournals cron', error);
        }
    }

    // Runs every Sunday at 09:00 PM
    @Cron('0 21 * * 0')
    async checkBehavioralPatterns() {
        this.logger.log('Starting weekly behavioral pattern analysis...');

        const lastWeek = new Date();
        lastWeek.setDate(lastWeek.getDate() - 7);

        try {
            const lastWeekTrades = await this.tradeRepo.find({
                where: {
                    closeTime: Between(lastWeek, new Date()),
                },
            });

            const accountStats = new Map<
                string,
                { total: number; lateTotal: number; lateLosses: number }
            >();

            lastWeekTrades.forEach((trade) => {
                const accId = trade.accountId;
                if (!accountStats.has(accId)) {
                    accountStats.set(accId, { total: 0, lateTotal: 0, lateLosses: 0 });
                }
                const stats = accountStats.get(accId)!;
                stats.total++;

                if (trade.closeTime && trade.closeTime.getHours() >= 16) {
                    stats.lateTotal++;
                    if (Number(trade.profit) <= 0) {
                        stats.lateLosses++;
                    }
                }
            });

            for (const [accId, stats] of accountStats.entries()) {
                const account = await this.accountRepo.findOne({ where: { id: accId } });
                if (!account || !account.userId) continue;

                if (stats.lateTotal >= 3 && stats.lateLosses / stats.lateTotal > 0.7) {
                    await this.alertsService.create(account.userId, {
                        type: AlertType.PSYCHOLOGY,
                        severity: AlertSeverity.WARNING,
                        title: 'Padrão Comportamental Detectado',
                        description:
                            'Sua taxa de perda supera 70% em operações encerradas após as 16:00. Avalie restringir sua janela operacional.',
                        metadata: {
                            lateTrades: stats.lateTotal,
                            lossRate: `${((stats.lateLosses / stats.lateTotal) * 100).toFixed(0)}%`,
                        },
                    });
                }

                const setups = [
                    ...new Set(
                        lastWeekTrades.filter((t) => t.accountId === accId).map((t) => t.setup),
                    ),
                ].filter(Boolean);
                for (const setupName of setups) {
                    const setupTrades = lastWeekTrades.filter(
                        (t) => t.accountId === accId && t.setup === setupName,
                    );
                    const losses = setupTrades.filter((t) => Number(t.profit) < 0).length;
                    if (setupTrades.length >= 4 && losses / setupTrades.length >= 0.75) {
                        await this.alertsService.create(account.userId, {
                            type: AlertType.PERFORMANCE,
                            severity: AlertSeverity.INFO,
                            title: `Revisão de Setup: ${setupName}`,
                            description: `O setup "${setupName}" registrou taxa de perda superior a 75% nos últimos 7 dias.`,
                            metadata: {
                                setup: setupName,
                                trades: setupTrades.length,
                                lossRate: '75%+',
                            },
                        });
                    }
                }
            }
        } catch (error) {
            this.logger.error('Failed to run checkBehavioralPatterns cron', error);
        }
    }

    // Runs every day at 10:00 AM server time
    @Cron('0 10 * * *')
    async checkMarketingForInactiveUsers() {
        this.logger.log('Starting daily check for inactive user onboarding...');

        try {
            await this.sendMarketingAlertsForDaysAgo(
                3,
                'Complete sua configuração operacional',
                'Vincule sua conta de negociação ou escolha um plano profissional para habilitar relatórios automáticos e auditoria de risco.',
            );

            await this.sendMarketingAlertsForDaysAgo(
                7,
                'Recursos avançados disponíveis no Torex Journal',
                'Ative um plano para liberar sincronização contínua, backtesting gráfico e indicadores comportamentais.',
            );
        } catch (error) {
            this.logger.error('Failed to run checkMarketingForInactiveUsers cron', error);
        }
    }

    private async sendMarketingAlertsForDaysAgo(
        daysAgo: number,
        title: string,
        description: string,
    ) {
        const targetDateStart = new Date();
        targetDateStart.setDate(targetDateStart.getDate() - daysAgo);
        targetDateStart.setHours(0, 0, 0, 0);

        const targetDateEnd = new Date(targetDateStart);
        targetDateEnd.setHours(23, 59, 59, 999);

        const usersToNotify = await this.userRepo.find({
            where: {
                createdAt: Between(targetDateStart, targetDateEnd),
            },
        });

        for (const user of usersToNotify) {
            const activeSub = await this.subscriptionRepo.findOne({
                where: {
                    userId: user.id,
                    status: SubscriptionStatus.ACTIVE,
                },
            });

            if (!activeSub) {
                await this.alertsService.create(user.id, {
                    type: AlertType.MARKETING,
                    severity: AlertSeverity.INFO,
                    title,
                    description,
                    metadata: { marketingCampaign: `inactive_${daysAgo}_days` },
                });
            }
        }
    }

    // Runs every minute to check for scheduled broadcasts
    @Cron(CronExpression.EVERY_MINUTE)
    async processScheduledBroadcasts() {
        const now = new Date();

        const pendingBroadcasts = await this.broadcastRepo.find({
            where: {
                status: BroadcastStatus.SCHEDULED,
                nextRunAt: LessThanOrEqual(now),
            },
        });

        for (const broadcast of pendingBroadcasts) {
            try {
                await this.broadcastingService.executeBroadcast(broadcast.id);
            } catch (error) {
                this.logger.error(`Failed to execute broadcast ${broadcast.id}`, error);
            }
        }
    }

    // Runs every day at 09:00 AM
    @Cron(CronExpression.EVERY_DAY_AT_9AM)
    async checkSubscriptionExpirations() {
        if (process.env.MT5_DEDICATED_SERVER === 'true') return;
        this.logger.log('Checking for subscriptions expiring in 5 days...');

        const fiveDaysFromNowStart = new Date();
        fiveDaysFromNowStart.setDate(fiveDaysFromNowStart.getDate() + 5);
        fiveDaysFromNowStart.setHours(0, 0, 0, 0);

        const fiveDaysFromNowEnd = new Date(fiveDaysFromNowStart);
        fiveDaysFromNowEnd.setHours(23, 59, 59, 999);

        try {
            const expiringSubs = await this.subscriptionRepo.find({
                where: {
                    status: SubscriptionStatus.ACTIVE,
                    currentPeriodEnd: Between(fiveDaysFromNowStart, fiveDaysFromNowEnd),
                },
                relations: ['user', 'planConfig'],
            });

            for (const sub of expiringSubs) {
                if (sub.user) {
                    const planName = sub.planConfig?.tier || 'Profissional';
                    await this.alertsService.create(sub.userId, {
                        type: AlertType.SYSTEM,
                        severity: AlertSeverity.WARNING,
                        title: 'Assinatura próxima do vencimento (5 dias)',
                        description: `Sua assinatura do plano ${planName} encerra em 5 dias. Renove antecipadamente para manter o acesso contínuo.`,
                        metadata: { expiryDate: sub.currentPeriodEnd, subId: sub.id },
                    });

                    // Shared deterministic jobId prevents duplicates with SubscriptionProcessor
                    await this.emailProducer.enqueue(
                        sub.user.email,
                        'SUBSCRIPTION_EXPIRING',
                        {
                            userName: sub.user.name || undefined,
                            plan: String(planName),
                            daysRemaining: 5,
                            expiryDate: new Date(sub.currentPeriodEnd).toISOString(),
                        },
                        { jobId: `sub-expiring-5d:${sub.id}` },
                    );

                    if (sub.user.whatsapp) {
                        await this.smsService.sendSms(
                            sub.user.id,
                            sub.user.whatsapp,
                            SmsTemplates.EXPIRATION_REMINDER(sub.user.name, 5),
                            true,
                        );
                    }
                }
            }
            this.logger.log(`Expiration check complete. Processed ${expiringSubs.length} subscriptions.`);
        } catch (error) {
            this.logger.error('Failed to run checkSubscriptionExpirations cron', error);
        }
    }

    // Runs every 5 minutes to check and expire subscriptions in database and Redis
    @Cron(CronExpression.EVERY_5_MINUTES)
    async checkExpiredSubscriptions() {
        if (process.env.MT5_DEDICATED_SERVER === 'true') return;
        const now = new Date();
        try {
            const expiredActiveSubs = await this.subscriptionRepo.find({
                where: {
                    status: SubscriptionStatus.ACTIVE,
                    currentPeriodEnd: LessThanOrEqual(now),
                },
                relations: ['user', 'planConfig'],
            });

            if (expiredActiveSubs.length === 0) return;

            this.logger.log(
                `Expiring ${expiredActiveSubs.length} subscriptions past period end...`,
            );

            for (const sub of expiredActiveSubs) {
                sub.status = SubscriptionStatus.EXPIRED;
                await this.subscriptionRepo.save(sub);

                await this.cacheManager.del(`user_plan_tier:${sub.userId}`).catch(() => {});
                await this.cacheManager
                    .del(`user_subscription_status:${sub.userId}`)
                    .catch(() => {});

                if (sub.user) {
                    const planName = sub.planConfig?.tier || 'Profissional';
                    await this.alertsService.create(sub.userId, {
                        type: AlertType.SYSTEM,
                        severity: AlertSeverity.WARNING,
                        title: 'Assinatura Expirada',
                        description: `A vigência do plano ${planName} encerrou. Reative sua assinatura para retomar os recursos completos.`,
                        metadata: { subId: sub.id },
                    });

                    await this.emailProducer.enqueue(
                        sub.user.email,
                        'SUBSCRIPTION_EXPIRED',
                        {
                            userName: sub.user.name || undefined,
                            plan: String(planName),
                            expiredAt: new Date(sub.currentPeriodEnd || now).toISOString(),
                        },
                        { jobId: `sub-expired:${sub.id}` },
                    );
                }
            }
        } catch (error) {
            this.logger.error('Failed to run checkExpiredSubscriptions cron', error);
        }
    }
}
