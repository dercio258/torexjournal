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

@Module({
    imports: [
        TypeOrmModule.forFeature([PaymentEntity, AccountEntity, Subscription, SubscriptionPlanConfig, UserEntity]),
        UsersModule,
        ConfigModule,
        AlertsModule,
        NotificationsModule
    ],
    providers: [PaymentService, SubscriptionService, PlanPermissionService, DebitoService],
    controllers: [PaymentController, SubscriptionController],
    exports: [SubscriptionService, PlanPermissionService, DebitoService],
})
export class PaymentModule { }
