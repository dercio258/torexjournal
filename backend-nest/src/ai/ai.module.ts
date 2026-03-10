import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiInsightEntity } from './ai-insight.entity';
import { AccountEntity } from '../account/account.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { HttpModule } from '@nestjs/axios';

@Module({
    imports: [
        TypeOrmModule.forFeature([AiInsightEntity, AccountEntity]),
        HttpModule,
        NotificationsModule
    ],
    controllers: [AiController],
    providers: [AiService],
    exports: [AiService]
})
export class AiModule { }
