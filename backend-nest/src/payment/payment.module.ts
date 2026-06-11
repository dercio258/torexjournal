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
import { UsersModule } from '../users/users.module';
import { AccountEntity } from '../account/account.entity';
import { ConfigModule } from '@nestjs/config';
import { AlertsModule } from '../alerts/alerts.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UserEntity } from '../users/user.entity';

import { PlanPermissionService } from './plan-permission.service';
import { DebitoService } from './debito.service';
import { SubscriptionProcessor } from './subscription.processor';
import { WebhookController } from './webhook.controller';
import { EmailModule } from '../email/email.module';
import { PlanGuard } from './plan.guard';

@Module({
    imports: [
        TypeOrmModule.forFeature([PaymentEntity, AccountEntity, Subscription, SubscriptionPlanConfig, UserEntity]),
        BullModule.registerQueue({
            name: 'subscription-queue',
        }),
        UsersModule,
        ConfigModule,
        forwardRef(() => AlertsModule),
        forwardRef(() => NotificationsModule),
        EmailModule
    ],
    providers: [PaymentService, SubscriptionService, PlanPermissionService, DebitoService, SubscriptionProcessor, PlanGuard],
    controllers: [PaymentController, SubscriptionController, PaymentsController, WebhookController],
    exports: [SubscriptionService, PlanPermissionService, DebitoService, PlanGuard],
})
export class PaymentModule { }
