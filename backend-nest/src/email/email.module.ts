import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule } from '@nestjs/config';
import { EmailProcessor } from './email.processor';
import { EmailService } from './email.service';

@Module({
    imports: [
        BullModule.registerQueue({
            name: 'email-queue',
        }),
        ConfigModule,
    ],
    providers: [EmailService, EmailProcessor],
    exports: [EmailService, BullModule], // Export EmailService and BullModule so other modules can inject the queue
})
export class EmailModule { }
