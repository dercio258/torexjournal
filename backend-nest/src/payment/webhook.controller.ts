import { Controller, Post, Body, Logger } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';

@Controller('webhook')
export class WebhookController {
    private readonly logger = new Logger(WebhookController.name);

    constructor(private readonly subscriptionService: SubscriptionService) { }

    @Post('c2b/emola')
    async emolaWebhook(@Body() body: any) {
        this.logger.log(`Received e-Mola webhook: ${JSON.stringify(body)}`);
        await this.subscriptionService.processDebitoWebhook(body);
        return { success: true };
    }

    @Post('c2b/bank')
    async bankWebhook(@Body() body: any) {
        this.logger.log(`Received Bank/Card webhook: ${JSON.stringify(body)}`);
        await this.subscriptionService.processDebitoWebhook(body);
        return { success: true };
    }
}
