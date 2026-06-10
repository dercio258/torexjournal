import { Controller, Get, Post, HttpCode, HttpStatus, Body } from '@nestjs/common';
import * as QRCode from 'qrcode';
import { WhatsAppBotService } from './whatsapp-bot.service';
import { BaileysService } from './baileys.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Controller('whatsapp')
export class WhatsAppBotController {
    constructor(
        private readonly whatsappBotService: WhatsAppBotService,
        private readonly baileysService: BaileysService,
        private readonly eventEmitter: EventEmitter2
    ) { }

    @Get('status')
    async getStatus() {
        const qrCodeString = this.baileysService.qrCode;
        let qrCodeDataUrl = null;

        if (qrCodeString) {
            qrCodeDataUrl = await QRCode.toDataURL(qrCodeString);
        }

        return {
            status: this.baileysService.getConnectionStatus(),
            qrCode: qrCodeDataUrl
        };
    }

    @Post('logout')
    @HttpCode(HttpStatus.OK)
    async logout() {
        const success = await this.baileysService.logout();
        return { success };
    }

    @Post('webhook')
    @HttpCode(HttpStatus.OK)
    async handleWebhook(@Body() body: any) {
        if (body && body.event === 'messages.upsert') {
            const payload = {
                messages: [body.data],
                type: 'notify'
            };
            this.eventEmitter.emit('whatsapp.messages.upsert', payload);
        }
        return { success: true };
    }
}

