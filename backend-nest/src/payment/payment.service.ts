import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PaymentService {
    private readonly logger = new Logger(PaymentService.name);

    constructor(private configService: ConfigService) { }

    getPricingConfig() {
        return {
            basicoPrice: this.configService.get<number>('PLANO_BASICO_PRICE', 1),
            premiumPrice: this.configService.get<number>('PLANO_PREMIUN_PRICE', 1),
            exchangeRate: this.configService.get<number>('EXCENCHE', 65),
        };
    }
}
