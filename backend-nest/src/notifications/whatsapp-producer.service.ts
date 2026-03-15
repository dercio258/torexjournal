import { Injectable, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';

@Injectable()
export class WhatsAppProducerService {
    constructor(
        @Inject('WHATSAPP_SERVICE') private readonly client: ClientProxy,
    ) { }

    async sendNotification(userId: string, message: string) {
        return this.client.emit('whatsapp.notification', { userId, message });
    }
}
