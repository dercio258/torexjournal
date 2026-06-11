import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { OandaService } from './oanda.service';
import { MarketDataController } from './market-data.controller';
import { MarketDataParserService } from './market-data-parser.service';
import { PaymentModule } from '../payment/payment.module';

@Module({
    imports: [
        HttpModule,
        ConfigModule,
        PaymentModule,
    ],
    controllers: [MarketDataController],
    providers: [OandaService, MarketDataParserService],
    exports: [OandaService, MarketDataParserService],
})
export class MarketDataModule { }
