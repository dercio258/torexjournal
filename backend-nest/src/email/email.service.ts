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
        const host = this.configService.get<string>('MAIL_HOST') || this.configService.get<string>('SMTP_HOST') || 'mail.ratixpay.co.mz';
        const port = this.configService.get<number>('MAIL_PORT') || this.configService.get<number>('SMTP_PORT') || 587;
        const secure = this.configService.get<boolean>('SMTP_SECURE') ?? false; // Port 587 usually requires secure: false (STARTTLS)
        const user = this.configService.get<string>('MAIL_USER') || this.configService.get<string>('Email_notification');
        const pass = this.configService.get<string>('MAIL_PASS') || this.configService.get<string>('Email_notification_pass');

        return nodemailer.createTransport({
            host,
            port,
            secure,
            auth: {
                user,
                pass,
            },
            tls: {
                rejectUnauthorized: false
            }
        });
    }

    private initializeTransporter() {
        this.transporter = this.createTransporter();
    }

    async sendEmail(to: string, subject: string, text: string, html?: string): Promise<boolean> {
        const user = this.configService.get<string>('MAIL_USER') || this.configService.get<string>('Email_notification');
        const pass = this.configService.get<string>('MAIL_PASS') || this.configService.get<string>('Email_notification_pass');

        if (!user || !pass) {
            this.logger.warn('Mock Email Dispatch (SMTP not fully configured in .env):');
            this.logger.warn(`To: ${to} | Subject: ${subject}`);
            return true;
        }

        try {
            const from = this.configService.get<string>('MAIL_FROM') || this.configService.get<string>('SMTP_FROM') || `"Torex Journal" <${user}>`;
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
        const logoUrl = 'https://res.cloudinary.com/dndlqdylc/image/upload/v1773270778/Touro_design_1_1_udrkwi.jpg';
        
        return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body { font-family: 'Inter', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #1e293b; margin: 0; padding: 0; background-color: #f8fafc; }
                .container { max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; }
                .header { background-color: #0f172a; padding: 40px 30px; text-align: center; background-image: linear-gradient(to bottom right, #0f172a, #1e293b); }
                .header img { max-width: 180px; height: auto; display: block; margin: 0 auto; }
                .content { padding: 45px 40px; }
                .footer { background-color: #f8fafc; padding: 35px; text-align: center; font-size: 13px; color: #64748b; border-top: 1px solid #f1f5f9; }
                .subtitle { color: #10b981; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; font-size: 12px; margin-bottom: 12px; display: block; }
                h1 { margin-top: 0; color: #0f172a; font-size: 26px; font-weight: 800; line-height: 1.2; }
                p { margin-bottom: 20px; color: #475569; }
                .divider { height: 1px; background-color: #f1f5f9; margin: 30px 0; }
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
                    <b>Torex Journal Service</b><br>
                    Elevando o seu trading através de dados e disciplina.<br>
                    <p style="margin-top: 25px; font-size: 11px;">&copy; ${new Date().getFullYear()} Torex Journal. Todos os direitos reservados.</p>
                </div>
            </div>
        </body>
        </html>
        `;
    }
}
