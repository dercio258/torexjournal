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
            case 'card':
                return this.configService.get<string>('DEBITO_WALLET_ID_CARD') ||
                    this.configService.get<string>('DEBITO_WALLET_ID_BANK', '');
            default: throw new Error(`Tipo de carteira inválido: ${type}`);
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
            this.logger.log(`M-Pesa payment initiated: ${JSON.stringify(response.data)}`);
            return response.data;
        } catch (error: any) {
            const apiError = error.response?.data?.message || error.response?.data?.error || error.message;
            this.logger.error(`M-Pesa payment failed: ${apiError}`, error.response?.data);
            
            // Map common provider errors to user friendly messages
            let userMessage = `Falha ao processar M-Pesa: ${apiError}`;
            if (apiError.includes('INSUFFICIENT_FUNDS')) userMessage = 'Saldo insuficiente para completar a transação.';
            if (apiError.includes('TIMEOUT')) userMessage = 'O pedido expirou. Por favor, tente novamente.';
            
            throw new Error(userMessage);
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
            this.logger.log(`e-Mola payment initiated: ${JSON.stringify(response.data)}`);
            return response.data;
        } catch (error: any) {
            const apiError = error.response?.data?.message || error.response?.data?.error || error.message;
            this.logger.error(`e-Mola payment failed: ${apiError}`, error.response?.data);
            
            let userMessage = `Falha ao processar e-Mola: ${apiError}`;
            if (apiError.includes('INSUFFICIENT_FUNDS')) userMessage = 'Saldo insuficiente na sua conta e-Mola.';
            
            throw new Error(userMessage);
        }
    }

    async initiateCardPayment(data: DebitoCardPaymentDto) {
        const walletId = this.getWalletId('card');
        if (!walletId) {
            this.logger.error('DEBITO_WALLET_ID_CARD or BANK is not configured');
            throw new Error('Configuração de pagamento Cartão incompleta. Por favor, configure DEBITO_WALLET_ID_CARD ou DEBITO_WALLET_ID_BANK.');
        }

        try {
            const url = `${this.baseUrl}/wallets/${walletId}/card-payment`;
            const response = await axios.post(url, data, { headers: this.getHeaders() });
            this.logger.log(`Card payment initiated: ${JSON.stringify(response.data)}`);
            return response.data; // Usually returns checkoutUrl and possibly transaction id
        } catch (error: any) {
            const apiError = error.response?.data?.message || error.response?.data?.error || error.message;
            this.logger.error(`Card payment failed: ${apiError}`, error.response?.data);
            throw new HttpException(
                `Falha ao processar Cartão: ${apiError}`,
                error.response?.status || HttpStatus.BAD_REQUEST
            );
        }
    }

    async checkTransactionStatus(reference: string) {
        try {
            this.logger.log(`Checking transaction status for reference: ${reference}`);
            const url = `${this.baseUrl}/transactions/${reference}/status`;
            const response = await axios.get(url, { headers: this.getHeaders() });
            this.logger.log(`Status response for ${reference}: ${JSON.stringify(response.data)}`);
            return response.data;
        } catch (error: any) {
            const apiError = error.response?.data?.message || error.response?.data?.error || error.message;
            this.logger.error(`Status check failed for ${reference}: ${apiError} (Status: ${error.response?.status})`);
            return null;
        }
    }
}
