import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentService } from './payment.service';
import { SubscriptionService } from './subscription.service';
import { PaymentController } from './payment.controller';
import { SubscriptionController } from './subscription.controller';
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
import { SubscriptionCronService } from './subscription.cron';
import { WebhookController } from './webhook.controller';
import { EmailModule } from '../email/email.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([PaymentEntity, AccountEntity, Subscription, SubscriptionPlanConfig, UserEntity]),
        UsersModule,
        ConfigModule,
        AlertsModule,
        NotificationsModule,
        EmailModule
    ],
    providers: [PaymentService, SubscriptionService, PlanPermissionService, DebitoService, SubscriptionCronService],
    controllers: [PaymentController, SubscriptionController, WebhookController],
    exports: [SubscriptionService, PlanPermissionService, DebitoService],
})
export class PaymentModule { }
