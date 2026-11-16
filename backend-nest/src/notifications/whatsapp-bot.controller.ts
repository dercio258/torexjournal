import { Controller, Post, HttpCode, HttpStatus, Body, Headers, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { timingSafeEqualStr } from '../common/security/security.config';

@Controller('whatsapp')
export class WhatsAppBotController {
    private readonly logger = new Logger(WhatsAppBotController.name);

    constructor(
        private readonly eventEmitter: EventEmitter2,
        private readonly configService: ConfigService,
    ) { }

    @Post('webhook')
    @HttpCode(HttpStatus.OK)
    async handleWebhook(
        @Body() body: any,
        @Headers('x-webhook-secret') headerSecret?: string,
        @Headers('apikey') apiKeyHeader?: string,
        @Headers('authorization') authHeader?: string,
    ) {
        const expectedSecret =
            this.configService.get<string>('EVOLUTION_WEBHOOK_SECRET') ||
            this.configService.get<string>('EVOLUTION_API_KEY');
        const isProd = this.configService.get<string>('NODE_ENV') === 'production';

        if (!expectedSecret) {
            if (isProd) {
                this.logger.warn('Webhook WhatsApp bloqueado: EVOLUTION_WEBHOOK_SECRET/EVOLUTION_API_KEY não configurado em produção.');
                throw new UnauthorizedException('Webhook secret não configurado');
            }
        } else {
            const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
            const provided = String(headerSecret || apiKeyHeader || bearer || '').trim();
            if (!provided || !timingSafeEqualStr(provided, expectedSecret)) {
                this.logger.warn('Tentativa não autorizada no webhook WhatsApp (segredo inválido/ausente).');
                throw new UnauthorizedException('Invalid webhook signature');
            }
        }

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

