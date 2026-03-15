import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { UserEntity } from '../users/user.entity';
import { Subscription, SubscriptionStatus } from '../payment/subscription.entity';

@Injectable()
export class SmsService {
    private readonly logger = new Logger(SmsService.name);
    private readonly apiUrl = 'https://api.tsemba.com/api/v1/sms/send';
    private readonly apiKey: string;
    private readonly senderId: string;

    private readonly TIER_LIMITS = {
        'FREE': 0,
        'BASIC': 5,
        'PRO': 20,
        'PREMIUM': 20,
        'GOLD': 50,
        'ENTERPRISE': 100
    };

    constructor(
        private configService: ConfigService,
        @InjectRepository(UserEntity)
        private userRepo: Repository<UserEntity>,
        @InjectRepository(Subscription)
        private subscriptionRepo: Repository<Subscription>,
    ) {
        this.apiKey = this.configService.get<string>('TSEMBA_API_KEY');
        this.senderId = this.configService.get<string>('TSEMBA_SENDER_ID', 'TOREX');
    }

    private formatPhoneNumber(phone: string): string {
        let cleaned = phone.replace(/\D/g, '');
        if (cleaned.length === 12 && cleaned.startsWith('258')) return `+${cleaned}`;
        if (cleaned.length === 9) return `+258${cleaned}`;
        if (phone.startsWith('+') && cleaned.length >= 10) return phone;
        return phone;
    }

    async sendSms(userId: string, to: string, message: string, isSystemic = false): Promise<{ success: boolean; error?: string }> {
        try {
            const user = await this.userRepo.findOne({ where: { id: userId } });
            if (!user) throw new Error('Usuário não encontrado');

            await this.checkAndResetUsage(user);

            // Get active subscription direct from repo to avoid circular dependency
            const sub = await this.subscriptionRepo.findOne({
                where: { userId, status: SubscriptionStatus.ACTIVE },
                relations: ['planConfig'],
                order: { currentPeriodEnd: 'DESC' }
            });

            const tier = sub?.planConfig?.tier || 'FREE';
            const limit = this.TIER_LIMITS[tier] || 0;

            if (!isSystemic && user.smsUsageCount >= limit) {
                this.logger.warn(`User ${userId} reached SMS limit for tier ${tier} (${user.smsUsageCount}/${limit})`);
                return { 
                    success: false, 
                    error: `Limite de SMS atingido para o plano ${tier}. Upgrade para aumentar o limite.` 
                };
            }

            const formattedPhone = this.formatPhoneNumber(to);
            const payload = {
                to: formattedPhone,
                message: message,
                api_key: this.apiKey,
                sender_id: this.senderId
            };

            const response = await axios.post(this.apiUrl, payload, {
                headers: { 'Content-Type': 'application/json' }
            });

            if (response.data && response.data.success) {
                user.smsUsageCount += 1;
                await this.userRepo.save(user);
                return { success: true };
            } else {
                throw new Error(response.data?.message || 'Erro na API de SMS');
            }
        } catch (error: any) {
            this.logger.error(`Failed to send SMS: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    private async checkAndResetUsage(user: UserEntity): Promise<void> {
        const now = new Date();
        const lastReset = user.lastSmsReset ? new Date(user.lastSmsReset) : new Date(0);
        
        // If it's a different month or year, reset
        if (now.getMonth() !== lastReset.getMonth() || now.getFullYear() !== lastReset.getFullYear()) {
            user.smsUsageCount = 0;
            user.lastSmsReset = now;
            await this.userRepo.save(user);
        }
    }
}
