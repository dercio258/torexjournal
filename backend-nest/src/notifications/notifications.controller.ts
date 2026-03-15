
import { Controller, Get, Post, Patch, Delete, Body, Param, Req, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { TelegramService } from './telegram.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
    constructor(
        private readonly notificationsService: NotificationsService,
        private readonly telegramService: TelegramService
    ) { }

    @Get()
    async findAll(@Req() req) {
        return this.notificationsService.findAll(req.user.id);
    }

    @Patch(':id/read')
    async markAsRead(@Param('id') id: string, @Req() req) {
        return this.notificationsService.markAsRead(id, req.user.id);
    }

    @Delete(':id')
    async remove(@Param('id') id: string, @Req() req) {
        return this.notificationsService.remove(id, req.user.id);
    }

    @Post('settings')
    async updateSettings(@Req() req, @Body() body: any) {
        return this.notificationsService.updateSettings(req.user.id, body);
    }

    @Post('telegram/setup')
    async setupTelegram(@Req() req) {
        const otp = await this.telegramService.generateOtp(req.user.id);
        return { otp, botUsername: process.env.TELEGRAM_BOT_USERNAME };
    }

    @Post('telegram/disconnect')
    async disconnectTelegram(@Req() req) {
        await this.telegramService.disconnectUser(req.user.id);
        return { message: 'Telegram disconnected successfully' };
    }

    @Get('telegram/status')
    async getTelegramStatus(@Req() req) {
        const connected = await this.telegramService.isUserConnected(req.user.id);
        return { connected };
    }

    @Get('whatsapp/status')
    async getWhatsAppStatus(@Req() req) {
        return this.notificationsService.getWhatsAppStatus(req.user.id);
    }

    @Post('whatsapp/code')
    async generateWhatsAppCode(@Req() req) {
        return this.notificationsService.generateWhatsAppCode(req.user.id);
    }

    @Post('test')
    async sendTest(@Req() req, @Body() body: { title: string; message: string; type?: string }) {
        return this.notificationsService.create(req.user.id, {
            title: body.title || 'Test Notification',
            message: body.message || 'This is a test notification.',
            type: body.type as any || 'INFO'
        });
    }
}
