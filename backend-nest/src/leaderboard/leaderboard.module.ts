import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { LeaderboardRankEntity } from './leaderboard-rank.entity';
import { AccountEntity } from '../account/account.entity';
import { TradeEntity } from '../mt5/trade.entity';
import { UserEntity } from '../users/user.entity';
import { LeaderboardService } from './leaderboard.service';
import { LeaderboardController } from './leaderboard.controller';
import { OptionalJwtAuthGuard } from '../common/guards/optional-jwt-auth.guard';
import { AdminAuthGuard } from '../admin/admin-auth.guard';
import { getJwtSecret } from '../common/security/security.config';

@Module({
    imports: [
        TypeOrmModule.forFeature([
            LeaderboardRankEntity,
            AccountEntity,
            TradeEntity,
            UserEntity,
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
    controllers: [LeaderboardController],
    providers: [LeaderboardService, OptionalJwtAuthGuard, AdminAuthGuard],
    exports: [LeaderboardService],
})
export class LeaderboardModule {}
