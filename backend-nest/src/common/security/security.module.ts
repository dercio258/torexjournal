import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedisSecurityService } from './redis-security.service';
import { RedisThrottlerStorage } from '../throttler/redis-throttler.storage';

@Global()
@Module({
    imports: [ConfigModule],
    providers: [RedisSecurityService, RedisThrottlerStorage],
    exports: [RedisSecurityService, RedisThrottlerStorage],
})
export class SecurityModule {}
