import * as crypto from 'crypto';
import { Process, Processor } from '@nestjs/bull';
import { Logger, Optional } from '@nestjs/common';
import { Job } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PushSubscriptionEntity } from './push-subscription.entity';
import { PushDeliveryLogEntity } from './push-delivery-log.entity';
import {
    PushProducerService,
    WebPushDispatchPayload,
    sanitizeSafePushPayload,
} from './push-producer.service';
import { resolveVapidKeysFromEnv, sendEncryptedWebPushRequest } from './web-push-crypto.util';

@Processor('push-queue')
export class PushProcessor {
    private readonly logger = new Logger(PushProcessor.name);
    private warnedMissingProdVapid = false;

    constructor(
        @InjectRepository(PushSubscriptionEntity)
        private readonly subRepo: Repository<PushSubscriptionEntity>,
        private readonly pushProducer: PushProducerService,
        @Optional()
        @InjectRepository(PushDeliveryLogEntity)
        private readonly deliveryLogRepo?: Repository<PushDeliveryLogEntity>,
    ) {}

    @Process('post-import-journal')
    async handlePostImportJournal(job: Job<{ userId: string }>) {
        const userId = String(job.data?.userId || '').trim();
        if (!userId) return;
        await this.pushProducer.processPostImportJournalReminder(userId);
    }

    @Process('send-web-push')
    async handleSendWebPush(job: Job<WebPushDispatchPayload>) {
        const { userId, title, body, url, tag, icon, clickToken, moderationMode } = job.data || {};
        if (!userId || !title || !body) return;

        const sanitized = sanitizeSafePushPayload(title, body, tag || '');
        if (!sanitized.allowed) {
            this.logger.debug(`Skipped sensitive Web Push at worker for user=${userId} tag=${tag}`);
            return;
        }

        const vapid = resolveVapidKeysFromEnv();
        if (!vapid) {
            if (!this.warnedMissingProdVapid) {
                this.warnedMissingProdVapid = true;
                this.logger.warn(
                    'VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY não configurados em produção — entrega Web Push ignorada.',
                );
            }
            return;
        }

        const subs = await this.subRepo.find({
            where: { userId, isActive: true },
        });
        if (subs.length === 0) return;

        const resolvedClickToken = clickToken || crypto.randomUUID();
        const notificationPayload = {
            title: sanitized.title,
            body: sanitized.body,
            url: url || '/dashboard',
            tag: tag || 'torex-general',
            icon: icon || '/pwa-192x192.png',
            clickToken: resolvedClickToken,
        };

        let sentOkCount = 0;

        for (const sub of subs) {
            try {
                const res = await sendEncryptedWebPushRequest({
                    endpoint: sub.endpoint,
                    p256dh: sub.p256dh,
                    auth: sub.auth,
                    payload: notificationPayload,
                    vapid,
                });

                if (res.ok) {
                    sentOkCount++;
                    sub.lastSentAt = new Date();
                    sub.failureCount = 0;
                    await this.subRepo.save(sub);
                } else if (res.gone) {
                    sub.isActive = false;
                    await this.subRepo.save(sub);
                    this.logger.debug(`Deactivated expired Web Push subscription ${sub.id} (${res.status})`);
                } else {
                    sub.failureCount = (sub.failureCount || 0) + 1;
                    if (sub.failureCount >= 5) {
                        sub.isActive = false;
                    }
                    await this.subRepo.save(sub);
                    this.logger.warn(`Web Push HTTP ${res.status} for ${sub.id}: ${res.error}`);
                }
            } catch (err: any) {
                sub.failureCount = (sub.failureCount || 0) + 1;
                if (sub.failureCount >= 5) {
                    sub.isActive = false;
                }
                await this.subRepo.save(sub).catch(() => {});
                this.logger.warn(`Web Push dispatch error for ${sub.id}: ${err?.message || err}`);
            }
        }

        if (sentOkCount > 0 && this.deliveryLogRepo) {
            const logEntry = this.deliveryLogRepo.create({
                userId,
                clickToken: resolvedClickToken,
                category: String(tag || 'torex-general').slice(0, 64),
                title: sanitized.title.slice(0, 120),
                status: 'SENT',
                sentAt: new Date(),
                moderationMode: moderationMode || 'ENGAGED',
            });
            await this.deliveryLogRepo.save(logEntry).catch((err) => {
                this.logger.debug(`Failed to record push_delivery_logs: ${err?.message || err}`);
            });
        }
    }
}
