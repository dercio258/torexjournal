import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Processor('email-queue')
export class EmailProcessor {
    private readonly logger = new Logger(EmailProcessor.name);

    constructor(private readonly configService: ConfigService) { }

    private createTransporter() {
        return nodemailer.createTransport({
            host: this.configService.get('EMAIL_HOST'),
            port: Number(this.configService.get('EMAIL_PORT')),
            secure: this.configService.get('EMAIL_SECURE') === 'true', // true for 465, false for other ports
            auth: {
                user: this.configService.get('EMAIL_SYSTEM_USER'),
                pass: this.configService.get('EMAIL_SYSTEM_PASS'),
            },
            tls: {
                rejectUnauthorized: false
            }
        });
    }

    @Process('login-alert')
    async handleLoginAlert(job: Job) {
        const { email, ip, device, time, name } = job.data;
        const transporter = this.createTransporter();
        const from = this.configService.get('EMAIL_FROM_DEFAULT');

        try {
            this.logger.log(`📧 Sending Login Alert to ${email}...`);

            // Allow failing silently if auth is bad to avoid crash loop
            try {
                await transporter.verify();
            } catch (e) {
                if (e.responseCode === 535 || e.responseCode === 554) {
                    this.logger.warn(`⚠️ Transport Verify Failed: ${e.message}`);
                    return;
                }
            }

            await transporter.sendMail({
                from,
                to: email,
                subject: '🚨 Novo Login Detectado - Torex Journal',
                html: `
                    <h1>Novo Login Detectado</h1>
                    <p>Olá <b>${name || 'Usuário'}</b>,</p>
                    <p>Detectamos um novo login em sua conta.</p>
                    <ul>
                        <li><b>Data:</b> ${time}</li>
                        <li><b>IP:</b> ${ip}</li>
                        <li><b>Dispositivo:</b> ${device}</li>
                    </ul>
                    <p>Se não foi você, recomendamos alterar sua senha imediatamente.</p>
                `
            });
            this.logger.log(`✅ Login Alert sent to ${email}`);
        } catch (error) {
            this.logger.warn(`⚠️ Email Send Failed: ${error.message}`);
        }
    }

    @Process('otp-alert')
    async handleOtpAlert(job: Job) {
        const { email, otp } = job.data;
        const transporter = this.createTransporter();
        const from = this.configService.get('EMAIL_FROM_DEFAULT');

        try {
            this.logger.log(`📧 Sending OTP to ${email}...`);

            await transporter.sendMail({
                from,
                to: email,
                subject: '🔐 Seu Código de Verificação - Torex Journal',
                html: `
                    <h1>Código de Verificação</h1>
                    <p>Use o código abaixo para completar seu cadastro:</p>
                    <h2 style="color: #4CAF50; letter-spacing: 5px;">${otp}</h2>
                    <p>Este código expira em 10 minutos.</p>
                `
            });
            this.logger.log(`✅ OTP sent to ${email}`);
        } catch (error) {
            this.logger.warn(`⚠️ Email Send Failed: ${error.message}`);
        }
    }

    @Process('welcome')
    async handleWelcome(job: Job) {
        const { email, name } = job.data;
        const transporter = this.createTransporter();
        const from = this.configService.get('EMAIL_FROM_DEFAULT');

        try {
            this.logger.log(`📧 Sending Welcome Email to ${email}...`);

            await transporter.sendMail({
                from,
                to: email,
                subject: '🚀 Bem-vindo ao Torex Journal!',
                html: `
                    <h1>Bem-vindo, ${name}!</h1>
                    <p>Estamos felizes em ter você conosco.</p>
                    <p>Aproveite sua jornada no trading.</p>
                `
            });
            this.logger.log(`✅ Welcome Email sent to ${email}`);
        } catch (error) {
            this.logger.warn(`⚠️ Email Send Failed: ${error.message}`);
        }
    }
    @Process('mt5-connected')
    async handleMt5Connected(job: Job) {
        const { email, name, mt5_id } = job.data;
        const transporter = this.createTransporter();
        const from = this.configService.get('EMAIL_FROM_DEFAULT');

        try {
            await transporter.sendMail({
                from,
                to: email,
                subject: '🟢 MT5 Conectado - Torex Journal',
                html: `
                    <h1>MT5 Conectado com Sucesso</h1>
                    <p>Olá <b>${name || 'Trader'}</b>,</p>
                    <p>Sua conta MT5 (ID: <b>${mt5_id}</b>) foi conectada ao sistema Torex Journal.</p>
                    <p style="color: green; font-weight: bold;">Status: ONLINE 🟢</p>
                    <p>Seus dados estão sendo sincronizados em tempo real.</p>
                `
            });
            this.logger.log(`✅ Connected Email sent to ${email}`);
        } catch (error) {
            this.logger.warn(`⚠️ Email Send Failed: ${error.message}`);
        }
    }

    @Process('mt5-disconnected')
    async handleMt5Disconnected(job: Job) {
        const { email, name, mt5_id } = job.data;
        const transporter = this.createTransporter();
        const from = this.configService.get('EMAIL_FROM_DEFAULT');

        try {
            await transporter.sendMail({
                from,
                to: email,
                subject: '🔴 MT5 Desconectado - Torex Journal',
                html: `
                    <h1>Alerta de Desconexão</h1>
                    <p>Olá <b>${name || 'Trader'}</b>,</p>
                    <p>Perdemos a conexão com sua conta MT5 (ID: <b>${mt5_id}</b>).</p>
                    <p style="color: red; font-weight: bold;">Status: OFFLINE 🔴</p>
                    <p>Verifique se o seu terminal MT5 está aberto e com o EA carregado.</p>
                `
            });
            this.logger.log(`✅ Disconnected Email sent to ${email}`);
        } catch (error) {
            this.logger.warn(`⚠️ Email Send Failed: ${error.message}`);
        }
    }

    @Process('trade-imported')
    async handleTradeImported(job: Job) {
        const { email, name, count, method } = job.data;
        const transporter = this.createTransporter();
        const from = this.configService.get('EMAIL_FROM_DEFAULT');

        const dataImportacao = new Date().toLocaleDateString('pt-BR');
        const horaImportacao = new Date().toLocaleTimeString('pt-BR');

        try {
            await transporter.sendMail({
                from,
                to: email,
                subject: '📥 Novos Trades Importados - Torex Journal',
                html: `
                    <h1>Importação Concluída com Sucesso</h1>
                    <p>Olá <b>${name || 'Trader'}</b>,</p>
                    <p>Sua conta sincronizou novos trades com as seguintes informações:</p>
                    <ul>
                        <li><b>Método de Importação:</b> ${method}</li>
                        <li><b>Quantidade de Trades:</b> ${count}</li>
                        <li><b>Data:</b> ${dataImportacao}</li>
                        <li><b>Hora:</b> ${horaImportacao}</li>
                    </ul>
                    <p>Acesse o seu painel <a href="https://torex-journal.com">Torex Journal</a> para visualizar seus novos resultados e atualizar seu diário de operações.</p>
                `
            });
            this.logger.log(`✅ Trade Imported Email sent to ${email}`);
        } catch (error) {
            this.logger.warn(`⚠️ Email Send Failed: ${error.message}`);
        }
    }
}
