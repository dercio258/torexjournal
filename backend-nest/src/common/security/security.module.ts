import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { RedisSecurityService } from './redis-security.service';
import { RedisThrottlerStorage } from '../throttler/redis-throttler.storage';
import { SecurityController } from './security.controller';
import { MediaController } from './media.controller';
import { TurnstileService } from './turnstile.service';
import { CloudflareR2StorageService } from './cloudflare-r2-storage.service';
import { DigitalSignatureService } from './digital-signature.service';

@Global()
@Module({
    imports: [ConfigModule, JwtModule.register({})],
    controllers: [SecurityController, MediaController],
    providers: [
        RedisSecurityService,
        RedisThrottlerStorage,
        TurnstileService,
        CloudflareR2StorageService,
        DigitalSignatureService,
    ],
    exports: [
        RedisSecurityService,
        RedisThrottlerStorage,
        TurnstileService,
        CloudflareR2StorageService,
        DigitalSignatureService,
    ],
})
export class SecurityModule {}
