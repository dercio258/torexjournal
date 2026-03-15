import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { EmailService } from './email.service';

@Processor('email-queue')
export class EmailProcessor {
    private readonly logger = new Logger(EmailProcessor.name);

    constructor(private readonly emailService: EmailService) { }

    @Process('login-alert')
    async handleLoginAlert(job: Job) {
        const { email, ip, device, time, name } = job.data;
        try {
            this.logger.log(`📧 Sending Login Alert to ${email}...`);
            await this.emailService.sendTemplatedEmail(email, 'LOGIN_ALERT', {
                userName: name,
                ip,
                device,
                time
            });
            this.logger.log(`✅ Login Alert sent to ${email}`);
        } catch (error: any) {
            this.logger.warn(`⚠️ Email Send Failed: ${error.message}`);
        }
    }

    @Process('otp-alert')
    async handleOtpAlert(job: Job) {
        const { email, otp } = job.data;
        try {
            this.logger.log(`📧 Sending OTP to ${email}...`);
            await this.emailService.sendTemplatedEmail(email, 'OTP_CODE', { otp });
            this.logger.log(`✅ OTP sent to ${email}`);
        } catch (error: any) {
            this.logger.warn(`⚠️ Email Send Failed: ${error.message}`);
        }
    }

    @Process('welcome')
    async handleWelcome(job: Job) {
        const { email, name } = job.data;
        try {
            this.logger.log(`📧 Sending Welcome Email to ${email}...`);
            await this.emailService.sendTemplatedEmail(email, 'WELCOME_EMAIL', { userName: name });
            this.logger.log(`✅ Welcome Email sent to ${email}`);
        } catch (error: any) {
            this.logger.warn(`⚠️ Email Send Failed: ${error.message}`);
        }
    }

    @Process('mt5-connected')
    async handleMt5Connected(job: Job) {
        const { email, name, mt5_id } = job.data;
        try {
            await this.emailService.sendTemplatedEmail(email, 'MT5_STATUS', {
                userName: name,
                mt5Id: mt5_id,
                status: 'CONNECTED'
            });
            this.logger.log(`✅ Connected Email sent to ${email}`);
        } catch (error: any) {
            this.logger.warn(`⚠️ Email Send Failed: ${error.message}`);
        }
    }

    @Process('mt5-disconnected')
    async handleMt5Disconnected(job: Job) {
        const { email, name, mt5_id } = job.data;
        try {
            await this.emailService.sendTemplatedEmail(email, 'MT5_STATUS', {
                userName: name,
                mt5Id: mt5_id,
                status: 'DISCONNECTED'
            });
            this.logger.log(`✅ Disconnected Email sent to ${email}`);
        } catch (error: any) {
            this.logger.warn(`⚠️ Email Send Failed: ${error.message}`);
        }
    }

    @Process('trade-imported')
    async handleTradeImported(job: Job) {
        const { email, name, count, method } = job.data;
        try {
            await this.emailService.sendTemplatedEmail(email, 'TRADE_IMPORTED', {
                userName: name,
                count,
                method
            });
            this.logger.log(`✅ Trade Imported Email sent to ${email}`);
        } catch (error: any) {
            this.logger.warn(`⚠️ Email Send Failed: ${error.message}`);
        }
    }

    @Process('general-notification')
    async handleGeneralNotification(job: Job) {
        const { email, userName, title, message, subtitle, buttonUrl, buttonLabel } = job.data;
        try {
            this.logger.log(`📧 Sending General Notification to ${email}...`);
            await this.emailService.sendTemplatedEmail(email, 'GENERAL_NOTIFICATION', {
                userName,
                title,
                message,
                subtitle,
                buttonUrl,
                buttonLabel
            });
            this.logger.log(`✅ General Notification sent to ${email}`);
        } catch (error: any) {
            this.logger.warn(`⚠️ Email Send Failed: ${error.message}`);
        }
    }
}
