import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { FinnhubController } from './finnhub.controller';
import { FinnhubService } from './finnhub.service';
import { EconomicEvent } from './economic-event.entity';
import { PaymentModule } from '../payment/payment.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([EconomicEvent]),
        HttpModule,
        ConfigModule,
        PaymentModule
    ],
    controllers: [FinnhubController],
    providers: [FinnhubService],
    exports: [FinnhubService]
})
export class FinnhubModule { }
