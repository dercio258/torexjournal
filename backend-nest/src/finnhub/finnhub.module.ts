import { Module } from '@nestjs/common';
import { FinnhubController } from './finnhub.controller';
import { FinnhubService } from './finnhub.service';
import { EconomicCalendarModule } from '../economic-calendar/economic-calendar.module';
import { PaymentModule } from '../payment/payment.module';

@Module({
    imports: [
        EconomicCalendarModule,
        PaymentModule,
    ],
    controllers: [FinnhubController],
    providers: [FinnhubService],
    exports: [FinnhubService]
})
export class FinnhubModule { }
