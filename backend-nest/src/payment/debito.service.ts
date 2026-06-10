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

export interface DebitoPayFastPaymentDto {
    amount: number;
    reference_description: string;
    first_name?: string;
    last_name?: string;
    email?: string;
    callback_url?: string;
}

@Injectable()
export class DebitoService {
    private readonly logger = new Logger(DebitoService.name);
    private readonly baseUrl: string;
    private readonly apiToken: string;
    private readonly merchantId: string;
    private readonly walletPayFast: string;
    private readonly walletCard: string;
    private readonly walletMpesa: string;
    private readonly walletEmola: string;
    private readonly mznRateZar: number;

    constructor(private configService: ConfigService) {
        this.baseUrl = this.configService.get<string>('DEBITO_BASE_URL', 'https://gyqoaningqhurhvdugne.supabase.co/functions/v1/payment-orchestrator');
        this.apiToken = this.configService.get<string>('TOKEN_DEBITO', '');
        this.merchantId = this.configService.get<string>('merchant_id') || this.configService.get<string>('DEBITO_MERCHANT_ID', '');
        
        // Support both DEBITO and DEVITO wallet config for PayFast due to user request spelling
        this.walletPayFast = this.configService.get<string>('DEBITO_WALLET_PAYFAST') || this.configService.get<string>('DEVITO_WALLET_PAYFAST', '');
        this.walletCard = this.configService.get<string>('DEBITO_WALLET_ID_CARD') || this.configService.get<string>('DEBITO_WALLET_ID_BANK', '');
        this.walletMpesa = this.configService.get<string>('DEBITO_WALLET_ID_MPESA', '');
        this.walletEmola = this.configService.get<string>('DEBITO_WALLET_ID_EMOLA', '');
        
        // Exchange rate ZAR <-> MZN
        this.mznRateZar = Number(this.configService.get<string>('mznratezar') || this.configService.get<string>('MZN_RATE_ZAR', '0.25'));

        if (!this.apiToken) {
            this.logger.warn('TOKEN_DEBITO is not configured.');
        }
        if (!this.merchantId) {
            this.logger.warn('merchant_id is not configured.');
        }
    }

    private getWalletId(type: 'mpesa' | 'emola' | 'card' | 'payfast'): string {
        let walletId = '';
        switch (type) {
            case 'mpesa': walletId = this.walletMpesa; break;
            case 'emola': walletId = this.walletEmola; break;
            case 'card': walletId = this.walletCard; break;
            case 'payfast': walletId = this.walletPayFast; break;
            default: throw new HttpException(`Tipo de carteira inválido: ${type}`, HttpStatus.BAD_REQUEST);
        }

        if (!walletId) {
            this.logger.error(`Carteira para o método '${type}' não está configurada.`);
            throw new HttpException(`Configuração de pagamento para '${type}' incompleta. Carteira não configurada.`, HttpStatus.BAD_REQUEST);
        }

        return walletId;
    }

    private getHeaders() {
        const authHeader = this.apiToken.startsWith('Bearer ') ? this.apiToken : `Bearer ${this.apiToken}`;
        return {
            'Authorization': authHeader,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };
    }

    private async initiateMobilePayment(method: 'mpesa' | 'emola', data: DebitoMobileMoneyDto) {
        const walletId = this.getWalletId(method);

        const payload = {
            action: 'process',
            payment_method: method,
            merchant_id: this.merchantId,
            wallet_code: walletId,
            amount: data.amount,
            currency: 'MZN',
            phone: data.msisdn,
            source: 'gateway',
            source_id: data.reference_description
        };

        try {
            this.logger.log(`Initiating ${method.toUpperCase()} payment: ${JSON.stringify(payload)}`);
            const response = await axios.post(this.baseUrl, payload, { headers: this.getHeaders() });
            this.logger.log(`${method.toUpperCase()} payment response: ${JSON.stringify(response.data)}`);
            return response.data;
        } catch (error: any) {
            const apiError = error.response?.data?.message || error.response?.data?.error || error.message;
            this.logger.error(`${method.toUpperCase()} payment failed: ${apiError}`, error.response?.data);
            
            let userMessage = `Falha ao processar ${method.toUpperCase()}: ${apiError}`;
            if (apiError.includes('INSUFFICIENT_FUNDS')) {
                userMessage = method === 'mpesa' 
                    ? 'Saldo insuficiente para completar a transação.' 
                    : 'Saldo insuficiente na sua conta e-Mola.';
            }
            if (apiError.includes('TIMEOUT')) {
                userMessage = 'O pedido expirou. Por favor, tente novamente.';
            }
            
            throw new HttpException(userMessage, error.response?.status || HttpStatus.BAD_REQUEST);
        }
    }

    private async initiateRedirectPayment(method: 'visa_mastercard' | 'payfast', data: DebitoCardPaymentDto | DebitoPayFastPaymentDto) {
        const walletType = method === 'visa_mastercard' ? 'card' : 'payfast';
        const walletId = this.getWalletId(walletType);

        let amount = data.amount;
        let currency = 'MZN';
        if (method === 'payfast') {
            amount = Number((data.amount * this.mznRateZar).toFixed(2));
            currency = 'ZAR';
        }

        const payload = {
            action: 'process',
            payment_method: method,
            merchant_id: this.merchantId,
            wallet_code: walletId,
            amount: amount,
            currency: currency,
            customer_email: data.email || 'user@torexjournal.com',
            customer_name: `${data.first_name || ''} ${data.last_name || ''}`.trim() || 'Cliente Torex',
            return_url: data.callback_url
        };

        try {
            if (method === 'payfast') {
                this.logger.log(`Initiating PayFast payment (Converted from ${data.amount} MZN at rate ${this.mznRateZar} to ${amount} ZAR): ${JSON.stringify(payload)}`);
            } else {
                this.logger.log(`Initiating Card payment: ${JSON.stringify(payload)}`);
            }

            const response = await axios.post(this.baseUrl, payload, { headers: this.getHeaders() });
            this.logger.log(`${method === 'payfast' ? 'PayFast' : 'Card'} payment response: ${JSON.stringify(response.data)}`);
            
            if (response.data && response.data.checkout_url && !response.data.checkoutUrl) {
                response.data.checkoutUrl = response.data.checkout_url;
            }
            return response.data;
        } catch (error: any) {
            const apiError = error.response?.data?.message || error.response?.data?.error || error.message;
            const channelName = method === 'payfast' ? 'PayFast' : 'Cartão';
            this.logger.error(`${channelName} payment failed: ${apiError}`, error.response?.data);
            throw new HttpException(
                `Falha ao processar ${channelName}: ${apiError}`,
                error.response?.status || HttpStatus.BAD_REQUEST
            );
        }
    }

    async initiateMpesaPayment(data: DebitoMobileMoneyDto) {
        return this.initiateMobilePayment('mpesa', data);
    }

    async initiateEmolaPayment(data: DebitoMobileMoneyDto) {
        return this.initiateMobilePayment('emola', data);
    }

    async initiateCardPayment(data: DebitoCardPaymentDto) {
        return this.initiateRedirectPayment('visa_mastercard', data);
    }

    async initiatePayFastPayment(data: DebitoPayFastPaymentDto) {
        return this.initiateRedirectPayment('payfast', data);
    }

    async checkTransactionStatus(paymentId: string) {
        try {
            this.logger.log(`Checking transaction status for paymentId: ${paymentId}`);
            const response = await axios.post(
                this.baseUrl,
                {
                    action: 'check-status',
                    payment_id: paymentId
                },
                { headers: this.getHeaders() }
            );
            this.logger.log(`Status response for ${paymentId}: ${JSON.stringify(response.data)}`);
            
            if (response.data && response.data.success && response.data.payment) {
                const statusMap: Record<string, string> = {
                    'success': 'SUCCESSFULL',
                    'failed': 'FAILED',
                    'expired': 'CANCELLED',
                    'pending': 'PENDING'
                };
                const rawStatus = response.data.payment.status;
                const mappedStatus = statusMap[rawStatus] || rawStatus.toUpperCase();
                return {
                    ...response.data.payment,
                    status: mappedStatus
                };
            }
            return null;
        } catch (error: any) {
            const apiError = error.response?.data?.message || error.response?.data?.error || error.message;
            this.logger.error(`Status check failed for ${paymentId}: ${apiError}`);
            return null;
        }
    }
}

