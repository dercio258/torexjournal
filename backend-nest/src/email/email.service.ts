import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { ConfigService } from '@nestjs/config';
import { EmailTemplateData, Templates } from './email-templates';

@Injectable()
export class EmailService {
    private transporter: nodemailer.Transporter;
    private readonly logger = new Logger(EmailService.name);

    constructor(private configService: ConfigService) {
        this.transporter = this.createTransporter();
    }

    private createTransporter(): nodemailer.Transporter {
        const host = this.configService.get<string>('SMTP_HOST') || 'smtppro.zoho.com';
        const port = this.configService.get<number>('SMTP_PORT') || 465;
        const secure = this.configService.get<string>('SMTP_SECURE') !== 'false';
        const user = this.configService.get<string>('Email_notification');
        const pass = this.configService.get<string>('Email_notification_pass');

        return nodemailer.createTransport({
            host,
            port,
            secure,
            auth: {
                user,
                pass,
            },
        });
    }

    private initializeTransporter() {
        this.transporter = this.createTransporter();
    }

    async sendEmail(to: string, subject: string, text: string, html?: string): Promise<boolean> {
        const user = this.configService.get<string>('Email_notification');
        const pass = this.configService.get<string>('Email_notification_pass');

        if (!user || !pass) {
            this.logger.warn('Mock Email Dispatch (Zoho not fully configured in .env):');
            this.logger.warn(`To: ${to} | Subject: ${subject}`);
            return true;
        }

        try {
            const from = this.configService.get<string>('SMTP_FROM') || `"Torex Journal" <${user}>`;
            const info = await this.transporter.sendMail({
                from,
                to,
                subject,
                text,
                html: html || this.wrapProfessionalTemplate(subject, text),
            });
            this.logger.log(`Email sent: ${info.messageId}`);
            return true;
        } catch (error: any) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorCode = (error as any)?.code;
            
            this.logger.error(`Error sending email to ${to}:`, errorMessage);
            
            // Retry once if connection was dropped
            if (errorCode === 'ECONNECTION' || errorCode === 'ETIMEDOUT') {
                this.initializeTransporter();
                return this.sendEmail(to, subject, text, html);
            }
            return false;
        }
    }

    async sendTemplatedEmail(to: string, template: keyof typeof Templates, data: any): Promise<boolean> {
        const templateFn = Templates[template] as any;
        if (!templateFn) {
            this.logger.error(`Template ${template} not found`);
            return false;
        }

        const html = templateFn(data);
        const subject = data.subject || data.title || 'Torex Journal Notice';
        
        return this.sendEmail(to, subject, data.message || '', html);
    }

    private wrapProfessionalTemplate(title: string, content: string): string {
        // Professional HTML Template with logo and styling
        const logoUrl = 'https://torexjournal.com/logo.png'; // Placeholder for professional logo
        
        return `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
                .container { max-width: 600px; margin: 20px auto; border: 1px solid #eee; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.05); }
                .header { background-color: #1a1a1a; padding: 30px; text-align: center; }
                .header img { max-width: 150px; height: auto; }
                .content { padding: 40px; background-color: #ffffff; }
                .footer { background-color: #f9f9f9; padding: 20px; text-align: center; font-size: 12px; color: #777; border-top: 1px solid #eee; }
                .button { display: inline-block; padding: 12px 25px; background-color: #007bff; color: #ffffff; text-decoration: none; border-radius: 5px; font-weight: bold; margin-top: 20px; }
                .subtitle { color: #007bff; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; font-size: 14px; margin-bottom: 10px; display: block; }
                h1 { margin-top: 0; color: #111; font-size: 24px; }
                p { margin-bottom: 20px; }
                .divider { height: 1px; background-color: #eee; margin: 30px 0; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <img src="${logoUrl}" alt="Torex Journal Logo">
                </div>
                <div class="content">
                    <span class="subtitle">TOREX JOURNAL SERVICE</span>
                    <h1>${title}</h1>
                    <div class="divider"></div>
                    <div>
                        ${content.split('\n').map(p => p ? `<p>${p}</p>` : '').join('')}
                    </div>
                </div>
                <div class="footer">
                    &copy; ${new Date().getFullYear()} Torex Journal. Todos os direitos reservados.<br>
                    Gestão de Trading Profissional
                </div>
            </div>
        </body>
        </html>
        `;
    }
}
