import { Injectable, Logger, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { UserEntity } from '../users/user.entity';
import { WhatsAppLink } from '../users/whatsapp-link.entity';
import { WhatsAppVerificationCode } from '../users/whatsapp-verification-code.entity';
import { OnEvent } from '@nestjs/event-emitter';
import { BaileysService } from './baileys.service';

@Injectable()
export class WhatsAppBotService {
    private readonly logger = new Logger(WhatsAppBotService.name);

    constructor(
        @Inject(CACHE_MANAGER) private cacheManager: Cache,
        @InjectRepository(UserEntity)
        private readonly userRepository: Repository<UserEntity>,
        @InjectRepository(WhatsAppLink)
        private readonly linkRepository: Repository<WhatsAppLink>,
        @InjectRepository(WhatsAppVerificationCode)
        private readonly codeRepository: Repository<WhatsAppVerificationCode>,
        private readonly baileysService: BaileysService,
    ) { }

    @OnEvent('whatsapp.messages.upsert')
    async handleBaileysUpsert(payload: any) {
        const { messages, type } = payload;
        if (type !== 'notify') return;

        for (const messageData of messages) {
            const remoteJid = messageData.key.remoteJid;
            const isMe = messageData.key.fromMe;

            // Ignore own messages, status updates and groups
            if (isMe || remoteJid === 'status@broadcast' || remoteJid.includes('@g.us')) continue;

            const text = (messageData.message?.conversation ||
                messageData.message?.extendedTextMessage?.text ||
                messageData.message?.buttonsResponseMessage?.selectedButtonId ||
                '').trim();

            const senderNumber = remoteJid.split('@')[0];
            this.logger.debug(`Message from ${senderNumber}: ${text}`);

            // Update last interaction
            await this.linkRepository.update(
                { whatsappNumber: senderNumber },
                { 
                    lastInteractionAt: new Date(),
                    interactionAlertSent: false
                }
            );

            // Rate Limiting Check
            const rateLimitKey = `rl:wa:${senderNumber}`;
            const count = (await this.cacheManager.get<number>(rateLimitKey)) || 0;
            if (count >= 10) {
                this.logger.warn(`Rate limit exceeded for ${senderNumber}`);
                continue;
            }
            await this.cacheManager.set(rateLimitKey, count + 1, 60000);

            // Standardize commands to lowercase
            const command = text.toLowerCase();

            // Process commands
            if (command === '/start') {
                await this.sendText(remoteJid, "oi aqui é o Torex .J assistente\n\nDiga:\n*/help*: para ajuda\n*/sync*: associar minha conta\n*/ping*: verificar conexão");
            } else if (command === '/help' || command === 'ajuda' || command === '/ajuda') {
                await this.handleHelp(remoteJid);
            } else if (command.startsWith('/sync')) {
                await this.handleSyncCommand(senderNumber, text, remoteJid);
            } else if (command === '/ping') {
                await this.handlePing(remoteJid);
            } else if (command === '/status' || command === 'status') {
                await this.handleStatus(senderNumber, remoteJid);
            } else {
                await this.handleFlowStep(senderNumber, text, remoteJid);
            }
        }
    }

    private async handlePing(remoteJid: string) {
        const delay = Math.floor(Math.random() * (60000 - 30000 + 1)) + 30000; // 30-60s
        this.logger.log(`Ping received. Delaying response for ${delay}ms`);
        
        setTimeout(async () => {
            await this.sendText(remoteJid, "pong! 🏓\nConexão estável e funcionando perfeitamente.");
        }, delay);
    }

    private async handleHelp(remoteJid: string) {
        const helpMessage = `🤖 *Central de Ajuda Torex .J*

Como posso te ajudar hoje?

👉 */sync <seu-email>*: Inicia a vinculação da sua conta.
👉 */status*: Verifica se seu número já está vinculado.
👉 */ping*: Testa a velocidade de resposta do sistema.

_Dica: Você precisa manter uma interação a cada 5 dias para não perder as notificações!_`;

        await this.sendText(remoteJid, helpMessage);
    }

    private async handleSyncCommand(senderNumber: string, text: string, remoteJid: string) {
        const parts = text.split(' ');
        const email = parts[1]?.trim();

        if (!email || !email.includes('@')) {
            await this.sendText(remoteJid, "⚠️ Por favor, use o formato: \`/sync seu-email@exemplo.com\`.");
            return;
        }

        const user = await this.userRepository.findOne({ where: { email } });

        if (!user) {
            await this.sendText(remoteJid, "❌ E-mail não encontrado na nossa base. Verifique se digitou corretamente.");
            return;
        }

        // Create session in Redis
        const sessionKey = `wa_session:${senderNumber}`;
        await this.cacheManager.set(sessionKey, { userId: user.id, state: 'WAITING_CODE' }, 300000); // 5 minutes

        await this.sendText(remoteJid, `👋 Olá ${user.name || ''}!\n\nPara confirmar a vinculação, envie o *código de 6 dígitos* que aparece no seu painel Admin/Configurações.`);
    }

    private async handleStatus(senderNumber: string, remoteJid: string) {
        const link = await this.linkRepository.findOne({
            where: { whatsappNumber: senderNumber },
            relations: ['user']
        });

        if (link && link.user) {
            await this.sendText(remoteJid, `✅ Status: *Conectado*\nConta: ${link.user.email}\n\nVocê está recebendo notificações normalmente.`);
        } else {
            await this.sendText(remoteJid, `❌ Status: *Não vinculado*\nUse \`/sync seu-email\` para começar.`);
        }
    }

    private async handleFlowStep(senderNumber: string, text: string, remoteJid: string) {
        const sessionKey = `wa_session:${senderNumber}`;
        const session: any = await this.cacheManager.get(sessionKey);

        if (!session) return;

        if (session.state === 'WAITING_CODE') {
            const code = text.trim();
            if (!/^\d{6}$/.test(code)) {
                await this.sendText(remoteJid, "⚠️ O código deve ter exatamente 6 números. Tente novamente.");
                return;
            }

            const verification = await this.codeRepository.findOne({
                where: {
                    user: { id: session.userId },
                    code,
                    used: false,
                    expiresAt: MoreThan(new Date()),
                },
                relations: ['user'],
            });

            if (!verification) {
                await this.sendText(remoteJid, "❌ Código inválido ou expirado. Gere um novo código no painel.");
                return;
            }

            // Mark code as used
            verification.used = true;
            await this.codeRepository.save(verification);

            // Link WhatsApp
            let link = await this.linkRepository.findOne({ where: { user: { id: session.userId } } });
            if (!link) {
                link = new WhatsAppLink();
                link.user = verification.user;
            }
            link.whatsappNumber = senderNumber;
            link.isActive = true;
            link.lastInteractionAt = new Date();
            await this.linkRepository.save(link);

            // Legacy support
            await this.userRepository.update(session.userId, { whatsapp: senderNumber });

            await this.cacheManager.del(sessionKey);
            await this.sendText(remoteJid, "🎉 *Perfeito!* Sua conta está vinculada.\nAlerta de trades e notificações serão enviados por aqui.");
        }
    }

    // Helper for easier code reuse
    private async sendText(jid: string, text: string) {
        return this.baileysService.sendMessage(jid, text);
    }
}
