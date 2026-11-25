/**
 * Institutional Email Template System — Type Definitions
 * Torex Journal
 */

export type EmailAccentTone = 'slate' | 'emerald' | 'amber' | 'crimson' | 'blue';

export interface EmailTemplateData {
    title: string;
    subtitle?: string;
    message: string;
    buttonLabel?: string;
    buttonUrl?: string;
    userName?: string;
    footerText?: string;
    subject?: string;
    metadata?: Array<{ label: string; value: string; mono?: boolean }>;
}

export type OtpPurpose = 'REGISTRATION' | 'TWO_FACTOR' | 'ADMIN_LOGIN' | 'VERIFICATION';

export interface EmailTemplatePayloadMap {
    // Auth & Security
    OTP_CODE: {
        otp: string;
        userName?: string;
        expiresInMinutes?: number;
        purpose?: OtpPurpose;
        subject?: string;
    };
    WELCOME_EMAIL: {
        userName?: string;
        dashboardUrl?: string;
        subject?: string;
    };
    LOGIN_ALERT: {
        userName?: string;
        ip: string;
        device: string;
        time: string;
        subject?: string;
    };
    PASSWORD_RECOVERY: {
        userName?: string;
        code: string;
        resetUrl: string;
        expiresInMinutes?: number;
        subject?: string;
    };
    ACCOUNT_LOCKED: {
        userName?: string;
        code: string;
        unlockUrl: string;
        failedAttempts?: number;
        expiresInMinutes?: number;
        subject?: string;
    };

    // Billing & Subscriptions
    PAYMENT_INITIATED: {
        userName?: string;
        amount: string | number;
        currency?: string;
        method: string;
        reference: string;
        plan?: string;
        subject?: string;
    };
    CRYPTO_PAYMENT_INITIATED: {
        userName?: string;
        plan?: string;
        cycle?: string;
        amountUsd: string | number;
        cryptoAmount: string | number;
        cryptoCurrency: string;
        displayName: string;
        network: string;
        walletAddress: string;
        payinExtraId?: string | null;
        reference: string;
        copyWalletUrl: string;
        checkoutUrl: string;
        expiresAt?: string | null;
        subject?: string;
    };
    PAYMENT_SUCCESS: {
        userName?: string;
        plan: string;
        expiryDate: string;
        cycle?: string;
        amount?: string | number;
        currency?: string;
        reference?: string;
        subject?: string;
    };
    PAYMENT_FAILED: {
        userName?: string;
        reference: string;
        reason?: string;
        plan?: string;
        subject?: string;
    };
    TRIAL_WELCOME: {
        userName?: string;
        days: number;
        expiryDate: string;
        plan?: string;
        dashboardUrl?: string;
        subject?: string;
    };
    SUBSCRIPTION_EXPIRING: {
        userName?: string;
        plan: string;
        daysRemaining: number;
        expiryDate: string;
        renewalUrl?: string;
        subject?: string;
    };
    SUBSCRIPTION_EXPIRED: {
        userName?: string;
        plan: string;
        expiredAt?: string;
        renewalUrl?: string;
        subject?: string;
    };
    SUBSCRIPTION_CANCELLED: {
        userName?: string;
        plan: string;
        effectiveDate?: string;
        reason?: string;
        subject?: string;
    };
    REMARKETING_FOLLOWUP: {
        userName?: string;
        plan?: string;
        pricingUrl?: string;
        subject?: string;
    };

    // Trading, Connectivity & Reporting
    MT5_STATUS: {
        userName?: string;
        mt5Id: string;
        status: 'CONNECTED' | 'DISCONNECTED' | 'AUTH_FAILED';
        broker?: string;
        server?: string;
        reason?: string;
        subject?: string;
    };
    TRADE_IMPORTED: {
        userName?: string;
        count: number;
        method: string;
        profit?: number;
        currency?: string;
        wins?: number;
        losses?: number;
        accountName?: string;
        subject?: string;
    };
    WEEKLY_SUMMARY: {
        userName?: string;
        totalPnL: number;
        currency?: string;
        winRate: number;
        totalTrades: number;
        topLessons?: Array<{ lesson: string; count: number }>;
        period: { start: string; end: string };
        subject?: string;
    };
    MONTHLY_SUMMARY: {
        userName?: string;
        totalPnL: number;
        currency?: string;
        winRate: number;
        totalTrades: number;
        topLessons?: Array<{ lesson: string; count: number }>;
        period: { start: string; end: string };
        subject?: string;
    };

    // Governance, Alerts & Communications
    SYSTEM_ALERT: {
        title: string;
        message: string;
        type: string;
        userName?: string;
        actionUrl?: string;
        actionLabel?: string;
        subject?: string;
    };
    GENERAL_NOTIFICATION: EmailTemplateData;
}

export type EmailTemplateName = keyof EmailTemplatePayloadMap;

export interface EmailInlineQrSpec {
    cid: string;
    data: string;
    filename?: string;
}

export interface RenderedEmail {
    subject: string;
    preheader: string;
    html: string;
    text: string;
    inlineQr?: EmailInlineQrSpec;
}

export interface EmailTemplateDefinition<T = any> {
    category: string;
    tone?: EmailAccentTone | ((data: T) => EmailAccentTone);
    subject: (data: T) => string;
    preheader: (data: T) => string;
    renderBody: (data: T) => string;
    footerNote?: (data: T) => string | undefined;
    buildInlineQr?: (data: T) => EmailInlineQrSpec | undefined;
}
