import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class PaymentService {
    private readonly logger = new Logger(PaymentService.name);
    private readonly paypalApiUrl: string;

    constructor(private configService: ConfigService) {
        const mode = this.configService.get<string>('PAYPAL_MODE', 'sandbox');
        this.paypalApiUrl = mode === 'live'
            ? 'https://api-m.paypal.com'
            : 'https://api-m.sandbox.paypal.com';
    }

    async getAccessToken(): Promise<string> {
        const clientId = this.configService.get<string>('PAYPAL_CLIENT_ID');
        const clientSecret = this.configService.get<string>('PAYPAL_CLIENT_SECRET');

        if (!clientId || !clientSecret) {
            throw new Error('PayPal credentials not configured');
        }

        const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

        try {
            const response = await axios.post(
                `${this.paypalApiUrl}/v1/oauth2/token`,
                'grant_type=client_credentials',
                {
                    headers: {
                        Authorization: `Basic ${auth}`,
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                },
            );
            return response.data.access_token;
        } catch (error) {
            this.logger.error('Failed to get PayPal access token', error);
            throw error;
        }
    }

    async createOrder(amount: string, currency: string = 'BRL'): Promise<any> {
        const accessToken = await this.getAccessToken();

        try {
            const response = await axios.post(
                `${this.paypalApiUrl}/v2/checkout/orders`,
                {
                    intent: 'CAPTURE',
                    purchase_units: [
                        {
                            amount: {
                                currency_code: currency,
                                value: amount,
                            },
                        },
                    ],
                },
                {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                },
            );
            return response.data;
        } catch (error) {
            this.logger.error('Failed to create PayPal order', error);
            throw error;
        }
    }

    async captureOrder(orderId: string): Promise<any> {
        const accessToken = await this.getAccessToken();

        try {
            const response = await axios.post(
                `${this.paypalApiUrl}/v2/checkout/orders/${orderId}/capture`,
                {},
                {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                },
            );
            return response.data;
        } catch (error) {
            this.logger.error('Failed to capture PayPal order', error);
            throw error;
        }
    }

    getClientId(): string {
        return this.configService.get<string>('PAYPAL_CLIENT_ID') || '';
    }
}
