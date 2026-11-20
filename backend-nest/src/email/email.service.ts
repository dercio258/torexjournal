import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { TelemetryService } from '../common/observability/telemetry.service';
import { AnalyticsService } from '../analytics/analytics.service';
import {
    BASE_LAYOUT,
    EmailTemplateName,
    EmailTemplatePayloadMap,
    escapeHtml,
    htmlToPlainText,
    renderCleanParagraphs,
    renderEmailTemplate,
    renderHeading,
    renderStatusEyebrow,
} from './email-templates';

const NO_TRACK_SECURITY_TEMPLATES = new Set([
    'OTP_CODE',
    'PASSWORD_RECOVERY',
    'ACCOUNT_LOCKED',
    'LOGIN_ALERT',
]);

@Injectable()
export class EmailService implements OnModuleDestroy {
    private transporter: nodemailer.Transporter;
    private readonly logger = new Logger(EmailService.name);
    private lastResetAt = 0;

    constructor(
        private readonly configService: ConfigService,
        @Optional() private readonly telemetry?: TelemetryService,
        @Optional() private readonly analyticsService?: AnalyticsService,
    ) {
        this.transporter = this.createTransporter();
    }

    onModuleDestroy() {
        try {
            this.transporter?.close?.();
        } catch {
            // Ignore close errors on shutdown
        }
    }

    private parseBoolean(value: unknown, fallback: boolean): boolean {
        if (value === undefined || value === null || value === '') return fallback;
        if (typeof value === 'boolean') return value;
        const normalized = String(value).trim().toLowerCase();
        if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
        if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
        return fallback;
    }

    private createTransporter(): nodemailer.Transporter {
        const host =
            this.configService.get<string>('MAIL_HOST') ||
            this.configService.get<string>('SMTP_HOST') ||
            'mail.ratixpay.co.mz';
        const rawPort =
            this.configService.get<string | number>('MAIL_PORT') ||
            this.configService.get<string | number>('SMTP_PORT') ||
            587;
        const port = Number(rawPort) || 587;
        const secure = this.parseBoolean(
            this.configService.get('SMTP_SECURE') ?? this.configService.get('MAIL_SECURE'),
            port === 465,
        );
        const user =
            this.configService.get<string>('MAIL_USER') ||
            this.configService.get<string>('Email_notification');
        const pass =
            this.configService.get<string>('MAIL_PASS') ||
            this.configService.get<string>('Email_notification_pass');

        return nodemailer.createTransport({
            pool: true,
            maxConnections: 5,
            maxMessages: 100,
            host,
            port,
            secure,
            connectionTimeout: 10000,
            greetingTimeout: 10000,
            socketTimeout: 20000,
            auth: user && pass ? { user, pass } : undefined,
            tls: {
                rejectUnauthorized: this.parseBoolean(
                    this.configService.get('SMTP_TLS_REJECT_UNAUTHORIZED'),
                    true,
                ),
            },
        });
    }

    private resetTransporter(): void {
        const now = Date.now();
        if (now - this.lastResetAt < 15_000) {
            return;
        }
        this.lastResetAt = now;
        const previous = this.transporter;
        this.transporter = this.createTransporter();
        if (previous) {
            // Delay closing previous pooled socket so concurrent workers in-flight can finish safely
            const timer = setTimeout(() => {
                try {
                    previous.close?.();
                } catch {
                    // Ignore close failure
                }
            }, 10_000);
            timer.unref?.();
        }
    }

    async sendEmail(
        to: string,
        subject: string,
        text: string,
        html?: string,
        options: {
            throwOnError?: boolean;
            templateName?: string;
            broadcastId?: string;
            userId?: string;
            utmCampaign?: string;
            utmMedium?: string;
        } = {},
    ): Promise<boolean> {
        const startedAt = Date.now();
        const templateLabel = options.templateName || 'RAW';
        const user =
            this.configService.get<string>('MAIL_USER') ||
            this.configService.get<string>('Email_notification');
        const pass =
            this.configService.get<string>('MAIL_PASS') ||
            this.configService.get<string>('Email_notification_pass');

        const baseHtml = html || this.wrapProfessionalTemplate(subject, text);
        const resolvedText = text && text.trim().length > 0 ? text : htmlToPlainText(baseHtml);

        const skipTracking = NO_TRACK_SECURITY_TEMPLATES.has(String(templateLabel).toUpperCase());
        const decorated =
            this.analyticsService && !skipTracking
                ? await this.analyticsService.createEmailTrackingTokenAndDecorateHtml({
                      to,
                      template: templateLabel,
                      subject,
                      html: baseHtml,
                      userId: options.userId || null,
                      broadcastId: options.broadcastId || null,
                      utmCampaign: options.utmCampaign || null,
                      utmMedium: options.utmMedium || null,
                  })
                : { html: baseHtml, token: null };
        const resolvedHtml = decorated.html;

        if (!user || !pass) {
            this.logger.warn(
                `SMTP mock dispatch -> to=${to} template=${templateLabel} subject="${subject}"`,
            );
            this.telemetry?.recordEmailSent(templateLabel, Date.now() - startedAt, true);
            return true;
        }

        try {
            const from =
                this.configService.get<string>('MAIL_FROM') ||
                this.configService.get<string>('SMTP_FROM') ||
                `"Torex Journal" <${user}>`;

            const info = await this.transporter.sendMail({
                from,
                to,
                subject,
                text: resolvedText,
                html: resolvedHtml,
            });

            const durationMs = Date.now() - startedAt;
            this.telemetry?.recordEmailSent(templateLabel, durationMs, false);
            this.logger.log(
                `Delivered email template=${templateLabel} to=${to} msgId=${info.messageId} (${durationMs}ms)`,
            );
            return true;
        } catch (error: any) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorCode = error?.code;

            // Reset pooled transporter on dropped socket so Bull's next retry gets a fresh connection
            if (
                errorCode === 'ECONNECTION' ||
                errorCode === 'ETIMEDOUT' ||
                errorCode === 'ESOCKET' ||
                errorCode === 'ECONNRESET'
            ) {
                this.resetTransporter();
            }

            this.logger.error(
                `SMTP error sending ${templateLabel} to ${to} [code=${errorCode || 'UNKNOWN'}]: ${errorMessage}`,
            );

            if (options.throwOnError) {
                throw error;
            }
            return false;
        }
    }

    async sendTemplatedEmail<K extends EmailTemplateName>(
        to: string,
        template: K,
        data: EmailTemplatePayloadMap[K],
        options: {
            throwOnError?: boolean;
            broadcastId?: string;
            userId?: string;
            utmCampaign?: string;
            utmMedium?: string;
        } = {},
    ): Promise<boolean> {
        const rendered = renderEmailTemplate(template, data);
        const finalSubject = (data as any)?.subject || rendered.subject;

        return this.sendEmail(to, finalSubject, rendered.text, rendered.html, {
            throwOnError: options.throwOnError,
            templateName: template,
            broadcastId: options.broadcastId,
            userId: options.userId,
            utmCampaign: options.utmCampaign,
            utmMedium: options.utmMedium,
        });
    }

    private wrapProfessionalTemplate(title: string, content: string): string {
        const innerContent = `
            ${renderStatusEyebrow('Comunicado Institucional', 'slate')}
            ${renderHeading(escapeHtml(title))}
            ${renderCleanParagraphs(content || '')}
        `;
        return BASE_LAYOUT(innerContent);
    }
}
