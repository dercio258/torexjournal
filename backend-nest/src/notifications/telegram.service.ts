import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from '../users/user.entity';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Context, Telegraf } from 'telegraf';
import { InjectBot, Start, Update, On, Message, Ctx } from 'nestjs-telegraf';

@Update()
@Injectable()
export class TelegramService implements OnModuleInit {
    private readonly logger = new Logger(TelegramService.name);

    constructor(
        @InjectRepository(UserEntity)
        private userRepository: Repository<UserEntity>,
        @Inject(CACHE_MANAGER) private cacheManager: Cache,
        @InjectBot() private bot: Telegraf<Context>,
    ) { }

    async onModuleInit() {
        // Launch bot asynchronously to avoid blocking startup
        this.launchBot();
    }

    private async launchBot() {
        try {
            await this.bot.launch({
                dropPendingUpdates: true,
            });
            this.logger.log('Telegram Bot launched successfully');
        } catch (error: any) {
            this.logger.error(`Failed to launch Telegram Bot: ${error.message}`);
        }
    }

    async generateOtp(userId: string): Promise<string> {
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        // Store OTP with userId for 5 minutes (300000 ms)
        await this.cacheManager.set(`telegram_otp:${otp}`, userId, 300000);
        return otp;
    }

    @Start()
    async onStart(@Ctx() ctx: Context) {
        await ctx.reply('Welcome! Please send the 6-digit OTP code shown on your dashboard to link your account.');
    }

    @On('text')
    async onMessage(@Message('text') message: string, @Ctx() ctx: Context) {
        const text = 'text' in ctx.message ? ctx.message.text : '';
        const chatId = ctx.from.id.toString();

        // Check if message is a 6-digit OTP
        if (/^\d{6}$/.test(text)) {
            const userId = await this.cacheManager.get<string>(`telegram_otp:${text}`);

            if (!userId) {
                await ctx.reply('Invalid or expired OTP. Please regenerate a new one on your dashboard.');
                return;
            }

            // Link user
            const user = await this.userRepository.findOne({ where: { id: userId } });
            if (user) {
                user.telegramChatId = chatId;
                await this.userRepository.save(user);
                await this.cacheManager.del(`telegram_otp:${text}`);
                await ctx.reply('Successfully connected! You will now receive notifications here.');
                this.logger.log(`User ${userId} linked Telegram chat ${chatId}`);
            } else {
                await ctx.reply('User not found.');
            }
        } else {
            // Ignore other messages or handle commands
        }
    }

    async disconnectUser(userId: string): Promise<void> {
        const user = await this.userRepository.findOne({ where: { id: userId } });
        if (user) {
            user.telegramChatId = null;
            await this.userRepository.save(user);
        }
    }

    async isUserConnected(userId: string): Promise<boolean> {
        const user = await this.userRepository.findOne({ where: { id: userId } });
        return !!(user && user.telegramChatId);
    }

    async sendNotification(userId: string, message: string): Promise<void> {
        const user = await this.userRepository.findOne({ where: { id: userId } });
        if (user && user.telegramChatId) {
            try {
                await this.bot.telegram.sendMessage(user.telegramChatId, message);
            } catch (error: any) {
                this.logger.error(`Failed to send Telegram message to user ${userId}: ${error.message}`);
            }
        }
    }
}
