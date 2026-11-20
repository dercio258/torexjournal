import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, LessThanOrEqual, In, MoreThanOrEqual } from 'typeorm';
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
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { RedisSecurityService } from '../common/security/redis-security.service';
import { PushSubscriptionEntity } from './push/push-subscription.entity';
import { PushProducerService } from './push/push-producer.service';

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
        @InjectRepository(PushSubscriptionEntity)
        private pushSubRepo: Repository<PushSubscriptionEntity>,
        private alertsService: AlertsService,
        private notificationsService: NotificationsService,
        private broadcastingService: BroadcastingService,
        private emailProducer: EmailProducerService,
        private redisSecurity: RedisSecurityService,
        @Inject(CACHE_MANAGER) private cacheManager: Cache,
        @Optional() private pushProducer?: PushProducerService,
    ) {}

    // Runs every day at 08:00 AM server time
    @Cron(CronExpression.EVERY_DAY_AT_8AM)
    async checkPendingJournals() {
        if (process.env.MT5_DEDICATED_SERVER === 'true') return;
        await this.redisSecurity.withLock('cron:pending_journals', 10 * 60 * 1000, async () => {
            this.logger.log('Starting daily check for pending journals...');

            const startOfYesterday = new Date();
            startOfYesterday.setUTCDate(startOfYesterday.getUTCDate() - 1);
            startOfYesterday.setUTCHours(0, 0, 0, 0);

            const endOfYesterday = new Date(startOfYesterday);
            endOfYesterday.setUTCHours(23, 59, 59, 999);

            try {
                const tradesYesterday = await this.tradeRepo.find({
                    where: {
                        closeTime: Between(startOfYesterday, endOfYesterday),
                    },
                });

                if (tradesYesterday.length === 0) return;

                const accountIds = [...new Set(tradesYesterday.map((t) => t.accountId))];
                // Format dateStr using UTC calendar date aligned to JournalService
                const dateStr = `${startOfYesterday.getUTCFullYear()}-${String(startOfYesterday.getUTCMonth() + 1).padStart(2, '0')}-${String(startOfYesterday.getUTCDate()).padStart(2, '0')}`;

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
        });
    }

    // Runs every Sunday at 09:00 PM
    @Cron('0 21 * * 0')
    async checkBehavioralPatterns() {
        if (process.env.MT5_DEDICATED_SERVER === 'true') return;
        await this.redisSecurity.withLock('cron:behavioral_patterns', 15 * 60 * 1000, async () => {
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
        });
    }

    // Runs every day at 10:00 AM server time
    @Cron('0 10 * * *')
    async checkMarketingForInactiveUsers() {
        if (process.env.MT5_DEDICATED_SERVER === 'true') return;
        await this.redisSecurity.withLock('cron:marketing_inactive_users', 10 * 60 * 1000, async () => {
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
        });
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
        if (process.env.MT5_DEDICATED_SERVER === 'true') return;
        await this.redisSecurity.withLock('cron:scheduled_broadcasts', 55 * 1000, async () => {
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
        });
    }

    // Runs every day at 09:00 AM
    @Cron(CronExpression.EVERY_DAY_AT_9AM)
    async checkSubscriptionExpirations() {
        if (process.env.MT5_DEDICATED_SERVER === 'true') return;
        await this.redisSecurity.withLock('cron:sub_expirations_5d', 10 * 60 * 1000, async () => {
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
                    const dedup = await this.redisSecurity.setIfAbsent(
                        `sub_exp_warn_5d:${sub.id}`,
                        '1',
                        6 * 24 * 60 * 60 * 1000,
                    );
                    if (!dedup) continue;

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
                        if (sub.user.email) {
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
                        }
                    }
                }
                this.logger.log(`Expiration check complete. Processed ${expiringSubs.length} subscriptions.`);
            } catch (error) {
                this.logger.error('Failed to run checkSubscriptionExpirations cron', error);
            }
        });
    }

    // Runs every 5 minutes to check and expire subscriptions in database and Redis
    @Cron(CronExpression.EVERY_5_MINUTES)
    async checkExpiredSubscriptions() {
        if (process.env.MT5_DEDICATED_SERVER === 'true') return;
        await this.redisSecurity.withLock('cron:expired_subscriptions', 4 * 60 * 1000, async () => {
            const now = new Date();
            // 5-minute grace window so Bull's scheduled renewal-charge runs ahead of fallback expiration
            const cutoff = new Date(now.getTime() - 5 * 60 * 1000);
            try {
                const expiredActiveSubs = await this.subscriptionRepo.find({
                    where: {
                        status: SubscriptionStatus.ACTIVE,
                        currentPeriodEnd: LessThanOrEqual(cutoff),
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
                    await this.cacheManager.del('admin:financial_stats').catch(() => {});

                    if (sub.user) {
                        const planName = sub.planConfig?.tier || 'Profissional';
                        await this.alertsService.create(sub.userId, {
                            type: AlertType.SYSTEM,
                            severity: AlertSeverity.WARNING,
                            title: 'Assinatura Expirada',
                            description: `A vigência do plano ${planName} encerrou. Reative sua assinatura para retomar os recursos completos.`,
                            metadata: { subId: sub.id },
                        });

                        if (sub.user.email) {
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
                }
            } catch (error) {
                this.logger.error('Failed to run checkExpiredSubscriptions cron', error);
            }
        });
    }

    /**
     * Ciclo diário inteligente de retenção, conexão transparente (+20 corretoras) e curiosidades reais via Web Push.
     */
    @Cron('0 14 * * *')
    async handleSmartPushEngagement() {
        if (process.env.MT5_DEDICATED_SERVER === 'true') return;
        if (!this.pushProducer) return;

        await this.redisSecurity.withLock('cron:smart_push_engagement', 600_000, async () => {
            try {
                const activeSubs = await this.pushSubRepo.find({
                    where: { isActive: true },
                    select: ['userId'],
                });
                const uniqueUserIds = Array.from(new Set(activeSubs.map((s) => s.userId))).slice(0, 500);
                if (uniqueUserIds.length === 0) return;

                const users = await this.userRepo.find({
                    where: { id: In(uniqueUserIds), isBlocked: false },
                    select: ['id', 'preferredLocale', 'createdAt'],
                });
                const now = Date.now();
                const fourteenDaysAgo = new Date(now - 14 * 86_400_000);

                for (const user of users) {
                    const accounts = await this.accountRepo.find({
                        where: { userId: user.id, isArchived: false },
                        select: ['id'],
                    });
                    const accountIds = accounts.map((a) => a.id);

                    const userAgeHours = (now - new Date(user.createdAt).getTime()) / 3_600_000;
                    if (accountIds.length === 0) {
                        if (userAgeHours >= 24) {
                            await this.pushProducer.sendRetentionBrokerConnect(user);
                        }
                        continue;
                    }

                    const latestTrade = await this.tradeRepo.findOne({
                        where: { accountId: In(accountIds) },
                        order: { closeTime: 'DESC' },
                        select: ['id', 'closeTime'],
                    });

                    if (!latestTrade) {
                        if (userAgeHours >= 24) {
                            await this.pushProducer.sendRetentionBrokerConnect(user);
                        }
                        continue;
                    }

                    const daysSinceLast = Math.floor(
                        (now - new Date(latestTrade.closeTime || user.createdAt).getTime()) / 86_400_000,
                    );
                    if (daysSinceLast >= 5) {
                        await this.pushProducer.sendStaleImportReminder(user, daysSinceLast);
                        continue;
                    }

                    const recentTrades = await this.tradeRepo.find({
                        where: {
                            accountId: In(accountIds),
                            closeTime: MoreThanOrEqual(fourteenDaysAgo),
                        },
                        select: ['symbol', 'profit'],
                        take: 250,
                    });

                    if (recentTrades.length >= 5) {
                        const bySymbol = new Map<string, { total: number; wins: number }>();
                        for (const t of recentTrades) {
                            const sym = (t.symbol || '').trim();
                            if (!sym) continue;
                            const stat = bySymbol.get(sym) || { total: 0, wins: 0 };
                            stat.total += 1;
                            if (Number(t.profit) > 0) stat.wins += 1;
                            bySymbol.set(sym, stat);
                        }
                        let bestSym = '';
                        let bestWr = 0;
                        for (const [sym, stat] of bySymbol.entries()) {
                            if (stat.total < 2) continue;
                            const wr = Math.round((stat.wins / stat.total) * 100);
                            if (wr >= bestWr) {
                                bestWr = wr;
                                bestSym = sym;
                            }
                        }
                        if (bestSym) {
                            await this.pushProducer.sendCuriosityInsight({
                                userId: user.id,
                                locale: user.preferredLocale,
                                topSymbol: bestSym,
                                topSymbolWinRate: bestWr,
                                totalRecentTrades: recentTrades.length,
                            });
                        }
                    }
                }
            } catch (error) {
                this.logger.error('Failed to run handleSmartPushEngagement cron', error);
            }
        });
    }
}
