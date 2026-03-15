import { Controller, Get, Post, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import * as QRCode from 'qrcode';
import { WhatsAppBotService } from './whatsapp-bot.service';
import { BaileysService } from './baileys.service';

@Controller('whatsapp')
export class WhatsAppBotController {
    constructor(
        private readonly whatsappBotService: WhatsAppBotService,
        private readonly baileysService: BaileysService
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
}
