import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface DebitoCardPaymentDto {
    amount: number;
    reference_description: string;
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: string;
    callback_url?: string;
}

export interface DebitoMobileMoneyDto {
    msisdn: string;
    amount: number;
    reference_description: string;
    internal_notes?: string;
}

@Injectable()
export class DebitoService {
    private readonly logger = new Logger(DebitoService.name);
    private readonly baseUrl: string;
    private readonly apiToken: string;

    constructor(private configService: ConfigService) {
        this.baseUrl = this.configService.get<string>('DEBITO_BASE_URL', 'https://my.debito.co.mz/api/v1');
        this.apiToken = this.configService.get<string>('TOKEN_DEBITO', '');

        if (!this.apiToken) {
            this.logger.warn('DEBITO_API_TOKEN is not configured.');
        }
    }

    private getWalletId(type: 'mpesa' | 'emola' | 'card'): string {
        switch (type) {
            case 'mpesa': return this.configService.get<string>('DEBITO_WALLET_ID_MPESA', '');
            case 'emola': return this.configService.get<string>('DEBITO_WALLET_ID_EMOLA', '');
            case 'card': return this.configService.get<string>('DEBITO_WALLET_ID_CARD', '');
            default: throw new Error(`Invalid wallet type: ${type}`);
        }
    }

    private getHeaders() {
        const authHeader = this.apiToken.startsWith('Bearer ') ? this.apiToken : `Bearer ${this.apiToken}`;
        return {
            'Authorization': authHeader,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };
    }

    async initiateMpesaPayment(data: DebitoMobileMoneyDto) {
        const walletId = this.getWalletId('mpesa');
        if (!walletId) {
            this.logger.error('DEBITO_WALLET_ID_MPESA is not configured');
            throw new Error('Configuração de pagamento M-Pesa incompleta');
        }

        try {
            const url = `${this.baseUrl}/wallets/${walletId}/c2b/mpesa`;
            const response = await axios.post(url, data, { headers: this.getHeaders() });
            return response.data;
        } catch (error: any) {
            this.logger.error('M-Pesa payment failed', error.response?.data || error.message);
            throw new Error(error.response?.data?.message || 'Falha ao processar M-Pesa');
        }
    }

    async initiateEmolaPayment(data: DebitoMobileMoneyDto) {
        const walletId = this.getWalletId('emola');
        if (!walletId) {
            this.logger.error('DEBITO_WALLET_ID_EMOLA is not configured');
            throw new Error('Configuração de pagamento e-Mola incompleta');
        }

        try {
            const url = `${this.baseUrl}/wallets/${walletId}/c2b/emola`;
            const response = await axios.post(url, data, { headers: this.getHeaders() });
            return response.data;
        } catch (error: any) {
            this.logger.error('e-Mola payment failed', error.response?.data || error.message);
            throw new Error(error.response?.data?.message || 'Falha ao processar e-Mola');
        }
    }

    async initiateCardPayment(data: DebitoCardPaymentDto) {
        const walletId = this.getWalletId('card');
        if (!walletId) {
            this.logger.error('DEBITO_WALLET_ID_CARD is not configured');
            throw new Error('Configuração de pagamento Cartão incompleta');
        }

        try {
            const url = `${this.baseUrl}/wallets/${walletId}/card-payment`;
            const response = await axios.post(url, data, { headers: this.getHeaders() });
            return response.data; // Usually returns checkoutUrl
        } catch (error: any) {
            this.logger.error('Card payment failed', error.response?.data || error.message);
            throw new HttpException(
                error.response?.data?.message || 'Falha ao processar Cartão',
                error.response?.status || HttpStatus.BAD_REQUEST
            );
        }
    }

    async checkTransactionStatus(reference: string) {
        try {
            const url = `${this.baseUrl}/transactions/${reference}/status`;
            const response = await axios.get(url, { headers: this.getHeaders() });
            return response.data;
        } catch (error: any) {
            this.logger.error(`Status check failed for ${reference}: ${error.message}`);
            return null;
        }
    }
}
