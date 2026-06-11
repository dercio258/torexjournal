import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlertEntity } from './alert.entity';
import { AlertsService } from './alerts.service';
import { AlertsController } from './alerts.controller';
import { ScoringService } from './scoring.service';
import { PaymentModule } from '../payment/payment.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([AlertEntity]),
        PaymentModule,
    ],
    providers: [AlertsService, ScoringService],
    controllers: [AlertsController],
    exports: [AlertsService, ScoringService]
})
export class AlertsModule { }
