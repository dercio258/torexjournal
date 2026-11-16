import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { EconomicEvent } from './entities/economic-event.entity';
import { TradeEntity } from '../mt5/trade.entity';
import { AccountEntity } from '../account/account.entity';
import { EconomicCalendarService } from './economic-calendar.service';
import { EconomicCalendarController } from './economic-calendar.controller';
import { OptionalJwtAuthGuard } from '../common/guards/optional-jwt-auth.guard';
import { getJwtSecret } from '../common/security/security.config';

@Module({
    imports: [
        TypeOrmModule.forFeature([
            EconomicEvent,
            TradeEntity,
            AccountEntity
        ]),
        ConfigModule,
        JwtModule.registerAsync({
            imports: [ConfigModule],
            useFactory: async (configService: ConfigService) => ({
                secret: getJwtSecret(configService),
                signOptions: { expiresIn: '12h' },
            }),
            inject: [ConfigService],
        }),
    ],
    providers: [
        EconomicCalendarService,
        OptionalJwtAuthGuard
    ],
    controllers: [
        EconomicCalendarController
    ],
    exports: [
        EconomicCalendarService
    ],
})
export class EconomicCalendarModule {}
