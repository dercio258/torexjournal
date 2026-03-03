import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentService } from './payment.service';
import { PaypalSubscriptionsService } from './paypal-subscription.service';
import { PaymentController } from './payment.controller';
import { SubscriptionController } from './subscription.controller';
import { PaymentEntity } from './payment.entity';
import { Subscription } from './subscription.entity';
import { SubscriptionPlanConfig } from './subscription-plan.entity';
import { UsersModule } from '../users/users.module';
import { AccountEntity } from '../account/account.entity';
import { ConfigModule } from '@nestjs/config';

@Module({
    imports: [
        TypeOrmModule.forFeature([PaymentEntity, AccountEntity, Subscription, SubscriptionPlanConfig]),
        UsersModule,
        ConfigModule
    ],
    providers: [PaymentService, PaypalSubscriptionsService],
    controllers: [PaymentController, SubscriptionController],
    exports: [PaypalSubscriptionsService],
})
export class PaymentModule { }
