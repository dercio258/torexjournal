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
import { EmailService } from '../email/email.service';
import { UserEntity } from '../users/user.entity';
import { SmsService } from '../notifications/sms.service';
import { SmsTemplates } from '../notifications/sms-templates';

@Injectable()
export class SubscriptionService implements OnModuleInit {
    private readonly logger = new Logger(SubscriptionService.name);

    constructor(
        private configService: ConfigService,
        private alertsService: AlertsService,
        private debitoService: DebitoService,
        private notificationsService: NotificationsService,
        private emailService: EmailService,
        @InjectRepository(SubscriptionPlanConfig)
        private planConfigRepo: Repository<SubscriptionPlanConfig>,
        @InjectRepository(Subscription)
        private subscriptionRepo: Repository<Subscription>,
        @InjectRepository(UserEntity)
        private userRepo: Repository<UserEntity>,
        private smsService: SmsService,
    ) { }

    async onModuleInit() {
        await this.seedDefaultPlans();
    }

    async seedDefaultPlans() {
        const tiers = ['BASIC', 'PRO'];
        for (const tier of tiers) {
            const exists = await this.planConfigRepo.findOne({ where: { tier } });
            if (!exists) {
                this.logger.log(`Seeding missing plan tier: ${tier}`);
                if (tier === 'BASIC') {
                    await this.planConfigRepo.save({
                        tier: 'BASIC',
                        description: 'Para quem está começando',
                        features: ['Acesso ao Painel', 'Diário Limitado', 'Suporte Básico'],
                        monthlyPrice: Number(this.configService.get<number>('PLANO_BASICO_PRICE', 1)),
                        annualDiscountPercent: 20,
                        trialEnabled: false,
                        trialDays: 0,
                        trialPrice: 0,
                        isActive: true
                    });
                } else if (tier === 'PRO') {
                    await this.planConfigRepo.save({
                        tier: 'PRO',
                        description: 'Para traders profissionais',
                        features: ['Tudo do Básico', 'Análises Avançadas', 'Sem Limites', 'Suporte VIP'],
                        monthlyPrice: Number(this.configService.get<number>('PLANO_PREMIUN_PRICE', 1)),
                        annualDiscountPercent: 20,
                        trialEnabled: false,
                        trialDays: 0,
                        trialPrice: 0,
                        isActive: true
                    });
                }
            } else if (!exists.isActive) {
                this.logger.log(`Re-activating existing plan tier: ${tier}`);
                exists.isActive = true;
                await this.planConfigRepo.save(exists);
            }
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
        // Prioritize DB monthlyPrice over environment variables
        const monthlyPrice = Number(config.monthlyPrice);
        const total = cycle === SubscriptionCycle.MONTHLY ? monthlyPrice : (monthlyPrice * 12 * (1 - config.annualDiscountPercent / 100));
        return Number(total.toFixed(2));
    }

    async createMobileSubscription(userId: string, tier: string, cycle: SubscriptionCycle, paymentMethod: 'mpesa' | 'emola', phoneNumber: string, savePreference?: boolean) {
        const config = await this.planConfigRepo.findOne({
            where: { tier: tier.toUpperCase(), isActive: true }
        });

        if (!config) {
            const availablePlans = await this.planConfigRepo.find();
            const tiers = availablePlans.map(p => `${p.tier}(${p.isActive ? 'active' : 'inactive'})`).join(', ');
            this.logger.error(`Plan configuration not found for tier: ${tier}. Available tiers: ${tiers}`);
            throw new Error(`Configuração do plano ${tier} não encontrada. Planos disponíveis: ${tiers}`);
        }

        const amount = this.getAmount(config, cycle);
        const reference = this.generateReference();

        // Call Debito
        const paymentData = {
            msisdn: phoneNumber,
            amount: amount,
            reference_description: reference
        };

        let debitoRes = null;
        try {
            if (paymentMethod === 'mpesa') {
                debitoRes = await this.debitoService.initiateMpesaPayment(paymentData);
            } else {
                debitoRes = await this.debitoService.initiateEmolaPayment(paymentData);
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
            const debitoId = debitoRes?.debito_reference || debitoRes?.transaction_id || debitoRes?.id;
            this.logger.log(`Creating subscription for reference ${reference}. Linked Debito ID: ${debitoId}`);

            const sub = this.subscriptionRepo.create({
                userId,
                planConfigId: config.id,
                paymentReference: reference,
                debitoTransactionId: debitoId ? String(debitoId) : null,
                status: SubscriptionStatus.APPROVAL_PENDING,
                cycle,
            });
            sub.planConfig = config; // Attach config to avoid 500 error in activateSubscription
            await this.subscriptionRepo.save(sub);

            // Activation only via Webhook or manual check
            this.logger.log(`Subscription created for reference ${reference}. Waiting for webhook confirmation.`);

            // Notification: Initiation
            const user = await this.userRepo.findOne({ where: { id: userId } });
            if (user?.email) {
                await this.emailService.sendTemplatedEmail(user.email, 'PAYMENT_INITIATED', {
                    userName: user.name,
                    amount: amount.toString(),
                    method: paymentMethod,
                    reference: reference
                });
            }

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
        const config = await this.planConfigRepo.findOne({
            where: { tier: tier.toUpperCase(), isActive: true }
        });

        if (!config) {
            const availablePlans = await this.planConfigRepo.find();
            const tiers = availablePlans.map(p => `${p.tier}(${p.isActive ? 'active' : 'inactive'})`).join(', ');
            this.logger.error(`Plan configuration not found for tier: ${tier}. Available tiers: ${tiers}`);
            throw new Error(`Configuração do plano ${tier} não encontrada. Planos disponíveis: ${tiers}`);
        }

        const user = await this.userRepo.findOne({ where: { id: userId } });
        if (!user) throw new Error('Usuário não encontrado');

        const amount = this.getAmount(config, cycle);
        const reference = this.generateReference();

        const names = (user.name || '').trim().split(' ');
        const firstName = names[0] || 'User';
        const lastName = names.slice(1).join(' ') || 'Torex';

        try {
            // Use environment variable if present, otherwise fallback to provided returnUrl
            const callbackUrl = this.configService.get<string>('CALL_BACK_DEBITO') || returnUrl;

            const res = await this.debitoService.initiateCardPayment({
                amount: Math.round(amount),
                reference_description: reference,
                first_name: firstName,
                last_name: lastName,
                email: user.email || 'user@torexjournal.com',
                phone: (phoneNumber || user.whatsapp || '840000000').replace(/\+/g, ''),
                callback_url: callbackUrl
            });

            // Save subscription
            const debitoId = res?.debito_reference || res?.transaction_id || res?.id;
            this.logger.log(`Creating card subscription for reference ${reference}. Linked Debito ID: ${debitoId}`);

            const sub = this.subscriptionRepo.create({
                userId,
                planConfigId: config.id,
                paymentReference: reference,
                debitoTransactionId: debitoId ? String(debitoId) : null,
                status: SubscriptionStatus.APPROVAL_PENDING,
                cycle,
            });
            sub.planConfig = config; // Attach config to avoid 500 error in activateSubscription
            await this.subscriptionRepo.save(sub);

            // Activation only via Webhook
            this.logger.log(`Card subscription created for reference ${reference}. Waiting for webhook confirmation.`);

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
            where: [
                { paymentReference: reference },
                { debitoTransactionId: reference }
            ],
            relations: ['planConfig']
        });

        if (!subscription) {
            this.logger.warn(`Subscription not found for reference: ${reference}`);
            return;
        }

        if (status === 'SUCCESSFULL' || status === 'SUCCESSFUL') {
            await this.activateSubscription(subscription, reference);
        } else if (status === 'FAILED' || status === 'CANCELLED' || status === 'REJECTED') {
            this.logger.log(`Payment failure received for reference ${reference}: ${status}`);
            
            // Check if already processed to avoid redundant notifications
            if (subscription.status === SubscriptionStatus.CANCELLED || subscription.status === SubscriptionStatus.EXPIRED) {
                this.logger.warn(`Subscription ${subscription.id} already in terminal state ${subscription.status}, skipping webhook failure processing.`);
                return;
            }
            
            const user = await this.userRepo.findOne({ where: { id: subscription.userId } });
            if (user?.email) {
                await this.emailService.sendTemplatedEmail(user.email, 'PAYMENT_FAILED', {
                    userName: user.name,
                    reference: reference,
                    reason: status === 'CANCELLED' ? 'O pagamento foi cancelado.' : 'A transação foi recusada pelo provedor.'
                });
            }

            await this.notificationsService.create(subscription.userId, {
                title: 'Pagamento Falhou ❌',
                message: `O seu pagamento de referência ${reference} foi ${status.toLowerCase()}.`,
            });
            subscription.status = SubscriptionStatus.CANCELLED;
            await this.subscriptionRepo.save(subscription);
        } else {
            this.logger.log(`Unhandled webhook status: ${status} for ${reference}`);
        }
    }

    private async activateSubscription(subscription: Subscription, reference: string) {
        if (subscription.status === SubscriptionStatus.ACTIVE) {
            this.logger.warn(`Subscription ${subscription.id} (Ref: ${reference}) is already active. Skipping activation.`);
            return;
        }

        this.logger.log(`Activating subscription ${subscription.id} for user ${subscription.userId} (Ref: ${reference})`);
        const now = new Date();
        const expiry = new Date(now);
        if (subscription.cycle === SubscriptionCycle.YEARLY) {
            expiry.setFullYear(now.getFullYear() + 1);
        } else {
            expiry.setMonth(now.getMonth() + 1);
        }
        subscription.currentPeriodEnd = expiry;
        
        // Ensure status is updated before saving
        subscription.status = SubscriptionStatus.ACTIVE;
        await this.subscriptionRepo.save(subscription);

        await this.alertsService.create(subscription.userId, {
            type: AlertType.SYSTEM,
            severity: AlertSeverity.INFO,
            title: 'Assinatura Ativada ✅',
            description: `Sua assinatura foi ativada com sucesso via Webhook! Validade até ${expiry.toLocaleDateString()}.`,
            metadata: { reference }
        });

        const user = await this.userRepo.findOne({ where: { id: subscription.userId } });
        if (user?.email) {
            await this.emailService.sendTemplatedEmail(user.email, 'PAYMENT_SUCCESS', {
                userName: user.name,
                plan: subscription.planConfig.tier,
                expiryDate: expiry.toLocaleDateString()
            });
        }

        // Dispatch Payment SMS (Systemic)
        if (user?.whatsapp) {
            await this.smsService.sendSms(
                user.id, 
                user.whatsapp, 
                SmsTemplates.PAYMENT_CONFIRMED(user.name, subscription.planConfig.tier),
                true // isSystemic
            );
        }

        await this.notificationsService.create(subscription.userId, {
            title: 'Pagamento Confirmado! 🎉',
            message: `Sua assinatura ${subscription.planConfig.tier} está ativa até ${expiry.toLocaleDateString()}.`,
        });

        this.logger.log(`Subscription activated via webhook for reference: ${reference}`);
    }

    async handleDebitoStatusUpdate(reference: string) {
        // Find subscription by either Torex reference or Debito ID
        const subscription = await this.subscriptionRepo.findOne({
            where: [
                { paymentReference: reference },
                { debitoTransactionId: reference }
            ],
            relations: ['planConfig']
        });

        if (!subscription) return;

        // Use Debito ID for polling if available, OTHERWISE DO NOT POLL (prevents 404s with internal refs)
        if (!subscription.debitoTransactionId) {
            this.logger.warn(`No Debito ID for subscription ${subscription.id} (Ref: ${reference}), skipping background polling.`);
            return;
        }

        const pollingRef = subscription.debitoTransactionId;
        this.logger.log(`Polling status for reference ${reference} using Debito ID: ${pollingRef}`);
        const result = await this.debitoService.checkTransactionStatus(pollingRef);

        if (result && (result.status === 'SUCCESSFULL' || result.status === 'SUCCESSFUL')) {
            await this.activateSubscription(subscription, reference);
        } else if (result && (result.status === 'FAILED' || result.status === 'CANCELLED')) {
            this.logger.log(`Status check failed for ${reference}: ${result.status}`);
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

    async updatePlanConfig(id: string, data: Partial<SubscriptionPlanConfig>) {
        await this.planConfigRepo.update(id, data);
        return this.planConfigRepo.findOne({ where: { id } });
    }

    async getUserSubscriptionHistory(userId: string) {
        return this.subscriptionRepo.find({
            where: { userId },
            relations: ['planConfig'],
            order: { createdAt: 'DESC' }
        });
    }

    async getAllPlans() {
        return this.planConfigRepo.find();
    }
}
