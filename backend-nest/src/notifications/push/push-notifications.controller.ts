import {
    BadRequestException,
    Body,
    Controller,
    Get,
    Optional,
    Post,
    Request,
    UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Transform, Type } from 'class-transformer';
import {
    IsBoolean,
    IsIn,
    IsObject,
    IsOptional,
    IsString,
    MaxLength,
    MinLength,
    ValidateNested,
} from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PushSubscriptionEntity } from './push-subscription.entity';
import { PushDeliveryLogEntity } from './push-delivery-log.entity';
import { PushProducerService } from './push-producer.service';
import {
    resolveVapidKeysFromEnv,
    validatePushSubscriptionEndpoint,
} from './web-push-crypto.util';

class PushKeysDto {
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    @IsString()
    @MinLength(20)
    @MaxLength(256)
    p256dh: string;

    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    @IsString()
    @MinLength(8)
    @MaxLength(128)
    auth: string;
}

class SubscribePushDto {
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    @IsString()
    @MaxLength(1024)
    endpoint: string;

    @IsObject()
    @ValidateNested()
    @Type(() => PushKeysDto)
    keys: PushKeysDto;

    @IsOptional()
    @IsBoolean()
    isStandaloneApp?: boolean;

    @IsOptional()
    @IsIn(['pt', 'en'])
    locale?: 'pt' | 'en';

    @IsOptional()
    @IsString()
    @MaxLength(120)
    deviceLabel?: string;

    @IsOptional()
    @IsBoolean()
    sendWelcome?: boolean;
}

class UnsubscribePushDto {
    @IsOptional()
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    @IsString()
    @MaxLength(1024)
    endpoint?: string;
}

class TrackPushInteractionDto {
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    @IsString()
    @MinLength(16)
    @MaxLength(80)
    clickToken: string;

    @IsIn(['CLICKED', 'DISMISSED'])
    event: 'CLICKED' | 'DISMISSED';
}

@Controller('notifications/push')
export class PushNotificationsController {
    constructor(
        @InjectRepository(PushSubscriptionEntity)
        private readonly subRepo: Repository<PushSubscriptionEntity>,
        private readonly pushProducer: PushProducerService,
        @Optional()
        @InjectRepository(PushDeliveryLogEntity)
        private readonly deliveryLogRepo?: Repository<PushDeliveryLogEntity>,
    ) {}

    @Get('vapid-public-key')
    getVapidPublicKey() {
        const keys = resolveVapidKeysFromEnv();
        if (!keys) {
            return { enabled: false, publicKey: null };
        }
        return {
            enabled: true,
            publicKey: keys.publicKey,
            ephemeralDev: keys.ephemeralDev,
        };
    }

    @UseGuards(JwtAuthGuard)
    @Get('status')
    async getStatus(@Request() req) {
        const activeCount = await this.subRepo.count({
            where: { userId: req.user.id, isActive: true },
        });
        return {
            subscribed: activeCount > 0,
            activeDevices: activeCount,
        };
    }

    @UseGuards(JwtAuthGuard)
    @Throttle({ default: { limit: 15, ttl: 60000 } })
    @Post('subscribe')
    async subscribe(@Request() req, @Body() body: SubscribePushDto) {
        try {
            validatePushSubscriptionEndpoint(body.endpoint);
        } catch (err: any) {
            throw new BadRequestException(err?.message || 'Endpoint Web Push inválido.');
        }

        const p256dhBuf = Buffer.from(body.keys.p256dh, 'base64url');
        if (p256dhBuf.length !== 65 || p256dhBuf[0] !== 0x04) {
            throw new BadRequestException('Chave pública p256dh inválida para Web Push.');
        }

        const userAgent = String(req.headers['user-agent'] || '').slice(0, 512) || null;
        let existing = await this.subRepo.findOne({ where: { endpoint: body.endpoint } });
        if (existing) {
            existing.userId = req.user.id;
            existing.p256dh = body.keys.p256dh;
            existing.auth = body.keys.auth;
            existing.userAgent = userAgent;
            existing.deviceLabel = body.deviceLabel || existing.deviceLabel;
            existing.isStandaloneApp = Boolean(body.isStandaloneApp);
            existing.locale = body.locale || existing.locale || 'pt';
            existing.isActive = true;
            existing.failureCount = 0;
            await this.subRepo.save(existing);
        } else {
            existing = this.subRepo.create({
                userId: req.user.id,
                endpoint: body.endpoint,
                p256dh: body.keys.p256dh,
                auth: body.keys.auth,
                userAgent,
                deviceLabel: body.deviceLabel || null,
                isStandaloneApp: Boolean(body.isStandaloneApp),
                locale: body.locale || 'pt',
                isActive: true,
                failureCount: 0,
            });
            await this.subRepo.save(existing);
        }

        if (body.sendWelcome !== false) {
            void this.pushProducer.enqueueWelcomePushOnce(req.user.id, body.locale);
        }

        return {
            success: true,
            subscriptionId: existing.id,
        };
    }

    @UseGuards(JwtAuthGuard)
    @Post('unsubscribe')
    async unsubscribe(@Request() req, @Body() body: UnsubscribePushDto) {
        if (body?.endpoint) {
            await this.subRepo.update(
                { userId: req.user.id, endpoint: body.endpoint },
                { isActive: false },
            );
        } else {
            await this.subRepo.update(
                { userId: req.user.id },
                { isActive: false },
            );
        }
        return { success: true };
    }

    @Throttle({ default: { limit: 60, ttl: 60000 } })
    @Post('track')
    async trackInteraction(@Body() body: TrackPushInteractionDto) {
        if (!this.deliveryLogRepo || !body?.clickToken) {
            return { ok: true };
        }
        const existing = await this.deliveryLogRepo.findOne({
            where: { clickToken: body.clickToken },
        });
        if (!existing) {
            return { ok: true };
        }
        // Monotonic: once CLICKED, keep CLICKED even if close fired shortly after
        if (existing.status !== 'CLICKED') {
            existing.status = body.event;
            existing.interactedAt = new Date();
            await this.deliveryLogRepo.save(existing).catch(() => {});
        }
        return { ok: true };
    }
}
