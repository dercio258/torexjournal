import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { PaymentService } from './payment.service';
import { SubscriptionService } from './subscription.service';
import { PaymentController } from './payment.controller';
import { SubscriptionController } from './subscription.controller';
import { PaymentsController } from './payments.controller';
import { PaymentEntity } from './payment.entity';
import { Subscription } from './subscription.entity';
import { SubscriptionPlanConfig } from './subscription-plan.entity';
import { CryptoPaymentSession } from './crypto-payment-session.entity';
import { PixPaymentSession } from './pix-payment-session.entity';
import { SubscriptionRenewalInvoice } from './subscription-renewal-invoice.entity';
import { NowPaymentsService } from './paymentgateways/nowpayment';
import { HubblyService } from './paymentgateways/hubbly';
import { DebitoPayService } from './paymentgateways/debitopay.service';
import { CheckoutGeoIpService } from './checkout-geoip.service';
import { UsersModule } from '../users/users.module';
import { AccountEntity } from '../account/account.entity';
import { ConfigModule } from '@nestjs/config';
import { AlertsModule } from '../alerts/alerts.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UserEntity } from '../users/user.entity';

import { PlanPermissionService } from './plan-permission.service';
import { SubscriptionProcessor } from './subscription.processor';
import { WebhookController } from './webhook.controller';
import { EmailModule } from '../email/email.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { PlanGuard } from './plan.guard';

@Module({
    imports: [
        TypeOrmModule.forFeature([
            PaymentEntity,
            AccountEntity,
            Subscription,
            SubscriptionPlanConfig,
            CryptoPaymentSession,
            PixPaymentSession,
            SubscriptionRenewalInvoice,
            UserEntity,
        ]),
        BullModule.registerQueue(
            {
                name: 'subscription-queue',
                defaultJobOptions: {
                    removeOnComplete: 200,
                    removeOnFail: 500,
                },
            },
            { name: 'email-queue' },
        ),
        UsersModule,
        ConfigModule,
        forwardRef(() => AlertsModule),
        forwardRef(() => NotificationsModule),
        EmailModule,
        AnalyticsModule
    ],
    providers: [
        PaymentService,
        NowPaymentsService,
        HubblyService,
        DebitoPayService,
        CheckoutGeoIpService,
        SubscriptionService,
        PlanPermissionService,
        ...(process.env.MT5_DEDICATED_SERVER === 'true' ? [] : [SubscriptionProcessor]),
        PlanGuard,
    ],
    controllers: [PaymentController, SubscriptionController, PaymentsController, WebhookController],
    exports: [
        SubscriptionService,
        PlanPermissionService,
        PlanGuard,
        NowPaymentsService,
        HubblyService,
        DebitoPayService,
        CheckoutGeoIpService,
    ],
})
export class PaymentModule { }
