import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as crypto from 'crypto';
import * as QRCode from 'qrcode';

export interface CryptoCurrencyOption {
    symbol: string;
    payCurrency: string;
    displayName: string;
    shortName: string;
    network: string;
    iconUrl: string;
    methodSlug: string;
    recommended?: boolean;
    requiresExtraId?: boolean;
    extraIdLabel?: string;
}

export interface CreateNowPaymentParams {
    orderId: string;
    amountUsd: number;
    cryptocurrency?: string;
    email?: string | null;
    description?: string | null;
    callbackUrl?: string | null;
}

export interface NowPaymentsCreateResult {
    success: true;
    paymentId: string;
    orderId: string;
    walletAddress: string;
    payinExtraId: string | null;
    cryptoAmount: string;
    cryptoCurrency: string;
    payCurrencyCode: string;
    displayName: string;
    network: string;
    iconUrl: string;
    fiatAmount: string;
    fiatCurrency: 'USD';
    status: string;
    qrCodeDataUrl: string;
    purchaseId: string | null;
    expirationDate: string | null;
    validUntil: string | null;
    rawResponse: Record<string, any>;
}

export interface NowPaymentsStatusResponse {
    payment_id: string | number;
    payment_status: string;
    pay_address: string;
    payin_extra_id?: string | null;
    price_amount: number;
    price_currency: string;
    pay_amount: number;
    actually_paid?: number;
    pay_currency: string;
    order_id?: string;
    order_description?: string;
    purchase_id?: string | number;
    outcome_amount?: number;
    outcome_currency?: string;
    created_at?: string;
    updated_at?: string;
    expiration_estimate_date?: string;
    valid_until?: string;
}

export interface IpnVerificationResult {
    valid: boolean;
    reason?: 'missing_secret' | 'missing_signature' | 'invalid_payload' | 'invalid_signature';
}

export const SUPPORTED_CRYPTO_CURRENCIES: CryptoCurrencyOption[] = [
    {
        symbol: 'USDT.TRC20',
        payCurrency: 'usdttrc20',
        displayName: 'Tether USD (TRC20)',
        shortName: 'USDT',
        network: 'TRON (TRC20)',
        iconUrl: 'https://panel.fsfpay.com/assets/img/coins/USDT.TRC20.png',
        methodSlug: 'usdt_trc20',
        recommended: true,
    },
    {
        symbol: 'BTC',
        payCurrency: 'btc',
        displayName: 'Bitcoin (BTC)',
        shortName: 'BTC',
        network: 'Bitcoin Network',
        iconUrl: 'https://panel.fsfpay.com/assets/img/coins/BTC.png',
        methodSlug: 'btc',
    },
    {
        symbol: 'USDT.ERC20',
        payCurrency: 'usdterc20',
        displayName: 'Tether USD (ERC20)',
        shortName: 'USDT',
        network: 'Ethereum (ERC20)',
        iconUrl: 'https://panel.fsfpay.com/assets/img/coins/USDT.ERC20.png',
        methodSlug: 'usdt_erc20',
    },
    {
        symbol: 'USDT.SOL',
        payCurrency: 'usdtsol',
        displayName: 'Tether USD (Solana)',
        shortName: 'USDT',
        network: 'Solana (SPL)',
        iconUrl: 'https://panel.fsfpay.com/assets/img/coins/USDT.SOL.png',
        methodSlug: 'usdt_sol',
    },
    {
        symbol: 'USDT.BEP20',
        payCurrency: 'usdtbsc',
        displayName: 'Tether USD (BEP20)',
        shortName: 'USDT',
        network: 'BNB Smart Chain (BEP20)',
        iconUrl: 'https://nowpayments.io/images/coins/usdtbsc.svg',
        methodSlug: 'usdt_bsc',
    },
    {
        symbol: 'ETH',
        payCurrency: 'eth',
        displayName: 'Ethereum (ETH)',
        shortName: 'ETH',
        network: 'Ethereum Mainnet',
        iconUrl: 'https://panel.fsfpay.com/assets/img/coins/ETH.png',
        methodSlug: 'eth',
    },
    {
        symbol: 'SOL',
        payCurrency: 'sol',
        displayName: 'Solana (SOL)',
        shortName: 'SOL',
        network: 'Solana Network',
        iconUrl: 'https://panel.fsfpay.com/assets/img/coins/SOL.png',
        methodSlug: 'sol',
    },
    {
        symbol: 'BNB.BSC',
        payCurrency: 'bnbbsc',
        displayName: 'BNB Coin (BSC)',
        shortName: 'BNB',
        network: 'BNB Smart Chain (BEP20)',
        iconUrl: 'https://panel.fsfpay.com/assets/img/coins/BNB.BSC.png',
        methodSlug: 'bnb_bsc',
    },
    {
        symbol: 'TRX',
        payCurrency: 'trx',
        displayName: 'TRON (TRX)',
        shortName: 'TRX',
        network: 'TRON Network',
        iconUrl: 'https://panel.fsfpay.com/assets/img/coins/TRX.png',
        methodSlug: 'trx',
    },
    {
        symbol: 'LTC',
        payCurrency: 'ltc',
        displayName: 'Litecoin (LTC)',
        shortName: 'LTC',
        network: 'Litecoin Network',
        iconUrl: 'https://panel.fsfpay.com/assets/img/coins/LTC.png',
        methodSlug: 'ltc',
    },
    {
        symbol: 'USDC.SOL',
        payCurrency: 'usdcsol',
        displayName: 'USD Coin (Solana)',
        shortName: 'USDC',
        network: 'Solana (SPL)',
        iconUrl: 'https://panel.fsfpay.com/assets/img/coins/USDC.png',
        methodSlug: 'usdc_sol',
    },
    {
        symbol: 'USDC.ERC20',
        payCurrency: 'usdcerc20',
        displayName: 'USD Coin (ERC20)',
        shortName: 'USDC',
        network: 'Ethereum (ERC20)',
        iconUrl: 'https://panel.fsfpay.com/assets/img/coins/USDC.png',
        methodSlug: 'usdc_erc20',
    },
    {
        symbol: 'TON',
        payCurrency: 'ton',
        displayName: 'Toncoin (TON)',
        shortName: 'TON',
        network: 'The Open Network (TON)',
        iconUrl: 'https://panel.fsfpay.com/assets/img/coins/TON.png',
        methodSlug: 'ton',
        requiresExtraId: true,
        extraIdLabel: 'Memo / Comment',
    },
    {
        symbol: 'XRP',
        payCurrency: 'xrp',
        displayName: 'Ripple (XRP)',
        shortName: 'XRP',
        network: 'XRP Ledger',
        iconUrl: 'https://panel.fsfpay.com/assets/img/coins/XRP.png',
        methodSlug: 'xrp',
        requiresExtraId: true,
        extraIdLabel: 'Destination Tag',
    },
];

const CRYPTO_ALIASES: Record<string, string> = {
    BITCOIN: 'BTC',
    BTC: 'BTC',
    USDT: 'USDT.TRC20',
    USDTTRC20: 'USDT.TRC20',
    'USDT_TRC20': 'USDT.TRC20',
    'USDT.TRC20': 'USDT.TRC20',
    USDTERC20: 'USDT.ERC20',
    'USDT_ERC20': 'USDT.ERC20',
    'USDT.ERC20': 'USDT.ERC20',
    USDTSOL: 'USDT.SOL',
    'USDT_SOL': 'USDT.SOL',
    'USDT.SOL': 'USDT.SOL',
    USDTBSC: 'USDT.BEP20',
    'USDT_BSC': 'USDT.BEP20',
    'USDT.BSC': 'USDT.BEP20',
    'USDT.BEP20': 'USDT.BEP20',
    USDTBEP20: 'USDT.BEP20',
    ETHEREUM: 'ETH',
    ETH: 'ETH',
    SOLANA: 'SOL',
    SOL: 'SOL',
    BNB: 'BNB.BSC',
    BNBBSC: 'BNB.BSC',
    'BNB_BSC': 'BNB.BSC',
    'BNB.BSC': 'BNB.BSC',
    TRON: 'TRX',
    TRX: 'TRX',
    LITECOIN: 'LTC',
    LTC: 'LTC',
    USDC: 'USDC.SOL',
    USDCSOL: 'USDC.SOL',
    'USDC_SOL': 'USDC.SOL',
    'USDC.SOL': 'USDC.SOL',
    USDCERC20: 'USDC.ERC20',
    'USDC_ERC20': 'USDC.ERC20',
    'USDC.ERC20': 'USDC.ERC20',
    TON: 'TON',
    TONCOIN: 'TON',
    XRP: 'XRP',
    RIPPLE: 'XRP',
};

const SAFE_PAYMENT_ID_RE = /^[a-zA-Z0-9_-]{3,80}$/;

/**
 * NOWPayments Crypto Payment Gateway Service
 * Suporta pagamentos seguros em criptomoedas (BTC, USDT TRC20/ERC20/SOL/BEP20, ETH, SOL, BNB, TRX, LTC, USDC, TON, XRP)
 * Documentação: https://documenter.getpostman.com/view/7907941/2s93m4X6hA
 */
@Injectable()
export class NowPaymentsService {
    private readonly logger = new Logger(NowPaymentsService.name);
    private readonly currencyMap = new Map<string, CryptoCurrencyOption>();
    private cachedCatalog: CryptoCurrencyOption[] | null = null;
    private cachedCatalogExpiresAt = 0;
    private catalogInFlight: Promise<CryptoCurrencyOption[]> | null = null;

    constructor(private readonly configService: ConfigService) {
        this.registerCurrenciesInMap(SUPPORTED_CRYPTO_CURRENCIES);
    }

    private registerCurrenciesInMap(coins: CryptoCurrencyOption[]) {
        for (const coin of coins) {
            const symKey = coin.symbol.toUpperCase();
            const payKey = coin.payCurrency.toUpperCase();
            const slugKey = coin.methodSlug.toUpperCase();
            if (!this.currencyMap.has(symKey)) this.currencyMap.set(symKey, coin);
            if (!this.currencyMap.has(payKey)) this.currencyMap.set(payKey, coin);
            if (!this.currencyMap.has(slugKey)) this.currencyMap.set(slugKey, coin);
        }
    }

    private normalizeLogoUrl(rawUrl?: string | null): string {
        const clean = String(rawUrl || '').trim();
        if (!clean) return '';
        if (/^https?:\/\//i.test(clean)) return clean;
        if (clean.startsWith('/')) return `https://nowpayments.io${clean}`;
        return `https://nowpayments.io/${clean}`;
    }

    private deriveShortName(code: string): string {
        const upper = code.toUpperCase();
        const stripped = upper.replace(/(TRC20|ERC20|BEP20|BSC|SOL|MATIC|POLYGON|BASE|ARBITRUM|ARB|OPTIMISM|OP|SPL|TON)$/, '');
        return stripped.length >= 2 ? stripped : upper;
    }

    private getApiUrl(): string {
        return (
            this.configService.get<string>('NOWPAYMENTS_API_URL') ||
            'https://api.nowpayments.io/v1'
        )
            .trim()
            .replace(/\/+$/, '');
    }

    private getApiKey(): string {
        return (this.configService.get<string>('NOWPAYMENTS_API_KEY') || '').trim();
    }

    private getIpnSecret(): string {
        return (this.configService.get<string>('NOWPAYMENTS_IPN_SECRET') || '').trim();
    }

    private getSlipSigningSecret(): string {
        return (
            this.configService.get<string>('NOWPAYMENTS_IPN_SECRET') ||
            this.configService.get<string>('WEBHOOK_SECRET') ||
            this.configService.get<string>('JWT_SECRET') ||
            this.configService.get<string>('USER_JWT_SECRET') ||
            'torex-crypto-slip-fallback-secret'
        ).trim();
    }

    private resolveIpnCallbackUrl(override?: string | null): string | null {
        const explicit = String(
            override || this.configService.get<string>('NOWPAYMENTS_IPN_CALLBACK_URL') || '',
        ).trim();
        if (explicit && /^https?:\/\//i.test(explicit)) {
            return explicit;
        }

        const baseUrl = (this.configService.get<string>('BASE_URL') || '').trim().replace(/\/+$/, '');
        if (baseUrl && /^https:\/\//i.test(baseUrl)) {
            const path = explicit && explicit.startsWith('/') ? explicit : '/api/webhook/nowpayments';
            return `${baseUrl}${path}`;
        }

        return null;
    }

    getSupportedCurrencies(): CryptoCurrencyOption[] {
        return SUPPORTED_CRYPTO_CURRENCIES.map((c) => ({ ...c }));
    }

    /**
     * Fetches and merges the full active NOWPayments currency catalog (`/v1/full-currencies`)
     * so users can search and pay with any enabled cryptocurrency (with 15-min in-memory cache).
     */
    async getSupportedCurrenciesCatalog(forceRefresh = false): Promise<CryptoCurrencyOption[]> {
        const base = SUPPORTED_CRYPTO_CURRENCIES.map((c) => ({ ...c }));
        const apiKey = this.getApiKey();
        if (!apiKey) {
            return base;
        }

        if (!forceRefresh && this.cachedCatalog && Date.now() < this.cachedCatalogExpiresAt) {
            return this.cachedCatalog;
        }

        if (this.catalogInFlight) {
            return this.catalogInFlight;
        }

        this.catalogInFlight = (async () => {
            try {
                const response = await axios.get<{ currencies?: any[] }>(
                    `${this.getApiUrl()}/full-currencies`,
                    {
                        headers: { 'x-api-key': apiKey },
                        timeout: 6000,
                    },
                );

                const rawList = Array.isArray(response.data?.currencies)
                    ? response.data.currencies
                    : [];

                if (rawList.length === 0) {
                    return base;
                }

                const byPayCurrency = new Map<string, CryptoCurrencyOption>();
                for (const item of base) {
                    byPayCurrency.set(item.payCurrency.toLowerCase(), item);
                }

                const extraCoins: CryptoCurrencyOption[] = [];
                for (const raw of rawList) {
                    if (!raw || raw.enable === false) continue;
                    const code = String(raw.code || '').trim();
                    if (!code || !/^[a-zA-Z0-9._-]{2,24}$/.test(code)) continue;
                    const lowerCode = code.toLowerCase();
                    const logoUrl = this.normalizeLogoUrl(raw.logo_url);

                    const existingBase = byPayCurrency.get(lowerCode);
                    if (existingBase) {
                        if (logoUrl && existingBase.iconUrl.includes('fsfpay.com')) {
                            existingBase.iconUrl = logoUrl;
                        }
                        continue;
                    }

                    const upperCode = code.toUpperCase();
                    const networkName = String(raw.network || upperCode).trim();
                    const displayName = String(raw.name || upperCode).trim();
                    const shortName = this.deriveShortName(upperCode);
                    const hasExtraId = Boolean(raw.extra_id_exists || raw.is_extra_id_supported);

                    const option: CryptoCurrencyOption = {
                        symbol: upperCode,
                        payCurrency: lowerCode,
                        displayName,
                        shortName,
                        network: networkName.toUpperCase() === upperCode ? upperCode : networkName,
                        iconUrl: logoUrl || `https://nowpayments.io/images/coins/${lowerCode}.svg`,
                        methodSlug: lowerCode,
                        requiresExtraId: hasExtraId || undefined,
                        extraIdLabel: hasExtraId ? 'Memo / Tag' : undefined,
                    };
                    byPayCurrency.set(lowerCode, option);
                    extraCoins.push(option);
                }

                extraCoins.sort((a, b) => a.symbol.localeCompare(b.symbol));
                const fullCatalog = [...base, ...extraCoins];
                this.registerCurrenciesInMap(fullCatalog);
                this.cachedCatalog = fullCatalog;
                this.cachedCatalogExpiresAt = Date.now() + 15 * 60 * 1000;
                return fullCatalog;
            } catch (err: any) {
                this.logger.warn(
                    `[NOWPayments] Falha ao carregar catálogo completo (/v1/full-currencies), usando catálogo base: ${err?.message || err}`,
                );
                return this.cachedCatalog || base;
            } finally {
                this.catalogInFlight = null;
            }
        })();

        return this.catalogInFlight;
    }

    isConfigured(): boolean {
        return this.getApiKey().length > 0;
    }

    /**
     * Resolve e valida a criptomoeda escolhida contra o catálogo suportado em memória.
     */
    resolveCrypto(input: string): CryptoCurrencyOption {
        const cleaned = String(input || '')
            .trim()
            .toUpperCase();
        if (!cleaned) {
            throw new BadRequestException('Selecione uma criptomoeda válida.');
        }

        const canonical = CRYPTO_ALIASES[cleaned] || cleaned;
        const found = this.currencyMap.get(canonical);
        if (!found) {
            throw new BadRequestException(
                `Criptomoeda "${cleaned}" não suportada. Selecione uma opção da lista.`,
            );
        }
        return found;
    }

    /**
     * Resolve a criptomoeda escolhida carregando o catálogo completo da NOWPayments se necessário.
     */
    async resolveCryptoAsync(input: string): Promise<CryptoCurrencyOption> {
        const cleaned = String(input || '')
            .trim()
            .toUpperCase();
        if (!cleaned) {
            throw new BadRequestException('Selecione uma criptomoeda válida.');
        }

        const canonical = CRYPTO_ALIASES[cleaned] || cleaned;
        const immediate = this.currencyMap.get(canonical);
        if (immediate) return immediate;

        if (this.getApiKey()) {
            await this.getSupportedCurrenciesCatalog(false);
            const afterCatalog = this.currencyMap.get(canonical);
            if (afterCatalog) return afterCatalog;
        }

        throw new BadRequestException(
            `Criptomoeda "${cleaned}" não suportada. Pesquise e selecione uma moeda disponível.`,
        );
    }

    async generateQrDataUrl(data: string): Promise<string> {
        return QRCode.toDataURL(data, {
            width: 280,
            margin: 2,
            errorCorrectionLevel: 'M',
            color: {
                dark: '#0F172A',
                light: '#FFFFFF',
            },
        });
    }

    async generateQrPngBuffer(data: string): Promise<Buffer> {
        return QRCode.toBuffer(data, {
            type: 'png',
            width: 260,
            margin: 2,
            errorCorrectionLevel: 'M',
            color: {
                dark: '#0F172A',
                light: '#FFFFFF',
            },
        });
    }

    /**
     * Gera assinatura HMAC-SHA256 curta para link público seguro de cópia da carteira no e-mail.
     */
    generateSlipSignature(reference: string, walletAddress: string): string {
        return crypto
            .createHmac('sha256', this.getSlipSigningSecret())
            .update(`crypto-slip:v1:${reference.trim()}:${walletAddress.trim()}`)
            .digest('hex')
            .slice(0, 32);
    }

    verifySlipSignature(reference: string, walletAddress: string, signature?: string | null): boolean {
        if (!signature || typeof signature !== 'string') return false;
        const expected = this.generateSlipSignature(reference, walletAddress);
        const provided = signature.trim().toLowerCase();
        if (provided.length !== expected.length) return false;
        try {
            return crypto.timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(provided, 'utf8'));
        } catch {
            return false;
        }
    }

    /**
     * Cria uma ordem de pagamento Crypto na NOWPayments.
     */
    async createPayment(params: CreateNowPaymentParams): Promise<NowPaymentsCreateResult> {
        const requestId = `np_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
        const cryptoInfo = await this.resolveCryptoAsync(params.cryptocurrency || 'USDT.TRC20');
        const apiKey = this.getApiKey();

        if (!apiKey) {
            this.logger.error(`[NOWPayments] [${requestId}] NOWPAYMENTS_API_KEY não configurada.`);
            throw new BadRequestException(
                'Gateway de criptomoedas temporariamente indisponível. Contacte o suporte.',
            );
        }

        const numAmount = Number(params.amountUsd);
        if (!Number.isFinite(numAmount) || numAmount <= 0) {
            throw new BadRequestException('Valor em USD inválido para criação do pagamento cripto.');
        }

        const ipnUrl = this.resolveIpnCallbackUrl(params.callbackUrl);
        const orderDescription = String(
            params.description || `Torex Journal - ${cryptoInfo.displayName} - ${params.orderId}`,
        )
            .trim()
            .slice(0, 200);

        const requestPayload: Record<string, any> = {
            price_amount: Number(numAmount.toFixed(2)),
            price_currency: 'usd',
            pay_currency: cryptoInfo.payCurrency,
            order_id: String(params.orderId),
            order_description: orderDescription,
        };

        if (ipnUrl) {
            requestPayload.ipn_callback_url = ipnUrl;
        }

        if (params.email && params.email.includes('@')) {
            requestPayload.customer_email = params.email.trim().toLowerCase();
        }

        this.logger.log(
            `[NOWPayments] [${requestId}] Criando pagamento ${cryptoInfo.displayName} (${cryptoInfo.payCurrency}) | orderId=${params.orderId} | usd=${requestPayload.price_amount}`,
        );

        try {
            const response = await axios.post(`${this.getApiUrl()}/payment`, requestPayload, {
                headers: {
                    'x-api-key': apiKey,
                    'Content-Type': 'application/json',
                },
                timeout: 30000,
            });

            const data = response.data;
            if (!data || !data.payment_id) {
                throw new Error('NOWPayments não retornou payment_id válido.');
            }
            if (!data.pay_address) {
                throw new Error(
                    `NOWPayments não retornou endereço de carteira para ${cryptoInfo.displayName}.`,
                );
            }

            const walletAddress = String(data.pay_address).trim();
            const qrCodeDataUrl = await this.generateQrDataUrl(walletAddress);

            this.logger.log(
                `[NOWPayments] [${requestId}] Pagamento criado com sucesso | paymentId=${data.payment_id} | payAmount=${data.pay_amount} ${data.pay_currency}`,
            );

            return {
                success: true,
                paymentId: String(data.payment_id),
                orderId: String(data.order_id || params.orderId),
                walletAddress,
                payinExtraId:
                    data.payin_extra_id !== undefined &&
                    data.payin_extra_id !== null &&
                    String(data.payin_extra_id).trim().length > 0
                        ? String(data.payin_extra_id).trim()
                        : null,
                cryptoAmount: String(data.pay_amount),
                cryptoCurrency: cryptoInfo.symbol,
                payCurrencyCode: String(data.pay_currency || cryptoInfo.payCurrency).toLowerCase(),
                displayName: cryptoInfo.displayName,
                network: cryptoInfo.network,
                iconUrl: cryptoInfo.iconUrl,
                fiatAmount: Number(data.price_amount || requestPayload.price_amount).toFixed(2),
                fiatCurrency: 'USD',
                status: String(data.payment_status || 'waiting').toLowerCase(),
                qrCodeDataUrl,
                purchaseId: data.purchase_id ? String(data.purchase_id) : null,
                expirationDate: data.expiration_estimate_date || null,
                validUntil: data.valid_until || null,
                rawResponse: data,
            };
        } catch (err: any) {
            const errStatus = err?.response?.status;
            const errData = err?.response?.data;
            const rawMsg =
                errData?.message ||
                errData?.error ||
                err?.message ||
                'Falha ao conectar à API da NOWPayments';

            this.logger.error(
                `[NOWPayments] [${requestId}] Erro na API (HTTP ${errStatus || 'N/A'}): ${rawMsg}`,
            );

            // Friendly error if amount is below minimum network threshold for selected coin
            const lower = String(rawMsg).toLowerCase();
            if (
                lower.includes('minimal') ||
                lower.includes('minimum') ||
                lower.includes('less than minimal') ||
                lower.includes('amount is too small')
            ) {
                throw new BadRequestException(
                    `O valor deste plano ($${requestPayload.price_amount.toFixed(2)} USD) está abaixo do mínimo exigido pela rede ${cryptoInfo.displayName}. Experimente selecionar USDT (TRC20), TRX, SOL ou LTC.`,
                );
            }

            if (err instanceof BadRequestException) {
                throw err;
            }

            throw new BadRequestException(
                `Não foi possível gerar a carteira para ${cryptoInfo.displayName}: ${rawMsg}`,
            );
        }
    }

    /**
     * Consulta o status autoritativo atual do pagamento diretamente na NOWPayments.
     */
    async getPaymentStatus(paymentId: string): Promise<NowPaymentsStatusResponse> {
        const cleanId = String(paymentId || '').trim();
        if (!SAFE_PAYMENT_ID_RE.test(cleanId)) {
            throw new BadRequestException('Identificador de pagamento cripto inválido.');
        }

        const apiKey = this.getApiKey();
        if (!apiKey) {
            throw new BadRequestException('NOWPAYMENTS_API_KEY não configurada no servidor.');
        }

        try {
            const response = await axios.get<NowPaymentsStatusResponse>(
                `${this.getApiUrl()}/payment/${encodeURIComponent(cleanId)}`,
                {
                    headers: {
                        'x-api-key': apiKey,
                    },
                    timeout: 15000,
                },
            );
            return response.data;
        } catch (err: any) {
            this.logger.error(
                `[NOWPayments] Erro ao consultar status do pagamento ${cleanId}: ${err?.message || err}`,
            );
            throw err;
        }
    }

    /**
     * Ordena recursivamente as chaves de um objeto para validação HMAC-SHA512 conforme spec NOWPayments.
     */
    sortObject(obj: any): any {
        if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
            return obj;
        }
        return Object.keys(obj)
            .sort()
            .reduce<Record<string, any>>((sorted, key) => {
                sorted[key] = this.sortObject(obj[key]);
                return sorted;
            }, {});
    }

    /**
     * Verifica a assinatura IPN HMAC-SHA512 da NOWPayments (nunca ignora silenciosamente).
     */
    verifyIpnSignature(
        payload: Record<string, any>,
        signature?: string | null,
        customSecret?: string | null,
    ): IpnVerificationResult {
        const secret = String(customSecret || this.getIpnSecret() || '').trim();
        if (!secret) {
            return { valid: false, reason: 'missing_secret' };
        }
        if (!signature || typeof signature !== 'string' || !signature.trim()) {
            return { valid: false, reason: 'missing_signature' };
        }
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            return { valid: false, reason: 'invalid_payload' };
        }

        try {
            const sortedPayload = this.sortObject(payload);
            const serialized = JSON.stringify(sortedPayload);
            const calculatedHmac = crypto
                .createHmac('sha512', secret)
                .update(serialized)
                .digest('hex');

            const cleanSig = signature.trim().toLowerCase();
            if (!/^[a-f0-9]+$/.test(cleanSig)) {
                return { valid: false, reason: 'invalid_signature' };
            }

            const sigBuffer = Buffer.from(cleanSig, 'hex');
            const calcBuffer = Buffer.from(calculatedHmac.toLowerCase(), 'hex');

            if (sigBuffer.length !== calcBuffer.length) {
                return { valid: false, reason: 'invalid_signature' };
            }

            const matches = crypto.timingSafeEqual(sigBuffer, calcBuffer);
            return matches ? { valid: true } : { valid: false, reason: 'invalid_signature' };
        } catch (err: any) {
            this.logger.error(`[NOWPayments] Erro ao validar assinatura IPN: ${err?.message || err}`);
            return { valid: false, reason: 'invalid_signature' };
        }
    }

    isConfirmedPaidStatus(status?: string | null): boolean {
        const s = String(status || '')
            .trim()
            .toLowerCase();
        return s === 'finished' || s === 'confirmed' || s === 'sending';
    }

    isFailedOrExpiredStatus(status?: string | null): boolean {
        const s = String(status || '')
            .trim()
            .toLowerCase();
        return s === 'failed' || s === 'expired' || s === 'refunded' || s === 'cancelled';
    }

    isPendingStatus(status?: string | null): boolean {
        const s = String(status || '')
            .trim()
            .toLowerCase();
        return s === 'waiting' || s === 'confirming' || s === 'partially_paid';
    }
}
