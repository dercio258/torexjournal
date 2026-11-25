import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as crypto from 'crypto';

export type DebitoPayMethod = 'mpesa' | 'emola' | 'visa_mastercard' | 'payfast';
export type DebitoPayNormalizedStatus = 'pending' | 'success' | 'failed' | 'expired' | 'refunded';

export interface DebitoPayCustomerContext {
    ip?: string | null;
    userAgent?: string | null;
    origin?: string | null;
}

export interface DebitoPayProcessResult {
    success: boolean;
    paymentId: string;
    reference: string;
    providerReference: string | null;
    status: DebitoPayNormalizedStatus;
    rawStatus: string;
    checkoutUrl: string | null;
    amount: number;
    currency: 'MZN' | 'ZAR';
    paymentMethod: DebitoPayMethod;
    walletCode: string;
    idempotencyKey: string;
    message?: string;
    rawResponse: Record<string, any>;
}

export interface DebitoPayStatusResult {
    paymentId: string;
    status: DebitoPayNormalizedStatus;
    rawStatus: string;
    reference: string | null;
    amount: number | null;
    currency: string | null;
    rawResponse: Record<string, any>;
}

export interface DebitoWebhookVerificationResult {
    valid: boolean;
    reason?: 'missing_secret' | 'missing_signature' | 'missing_raw_body' | 'invalid_signature';
}

const DEFAULT_DEBITO_BASE_URL = 'https://gyqoaningqhurhvdugne.supabase.co/functions/v1';

/**
 * Debito Pay C2B Payment Gateway Service
 * Suporta exclusivamente pagamentos C2B:
 *  - M-Pesa (MZN, min 10 MZN, popup)
 *  - e-Mola (MZN, min 5 MZN, popup)
 *  - Visa / Mastercard (MZN, min 50 MZN, Hosted Checkout)
 *  - PayFast (ZAR, min 5 ZAR, Hosted Checkout, carteira ZAR isolada)
 * Documentação: https://debitopay.com/developers/payments-api/ & debitopaydoc.md
 */
@Injectable()
export class DebitoPayService {
    private readonly logger = new Logger(DebitoPayService.name);

    constructor(private readonly configService: ConfigService) {}

    private readEnv(keys: string[], fallback = ''): string {
        for (const key of keys) {
            const val = (this.configService.get<string>(key) ?? process.env[key] ?? '').trim();
            if (val) return val;
        }
        return fallback;
    }

    getBaseUrl(): string {
        return this.readEnv(
            ['DEBITO_PAY_BASE_URL', 'DEBITO_BASE_URL'],
            DEFAULT_DEBITO_BASE_URL,
        ).replace(/\/+$/, '');
    }

    getOrchestratorEndpoint(): string {
        const explicit = this.readEnv(['DEBITO_PAY_ENDPOINT', 'DEBITO_ENDPOINT']);
        if (explicit) {
            return explicit.replace(/\/+$/, '');
        }
        const base = this.getBaseUrl();
        if (base.endsWith('/payment-orchestrator')) {
            return base;
        }
        return `${base}/payment-orchestrator`;
    }

    getWebhookEndpoint(): string {
        const explicit = this.readEnv(['DEBITO_PAY_WEBHOOK_URL', 'DEBITO_PAY_WEBHOOK_ENDPOINT']);
        if (explicit) return explicit;
        const baseUrl = this.readEnv(['BASE_URL'], 'https://torexjournal.com').replace(/\/+$/, '');
        return `${baseUrl}/api/webhooks/debito-pay`;
    }

    private getApiKey(): string {
        return this.readEnv(['DEBITO_PAY_API_KEY', 'TOKEN_DEBITO']);
    }

    private getMerchantId(): string {
        return this.readEnv(['DEBITO_PAY_MERCHANT_ID', 'DEBITO_MERCHANT_ID', 'merchant_id']);
    }

    getWalletCode(method: DebitoPayMethod): string {
        if (method === 'payfast') {
            return this.readEnv([
                'DEBITO_PAY_WALLET_PAYFAST',
                'DEBITO_WALLET_ID_PAYFAST',
                'DEBITO_WALLET_PAYFAST',
                'DEBITO_PAY_WALLET_ZAR',
            ]);
        }
        if (method === 'mpesa') {
            return this.readEnv([
                'DEBITO_PAY_WALLET_MPESA',
                'DEBITO_WALLET_ID_MPESA',
                'DEBITO_PAY_WALLET_MZN',
            ]);
        }
        if (method === 'emola') {
            return this.readEnv([
                'DEBITO_PAY_WALLET_EMOLA',
                'DEBITO_WALLET_ID_EMOLA',
                'DEBITO_PAY_WALLET_MZN',
            ]);
        }
        return this.readEnv([
            'DEBITO_PAY_WALLET_CARD',
            'DEBITO_WALLET_ID_CARD',
            'DEBITO_PAY_WALLET_MZN',
        ]);
    }

    getWebhookSecret(): string {
        return this.readEnv(['DEBITO_PAY_WEBHOOK_SECRET', 'WEBHOOK_SECRET']);
    }

    getDefaultReturnUrl(): string {
        const explicit = this.readEnv(['DEBITO_PAY_RETURN_URL', 'CALL_BACK_DEBITO']);
        if (explicit && /^https?:\/\//i.test(explicit)) return explicit;
        const frontendUrl = this.readEnv(['FRONTEND_URL', 'BASE_URL'], 'https://torexjournal.com').replace(
            /\/+$/,
            '',
        );
        return `${frontendUrl}/subscription/success`;
    }

    isMethodConfigured(method: DebitoPayMethod): boolean {
        return Boolean(this.getApiKey() && this.getMerchantId() && this.getWalletCode(method));
    }

    private buildHeaders(idempotencyKey: string, ctx?: DebitoPayCustomerContext): Record<string, string> {
        const apiKey = this.getApiKey();
        const headers: Record<string, string> = {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-Idempotency-Key': idempotencyKey,
        };
        if (ctx?.ip) headers['X-Customer-IP'] = String(ctx.ip).trim().slice(0, 64);
        if (ctx?.userAgent) headers['X-Customer-User-Agent'] = String(ctx.userAgent).trim().slice(0, 256);
        if (ctx?.origin) headers['X-Customer-Origin'] = String(ctx.origin).trim().slice(0, 256);
        return headers;
    }

    normalizeStatus(raw?: string | null): DebitoPayNormalizedStatus {
        const s = String(raw || '')
            .trim()
            .toLowerCase();
        if (
            s === 'success' ||
            s === 'successful' ||
            s === 'successfull' ||
            s === 'completed' ||
            s === 'paid' ||
            s === 'approved' ||
            s === 'settled' ||
            s === 'payment.completed'
        ) {
            return 'success';
        }
        if (
            s === 'refunded' ||
            s === 'chargeback' ||
            s === 'payment.refunded' ||
            s === 'payment.chargeback'
        ) {
            return 'refunded';
        }
        if (s === 'expired' || s === 'timeout' || s === 'timed_out' || s === 'payment.expired') {
            return 'expired';
        }
        if (
            s === 'failed' ||
            s === 'error' ||
            s === 'rejected' ||
            s === 'declined' ||
            s === 'cancelled' ||
            s === 'canceled' ||
            s === 'payment.failed'
        ) {
            return 'failed';
        }
        return 'pending';
    }

    private mapGatewayError(err: any, method: DebitoPayMethod): BadRequestException {
        const status = err?.response?.status;
        const data = err?.response?.data || {};
        const code = String(data?.code || data?.error_code || data?.error || '')
            .trim()
            .toUpperCase();
        const rawMsg = String(
            data?.message || data?.error_description || data?.error || err?.message || '',
        ).trim();

        this.logger.error(
            `[DebitoPay] Erro em ${method} (HTTP ${status || 'N/A'}, code=${code || 'NONE'}): ${rawMsg}`,
        );

        if (code.includes('INVALID_API_KEY') || status === 401) {
            return new BadRequestException(
                'Falha de autenticação no gateway de pagamentos. Contacte o suporte técnico.',
            );
        }
        if (code.includes('WALLET_DOMAIN_NOT_ALLOWED')) {
            return new BadRequestException(
                'Domínio não autorizado na carteira de pagamentos. Contacte o suporte.',
            );
        }
        if (code.includes('WALLET_CODE_NOT_FOUND') || code.includes('WALLET_INACTIVE')) {
            return new BadRequestException(
                `Carteira ${method.toUpperCase()} temporariamente indisponível. Escolha outro método de pagamento.`,
            );
        }
        if (code.includes('INSUFFICIENT_MATURED_BALANCE') || code.includes('INSUFFICIENT')) {
            return new BadRequestException(
                'Saldo insuficiente para concluir esta transação. Verifique sua carteira e tente novamente.',
            );
        }
        if (status === 429 || code.includes('RATE_LIMIT')) {
            return new BadRequestException(
                'Muitas tentativas de pagamento em sequência. Aguarde alguns segundos e tente novamente.',
            );
        }
        if (err?.code === 'ECONNABORTED' || err?.code === 'ETIMEDOUT' || status === 504) {
            return new BadRequestException(
                'A operadora demorou a responder. Verifique se recebeu a solicitação no telefone antes de tentar novamente.',
            );
        }
        if (status >= 500) {
            return new BadRequestException(
                'Serviço da operadora temporariamente instável. Tente novamente em instantes.',
            );
        }

        return new BadRequestException(
            rawMsg || `Não foi possível processar o pagamento via ${method.toUpperCase()}.`,
        );
    }

    private ensureGatewayReady(method: DebitoPayMethod): { merchantId: string; walletCode: string } {
        const apiKey = this.getApiKey();
        const merchantId = this.getMerchantId();
        const walletCode = this.getWalletCode(method);

        if (!apiKey || !merchantId || !walletCode) {
            this.logger.error(
                `[DebitoPay] Configuração incompleta para ${method}: apiKey=${Boolean(apiKey)}, merchantId=${Boolean(merchantId)}, walletCode=${Boolean(walletCode)}`,
            );
            throw new BadRequestException(
                `Método ${method.toUpperCase()} temporariamente indisponível. Contacte o suporte ou escolha outro método.`,
            );
        }
        return { merchantId, walletCode };
    }

    private formatMozambiquePhone(rawPhone: string, withPlus: boolean): string {
        const digits = String(rawPhone || '').replace(/\D/g, '');
        let local9 = digits;
        if (digits.startsWith('258') && digits.length === 12) {
            local9 = digits.slice(3);
        } else if (digits.length > 9) {
            local9 = digits.slice(-9);
        }
        if (local9.length !== 9) {
            throw new BadRequestException(
                'Informe um número moçambicano válido com 9 dígitos (ex: 84XXXXXXX ou 86XXXXXXX).',
            );
        }
        return withPlus ? `+258${local9}` : `258${local9}`;
    }

    private async invokeOrchestrator(
        payload: Record<string, any>,
        method: DebitoPayMethod,
        idempotencyKey: string,
        ctx?: DebitoPayCustomerContext,
    ): Promise<Record<string, any>> {
        try {
            const url = this.getOrchestratorEndpoint();
            const response = await axios.post(url, payload, {
                headers: this.buildHeaders(idempotencyKey, ctx),
                timeout: 35000,
            });
            return response.data || {};
        } catch (err: any) {
            throw this.mapGatewayError(err, method);
        }
    }

    private parseOrchestratorResponse(
        raw: Record<string, any>,
        meta: {
            reference: string;
            amount: number;
            currency: 'MZN' | 'ZAR';
            method: DebitoPayMethod;
            walletCode: string;
            idempotencyKey: string;
        },
    ): DebitoPayProcessResult {
        const inner = raw?.data && typeof raw.data === 'object' ? raw.data : raw;
        const paymentId = String(
            inner?.payment_id ||
                inner?.paymentId ||
                inner?.transaction_id ||
                inner?.transactionId ||
                inner?.id ||
                raw?.payment_id ||
                raw?.id ||
                meta.reference,
        ).trim();
        const providerRef =
            inner?.reference ||
            inner?.provider_reference ||
            raw?.reference ||
            null;
        const checkoutUrl =
            inner?.checkout_url ||
            inner?.checkoutUrl ||
            inner?.redirect_url ||
            inner?.payment_url ||
            raw?.checkout_url ||
            raw?.checkoutUrl ||
            null;
        const rawStatus = String(
            inner?.status || inner?.payment_status || raw?.status || 'pending',
        ).trim();
        const normalizedStatus = this.normalizeStatus(rawStatus);

        return {
            success: raw?.success !== false && normalizedStatus !== 'failed',
            paymentId,
            reference: meta.reference,
            providerReference: providerRef ? String(providerRef) : null,
            status: normalizedStatus,
            rawStatus,
            checkoutUrl: checkoutUrl ? String(checkoutUrl).trim() : null,
            amount: meta.amount,
            currency: meta.currency,
            paymentMethod: meta.method,
            walletCode: meta.walletCode,
            idempotencyKey: meta.idempotencyKey,
            message: inner?.message || raw?.message || undefined,
            rawResponse: raw,
        };
    }

    /**
     * 2.1 M-Pesa (MZN, min 10 MZN, C2B via popup — sem Hosted Checkout)
     */
    async processMpesa(params: {
        reference: string;
        amountMzn: number;
        phoneNumber: string;
        idempotencyKey?: string;
        customerContext?: DebitoPayCustomerContext;
    }): Promise<DebitoPayProcessResult> {
        const { merchantId, walletCode } = this.ensureGatewayReady('mpesa');
        const amount = Number(Number(params.amountMzn).toFixed(2));
        if (!Number.isFinite(amount) || amount < 10) {
            throw new BadRequestException('O valor mínimo para pagamento via M-Pesa é 10 MZN.');
        }

        const formattedPhone = this.formatMozambiquePhone(params.phoneNumber, true);
        const localPrefix = formattedPhone.slice(4, 6);
        if (!['84', '85'].includes(localPrefix)) {
            throw new BadRequestException('Número M-Pesa inválido. Utilize prefixo 84 ou 85.');
        }

        const idempotencyKey = params.idempotencyKey || crypto.randomUUID();
        const payload = {
            action: 'process',
            payment_method: 'mpesa',
            merchant_id: merchantId,
            wallet_code: walletCode,
            amount,
            currency: 'MZN',
            phone: formattedPhone,
            source: 'torexjournal',
            source_id: params.reference,
        };

        this.logger.log(
            `[DebitoPay] Iniciando M-Pesa C2B | ref=${params.reference} | amount=${amount} MZN | wallet=${walletCode}`,
        );
        const raw = await this.invokeOrchestrator(
            payload,
            'mpesa',
            idempotencyKey,
            params.customerContext,
        );
        return this.parseOrchestratorResponse(raw, {
            reference: params.reference,
            amount,
            currency: 'MZN',
            method: 'mpesa',
            walletCode,
            idempotencyKey,
        });
    }

    /**
     * 2.2 e-Mola (MZN, min 5 MZN, C2B via popup — confirmação assíncrona)
     */
    async processEmola(params: {
        reference: string;
        amountMzn: number;
        phoneNumber: string;
        idempotencyKey?: string;
        customerContext?: DebitoPayCustomerContext;
    }): Promise<DebitoPayProcessResult> {
        const { merchantId, walletCode } = this.ensureGatewayReady('emola');
        const amount = Number(Number(params.amountMzn).toFixed(2));
        if (!Number.isFinite(amount) || amount < 5) {
            throw new BadRequestException('O valor mínimo para pagamento via e-Mola é 5 MZN.');
        }

        const formattedPhone = this.formatMozambiquePhone(params.phoneNumber, false);
        const localPrefix = formattedPhone.slice(3, 5);
        if (!['86', '87'].includes(localPrefix)) {
            throw new BadRequestException('Número e-Mola inválido. Utilize prefixo 86 ou 87.');
        }

        const idempotencyKey = params.idempotencyKey || crypto.randomUUID();
        const payload = {
            action: 'process',
            payment_method: 'emola',
            merchant_id: merchantId,
            wallet_code: walletCode,
            amount,
            currency: 'MZN',
            phone: formattedPhone,
            source: 'torexjournal',
            source_id: params.reference,
        };

        this.logger.log(
            `[DebitoPay] Iniciando e-Mola C2B | ref=${params.reference} | amount=${amount} MZN | wallet=${walletCode}`,
        );
        const raw = await this.invokeOrchestrator(
            payload,
            'emola',
            idempotencyKey,
            params.customerContext,
        );
        return this.parseOrchestratorResponse(raw, {
            reference: params.reference,
            amount,
            currency: 'MZN',
            method: 'emola',
            walletCode,
            idempotencyKey,
        });
    }

    /**
     * 2.3 Visa / Mastercard (MZN, min 50 MZN, Hosted Checkout)
     */
    async processVisaMastercard(params: {
        reference: string;
        amountMzn: number;
        customerEmail: string;
        customerName: string;
        customerPhone?: string;
        returnUrl?: string;
        idempotencyKey?: string;
        customerContext?: DebitoPayCustomerContext;
    }): Promise<DebitoPayProcessResult> {
        const { merchantId, walletCode } = this.ensureGatewayReady('visa_mastercard');
        const amount = Number(Number(params.amountMzn).toFixed(2));
        if (!Number.isFinite(amount) || amount < 50) {
            throw new BadRequestException(
                'O valor mínimo para pagamento com cartão Visa/Mastercard é 50 MZN.',
            );
        }

        const idempotencyKey = params.idempotencyKey || crypto.randomUUID();
        const returnUrl = params.returnUrl || this.getDefaultReturnUrl();

        const payload: Record<string, any> = {
            action: 'process',
            payment_method: 'visa_mastercard',
            merchant_id: merchantId,
            wallet_code: walletCode,
            amount,
            currency: 'MZN',
            customer_email: params.customerEmail.trim().toLowerCase(),
            customer_name: String(params.customerName || 'Cliente TorexJournal').trim().slice(0, 120),
            return_url: returnUrl,
            source: 'torexjournal',
            source_id: params.reference,
        };
        if (params.customerPhone && params.customerPhone.trim().length >= 7) {
            payload.customer_phone = params.customerPhone.trim().slice(0, 30);
        }

        this.logger.log(
            `[DebitoPay] Iniciando Visa/Mastercard Hosted Checkout | ref=${params.reference} | amount=${amount} MZN | wallet=${walletCode}`,
        );
        const raw = await this.invokeOrchestrator(
            payload,
            'visa_mastercard',
            idempotencyKey,
            params.customerContext,
        );
        const parsed = this.parseOrchestratorResponse(raw, {
            reference: params.reference,
            amount,
            currency: 'MZN',
            method: 'visa_mastercard',
            walletCode,
            idempotencyKey,
        });
        if (!parsed.checkoutUrl) {
            throw new BadRequestException(
                'O gateway não retornou o link seguro de checkout para o cartão. Tente novamente.',
            );
        }
        return parsed;
    }

    /**
     * 2.4 PayFast (ZAR exclusivamente, min 5 ZAR, carteira ZAR isolada, Hosted Checkout)
     */
    async processPayFast(params: {
        reference: string;
        amountZar: number;
        customerEmail: string;
        customerName: string;
        customerPhone?: string;
        returnUrl?: string;
        idempotencyKey?: string;
        customerContext?: DebitoPayCustomerContext;
    }): Promise<DebitoPayProcessResult> {
        const { merchantId, walletCode } = this.ensureGatewayReady('payfast');
        const amount = Number(Number(params.amountZar).toFixed(2));
        if (!Number.isFinite(amount) || amount < 5) {
            throw new BadRequestException('Minimum amount for PayFast payment is 5 ZAR.');
        }

        const idempotencyKey = params.idempotencyKey || crypto.randomUUID();
        const returnUrl = params.returnUrl || this.getDefaultReturnUrl();

        const payload: Record<string, any> = {
            action: 'process',
            payment_method: 'payfast',
            merchant_id: merchantId,
            wallet_code: walletCode,
            amount,
            currency: 'ZAR',
            customer_email: params.customerEmail.trim().toLowerCase(),
            customer_name: String(params.customerName || 'TorexJournal Customer').trim().slice(0, 120),
            return_url: returnUrl,
            source: 'torexjournal',
            source_id: params.reference,
        };
        if (params.customerPhone && params.customerPhone.trim().length >= 7) {
            payload.customer_phone = params.customerPhone.trim().slice(0, 30);
        }

        this.logger.log(
            `[DebitoPay] Initiating PayFast Hosted Checkout | ref=${params.reference} | amount=${amount} ZAR | wallet=${walletCode}`,
        );
        const raw = await this.invokeOrchestrator(
            payload,
            'payfast',
            idempotencyKey,
            params.customerContext,
        );
        const parsed = this.parseOrchestratorResponse(raw, {
            reference: params.reference,
            amount,
            currency: 'ZAR',
            method: 'payfast',
            walletCode,
            idempotencyKey,
        });
        if (!parsed.checkoutUrl) {
            throw new BadRequestException(
                'Gateway did not return a secure PayFast checkout link. Please try again.',
            );
        }
        return parsed;
    }

    /**
     * §10 Consulta de estado e reconciliação via POST /payment-orchestrator { action: 'check-status', payment_id }
     */
    async checkStatus(paymentId: string): Promise<DebitoPayStatusResult | null> {
        const cleanId = String(paymentId || '').trim();
        if (!cleanId || !this.getApiKey()) {
            return null;
        }

        try {
            const url = this.getOrchestratorEndpoint();
            const response = await axios.post(
                url,
                {
                    action: 'check-status',
                    payment_id: cleanId,
                },
                {
                    headers: {
                        Authorization: `Bearer ${this.getApiKey()}`,
                        'Content-Type': 'application/json',
                        Accept: 'application/json',
                    },
                    timeout: 15000,
                },
            );

            const raw = response.data || {};
            const inner = raw?.data && typeof raw.data === 'object' ? raw.data : raw;
            const rawStatus = String(
                inner?.status || inner?.payment_status || raw?.status || 'pending',
            ).trim();

            return {
                paymentId: cleanId,
                status: this.normalizeStatus(rawStatus),
                rawStatus,
                reference: inner?.source_id || inner?.reference || raw?.reference || null,
                amount:
                    inner?.amount !== undefined && Number.isFinite(Number(inner.amount))
                        ? Number(inner.amount)
                        : null,
                currency: inner?.currency ? String(inner.currency).toUpperCase() : null,
                rawResponse: raw,
            };
        } catch (err: any) {
            this.logger.warn(
                `[DebitoPay] Falha ao consultar check-status para ${cleanId}: ${err?.response?.data?.message || err?.message || err}`,
            );
            return null;
        }
    }

    /**
     * §8.2 Validação HMAC-SHA256 da assinatura x-webhook-signature usando rawBody e timingSafeEqual.
     */
    verifyWebhookSignature(
        rawBody: Buffer | string | undefined,
        signature?: string | null,
        customSecret?: string | null,
    ): DebitoWebhookVerificationResult {
        const secret = String(customSecret || this.getWebhookSecret() || '').trim();
        if (!secret) {
            return { valid: false, reason: 'missing_secret' };
        }
        if (!signature || typeof signature !== 'string' || !signature.trim()) {
            return { valid: false, reason: 'missing_signature' };
        }
        if (!rawBody) {
            return { valid: false, reason: 'missing_raw_body' };
        }

        try {
            const bodyBuf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
            const expectedHex = crypto.createHmac('sha256', secret).update(bodyBuf).digest('hex');
            const cleanSig = signature.replace(/^sha256=/i, '').trim().toLowerCase();
            if (cleanSig.length !== expectedHex.length || !/^[a-f0-9]+$/.test(cleanSig)) {
                return { valid: false, reason: 'invalid_signature' };
            }
            const matches = crypto.timingSafeEqual(
                Buffer.from(cleanSig, 'hex'),
                Buffer.from(expectedHex, 'hex'),
            );
            return matches ? { valid: true } : { valid: false, reason: 'invalid_signature' };
        } catch {
            return { valid: false, reason: 'invalid_signature' };
        }
    }
}
