import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThanOrEqual, Repository } from 'typeorm';
import { UserEntity } from '../users/user.entity';
import { TradeEntity } from '../mt5/trade.entity';
import { AccountEntity } from '../account/account.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.entity';
import { RedisSecurityService } from '../common/security/redis-security.service';
import { OnEvent } from '@nestjs/event-emitter';

@Injectable()
export class RiskManagementService {
    private readonly logger = new Logger(RiskManagementService.name);

    constructor(
        @InjectRepository(UserEntity)
        private userRepo: Repository<UserEntity>,
        @InjectRepository(TradeEntity)
        private tradeRepo: Repository<TradeEntity>,
        @InjectRepository(AccountEntity)
        private accountRepo: Repository<AccountEntity>,
        private notificationsService: NotificationsService,
        @Optional()
        private redisSecurity?: RedisSecurityService,
    ) {}

    @OnEvent('trades.imported')
    async checkDailyLossLimit(payload: { userId: string; trades?: any[] }) {
        const { userId } = payload || {};
        if (!userId) return;

        const user = await this.userRepo.findOne({ where: { id: userId } });
        if (!user || !user.dailyLossLimit || Number(user.dailyLossLimit) <= 0) return;

        const accounts = await this.accountRepo.find({
            where: { userId },
            select: ['id'],
        });
        const accountIds = accounts.map((a) => a.id).filter(Boolean);
        if (accountIds.length === 0) return;

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

        const trades = await this.tradeRepo.find({
            where: {
                accountId: In(accountIds),
                status: 'CLOSED',
                closeTime: MoreThanOrEqual(today),
            },
        });

        const dailyPnL = trades.reduce((sum, t) => {
            if (t.netPnl !== null && t.netPnl !== undefined) {
                return sum + Number(t.netPnl);
            }
            return sum + (Number(t.profit) || 0) + (Number(t.commission) || 0) + (Number(t.swap) || 0);
        }, 0);

        this.logger.debug(`User ${userId} Daily PnL: ${dailyPnL} | Limit: -${user.dailyLossLimit}`);

        if (dailyPnL <= -Number(user.dailyLossLimit)) {
            const firstAlertToday = this.redisSecurity
                ? await this.redisSecurity.setIfAbsent(
                      `risk_daily_loss:${userId}:${todayKey}`,
                      '1',
                      24 * 60 * 60 * 1000,
                  )
                : true;
            if (!firstAlertToday) return;

            const message = `Olá ${user.name || 'Trader'}, a sua perda diária atingiu ${dailyPnL.toFixed(2)}, ultrapassando o limite configurado de ${user.dailyLossLimit}. Recomendamos parar de operar por hoje para proteger o seu capital.`;

            await this.notificationsService
                .create(userId, {
                    title: 'Alerta de Risco: Limite Diário Atingido',
                    message,
                    type: NotificationType.RISK_ALERT,
                    actionUrl: '/dashboard',
                    actionLabel: 'Rever Risco',
                })
                .catch((err) => {
                    this.logger.warn(`Failed to dispatch daily risk notification: ${err?.message || err}`);
                });
        }
    }
}

