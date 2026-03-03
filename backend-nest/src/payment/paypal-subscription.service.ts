import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { PaymentService } from './payment.service';
import { SubscriptionPlanConfig } from './subscription-plan.entity';
import { Subscription, SubscriptionStatus, SubscriptionCycle } from './subscription.entity';
import { UserEntity } from '../users/user.entity';

@Injectable()
export class PaypalSubscriptionsService implements OnModuleInit {
    private readonly logger = new Logger(PaypalSubscriptionsService.name);
    private readonly paypalApiUrl: string;

    constructor(
        private configService: ConfigService,
        private paymentService: PaymentService,
        @InjectRepository(SubscriptionPlanConfig)
        private planConfigRepo: Repository<SubscriptionPlanConfig>,
        @InjectRepository(Subscription)
        private subscriptionRepo: Repository<Subscription>,
    ) {
        const mode = this.configService.get<string>('PAYPAL_MODE', 'sandbox');
        this.paypalApiUrl = mode === 'live'
            ? 'https://api-m.paypal.com'
            : 'https://api-m.sandbox.paypal.com';
    }

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
                monthlyPrice: 29.90,
                annualDiscountPercent: 20,
                trialEnabled: true,
                trialDays: 7,
                trialPrice: 0,
                isActive: true
            });

            // Pro Plan
            await this.planConfigRepo.save({
                tier: 'PRO',
                description: 'Para traders profissionais',
                features: ['Tudo do Básico', 'Análises Avançadas', 'Sem Limites', 'Suporte VIP'],
                monthlyPrice: 49.90,
                annualDiscountPercent: 20,
                trialEnabled: true,
                trialDays: 14,
                trialPrice: 0,
                isActive: true
            });

            this.logger.log('Default plans seeded.');
        }
    }

    // --- 1. Product Management ---

    async getOrCreateProduct(requestId: string): Promise<string> {
        const accessToken = await this.paymentService.getAccessToken();
        const productId = 'TRADING_COSSA_SAAS_V1'; // Changed ID
        const productDetails = {
            id: productId,
            name: 'Trading Cossa SaaS',
            description: 'Access to Trading Cossa platform',
            type: 'SERVICE',
            category: 'SOFTWARE',
            image_url: 'https://tradingcossa.com/assets/logo.png', // Placeholder
            home_url: 'https://tradingcossa.com'
        };

        try {
            // Try to get existing
            await axios.get(
                `${this.paypalApiUrl}/v1/catalogs/products/${productId}`,
                { headers: { Authorization: `Bearer ${accessToken}` } }
            );

            // Product exists, let's update it to ensure sync
            await this.updateProduct(productId, productDetails, accessToken);

            return productId;
        } catch (e) {
            // Create if not exists
            try {
                const response = await axios.post(
                    `${this.paypalApiUrl}/v1/catalogs/products`,
                    productDetails,
                    {
                        headers: {
                            Authorization: `Bearer ${accessToken}`,
                            'Content-Type': 'application/json',
                            'PayPal-Request-Id': requestId,
                        },
                    },
                );
                return response.data.id;
            } catch (createError) {
                this.logger.error('Failed to create PayPal product', createError.response?.data || createError);
                throw createError;
            }
        }
    }

    private async updateProduct(productId: string, details: any, accessToken: string) {
        try {
            const patchRequest = [
                { op: 'replace', path: '/description', value: details.description },
                { op: 'replace', path: '/category', value: details.category },
                { op: 'replace', path: '/image_url', value: details.image_url },
                { op: 'replace', path: '/home_url', value: details.home_url }
            ];

            await axios.patch(
                `${this.paypalApiUrl}/v1/catalogs/products/${productId}`,
                patchRequest,
                {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                }
            );
            this.logger.log(`Product ${productId} updated successfully.`);
        } catch (error) {
            // Log but don't fail flow, as product exists
            this.logger.warn('Failed to update PayPal product details', error.response?.data || error);
        }
    }

    // --- 2. Plan Management ---

    async createPaypalPlan(
        productProtocolId: string,
        planName: string,
        price: string,
        currency: string,
        intervalUnit: 'MONTH' | 'YEAR',
        intervalCount: number,
        trialDays: number = 0,
        trialPrice: string = '0', // If trial, what's the cost? usually 0 or discounted
    ): Promise<string> {
        const accessToken = await this.paymentService.getAccessToken();

        // Billing Cycles
        const billingCycles = [];
        let sequence = 1;

        // Optional Trial
        if (trialDays > 0) {
            billingCycles.push({
                frequency: { interval_unit: 'DAY', interval_count: trialDays },
                tenure_type: 'TRIAL',
                sequence: sequence++,
                total_cycles: 1,
                pricing_scheme: {
                    fixed_price: { value: trialPrice, currency_code: currency }
                }
            });
        }

        // Regular Cycle
        billingCycles.push({
            frequency: { interval_unit: intervalUnit, interval_count: intervalCount },
            tenure_type: 'REGULAR',
            sequence: sequence++,
            total_cycles: 0, // Infinite
            pricing_scheme: {
                fixed_price: { value: price, currency_code: currency }
            }
        });

        const payload = {
            product_id: productProtocolId,
            name: planName,
            description: `${intervalUnit} plan for RatixPay`,
            status: 'ACTIVE',
            billing_cycles: billingCycles,
            payment_preferences: {
                auto_bill_outstanding: true,
                setup_fee_failure_action: 'CANCEL',
                payment_failure_threshold: 3,
            },
        };

        try {
            const response = await axios.post(
                `${this.paypalApiUrl}/v1/billing/plans`,
                payload,
                {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                        'PayPal-Request-Id': `PLAN-${Date.now()}-${Math.random()}`,
                    },
                },
            );
            return response.data.id;
        } catch (error) {
            this.logger.error('Failed to create PayPal plan', error.response?.data || error);
            throw error;
        }
    }

    async syncPlans(): Promise<any> {
        const productId = await this.getOrCreateProduct(`PROD-INIT-${Date.now()}`);
        const currency = 'BRL'; // Or USD, based on requirements. User examples used USD/BRL mixed, assuming BRL for now or configured.

        // Fetch all active configs from DB
        const configs = await this.planConfigRepo.find({ where: { isActive: true } });

        for (const config of configs) {
            // 1. Monthly Plan
            if (!config.paypalMonthlyPlanId) {
                const planId = await this.createPaypalPlan(
                    productId,
                    `${config.tier} Monthly`,
                    config.monthlyPrice.toString(),
                    currency,
                    'MONTH',
                    1,
                    config.trialEnabled ? config.trialDays : 0,
                    config.trialPrice.toString()
                );
                config.paypalMonthlyPlanId = planId;
            }

            // 2. Yearly Plan
            if (!config.paypalYearlyPlanId) {
                // Calculate yearly price with discount
                const monthlyTotal = config.monthlyPrice * 12;
                const discountAmount = monthlyTotal * (config.annualDiscountPercent / 100);
                const yearlyPrice = (monthlyTotal - discountAmount).toFixed(2);

                const planId = await this.createPaypalPlan(
                    productId,
                    `${config.tier} Yearly`,
                    yearlyPrice,
                    currency,
                    'YEAR',
                    1,
                    config.trialEnabled ? config.trialDays : 0,
                    config.trialPrice.toString()
                );
                config.paypalYearlyPlanId = planId;
            }

            await this.planConfigRepo.save(config);
        }

        return { message: 'Plans synced successfully', configs };
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

    // --- 3. Subscription Creation ---

    async createSubscription(userId: string, tier: string, cycle: SubscriptionCycle, returnUrl: string, cancelUrl: string) {
        const config = await this.planConfigRepo.findOne({ where: { tier, isActive: true } });
        if (!config) throw new Error(`Plan configuration not found for tier ${tier}`);

        const planId = cycle === SubscriptionCycle.MONTHLY
            ? config.paypalMonthlyPlanId
            : config.paypalYearlyPlanId;

        if (!planId) throw new Error('PayPal Plan ID not generated. Run syncPlans first.');

        const accessToken = await this.paymentService.getAccessToken();

        const payload = {
            plan_id: planId,
            custom_id: userId, // Pass userId to webhook
            application_context: {
                brand_name: "Trading Cossa",
                user_action: "SUBSCRIBE_NOW",
                return_url: returnUrl,
                cancel_url: cancelUrl,
            }
        };

        try {
            const response = await axios.post(
                `${this.paypalApiUrl}/v1/billing/subscriptions`,
                payload,
                {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                },
            );

            // Save tentative subscription
            const sub = this.subscriptionRepo.create({
                userId,
                planConfigId: config.id,
                paypalSubscriptionId: response.data.id,
                status: SubscriptionStatus.APPROVAL_PENDING,
                cycle,
            });
            await this.subscriptionRepo.save(sub);

            return response.data; // Contains links for approval
        } catch (error) {
            this.logger.error('Failed to create PayPal subscription', error.response?.data || error);
            throw error;
        }
    }

    // --- 4. Webhook Handling ---

    async verifyWebhookSignature(headers: any, body: any, webhookId: string): Promise<boolean> {
        const accessToken = await this.paymentService.getAccessToken();

        try {
            const response = await axios.post(
                `${this.paypalApiUrl}/v1/notifications/verify-webhook-signature`,
                {
                    auth_algo: headers['paypal-auth-algo'],
                    cert_url: headers['paypal-cert-url'],
                    transmission_id: headers['paypal-transmission-id'],
                    transmission_sig: headers['paypal-transmission-sig'],
                    transmission_time: headers['paypal-transmission-time'],
                    webhook_id: webhookId,
                    webhook_event: body,
                },
                {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                },
            );
            return response.data.verification_status === 'SUCCESS';
        } catch (error) {
            this.logger.error('Webhook signature verification failed', error.response?.data || error);
            return false;
        }
    }

    async handleWebhookEvent(event: any) {
        const eventType = event.event_type;
        const resource = event.resource;
        const subscriptionId = resource.id;

        this.logger.log(`Handling PayPal Webhook: ${eventType} for Subscription ${subscriptionId}`);

        // Try to find subscription locally
        // Note: resource.id matches paypalSubscriptionId
        const subscription = await this.subscriptionRepo.findOne({
            where: { paypalSubscriptionId: subscriptionId },
        });

        if (!subscription) {
            this.logger.warn(`Subscription ${subscriptionId} not found in local DB.`);
            return;
        }

        switch (eventType) {
            case 'BILLING.SUBSCRIPTION.ACTIVATED':
                subscription.status = SubscriptionStatus.ACTIVE;
                break;
            case 'BILLING.SUBSCRIPTION.CANCELLED':
                subscription.status = SubscriptionStatus.CANCELLED;
                break;
            case 'BILLING.SUBSCRIPTION.SUSPENDED':
                subscription.status = SubscriptionStatus.SUSPENDED;
                break;
            case 'BILLING.SUBSCRIPTION.EXPIRED':
                subscription.status = SubscriptionStatus.EXPIRED;
                break;
            case 'PAYMENT.SALE.COMPLETED':
                // Extend period if needed, or just log revenue
                break;
        }

        await this.subscriptionRepo.save(subscription);
        this.logger.log(`Subscription ${subscriptionId} status updated to ${subscription.status}`);
    }
}
