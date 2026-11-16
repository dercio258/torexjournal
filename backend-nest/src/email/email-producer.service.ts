import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { JobOptions, Queue } from 'bull';
import { getCorrelationId } from '../common/observability/correlation.context';
import { TelemetryService } from '../common/observability/telemetry.service';
import { EmailTemplateName, EmailTemplatePayloadMap } from './templates';

export interface EmailTrackingMeta {
    broadcastId?: string;
    userId?: string;
    utmCampaign?: string;
    utmMedium?: string;
}

export interface EnqueueEmailOptions {
    priority?: 1 | 2 | 3;
    jobId?: string;
    delayMs?: number;
    attempts?: number;
    correlationId?: string;
    trackingMeta?: EmailTrackingMeta;
}

const TEMPLATE_DEFAULT_PRIORITY: Record<EmailTemplateName, 1 | 2 | 3> = {
    OTP_CODE: 1,
    PASSWORD_RECOVERY: 1,
    ACCOUNT_LOCKED: 1,

    PAYMENT_INITIATED: 2,
    PAYMENT_SUCCESS: 2,
    PAYMENT_FAILED: 2,
    TRIAL_WELCOME: 2,
    SUBSCRIPTION_EXPIRING: 2,
    SUBSCRIPTION_EXPIRED: 2,
    SUBSCRIPTION_CANCELLED: 2,
    WELCOME_EMAIL: 2,
    LOGIN_ALERT: 2,
    MT5_STATUS: 2,

    TRADE_IMPORTED: 3,
    WEEKLY_SUMMARY: 3,
    SYSTEM_ALERT: 3,
    GENERAL_NOTIFICATION: 3,
    REMARKETING_FOLLOWUP: 3,
};

@Injectable()
export class EmailProducerService {
    private readonly logger = new Logger(EmailProducerService.name);

    constructor(
        @InjectQueue('email-queue') private readonly emailQueue: Queue,
        @Optional() private readonly telemetry?: TelemetryService,
    ) {}

    /**
     * Enqueues a typed institutional email job in Redis (`email-queue`).
     * Never blocks HTTP/WebSocket handlers on SMTP network I/O.
     */
    async enqueue<K extends EmailTemplateName>(
        to: string,
        template: K,
        data: EmailTemplatePayloadMap[K],
        options: EnqueueEmailOptions = {},
    ): Promise<boolean> {
        const cleanTo = (to || '').trim().toLowerCase();
        if (!cleanTo || !cleanTo.includes('@')) {
            this.logger.warn(`Skipped enqueueing ${template}: invalid recipient "${to}"`);
            return false;
        }

        const correlationId = options.correlationId || getCorrelationId();
        const priority = options.priority ?? TEMPLATE_DEFAULT_PRIORITY[template] ?? 2;

        const jobOptions: JobOptions = {
            priority,
            attempts: options.attempts ?? 5,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: 200,
            removeOnFail: 500,
            ...(options.delayMs ? { delay: options.delayMs } : {}),
            ...(options.jobId ? { jobId: options.jobId } : {}),
        };

        try {
            if (options.jobId) {
                const existing = await this.emailQueue.getJob(options.jobId);
                if (existing) {
                    const state = await existing.getState();
                    if (state !== 'failed') {
                        this.telemetry?.recordEmailDeduplicated();
                        this.logger.debug(
                            `Deduplicated email job ${options.jobId} (${template} -> ${cleanTo}, state=${state})`,
                        );
                        return false;
                    }
                    // Allow re-enqueue if a previous deterministic job failed all attempts
                    await existing.remove().catch(() => undefined);
                }
            }

            await this.emailQueue.add(
                'send-template',
                {
                    to: cleanTo,
                    template,
                    data,
                    correlationId,
                    trackingMeta: options.trackingMeta,
                    enqueuedAt: new Date().toISOString(),
                },
                jobOptions,
            );

            this.telemetry?.recordEmailEnqueued(template, 1);
            return true;
        } catch (err: any) {
            this.logger.error(
                `Failed to enqueue ${template} for ${cleanTo}: ${err?.message || err}`,
            );
            this.telemetry?.recordError(
                'email-queue',
                `Enqueue failed for ${template}: ${err?.message || err}`,
                correlationId,
            );
            return false;
        }
    }

    /**
     * Enqueues large batches (broadcasts, weekly digests, expiration crons) in chunks of 100
     * using Redis pipeline (`addBulk`) for minimal latency.
     */
    async enqueueBulk<K extends EmailTemplateName>(
        items: Array<{
            to: string;
            template: K;
            data: EmailTemplatePayloadMap[K];
            jobId?: string;
            trackingMeta?: EmailTrackingMeta;
        }>,
        options: Omit<EnqueueEmailOptions, 'jobId'> = {},
    ): Promise<number> {
        const validItems = items.filter((item) => item.to && item.to.includes('@'));
        if (validItems.length === 0) return 0;

        const correlationId = options.correlationId || getCorrelationId();
        const CHUNK_SIZE = 100;
        let enqueuedCount = 0;

        for (let i = 0; i < validItems.length; i += CHUNK_SIZE) {
            const slice = validItems.slice(i, i + CHUNK_SIZE);
            const bulkJobs = slice.map((item) => {
                const cleanTo = item.to.trim().toLowerCase();
                const priority =
                    options.priority ?? TEMPLATE_DEFAULT_PRIORITY[item.template] ?? 3;

                return {
                    name: 'send-template',
                    data: {
                        to: cleanTo,
                        template: item.template,
                        data: item.data,
                        correlationId,
                        trackingMeta: item.trackingMeta || options.trackingMeta,
                        enqueuedAt: new Date().toISOString(),
                    },
                    opts: {
                        priority,
                        attempts: options.attempts ?? 5,
                        backoff: { type: 'exponential', delay: 5000 },
                        removeOnComplete: 200,
                        removeOnFail: 500,
                        ...(options.delayMs ? { delay: options.delayMs } : {}),
                        ...(item.jobId ? { jobId: item.jobId } : {}),
                    } as JobOptions,
                };
            });

            try {
                await this.emailQueue.addBulk(bulkJobs);
                enqueuedCount += bulkJobs.length;
                for (const job of slice) {
                    this.telemetry?.recordEmailEnqueued(job.template, 1);
                }
            } catch (err: any) {
                this.logger.error(
                    `Bulk email enqueue chunk failed (${slice.length} items): ${err?.message || err}`,
                );
                this.telemetry?.recordError(
                    'email-queue',
                    `Bulk enqueue chunk failed: ${err?.message || err}`,
                    correlationId,
                );
            }
        }

        return enqueuedCount;
    }

    /**
     * Enqueues a raw email through Redis (`send-raw`) when no template applies.
     */
    async enqueueRaw(
        to: string,
        subject: string,
        text: string,
        html?: string,
        options: EnqueueEmailOptions = {},
    ): Promise<boolean> {
        const cleanTo = (to || '').trim().toLowerCase();
        if (!cleanTo || !cleanTo.includes('@')) return false;

        const correlationId = options.correlationId || getCorrelationId();
        await this.emailQueue.add(
            'send-raw',
            { to: cleanTo, subject, text, html, correlationId },
            {
                priority: options.priority ?? 3,
                attempts: options.attempts ?? 5,
                backoff: { type: 'exponential', delay: 5000 },
                removeOnComplete: 200,
                removeOnFail: 500,
                ...(options.jobId ? { jobId: options.jobId } : {}),
            },
        );
        this.telemetry?.recordEmailEnqueued('RAW', 1);
        return true;
    }
}
