import { Injectable, Logger } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WhatsAppLink } from '../users/whatsapp-link.entity';
import { BaileysService } from './baileys.service';
import { MoreThan } from 'typeorm';

@Injectable()
export class WhatsAppWorkerService {
    private readonly logger = new Logger(WhatsAppWorkerService.name);

    constructor(
        @InjectRepository(WhatsAppLink)
        private readonly linkRepository: Repository<WhatsAppLink>,
        private readonly baileysService: BaileysService,
    ) { }

    @MessagePattern('whatsapp.notification')
    async handleNotification(@Payload() data: { userId: string; message: string }) {
        this.logger.log(`Processing WhatsApp notification for user ${data.userId}`);

        try {
            const link = await this.linkRepository.findOne({
                where: { user: { id: data.userId } },
            });

            if (!link) {
                this.logger.warn(`No WhatsApp link found for user ${data.userId}`);
                return;
            }

            // Implementation of 5-day rule
            const fiveDaysAgo = new Date();
            fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

            if (!link.lastInteractionAt || link.lastInteractionAt < fiveDaysAgo) {
                this.logger.warn(`User ${data.userId} has not interacted with the bot in 5+ days. Blocking notification to avoid ban.`);
                
                // Optional: Send one last alert if not already sent
                if (!link.interactionAlertSent) {
                    await this.baileysService.sendMessage(link.whatsappNumber, "⚠️ *Aviso de Segurança*: Para continuar recebendo notificações, por favor mande qualquer mensagem para este bot (ex: 'oi').\nIsso ajuda a evitar que nosso número seja banido.");
                    await this.linkRepository.update(link.id, { interactionAlertSent: true });
                }
                return;
            }

            await this.baileysService.sendMessage(link.whatsappNumber, data.message);
            this.logger.log(`Notification sent successfully to ${link.whatsappNumber}`);
        } catch (error) {
            this.logger.error(`Failed to process WhatsApp notification: ${error.message}`, error.stack);
        }
    }
}
