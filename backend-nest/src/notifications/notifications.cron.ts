import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { TradeEntity } from '../mt5/trade.entity';
import { NotificationsService } from './notifications.service';
import { NotificationType } from './notification.entity';
import { TechnicalJournal } from '../dashboard/technical-journal.entity';
import { AccountEntity } from '../account/account.entity';
import { AlertsService } from '../alerts/alerts.service';
import { AlertType, AlertSeverity } from '../alerts/alert.entity';
import { UserEntity } from '../users/user.entity';
import { Subscription, SubscriptionStatus } from '../payment/subscription.entity';
import { BroadcastingService } from './broadcast.service';
import { BroadcastNotificationEntity, BroadcastStatus } from './broadcast-notification.entity';
import { LessThanOrEqual } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { SmsService } from './sms.service';
import { SmsTemplates } from './sms-templates';

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
        @InjectQueue('email-queue') private emailQueue: Queue,
        private smsService: SmsService,
    ) { }

    // Runs every day at 08:00 AM server time
    @Cron(CronExpression.EVERY_DAY_AT_8AM)
    async checkPendingJournals() {
        this.logger.log('Starting daily check for pending journals...');

        // Time window for yesterday
        const startOfYesterday = new Date();
        startOfYesterday.setDate(startOfYesterday.getDate() - 1);
        startOfYesterday.setHours(0, 0, 0, 0);

        const endOfYesterday = new Date(startOfYesterday);
        endOfYesterday.setHours(23, 59, 59, 999);

        try {
            // Find all trades closed yesterday
            const tradesYesterday = await this.tradeRepo.find({
                where: {
                    closeTime: Between(startOfYesterday, endOfYesterday)
                }
            });

            if (tradesYesterday.length === 0) return;

            // Get unique account IDs that traded yesterday
            const accountIds = [...new Set(tradesYesterday.map(t => t.accountId))];
            const dateStr = startOfYesterday.toISOString().split('T')[0];

            for (const accountId of accountIds) {
                // Check if journal exists for this account and date
                const journal = await this.journalRepo.findOne({
                    where: { accountId, date: dateStr }
                });

                if (!journal) {
                    // Get User ID from Account
                    const account = await this.accountRepo.findOne({ where: { id: accountId } });
                    if (account && account.userId) {
                        await this.alertsService.create(account.userId, {
                            type: AlertType.JOURNAL,
                            severity: AlertSeverity.WARNING,
                            title: 'Diário Pendente 📝',
                            description: `Você operou ontem mas ainda não preencheu seu diário técnico. Mantenha seus registros em dia para manter a precisão das suas métricas.`,
                            metadata: { date: dateStr, tradesCount: tradesYesterday.filter(t => t.accountId === accountId).length }
                        });
                    }
                }
            }

            this.logger.log(`Journal check complete.`);
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
                    closeTime: Between(lastWeek, new Date())
                }
            });

            const accountStats = new Map<string, { total: number; lateTotal: number; lateLosses: number }>();

            lastWeekTrades.forEach(trade => {
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

                // 1. Time-based behavioral insight
                if (stats.lateTotal >= 3 && (stats.lateLosses / stats.lateTotal) > 0.7) {
                    await this.alertsService.create(account.userId, {
                        type: AlertType.PSYCHOLOGY,
                        severity: AlertSeverity.WARNING,
                        title: 'Padrão Comportamental Detectado 🧠',
                        description: `Sua performance cai significativamente após às 16:00 (70%+ de taxa de perda). Considere parar de operar nesse horário.`,
                        metadata: { lateTrades: stats.lateTotal, lossRate: `${(stats.lateLosses / stats.lateTotal * 100).toFixed(0)}%` }
                    });
                }

                // 2. Setup Profitability Analysis (Example)
                const setups = [...new Set(lastWeekTrades.filter(t => t.accountId === accId).map(t => t.setup))].filter(Boolean);
                for (const setupName of setups) {
                    const setupTrades = lastWeekTrades.filter(t => t.accountId === accId && t.setup === setupName);
                    const losses = setupTrades.filter(t => Number(t.profit) < 0).length;
                    if (setupTrades.length >= 4 && (losses / setupTrades.length) >= 0.75) {
                        await this.alertsService.create(account.userId, {
                            type: AlertType.PERFORMANCE,
                            severity: AlertSeverity.INFO,
                            title: `Insight de Performance: ${setupName} 📊`,
                            description: `Seu setup "${setupName}" teve 75% de taxa de perda esta semana. Talvez não esteja adequado para o contexto atual do mercado.`,
                            metadata: { setup: setupName, trades: setupTrades.length, lossRate: '75%+' }
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
        this.logger.log('Starting daily check for marketing to inactive users...');

        try {
            // Check for users created exactly 3 days ago
            await this.sendMarketingAlertsForDaysAgo(3, 'Comece a Operar como um Profissional 🚀', 'Já se passaram alguns dias desde que você se registrou. Aproveite nossas ferramentas escolhendo o plano Traders Básico para análise de diário ou o Analista Premium para inteligência em tempo real.');

            // Check for users created exactly 7 days ago
            await this.sendMarketingAlertsForDaysAgo(7, 'Eleve seu Trading ao Próximo Nível 📈', 'Uma semana e você ainda não aproveitou todo o nosso potencial. Desbloqueie o Analista Premium agora para ter relatórios automáticos e insights precisos do seu histórico MT5.');

        } catch (error) {
            this.logger.error('Failed to run checkMarketingForInactiveUsers cron', error);
        }
    }

    private async sendMarketingAlertsForDaysAgo(daysAgo: number, title: string, description: string) {
        const targetDateStart = new Date();
        targetDateStart.setDate(targetDateStart.getDate() - daysAgo);
        targetDateStart.setHours(0, 0, 0, 0);

        const targetDateEnd = new Date(targetDateStart);
        targetDateEnd.setHours(23, 59, 59, 999);

        const usersToNotify = await this.userRepo.find({
            where: {
                createdAt: Between(targetDateStart, targetDateEnd)
            }
        });

        for (const user of usersToNotify) {
            const activeSub = await this.subscriptionRepo.findOne({
                where: {
                    userId: user.id,
                    status: SubscriptionStatus.ACTIVE
                }
            });

            // If user has no active subscription, send marketing alert
            if (!activeSub) {
                await this.alertsService.create(user.id, {
                    type: AlertType.MARKETING,
                    severity: AlertSeverity.INFO,
                    title: title,
                    description: description,
                    metadata: { marketingCampaign: `inactive_${daysAgo}_days` }
                });
            }
        }
    }

    // Runs every minute to check for scheduled broadcasts
    @Cron(CronExpression.EVERY_MINUTE)
    async processScheduledBroadcasts() {
        // this.logger.log('Checking for scheduled broadcasts...');
        const now = new Date();
        
        const pendingBroadcasts = await this.broadcastRepo.find({
            where: {
                status: BroadcastStatus.SCHEDULED,
                nextRunAt: LessThanOrEqual(now)
            }
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
    // @Cron(CronExpression.EVERY_DAY_AT_9AM)
    async checkSubscriptionExpirations() {
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
                    currentPeriodEnd: Between(fiveDaysFromNowStart, fiveDaysFromNowEnd)
                },
                relations: ['user', 'planConfig']
            });

            for (const sub of expiringSubs) {
                if (sub.user) {
                    await this.alertsService.create(sub.userId, {
                        type: AlertType.SYSTEM,
                        severity: AlertSeverity.WARNING,
                        title: 'Sua assinatura expira em 5 dias! ⏳',
                        description: `Sua assinatura do plano ${sub.planConfig?.tier || 'atual'} está chegando ao fim. Renove agora para não perder o acesso às suas métricas e ferramentas.`,
                        metadata: { expiryDate: sub.currentPeriodEnd, subId: sub.id }
                    });

                    // Send Professional Email
                    await this.emailQueue.add('general-notification', {
                        email: sub.user.email,
                        userName: sub.user.name,
                        title: 'Acção Necessária: Sua Assinatura Expira em Breve',
                        subtitle: 'RENOVAÇÃO DE PLANO',
                        message: `Sua assinatura do plano ${sub.planConfig?.tier || 'atual'} termina em apenas 5 dias (${new Date(sub.currentPeriodEnd).toLocaleDateString()}).\n\nGaranta a continuidade do seu diário de trading e não perca o acesso aos seus dados históricos e relatórios avançados.`,
                        buttonUrl: `${process.env.BASE_URL || ''}/pricing`,
                        buttonLabel: 'Renovar Assinatura Agora'
                    }, { removeOnComplete: true });

                    // Send Professional SMS (Systemic)
                    if (sub.user.whatsapp) {
                        await this.smsService.sendSms(
                            sub.user.id,
                            sub.user.whatsapp,
                            SmsTemplates.EXPIRATION_REMINDER(sub.user.name, 5),
                            true // isSystemic
                        );
                    }
                }
            }
            this.logger.log(`Expiration check complete. Notified ${expiringSubs.length} users.`);
        } catch (error) {
            this.logger.error('Failed to run checkSubscriptionExpirations cron', error);
        }
    }
}
