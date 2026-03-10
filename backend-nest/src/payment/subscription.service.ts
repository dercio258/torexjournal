import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual } from 'typeorm';
import { SubscriptionPlanConfig } from './subscription-plan.entity';
import { Subscription, SubscriptionStatus, SubscriptionCycle } from './subscription.entity';
import { AlertsService } from '../alerts/alerts.service';
import { AlertType, AlertSeverity } from '../alerts/alert.entity';
import { DebitoService } from './debito.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UserEntity } from '../users/user.entity';

@Injectable()
export class SubscriptionService implements OnModuleInit {
    private readonly logger = new Logger(SubscriptionService.name);

    constructor(
        private configService: ConfigService,
        private alertsService: AlertsService,
        private debitoService: DebitoService,
        private notificationsService: NotificationsService,
        @InjectRepository(SubscriptionPlanConfig)
        private planConfigRepo: Repository<SubscriptionPlanConfig>,
        @InjectRepository(Subscription)
        private subscriptionRepo: Repository<Subscription>,
        @InjectRepository(UserEntity)
        private userRepo: Repository<UserEntity>,
    ) { }

    async onModuleInit() {
        await this.seedDefaultPlans();
    }

    async seedDefaultPlans() {
        const count = await this.planConfigRepo.count();
        if (count === 0) {
            this.logger.log('Seeding default subscription plans...');

            // Basic Plan
            await this.planConfigRepo.save({
                tier: 'BASIC',
                description: 'Para quem está começando',
                features: ['Acesso ao Painel', 'Diário Limitado', 'Suporte Básico'],
                monthlyPrice: this.configService.get<number>('PLANO_BASICO_PRICE', 2000.00),
                annualDiscountPercent: 20,
                trialEnabled: false,
                trialDays: 0,
                trialPrice: 0,
                isActive: true
            });

            // Pro Plan
            await this.planConfigRepo.save({
                tier: 'PRO',
                description: 'Para traders profissionais',
                features: ['Tudo do Básico', 'Análises Avançadas', 'Sem Limites', 'Suporte VIP'],
                monthlyPrice: this.configService.get<number>('PLANO_PREMIUN_PRICE', 4000.00),
                annualDiscountPercent: 20,
                trialEnabled: false,
                trialDays: 0,
                trialPrice: 0,
                isActive: true
            });

            this.logger.log('Default plans seeded.');
        }
    }

    private generateReference(): string {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hour = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        const rand = Math.floor(1000 + Math.random() * 9000);
        return `TOREX${year}${month}${day}${hour}${min}${rand}`;
    }

    async getActivePlans() {
        return this.planConfigRepo.find({ where: { isActive: true } });
    }

    async createPlanConfig(data: Partial<SubscriptionPlanConfig>) {
        const newPlan = this.planConfigRepo.create({
            ...data,
            isActive: true, // Default active
        });
        return this.planConfigRepo.save(newPlan);
    }

    // --- Subscription Creation ---

    private getAmount(config: SubscriptionPlanConfig, cycle: SubscriptionCycle): number {
        const envPrice = config.tier === 'BASIC' ?
            this.configService.get<number>('PLANO_BASICO_PRICE') :
            this.configService.get<number>('PLANO_PREMIUN_PRICE');

        const monthlyPrice = Number(envPrice || config.monthlyPrice);
        const total = cycle === SubscriptionCycle.MONTHLY ? monthlyPrice : (monthlyPrice * 12 * (1 - config.annualDiscountPercent / 100));
        return Number(total.toFixed(2));
    }

    async createMobileSubscription(userId: string, tier: string, cycle: SubscriptionCycle, paymentMethod: 'mpesa' | 'emola', phoneNumber: string, savePreference: boolean = false) {
        const config = await this.planConfigRepo.findOne({ where: { tier, isActive: true } });
        if (!config) throw new Error(`Plan configuration not found for tier ${tier}`);

        const amount = this.getAmount(config, cycle);
        const reference = this.generateReference();

        // Call Debito
        const paymentData = {
            msisdn: phoneNumber,
            amount: amount,
            reference_description: reference
        };

        try {
            if (paymentMethod === 'mpesa') {
                await this.debitoService.initiateMpesaPayment(paymentData);
            } else {
                await this.debitoService.initiateEmolaPayment(paymentData);
            }

            // Save preferences if requested
            if (savePreference) {
                await this.userRepo.update(userId, {
                    preferredMpesa: paymentMethod === 'mpesa' ? phoneNumber : undefined,
                    preferredEmola: paymentMethod === 'emola' ? phoneNumber : undefined,
                    lastPaymentMethod: paymentMethod
                });
            }

            // Save subscription as PENDING
            const sub = this.subscriptionRepo.create({
                userId,
                planConfigId: config.id,
                paymentReference: reference,
                status: SubscriptionStatus.APPROVAL_PENDING,
                cycle,
            });
            await this.subscriptionRepo.save(sub);

            // Notification: Initiation
            await this.notificationsService.create(userId, {
                title: 'Pagamento Iniciado ⏳',
                message: `Lançamos um pedido de pagamento de MT ${amount} via ${paymentMethod.toUpperCase()}. Confirme no seu telemóvel.`,
            });

            return { success: true, reference };
        } catch (error) {
            this.logger.error(`Mobile subscription failed: ${error.message}`);
            // Notification: Failure
            await this.notificationsService.create(userId, {
                title: 'Falha no Pagamento ❌',
                message: `Não conseguimos iniciar o seu pagamento via ${paymentMethod.toUpperCase()}: ${error.message}`,
            });
            throw error;
        }
    }

    async createCardSubscription(userId: string, tier: string, cycle: SubscriptionCycle, returnUrl: string, cancelUrl: string, phoneNumber?: string) {
        const config = await this.planConfigRepo.findOne({ where: { tier, isActive: true } });
        if (!config) throw new Error(`Plan configuration not found for tier ${tier}`);

        const user = await this.userRepo.findOne({ where: { id: userId } });
        if (!user) throw new Error('Usuário não encontrado');

        const amount = this.getAmount(config, cycle);
        const reference = this.generateReference();

        const names = (user.name || '').split(' ');
        const firstName = names[0] || 'User';
        const lastName = names.slice(1).join(' ') || 'Torex';

        try {
            const res = await this.debitoService.initiateCardPayment({
                amount,
                reference_description: `Plano ${tier} - Pagamento plano ${tier.toLowerCase()}`,
                first_name: firstName,
                last_name: lastName,
                email: user.email,
                phone: phoneNumber || user.whatsapp || user.preferredMpesa || user.preferredEmola || '840000000',
                callback_url: returnUrl
            });

            // Save subscription
            const sub = this.subscriptionRepo.create({
                userId,
                planConfigId: config.id,
                paymentReference: reference,
                status: SubscriptionStatus.APPROVAL_PENDING,
                cycle,
            });
            await this.subscriptionRepo.save(sub);

            return res;
        } catch (error) {
            this.logger.error(`Card subscription failed: ${error.message}`);
            throw error;
        }
    }

    async processDebitoWebhook(payload: any) {
        this.logger.log(`Receiving Debito Webhook: ${JSON.stringify(payload)}`);
        const reference = payload.reference_description || payload.reference;
        const status = payload.status;

        if (!reference) {
            this.logger.error('Webhook received without reference');
            return;
        }

        const subscription = await this.subscriptionRepo.findOne({
            where: { paymentReference: reference },
            relations: ['planConfig']
        });

        if (!subscription) {
            this.logger.warn(`Subscription not found for reference: ${reference}`);
            return;
        }

        if (status === 'SUCCESSFULL') {
            await this.activateSubscription(subscription, reference);
        } else if (status === 'FAILED' || status === 'CANCELLED') {
            await this.notificationsService.create(subscription.userId, {
                title: 'Pagamento Falhou ❌',
                message: `O seu pagamento de referência ${reference} foi ${status.toLowerCase()}.`,
            });
            subscription.status = SubscriptionStatus.EXPIRED; // Or another appropriate status
            await this.subscriptionRepo.save(subscription);
        } else {
            this.logger.log(`Unhandled webhook status: ${status} for ${reference}`);
        }
    }

    private async activateSubscription(subscription: Subscription, reference: string) {
        if (subscription.status === SubscriptionStatus.ACTIVE) return;

        subscription.status = SubscriptionStatus.ACTIVE;
        const now = new Date();
        const expiry = new Date(now);
        if (subscription.cycle === SubscriptionCycle.YEARLY) {
            expiry.setFullYear(now.getFullYear() + 1);
        } else {
            expiry.setMonth(now.getMonth() + 1);
        }
        subscription.currentPeriodEnd = expiry;
        await this.subscriptionRepo.save(subscription);

        await this.alertsService.create(subscription.userId, {
            type: AlertType.SYSTEM,
            severity: AlertSeverity.INFO,
            title: 'Assinatura Ativada ✅',
            description: `Sua assinatura foi ativada com sucesso via Webhook! Validade até ${expiry.toLocaleDateString()}.`,
            metadata: { reference }
        });

        await this.notificationsService.create(subscription.userId, {
            title: 'Pagamento Confirmado! 🎉',
            message: `Sua assinatura ${subscription.planConfig.tier} está ativa até ${expiry.toLocaleDateString()}.`,
        });

        this.logger.log(`Subscription activated via webhook for reference: ${reference}`);
    }

    async handleDebitoStatusUpdate(reference: string) {
        const result = await this.debitoService.checkTransactionStatus(reference);
        const subscription = await this.subscriptionRepo.findOne({
            where: { paymentReference: reference },
            relations: ['planConfig']
        });

        if (!subscription) return;

        if (result && result.status === 'SUCCESSFULL') {
            await this.activateSubscription(subscription, reference);
        } else if (result && (result.status === 'FAILED' || result.status === 'CANCELLED')) {
            await this.notificationsService.create(subscription.userId, {
                title: 'Pagamento Falhou ❌',
                message: `O seu pagamento de referência ${reference} não foi concluído.`,
            });
        }
    }

    async getSubscriptionStatus(userId: string) {
        const sub = await this.subscriptionRepo.findOne({
            where: { userId, status: SubscriptionStatus.ACTIVE },
            relations: ['planConfig'],
            order: { currentPeriodEnd: 'DESC' }
        });

        if (!sub) return { hasActive: false };

        const now = new Date();
        const diff = sub.currentPeriodEnd.getTime() - now.getTime();
        const daysLeft = Math.ceil(diff / (1000 * 60 * 60 * 24));

        return {
            hasActive: true,
            tier: sub.planConfig.tier,
            daysLeft,
            expiryDate: sub.currentPeriodEnd,
            id: sub.id
        };
    }

    async renewActiveSubscription(userId: string) {
        const user = await this.userRepo.findOne({ where: { id: userId } });
        if (!user || !user.lastPaymentMethod) {
            throw new Error('Nenhum método de pagamento preferencial encontrado para renovação dinâmica.');
        }

        const currentSub = await this.getSubscriptionStatus(userId);
        if (!currentSub.hasActive) throw new Error('Nenhuma assinatura activa para renovar.');

        const phoneNumber = user.lastPaymentMethod === 'mpesa' ? user.preferredMpesa : user.preferredEmola;
        if (!phoneNumber && user.lastPaymentMethod !== 'card') {
            throw new Error('Contacto de pagamento não encontrado.');
        }

        // Always renew with the same tier and cycle as current active
        const sub = await this.subscriptionRepo.findOne({ where: { id: (currentSub as any).id } });

        if (user.lastPaymentMethod === 'card') {
            throw new Error('Renovação automática para cartão não implementada (requer retorno de URL).');
        }

        return this.createMobileSubscription(
            userId,
            currentSub.tier,
            sub.cycle,
            user.lastPaymentMethod as any,
            phoneNumber
        );
    }
}
