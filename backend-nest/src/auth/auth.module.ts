import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UsersModule } from '../users/users.module';
import { AccountModule } from '../account/account.module';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { GoogleStrategy } from './google.strategy';
import { GithubStrategy } from './github.strategy';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountEntity } from '../account/account.entity';
import { EmailModule } from '../email/email.module';
import { PaymentModule } from '../payment/payment.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditLogEntity } from './audit-log.entity';
import { AuditLogService } from './audit-log.service';
import { SessionEntity } from './session.entity';

@Module({
    imports: [
        UsersModule,
        AccountModule,
        PassportModule,
        TypeOrmModule.forFeature([AccountEntity, AuditLogEntity, SessionEntity]),
        JwtModule.registerAsync({
            imports: [ConfigModule],
            useFactory: async (configService: ConfigService) => ({
                secret: configService.get<string>('JWT_SECRET') || (process.env.NODE_ENV === 'production' ? (() => { throw new Error('JWT_SECRET missing'); })() : 'dev_secret'),
                signOptions: { expiresIn: '24h' },
            }),
            inject: [ConfigService],
        }),
        EmailModule,
        PaymentModule,
        NotificationsModule,
        ConfigModule
    ],
    providers: [AuthService, JwtStrategy, GoogleStrategy, GithubStrategy, AuditLogService],
    controllers: [AuthController],
    exports: [AuthService, AuditLogService],
})
export class AuthModule { }
