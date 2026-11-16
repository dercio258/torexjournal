import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminIntelligenceService } from './admin-intelligence.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UsersModule } from '../users/users.module';
import { PaymentModule } from '../payment/payment.module';
import { EmailModule } from '../email/email.module';
import { NetworkModule } from '../network/network.module';
import { Mt5Module } from '../mt5/mt5.module';
import { EconomicCalendarModule } from '../economic-calendar/economic-calendar.module';
import { AiModule } from '../ai/ai.module';
import { JwtModule } from '@nestjs/jwt';
import { getJwtSecret } from '../common/security/security.config';

@Module({
    imports: [
        ConfigModule,
        UsersModule,
        PaymentModule,
        EmailModule,
        NetworkModule,
        Mt5Module,
        EconomicCalendarModule,
        AiModule,
        BullModule.registerQueue(
            { name: 'email-queue' },
            { name: 'subscription-queue' },
            { name: 'behavioral-analysis' },
            { name: 'trade-import' },
        ),
        JwtModule.registerAsync({
            imports: [ConfigModule],
            useFactory: async (configService: ConfigService) => ({
                secret: getJwtSecret(configService),
                signOptions: { expiresIn: '12h' },
            }),
            inject: [ConfigService],
        }),
    ],
    controllers: [AdminController],
    providers: [AdminIntelligenceService],
})
export class AdminModule {}
