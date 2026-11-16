import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EmailProducerService } from './email-producer.service';
import { EmailProcessor } from './email.processor';
import { EmailService } from './email.service';
import { AnalyticsModule } from '../analytics/analytics.module';

@Module({
    imports: [
        BullModule.registerQueue({
            name: 'email-queue',
            defaultJobOptions: {
                attempts: 5,
                backoff: {
                    type: 'exponential',
                    delay: 5000,
                },
                removeOnComplete: 200,
                removeOnFail: 500,
            },
        }),
        ConfigModule,
        AnalyticsModule,
    ],
    providers: [EmailService, EmailProducerService, EmailProcessor],
    exports: [EmailService, EmailProducerService, BullModule],
})
export class EmailModule {}
