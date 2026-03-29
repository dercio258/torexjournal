import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from '../users/user.entity';
import { TradeEntity } from '../mt5/trade.entity';
import { TelegramService } from '../notifications/telegram.service';
import { WhatsAppBotService } from '../notifications/whatsapp-bot.service';
import { OnEvent } from '@nestjs/event-emitter';

@Injectable()
export class RiskManagementService {
    private readonly logger = new Logger(RiskManagementService.name);

    constructor(
        @InjectRepository(UserEntity)
        private userRepo: Repository<UserEntity>,
        @InjectRepository(TradeEntity)
        private tradeRepo: Repository<TradeEntity>,
        private telegramService: TelegramService,
        private whatsappService: WhatsAppBotService,
    ) { }

    @OnEvent('trades.imported')
    async checkDailyLossLimit(payload: { userId: string; trades: any[] }) {
        const { userId } = payload;
        
        const user = await this.userRepo.findOne({ where: { id: userId } });
        if (!user || !user.dailyLossLimit) return;

        // Calculate today's PnL
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const trades = await this.tradeRepo.createQueryBuilder('trade')
            .innerJoin('trade.account', 'account')
            .where('account.userId = :userId', { userId })
            .andWhere('trade.status = :status', { status: 'CLOSED' })
            .andWhere('trade.closeTime >= :today', { today })
            .getMany();

        const dailyPnL = trades.reduce((sum, t) => sum + (Number(t.profit) || 0) + (Number(t.commission) || 0) + (Number(t.swap) || 0), 0);
        
        this.logger.debug(`User ${userId} Daily PnL: ${dailyPnL} | Limit: -${user.dailyLossLimit}`);

        if (dailyPnL <= -Number(user.dailyLossLimit)) {
            const message = `⚠️ *ALERTA DE RISCO: LIMITE ATINGIDO*\n\nOlá ${user.name || 'Trader'},\n\nSua perda diária atingiu *${dailyPnL.toFixed(2)} MT*, ultrapassando seu limite configurado de *${user.dailyLossLimit} MT*.\n\nRecomendamos parar de operar por hoje para proteger seu capital. A disciplina é o segredo da consistência. 🛡️`;

            // Send to Telegram
            if (user.telegramChatId) {
                await this.telegramService.sendNotification(userId, message);
            }

            // Send to WhatsApp (if linked) - Note: WhatsAppBotService might need a direct send method
            // For now we use the legacy whatsapp field if available or links
            if (user.whatsapp) {
                // Simplified WhatsApp alert (this depends on BaileysService being public or WhatsAppBotService having a direct method)
                try {
                    // Assuming whatsapp field is a JID or number
                    const jid = user.whatsapp.includes('@') ? user.whatsapp : `${user.whatsapp}@s.whatsapp.net`;
                    // We might need to inject BaileysService or use a method in WhatsAppBotService
                    // this.whatsappService.sendText(jid, message); // sendText is private in WhatsAppBotService!
                } catch (e) {
                    this.logger.error(`Failed to send WhatsApp risk alert: ${e.message}`);
                }
            }
        }
    }
}

