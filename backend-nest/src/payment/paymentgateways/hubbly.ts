import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as crypto from 'crypto';
import * as https from 'https';
import * as QRCode from 'qrcode';

export interface CreateHubblyPixParams {
    amountBrl: number;
    description: string;
    reference: string;
    payerName: string;
    payerDocument: string;
}

export interface HubblyCreatePixResult {
    success: true;
    transactionId: string;
    reference: string;
    emvCode: string;
    qrCodeDataUrl: string;
    amountBrl: number;
    status: string;
    expiresAt: string | null;
    rawResponse: Record<string, any>;
}

export interface HubblyWebhookVerificationResult {
    valid: boolean;
    reason?: 'missing_secret' | 'missing_headers' | 'invalid_format' | 'expired_timestamp' | 'invalid_signature';
}

const SAFE_EXTERNAL_ID_RE = /^[a-zA-Z0-9_-]{4,80}$/;

export function sanitizeBrazilianDocument(raw?: string | null): string {
    return String(raw || '').replace(/\D/g, '');
}

export function isValidCpf(raw: string): boolean {
    const digits = sanitizeBrazilianDocument(raw);
    if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) {
        return false;
    }

    let sum = 0;
    for (let i = 0; i < 9; i++) {
        sum += Number(digits[i]) * (10 - i);
    }
    let rem = (sum * 10) % 11;
    if (rem === 10) rem = 0;
    if (rem !== Number(digits[9])) return false;

    sum = 0;
    for (let i = 0; i < 10; i++) {
        sum += Number(digits[i]) * (11 - i);
    }
    rem = (sum * 10) % 11;
    if (rem === 10) rem = 0;
    return rem === Number(digits[10]);
}

export function isValidCnpj(raw: string): boolean {
    const digits = sanitizeBrazilianDocument(raw);
    if (digits.length !== 14 || /^(\d)\1{13}$/.test(digits)) {
        return false;
    }

    const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < 12; i++) {
        sum += Number(digits[i]) * weights1[i];
    }
    let rem = sum % 11;
    const d1 = rem < 2 ? 0 : 11 - rem;
    if (d1 !== Number(digits[12])) return false;

    const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    sum = 0;
    for (let i = 0; i < 13; i++) {
        sum += Number(digits[i]) * weights2[i];
    }
    rem = sum % 11;
    const d2 = rem < 2 ? 0 : 11 - rem;
    return d2 === Number(digits[13]);
}

export function validateCpfOrCnpj(raw: string): {
    valid: boolean;
    digits: string;
    type: 'CPF' | 'CNPJ' | null;
    masked: string;
} {
    const digits = sanitizeBrazilianDocument(raw);
    if (digits.length === 11 && isValidCpf(digits)) {
        return {
            valid: true,
            digits,
            type: 'CPF',
            masked: `***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-**`,
        };
    }
    if (digits.length === 14 && isValidCnpj(digits)) {
        return {
            valid: true,
            digits,
            type: 'CNPJ',
            masked: `**.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-**`,
        };
    }
    return { valid: false, digits, type: null, masked: '' };
}

/**
 * Hubbly PIX v2 Payment Gateway Service
 * Suporta cobranças PIX (BRL) com validação de CPF/CNPJ, QR Code EMV e webhooks HMAC-SHA256.
 */
@Injectable()
export class HubblyService {
    private readonly logger = new Logger(HubblyService.name);
    private readonly httpsAgent = new https.Agent({
        keepAlive: true,
        timeout: 30000,
    });
    private accessToken: string | null = null;
    private tokenExpiresAt = 0;
    private cachedWalletId: string | null = null;

    constructor(private readonly configService: ConfigService) {
        this.cachedWalletId = (this.configService.get<string>('HUBBLY_WALLET_ID') || '').trim() || null;
    }

    private getApiBase(): string {
        return (
            this.configService.get<string>('HUBBLY_BASE_URL') ||
            'https://api.hubblybr.com/api/v2'
        )
            .trim()
            .replace(/\/+$/, '');
    }

    private getClientId(): string {
        return (
            this.configService.get<string>('HUBBLY_CLIENT_ID') ||
            this.configService.get<string>('HUBBLY_API_KEY') ||
            ''
        ).trim();
    }

    private getClientSecret(): string {
        return (this.configService.get<string>('HUBBLY_CLIENT_SECRET') || '').trim();
    }

    private getWebhookSecret(): string {
        return (this.configService.get<string>('HUBBLY_WEBHOOK_SECRET') || '').trim();
    }

    isConfigured(): boolean {
        return Boolean(this.getClientId() && this.getClientSecret());
    }

    async generateQrDataUrl(emvCode: string): Promise<string> {
        return QRCode.toDataURL(emvCode, {
            width: 280,
            margin: 2,
            errorCorrectionLevel: 'M',
            color: {
                dark: '#0F172A',
                light: '#FFFFFF',
            },
        });
    }

    /**
     * Emite ou reaproveita o token Bearer via POST /resource/auth/token
     */
    async getAccessToken(): Promise<string> {
        const now = Date.now();
        if (this.accessToken && this.tokenExpiresAt > now + 60000) {
            return this.accessToken;
        }

        const clientId = this.getClientId();
        const clientSecret = this.getClientSecret();

        if (!clientId || !clientSecret) {
            this.logger.error('[HubblyService] HUBBLY_CLIENT_ID e/ou HUBBLY_CLIENT_SECRET não configurados.');
            throw new BadRequestException(
                'Gateway PIX temporariamente indisponível. Contacte o suporte.',
            );
        }

        try {
            this.logger.log('[HubblyService] Solicitando novo accessToken via POST /resource/auth/token...');
            const response = await axios.post(
                `${this.getApiBase()}/resource/auth/token`,
                { clientId, clientSecret },
                {
                    timeout: 15000,
                    httpsAgent: this.httpsAgent,
                    headers: { 'Content-Type': 'application/json' },
                },
            );

            const data = response.data?.data;
            if (data && data.accessToken) {
                this.accessToken = String(data.accessToken);
                const expiresInSec = Number(data.expiresIn) || 1800;
                this.tokenExpiresAt = Date.now() + expiresInSec * 1000;
                this.logger.log(`[HubblyService] AccessToken emitido com sucesso (TTL ${expiresInSec}s).`);
                return this.accessToken;
            }

            throw new Error(response.data?.message || 'Resposta inesperada ao emitir token Hubbly');
        } catch (error: any) {
            if (error instanceof BadRequestException) throw error;
            const errMsg = error?.response?.data?.message || error?.message || 'Falha de autenticação na Hubbly';
            this.logger.error(
                `[HubblyService] Erro ao autenticar na Hubbly (HTTP ${error?.response?.status || 'N/A'}): ${errMsg}`,
            );
            throw new BadRequestException(`Falha ao conectar ao gateway PIX: ${errMsg}`);
        }
    }

    /**
     * Obtém o walletId (do .env ou buscando a primeira carteira ativa da organização)
     */
    async getWalletId(): Promise<string> {
        if (this.cachedWalletId) {
            return this.cachedWalletId;
        }

        const envWallet = (this.configService.get<string>('HUBBLY_WALLET_ID') || '').trim();
        if (envWallet) {
            this.cachedWalletId = envWallet;
            return envWallet;
        }

        try {
            const token = await this.getAccessToken();
            this.logger.log('[HubblyService] Consultando carteiras disponíveis via GET /resource/wallets...');
            const response = await axios.get(`${this.getApiBase()}/resource/wallets?page=1&limit=10`, {
                timeout: 15000,
                httpsAgent: this.httpsAgent,
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            const wallets = response.data?.data || response.data?.wallets || response.data;
            let foundWallet: string | null = null;
            if (Array.isArray(wallets) && wallets.length > 0) {
                foundWallet = String(wallets[0].id || wallets[0].walletId || '').trim() || null;
            } else if (wallets && typeof wallets === 'object' && (wallets.id || wallets.walletId)) {
                foundWallet = String(wallets.id || wallets.walletId).trim() || null;
            }

            if (foundWallet) {
                this.cachedWalletId = foundWallet;
                this.logger.log(`[HubblyService] Carteira localizada e armazenada em cache: ${foundWallet}`);
                return foundWallet;
            }

            throw new BadRequestException('Nenhuma carteira PIX ativa encontrada na organização Hubbly.');
        } catch (error: any) {
            if (error instanceof BadRequestException) throw error;
            this.logger.error(
                `[HubblyService] Erro ao obter carteira Hubbly: ${error?.response?.data?.message || error?.message}`,
            );
            throw new BadRequestException('Não foi possível localizar a carteira PIX do recebedor.');
        }
    }

    /**
     * Cria cobrança PIX via POST /payment/pix/qrcode
     */
    async createTransaction(
        params: CreateHubblyPixParams,
        attempt = 1,
    ): Promise<HubblyCreatePixResult> {
        const docCheck = validateCpfOrCnpj(params.payerDocument);
        if (!docCheck.valid) {
            throw new BadRequestException(
                'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido para gerar o pagamento PIX.',
            );
        }

        const amountReais = Number(Number(params.amountBrl).toFixed(2));
        if (!Number.isFinite(amountReais) || amountReais < 1) {
            throw new BadRequestException('Valor mínimo para pagamento via PIX é R$ 1,00 BRL.');
        }

        const payerName = String(params.payerName || 'Cliente Torex').trim().slice(0, 120);

        try {
            const token = await this.getAccessToken();
            const walletId = await this.getWalletId();

            const payload = {
                walletId,
                amount: amountReais,
                description: String(params.description || 'Assinatura Torex Journal - PIX').slice(0, 140),
                externalId: String(params.reference),
                info: {
                    payerDocument: docCheck.digits,
                    payerName,
                },
            };

            this.logger.log(
                `[HubblyService] Criando cobrança PIX v2 (tentativa ${attempt}): ref=${params.reference} | R$ ${amountReais.toFixed(2)} | docType=${docCheck.type}`,
            );

            const response = await axios.post(`${this.getApiBase()}/payment/pix/qrcode`, payload, {
                timeout: 20000,
                httpsAgent: this.httpsAgent,
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
            });

            const resData = response.data;
            const payloadData = resData?.data?.payload || resData?.data || resData;
            const emvCode = String(
                payloadData?.qrCode ||
                    payloadData?.emv ||
                    payloadData?.pix_code ||
                    resData?.payload?.qrCode ||
                    '',
            ).trim();
            const txId = String(
                payloadData?.transactionId ||
                    payloadData?.id ||
                    resData?.data?.id ||
                    resData?.id ||
                    params.reference,
            ).trim();

            if (!emvCode) {
                throw new Error('Hubbly não retornou código PIX Copia e Cola válido.');
            }

            const qrCodeDataUrl = await this.generateQrDataUrl(emvCode);
            const expiresAt =
                payloadData?.expiresAt ||
                payloadData?.expirationDate ||
                resData?.data?.expiresAt ||
                null;

            return {
                success: true,
                transactionId: txId,
                reference: params.reference,
                emvCode,
                qrCodeDataUrl,
                amountBrl: amountReais,
                status: String(payloadData?.status || resData?.data?.status || 'pending').toLowerCase(),
                expiresAt: expiresAt ? String(expiresAt) : null,
                rawResponse: resData,
            };
        } catch (error: any) {
            if (error instanceof BadRequestException) throw error;

            const isNetworkOrDnsError =
                error?.code === 'ENOTFOUND' ||
                error?.code === 'ECONNRESET' ||
                error?.code === 'ETIMEDOUT' ||
                error?.code === 'ECONNABORTED' ||
                (typeof error?.message === 'string' && error.message.includes('getaddrinfo'));

            if (isNetworkOrDnsError && attempt < 3) {
                this.logger.warn(
                    `[HubblyService] Erro transitório de rede (${error?.code || error?.message}). Tentando novamente (${attempt + 1}/3)...`,
                );
                await new Promise((resolve) => setTimeout(resolve, 1000));
                return this.createTransaction(params, attempt + 1);
            }

            if ((error?.response?.status === 401 || error?.response?.status === 503) && attempt === 1) {
                this.logger.warn('[HubblyService] Token expirado (401/503). Renovando credenciais...');
                this.accessToken = null;
                this.tokenExpiresAt = 0;
                return this.createTransaction(params, 2);
            }

            const errMsg =
                error?.response?.data?.message ||
                error?.response?.data?.error ||
                error?.message ||
                'Falha ao processar solicitação de cobrança PIX';

            this.logger.error(
                `[HubblyService] Erro ao criar cobrança PIX v2 (HTTP ${error?.response?.status || 'N/A'}): ${errMsg}`,
            );
            throw new BadRequestException(errMsg);
        }
    }

    /**
     * Consulta transação autoritativa pelo externalId (GET /resource/transactions/external-id/{externalId})
     */
    async getTransactionByExternalId(externalId: string): Promise<Record<string, any> | null> {
        const cleanRef = String(externalId || '').trim();
        if (!SAFE_EXTERNAL_ID_RE.test(cleanRef)) {
            throw new BadRequestException('Referência externa PIX inválida.');
        }

        try {
            const token = await this.getAccessToken();
            const response = await axios.get(
                `${this.getApiBase()}/resource/transactions/external-id/${encodeURIComponent(cleanRef)}`,
                {
                    timeout: 15000,
                    httpsAgent: this.httpsAgent,
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                },
            );
            return response.data?.data || response.data || null;
        } catch (error: any) {
            if (error?.response?.status === 404) {
                return null;
            }
            this.logger.error(
                `[HubblyService] Erro ao consultar transação PIX ${cleanRef}: ${error?.response?.data?.message || error?.message}`,
            );
            throw error;
        }
    }

    /**
     * Valida a assinatura HMAC-SHA256 de webhooks da Hubbly conforme especificação v2.
     * Nunca ignora silenciosamente quando o segredo está ausente.
     */
    verifyWebhookSignature(
        rawBody: Buffer | string | Record<string, any>,
        headers: Record<string, any>,
        customSecret?: string | null,
    ): HubblyWebhookVerificationResult {
        const webhookSecret = String(customSecret || this.getWebhookSecret() || '').trim();
        if (!webhookSecret) {
            return { valid: false, reason: 'missing_secret' };
        }

        const timestamp = headers?.['x-webhook-timestamp'];
        const signature = headers?.['x-webhook-signature'];

        if (typeof timestamp !== 'string' || typeof signature !== 'string') {
            return { valid: false, reason: 'missing_headers' };
        }

        const cleanSig = signature.replace(/^sha256=/i, '').trim().toLowerCase();
        if (!/^[0-9a-f]{64}$/i.test(cleanSig)) {
            return { valid: false, reason: 'invalid_format' };
        }

        // Anti-replay window (+/- 5 minutes)
        const sentAtNum = Number(timestamp.trim());
        const sentAtSec = sentAtNum > 1e12 ? sentAtNum / 1000 : sentAtNum;
        if (!Number.isFinite(sentAtSec) || Math.abs(Date.now() / 1000 - sentAtSec) > 300) {
            return { valid: false, reason: 'expired_timestamp' };
        }

        try {
            const bodyBuf = Buffer.isBuffer(rawBody)
                ? rawBody
                : Buffer.from(
                      typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody || {}),
                      'utf8',
                  );
            const expected = crypto
                .createHmac('sha256', webhookSecret)
                .update(`${timestamp.trim()}.`)
                .update(bodyBuf)
                .digest();

            const signatureBuf = Buffer.from(cleanSig, 'hex');
            if (signatureBuf.length !== expected.length) {
                return { valid: false, reason: 'invalid_signature' };
            }

            const matches = crypto.timingSafeEqual(signatureBuf, expected);
            return matches ? { valid: true } : { valid: false, reason: 'invalid_signature' };
        } catch (err: any) {
            this.logger.error(`[HubblyService] Erro ao validar assinatura HMAC: ${err?.message || err}`);
            return { valid: false, reason: 'invalid_signature' };
        }
    }

    isPaidStatus(status?: string | null): boolean {
        const s = String(status || '')
            .trim()
            .toLowerCase();
        return (
            s === 'paid' ||
            s === 'completed' ||
            s === 'confirmed' ||
            s === 'approved' ||
            s === 'settled' ||
            s === 'success' ||
            s === 'succeeded' ||
            s === 'payment.completed' ||
            s === 'pix.paid'
        );
    }

    isFailedOrExpiredStatus(status?: string | null): boolean {
        const s = String(status || '')
            .trim()
            .toLowerCase();
        return (
            s === 'failed' ||
            s === 'expired' ||
            s === 'cancelled' ||
            s === 'canceled' ||
            s === 'refunded' ||
            s === 'rejected' ||
            s === 'chargeback' ||
            s === 'payment.failed' ||
            s === 'payment.expired'
        );
    }
}
