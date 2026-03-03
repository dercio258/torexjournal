import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { ConfigModule } from '@nestjs/config';
import { UsersModule } from '../users/users.module';
import { PaymentModule } from '../payment/payment.module';

@Module({
    imports: [ConfigModule, UsersModule, PaymentModule],
    controllers: [AdminController],
})
export class AdminModule { }
