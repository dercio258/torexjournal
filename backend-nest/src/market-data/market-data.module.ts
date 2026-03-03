import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { OandaService } from './oanda.service';
import { MarketDataController } from './market-data.controller';

@Module({
    imports: [
        HttpModule,
        ConfigModule,
    ],
    controllers: [MarketDataController],
    providers: [OandaService],
    exports: [OandaService],
})
export class MarketDataModule { }
