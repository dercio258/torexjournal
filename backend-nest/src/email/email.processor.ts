import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { Logger, Optional } from '@nestjs/common';
import { Job } from 'bull';
import { runWithCorrelation } from '../common/observability/correlation.context';
import { TelemetryService } from '../common/observability/telemetry.service';
import { EmailService } from './email.service';
import { EmailTemplateName, EmailTemplatePayloadMap } from './templates';

interface SendTemplateJobPayload<K extends EmailTemplateName = EmailTemplateName> {
    to: string;
    template: K;
    data: EmailTemplatePayloadMap[K];
    correlationId?: string;
    trackingMeta?: {
        broadcastId?: string;
        userId?: string;
        utmCampaign?: string;
        utmMedium?: string;
    };
}

@Processor('email-queue')
export class EmailProcessor {
    private readonly logger = new Logger(EmailProcessor.name);

    constructor(
        private readonly emailService: EmailService,
        @Optional() private readonly telemetry?: TelemetryService,
    ) {}

    /**
     * Primary unified Redis queue handler for all 18 institutional email templates.
     * Re-throws transient SMTP errors so Bull executes exponential backoff retries.
     */
    @Process({ name: 'send-template', concurrency: 5 })
    async handleSendTemplate(job: Job<SendTemplateJobPayload>) {
        const { to, template, data, correlationId, trackingMeta } = job.data;
        return runWithCorrelation({ correlationId }, async () => {
            await this.emailService.sendTemplatedEmail(to, template, data, {
                throwOnError: true,
                broadcastId: trackingMeta?.broadcastId,
                userId: trackingMeta?.userId,
                utmCampaign: trackingMeta?.utmCampaign,
                utmMedium: trackingMeta?.utmMedium,
            });
        });
    }

    @Process({ name: 'send-raw', concurrency: 2 })
    async handleSendRaw(
        job: Job<{
            to: string;
            subject: string;
            text: string;
            html?: string;
            correlationId?: string;
        }>,
    ) {
        const { to, subject, text, html, correlationId } = job.data;
        return runWithCorrelation({ correlationId }, async () => {
            await this.emailService.sendEmail(to, subject, text, html, {
                throwOnError: true,
                templateName: 'RAW',
            });
        });
    }

    // --- Legacy Queue Job Handlers (Backward-compatible for in-flight Redis jobs) ---

    @Process('login-alert')
    async handleLoginAlert(job: Job) {
        const { email, ip, device, time, name } = job.data;
        await this.emailService.sendTemplatedEmail(
            email,
            'LOGIN_ALERT',
            { userName: name, ip, device, time },
            { throwOnError: true },
        );
    }

    @Process('otp-alert')
    async handleOtpAlert(job: Job) {
        const { email, otp, expiresInMinutes, purpose, userName } = job.data;
        await this.emailService.sendTemplatedEmail(
            email,
            'OTP_CODE',
            { otp, expiresInMinutes, purpose, userName },
            { throwOnError: true },
        );
    }

    @Process('welcome')
    async handleWelcome(job: Job) {
        const { email, name } = job.data;
        await this.emailService.sendTemplatedEmail(
            email,
            'WELCOME_EMAIL',
            { userName: name },
            { throwOnError: true },
        );
    }

    @Process('mt5-connected')
    async handleMt5Connected(job: Job) {
        const { email, name, mt5_id, broker, server } = job.data;
        await this.emailService.sendTemplatedEmail(
            email,
            'MT5_STATUS',
            { userName: name, mt5Id: mt5_id, status: 'CONNECTED', broker, server },
            { throwOnError: true },
        );
    }

    @Process('mt5-disconnected')
    async handleMt5Disconnected(job: Job) {
        const { email, name, mt5_id, broker, server } = job.data;
        await this.emailService.sendTemplatedEmail(
            email,
            'MT5_STATUS',
            { userName: name, mt5Id: mt5_id, status: 'DISCONNECTED', broker, server },
            { throwOnError: true },
        );
    }

    @Process('trade-imported')
    async handleTradeImported(job: Job) {
        const { email, name, count, method, profit, currency, wins, losses } = job.data;
        await this.emailService.sendTemplatedEmail(
            email,
            'TRADE_IMPORTED',
            { userName: name, count, method, profit, currency, wins, losses },
            { throwOnError: true },
        );
    }

    @Process('general-notification')
    async handleGeneralNotification(job: Job) {
        const { email, userName, title, message, subtitle, buttonUrl, buttonLabel, subject } =
            job.data;
        await this.emailService.sendTemplatedEmail(
            email,
            'GENERAL_NOTIFICATION',
            { userName, title, message, subtitle, buttonUrl, buttonLabel, subject },
            { throwOnError: true },
        );
    }

    @Process('trial-welcome')
    async handleTrialWelcome(job: Job) {
        const { email, userName, days, expiryDate, dashboardUrl } = job.data;
        await this.emailService.sendTemplatedEmail(
            email,
            'TRIAL_WELCOME',
            { userName, days, expiryDate, dashboardUrl },
            { throwOnError: true },
        );
    }

    @OnQueueFailed()
    onFailed(job: Job, error: Error) {
        const maxAttempts = job.opts?.attempts || 1;
        const willRetry = job.attemptsMade < maxAttempts;
        const template = job.data?.template || job.name || 'UNKNOWN';
        const recipient = job.data?.to || job.data?.email || 'unknown';
        const correlationId = job.data?.correlationId;

        this.telemetry?.recordEmailFailed(
            template,
            error?.message || 'Unknown SMTP failure',
            willRetry,
            correlationId,
        );

        if (willRetry) {
            this.logger.warn(
                `Email job ${job.id} (${template} -> ${recipient}) attempt ${job.attemptsMade}/${maxAttempts} failed: ${error?.message}. Scheduled for exponential retry.`,
            );
        } else {
            this.logger.error(
                `Email job ${job.id} (${template} -> ${recipient}) exhausted all ${maxAttempts} attempts: ${error?.message}`,
            );
        }
    }
}
