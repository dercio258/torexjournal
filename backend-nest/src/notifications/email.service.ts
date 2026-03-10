import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
    private transporter: nodemailer.Transporter;
    private readonly logger = new Logger(EmailService.name);

    constructor() {
        // Initialize the standard transporter
        // Assumes that standard SMTP environment variables are defined
        this.transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT) || 587,
            secure: process.env.SMTP_SECURE === 'true',
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            },
        });
    }

    async sendEmail(to: string, subject: string, text: string, html?: string): Promise<boolean> {
        if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
            this.logger.warn('Mock Email Dispatch (SMTP not fully configured):');
            this.logger.warn(`To: ${to} | Subject: ${subject}`);
            return true;
        }

        try {
            const info = await this.transporter.sendMail({
                from: `"Torex Journal" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
                to,
                subject,
                text,
                html: html || text,
            });
            this.logger.log(`Email sent: ${info.messageId}`);
            return true;
        } catch (error) {
            this.logger.error(`Error sending email to ${to}:`, error);
            return false;
        }
    }
}
