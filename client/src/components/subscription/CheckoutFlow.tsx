import { useEffect, useMemo, useRef, useState } from 'react';
import {
    ShieldCheck,
    CreditCard,
    Smartphone,
    Check,
    Loader2,
    ChevronRight,
    ChevronDown,
    ArrowRight,
    Info,
    CheckCircle2,
    Copy,
    QrCode,
    Clock,
    RefreshCw,
    AlertTriangle,
    Mail,
    ArrowLeftRight,
    ExternalLink,
    Lock,
    Search,
    Globe,
    X,
} from 'lucide-react';
import { CountryPhoneInput } from '../ui/CountryPhoneInput';
import {
    filterCountries,
    findCountry,
    getLocalizedCountryName,
} from '../../constants/countries';
import { motion } from 'framer-motion';

// --- Shared Types ---

export type CheckoutMethodId = 'mpesa' | 'emola' | 'card' | 'payfast' | 'pix' | 'crypto';

export interface CheckoutLocationOption {
    code: string;
    flag: string;
    flagUrl?: string;
    dialCode?: string;
    label: string;
    shortLabel: string;
    locale: 'pt' | 'en';
    methods: CheckoutMethodId[];
    defaultMethod: CheckoutMethodId;
}

const LUSOPHONE_ISO2 = new Set(['MZ', 'BR', 'PT', 'AO', 'CV', 'GW', 'ST', 'TL']);
const PRIORITY_CHECKOUT_ISO2 = ['MZ', 'BR', 'ZA', 'PT', 'AO', 'US', 'GB'];

export const CHECKOUT_LOCATIONS: CheckoutLocationOption[] = [
    {
        code: 'MZ',
        flag: '🇲🇿',
        flagUrl: 'https://flagcdn.com/mz.svg',
        dialCode: '+258',
        label: 'Moçambique',
        shortLabel: 'MZ',
        locale: 'pt',
        methods: ['mpesa', 'emola', 'card', 'crypto'],
        defaultMethod: 'mpesa',
    },
    {
        code: 'BR',
        flag: '🇧🇷',
        flagUrl: 'https://flagcdn.com/br.svg',
        dialCode: '+55',
        label: 'Brasil',
        shortLabel: 'BR',
        locale: 'pt',
        methods: ['pix', 'card', 'crypto'],
        defaultMethod: 'pix',
    },
    {
        code: 'ZA',
        flag: '🇿🇦',
        flagUrl: 'https://flagcdn.com/za.svg',
        dialCode: '+27',
        label: 'South Africa',
        shortLabel: 'ZA',
        locale: 'en',
        methods: ['payfast', 'card', 'crypto'],
        defaultMethod: 'payfast',
    },
    {
        code: 'INTL',
        flag: '🌍',
        label: 'Global',
        shortLabel: 'Global',
        locale: 'en',
        methods: ['card', 'crypto'],
        defaultMethod: 'card',
    },
];

export function resolveLocationOption(
    countryCode?: string | null,
    isEn = false,
): CheckoutLocationOption {
    const cc = String(countryCode || '').trim().toUpperCase();
    const preset = CHECKOUT_LOCATIONS.find((loc) => loc.code === cc);
    if (preset) {
        if (preset.code === 'INTL') return preset;
        return {
            ...preset,
            label: getLocalizedCountryName(preset.code, isEn),
        };
    }

    const catalogMatch = /^[A-Z]{2}$/.test(cc) ? findCountry(cc) : undefined;
    if (catalogMatch) {
        return {
            code: catalogMatch.iso2,
            flag: catalogMatch.iso2,
            flagUrl: catalogMatch.flagUrl,
            dialCode: catalogMatch.dialCode,
            label: getLocalizedCountryName(catalogMatch.iso2, isEn),
            shortLabel: catalogMatch.iso2,
            locale: LUSOPHONE_ISO2.has(catalogMatch.iso2) ? 'pt' : 'en',
            methods: ['card', 'crypto'],
            defaultMethod: 'card',
        };
    }

    return CHECKOUT_LOCATIONS[CHECKOUT_LOCATIONS.length - 1];
}

export function getPaymentMethodGridClass(count: number): string {
    if (count <= 2) return 'grid-cols-2 gap-2.5 sm:gap-3';
    if (count === 3) return 'grid-cols-3 gap-2 sm:gap-3';
    return 'grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3';
}

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

export interface ActiveCryptoPayment {
    id: string;
    reference: string;
    paymentId: string;
    tier: string;
    cycle: string;
    fiatAmountUsd: number;
    fiatCurrency: string;
    cryptoCurrency: string;
    payCurrencyCode: string;
    displayName: string;
    network: string;
    iconUrl?: string | null;
    walletAddress: string;
    payinExtraId?: string | null;
    cryptoAmount: string;
    actuallyPaid?: string | null;
    qrCodeDataUrl: string;
    providerStatus: string;
    expiresAt?: string | null;
    createdAt?: string;
    copyWalletUrl?: string;
    checkoutUrl?: string;
}

export interface ActivePixPayment {
    id: string;
    reference: string;
    transactionId: string;
    tier: string;
    cycle: string;
    amountUsd: number;
    payerDocumentType: 'CPF' | 'CNPJ' | string;
    payerDocumentMasked: string;
    emvCode: string;
    qrCodeDataUrl: string;
    providerStatus: string;
    expiresAt?: string | null;
    createdAt?: string;
}

export const DEFAULT_CRYPTO_CURRENCIES: CryptoCurrencyOption[] = [
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
        symbol: 'BNB.BSC',
        payCurrency: 'bnbbsc',
        displayName: 'Binance Coin (BNB · BSC)',
        shortName: 'BNB',
        network: 'BNB Smart Chain (BEP20)',
        iconUrl: 'https://panel.fsfpay.com/assets/img/coins/BNB.BSC.png',
        methodSlug: 'bnb_bsc',
    },
    {
        symbol: 'USDT.BEP20',
        payCurrency: 'usdtbsc',
        displayName: 'Tether USD (Binance BEP20)',
        shortName: 'USDT',
        network: 'BNB Smart Chain (BEP20)',
        iconUrl: 'https://panel.fsfpay.com/assets/img/coins/USDT.TRC20.png',
        methodSlug: 'usdt_bsc',
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

export function formatCpfCnpj(raw: string): string {
    const digits = raw.replace(/\D/g, '').slice(0, 14);
    if (digits.length <= 11) {
        return digits
            .replace(/^(\d{3})(\d)/, '$1.$2')
            .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
            .replace(/\.(\d{3})(\d)/, '.$1-$2');
    }
    return digits
        .replace(/^(\d{2})(\d)/, '$1.$2')
        .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
        .replace(/\.(\d{3})(\d)/, '.$1/$2')
        .replace(/(\d{4})(\d)/, '$1-$2');
}

export function validateCpfCnpjClient(raw: string): {
    valid: boolean;
    type: 'CPF' | 'CNPJ' | null;
    digits: string;
} {
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 11) {
        if (/^(\d)\1{10}$/.test(digits)) return { valid: false, type: null, digits };
        let sum = 0;
        for (let i = 0; i < 9; i++) sum += Number(digits[i]) * (10 - i);
        let rem = (sum * 10) % 11;
        if (rem === 10) rem = 0;
        if (rem !== Number(digits[9])) return { valid: false, type: null, digits };
        sum = 0;
        for (let i = 0; i < 10; i++) sum += Number(digits[i]) * (11 - i);
        rem = (sum * 10) % 11;
        if (rem === 10) rem = 0;
        return {
            valid: rem === Number(digits[10]),
            type: rem === Number(digits[10]) ? 'CPF' : null,
            digits,
        };
    }
    if (digits.length === 14) {
        if (/^(\d)\1{13}$/.test(digits)) return { valid: false, type: null, digits };
        const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
        let sum = 0;
        for (let i = 0; i < 12; i++) sum += Number(digits[i]) * w1[i];
        let rem = sum % 11;
        const d1 = rem < 2 ? 0 : 11 - rem;
        if (d1 !== Number(digits[12])) return { valid: false, type: null, digits };
        const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
        sum = 0;
        for (let i = 0; i < 13; i++) sum += Number(digits[i]) * w2[i];
        rem = sum % 11;
        const d2 = rem < 2 ? 0 : 11 - rem;
        return {
            valid: d2 === Number(digits[13]),
            type: d2 === Number(digits[13]) ? 'CNPJ' : null,
            digits,
        };
    }
    return { valid: false, type: null, digits };
}

// --- Brand Icons ---

export const PAYMENT_METHOD_ICON_PATHS = {
    card: '/metodos_icones/logo-visa-mc-color-D7b86M9t.png',
    mpesa: '/metodos_icones/logo-mpesa-color-9CM38Rpf.png',
    emola: '/metodos_icones/logo-emola-color-C3UXahgL.png',
} as const;

export const PAYFAST_COMPILED_ICONS = [
    { src: '/metodos_icones/applepay.png', alt: 'Apple Pay' },
    { src: '/metodos_icones/card.PNG', alt: 'Visa & Mastercard' },
    { src: '/metodos_icones/EFT.PNG', alt: 'Instant EFT' },
    { src: '/metodos_icones/Gpay.jpg', alt: 'Google Pay' },
] as const;

export const MpesaIcon = ({ size = 28, className = '' }: { size?: number; className?: string }) => (
    <img
        src={PAYMENT_METHOD_ICON_PATHS.mpesa}
        alt="M-Pesa"
        style={{ width: Math.max(size, 36), height: size }}
        className={`max-w-full max-h-full object-contain select-none ${className}`}
        loading="eager"
        decoding="async"
    />
);

export const EmolaIcon = ({ size = 28, className = '' }: { size?: number; className?: string }) => (
    <img
        src={PAYMENT_METHOD_ICON_PATHS.emola}
        alt="e-Mola"
        style={{ width: Math.max(size, 36), height: size }}
        className={`max-w-full max-h-full object-contain select-none ${className}`}
        loading="eager"
        decoding="async"
    />
);

export const CardBrandsIcon = ({ size = 34, className = '' }: { size?: number; className?: string }) => (
    <img
        src={PAYMENT_METHOD_ICON_PATHS.card}
        alt="Visa / Mastercard"
        style={{ width: Math.max(size, 42), height: Math.round(size * 0.8) }}
        className={`max-w-full max-h-full object-contain select-none ${className}`}
        loading="eager"
        decoding="async"
    />
);

export const BitcoinIcon = ({ size = 24, className = '' }: { size?: number; className?: string }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        aria-hidden="true"
    >
        <circle cx="12" cy="12" r="10.5" fill="#F7931A" />
        <path
            d="M15.48 10.62c.24-1.6-.98-2.46-2.64-3.03l.54-2.16-1.32-.33-.52 2.11c-.35-.09-.7-.17-1.06-.25l.53-2.12-1.32-.33-.54 2.16c-.29-.07-.57-.13-.84-.2l-1.82-.45-.35 1.41s.98.22.96.24c.53.13.63.49.61.77l-.61 2.46c.04.01.08.02.13.04l-.14-.03-.86 3.45c-.07.16-.23.41-.6.31.01.02-.96-.24-.96-.24l-.65 1.51 1.72.43c.32.08.63.16.94.24l-.55 2.19 1.32.33.54-2.16c.36.1.71.19 1.05.27l-.54 2.15 1.32.33.55-2.18c2.25.43 3.94.25 4.65-1.78.57-1.64-.03-2.59-1.21-3.2.86-.2 1.51-.77 1.68-1.94zm-3.01 4.22c-.41 1.64-3.17.75-4.07.53l.73-2.91c.9.22 3.76.67 3.34 2.38zm.41-4.24c-.37 1.49-2.67.73-3.42.55l.66-2.64c.75.19 3.14.54 2.76 2.09z"
            fill="#FFFFFF"
        />
    </svg>
);

export const CryptoMethodIcon = ({ size = 32, className = '' }: { size?: number; className?: string }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 36 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        aria-hidden="true"
    >
        {/* Tether USDT coin behind right */}
        <circle cx="24" cy="17.5" r="9.5" fill="#26A17B" stroke="#FFFFFF" strokeWidth="1.5" />
        <path
            d="M20.2 13.7H27.8V15.4H24.9V17.4C26.7 17.5 28 17.9 28 18.4C28 18.9 26.7 19.3 24.9 19.4V22.4H23.1V19.4C21.3 19.3 20 18.9 20 18.4C20 17.9 21.3 17.5 23.1 17.4V15.4H20.2V13.7ZM24 18.9C25.8 18.9 27.1 18.6 27.1 18.3C27.1 18 25.8 17.8 24 17.8C22.2 17.8 20.9 18 20.9 18.3C20.9 18.6 22.2 18.9 24 18.9Z"
            fill="#FFFFFF"
        />
        {/* Bitcoin front left */}
        <circle cx="12.5" cy="14.5" r="10" fill="#F7931A" stroke="#FFFFFF" strokeWidth="1.6" />
        <path
            d="M15.42 13.38c.2-1.33-.81-2.04-2.19-2.51l.45-1.79-1.09-.27-.44 1.74c-.29-.07-.58-.14-.88-.2l.44-1.76-1.09-.27-.45 1.79c-.24-.06-.47-.11-.7-.17l-1.5-.37-.29 1.17s.81.18.8.2c.44.11.52.4.5.64l-.51 2.04c.03.01.07.02.11.03l-.11-.03-.71 2.86c-.06.13-.19.34-.5.26.01.02-.8-.2-.8-.2l-.54 1.25 1.43.36c.27.07.52.13.78.2l-.45 1.81 1.09.27.45-1.79c.3.08.59.16.87.22l-.45 1.79 1.09.27.46-1.81c1.86.35 3.26.21 3.85-1.48.47-1.36-.02-2.14-1-2.65.71-.17 1.25-.64 1.39-1.61zm-2.49 3.49c-.34 1.36-2.63.62-3.37.44l.6-2.41c.74.18 3.12.55 2.77 1.97zm.34-3.51c-.31 1.24-2.21.61-2.83.46l.55-2.19c.62.15 2.6.44 2.28 1.73z"
            fill="#FFFFFF"
        />
    </svg>
);

export const PixIcon = ({ size = 26, className = '' }: { size?: number; className?: string }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        aria-hidden="true"
    >
        {/* Official 4-petal Banco Central Pix mark */}
        <path
            d="M15.45 8.55L13.1 10.9C12.49 11.51 11.51 11.51 10.9 10.9L8.55 8.55C8.08 8.08 7.45 7.82 6.79 7.82H5.6L9.9 3.52C11.06 2.36 12.94 2.36 14.1 3.52L18.4 7.82H17.21C16.55 7.82 15.92 8.08 15.45 8.55Z"
            fill="#32BCAD"
        />
        <path
            d="M8.55 15.45L10.9 13.1C11.51 12.49 12.49 12.49 13.1 13.1L15.45 15.45C15.92 15.92 16.55 16.18 17.21 16.18H18.4L14.1 20.48C12.94 21.64 11.06 21.64 9.9 20.48L5.6 16.18H6.79C7.45 16.18 8.08 15.92 8.55 15.45Z"
            fill="#32BCAD"
        />
        <path
            d="M3.52 9.9L7.48 5.94V7.21C7.48 7.87 7.74 8.5 8.21 8.97L10.37 11.13C10.85 11.61 10.85 12.39 10.37 12.87L8.21 15.03C7.74 15.5 7.48 16.13 7.48 16.79V18.06L3.52 14.1C2.36 12.94 2.36 11.06 3.52 9.9Z"
            fill="#32BCAD"
        />
        <path
            d="M20.48 14.1L16.52 18.06V16.79C16.52 16.13 16.26 15.5 15.79 15.03L13.63 12.87C13.15 12.39 13.15 11.61 13.63 11.13L15.79 8.97C16.26 8.5 16.52 7.87 16.52 7.21V5.94L20.48 9.9C21.64 11.06 21.64 12.94 20.48 14.1Z"
            fill="#32BCAD"
        />
    </svg>
);

export const PayFastIcon = ({ className = '' }: { size?: number; className?: string }) => (
    <div
        className={`grid grid-cols-2 gap-0.5 w-full h-full items-center justify-items-center ${className}`}
        aria-hidden="true"
    >
        {PAYFAST_COMPILED_ICONS.map((item) => (
            <div
                key={item.src}
                className="w-full h-full rounded-[4px] bg-white border border-slate-200/80 flex items-center justify-center px-0.5 overflow-hidden"
            >
                <img
                    src={item.src}
                    alt={item.alt}
                    className="max-h-[14px] w-full object-contain"
                    loading="eager"
                    decoding="async"
                />
            </div>
        ))}
    </div>
);

const COIN_BADGE_COLORS: Record<string, string> = {
    USDT: '#26A17B',
    USDC: '#2775CA',
    BTC: '#F7931A',
    ETH: '#627EEA',
    BNB: '#F3BA2F',
    SOL: '#9945FF',
    TRX: '#EF0027',
    LTC: '#345D9D',
    TON: '#0098EA',
    XRP: '#23292F',
};

const CoinAvatar = ({ iconUrl, shortName }: { iconUrl?: string | null; shortName: string }) => {
    const [imgFailed, setImgFailed] = useState(false);

    if (iconUrl && !imgFailed) {
        return (
            <img
                src={iconUrl}
                alt={shortName}
                onError={() => setImgFailed(true)}
                className="w-7 h-7 rounded-full object-contain bg-white p-0.5 border border-slate-200 shrink-0"
            />
        );
    }

    const cleanCode = shortName.toUpperCase().split('.')[0];
    const bg = COIN_BADGE_COLORS[cleanCode] || '#F59E0B';
    return (
        <div
            style={{ backgroundColor: bg }}
            className="w-7 h-7 rounded-full text-white flex items-center justify-center text-[9px] font-black shrink-0 shadow-xs"
        >
            {cleanCode.slice(0, 4)}
        </div>
    );
};

// --- Location Flag Dropdown (Synced with Contact Field) ---

const getLocalMethodHint = (code: string, isEn: boolean): string | null => {
    if (code === 'MZ') return 'M-Pesa · e-Mola';
    if (code === 'BR') return 'PIX';
    if (code === 'ZA') return 'PayFast';
    if (code === 'INTL') return isEn ? 'Card · Crypto' : 'Cartão · Cripto';
    return null;
};

export const CheckoutLocationSwitcher = ({
    currentCode,
    onSelectLocation,
    isEn = false,
}: {
    currentCode: string;
    onSelectLocation: (loc: CheckoutLocationOption) => void;
    isEn?: boolean;
}) => {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const rootRef = useRef<HTMLDivElement>(null);

    const activeLoc = useMemo(
        () => resolveLocationOption(currentCode, isEn),
        [currentCode, isEn],
    );

    useEffect(() => {
        if (!open) return;
        const onMouseDown = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', onMouseDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onMouseDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open]);

    const filteredAll = useMemo(() => {
        const list = filterCountries(query).map((c) => resolveLocationOption(c.iso2, isEn));
        const q = query.trim().toLowerCase();
        if (!q || 'global'.includes(q) || 'internacional'.includes(q) || 'intl'.includes(q)) {
            list.push(resolveLocationOption('INTL', isEn));
        }
        return list;
    }, [query, isEn]);

    const priorityCountries = useMemo(() => {
        if (query.trim()) return [];
        const prioritySet = new Set(PRIORITY_CHECKOUT_ISO2);
        return PRIORITY_CHECKOUT_ISO2.filter((code) => prioritySet.has(code)).map((code) =>
            resolveLocationOption(code, isEn),
        );
    }, [query, isEn]);

    const restCountries = useMemo(() => {
        if (query.trim()) return filteredAll;
        const prioritySet = new Set(PRIORITY_CHECKOUT_ISO2);
        return filteredAll.filter((loc) => !prioritySet.has(loc.code));
    }, [filteredAll, query]);

    const handlePick = (loc: CheckoutLocationOption) => {
        onSelectLocation(loc);
        setOpen(false);
        setQuery('');
    };

    const renderRow = (loc: CheckoutLocationOption) => {
        const isSelected = loc.code === activeLoc.code;
        const hint = getLocalMethodHint(loc.code, isEn);
        return (
            <button
                key={loc.code}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => handlePick(loc)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left transition-colors cursor-pointer ${
                    isSelected
                        ? 'bg-indigo-50 text-indigo-800 font-semibold'
                        : 'hover:bg-slate-50 text-slate-700'
                }`}
            >
                {loc.flagUrl ? (
                    <img
                        src={loc.flagUrl}
                        alt={loc.code}
                        className="w-5 h-3.5 rounded-[2px] object-cover shadow-xs shrink-0"
                    />
                ) : (
                    <Globe size={16} className="text-indigo-600 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                    <div className="text-xs sm:text-sm truncate">{loc.label}</div>
                    {hint && (
                        <div className="text-[10px] text-indigo-600 font-semibold truncate">{hint}</div>
                    )}
                </div>
                {loc.dialCode && (
                    <span className="text-[11px] font-mono text-slate-400 shrink-0">{loc.dialCode}</span>
                )}
                {isSelected && <Check size={14} className="text-indigo-600 shrink-0" />}
            </button>
        );
    };

    return (
        <div className="relative" ref={rootRef}>
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-label={
                    isEn
                        ? `Country: ${activeLoc.label}. Change country`
                        : `País: ${activeLoc.label}. Alterar país`
                }
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-slate-200 hover:border-slate-300 shadow-sm text-slate-800 transition-all cursor-pointer"
            >
                {activeLoc.flagUrl ? (
                    <img
                        src={activeLoc.flagUrl}
                        alt={activeLoc.code}
                        className="w-5 h-3.5 rounded-[2px] object-cover shadow-xs shrink-0"
                    />
                ) : (
                    <Globe size={16} className="text-indigo-600 shrink-0" />
                )}
                <span className="text-xs font-bold text-slate-800 max-w-[130px] sm:max-w-[170px] truncate">
                    {activeLoc.label}
                </span>
                {activeLoc.dialCode && (
                    <span className="hidden sm:inline text-[11px] font-mono font-semibold text-slate-500">
                        {activeLoc.dialCode}
                    </span>
                )}
                <ChevronDown
                    size={14}
                    className={`text-slate-400 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`}
                />
            </button>

            {open && (
                <div
                    role="listbox"
                    aria-label={isEn ? 'Select country' : 'Selecionar país'}
                    className="absolute right-0 top-full mt-1.5 w-72 sm:w-80 max-w-[calc(100vw-2rem)] bg-white rounded-2xl shadow-2xl border border-slate-200 z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150"
                >
                    <div className="p-2 border-b border-slate-100 bg-slate-50/70">
                        <div className="relative">
                            <Search
                                size={14}
                                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                            />
                            <input
                                type="text"
                                autoFocus
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder={
                                    isEn ? 'Search country or code...' : 'Pesquisar país ou código...'
                                }
                                className="w-full pl-9 pr-8 py-1.5 text-sm bg-white border border-slate-200 rounded-xl outline-none focus:border-indigo-500 text-slate-900 placeholder:text-slate-400"
                            />
                            {query && (
                                <button
                                    type="button"
                                    onClick={() => setQuery('')}
                                    aria-label={isEn ? 'Clear search' : 'Limpar pesquisa'}
                                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                                >
                                    <X size={13} />
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="max-h-72 overflow-y-auto p-1.5 space-y-1">
                        {priorityCountries.length > 0 && (
                            <>
                                <div className="px-2.5 pt-1 pb-0.5 text-[10px] font-black uppercase tracking-wider text-slate-400">
                                    {isEn ? 'Popular regions' : 'Regiões principais'}
                                </div>
                                {priorityCountries.map(renderRow)}
                                <div className="my-1 border-t border-slate-100" />
                                <div className="px-2.5 pt-0.5 pb-0.5 text-[10px] font-black uppercase tracking-wider text-slate-400">
                                    {isEn ? 'All countries' : 'Todos os países'}
                                </div>
                            </>
                        )}

                        {restCountries.length === 0 && priorityCountries.length === 0 ? (
                            <div className="p-4 text-center text-xs text-slate-500">
                                {isEn ? 'No country found' : 'Nenhum país encontrado'}
                            </div>
                        ) : (
                            restCountries.map(renderRow)
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

// --- Plan Summary (Always strictly in USD) ---

export const PlanSummary = ({
    plan,
    billingCycle,
    total,
    baseTotal,
    appliedCredit = 0,
    isEn = false,
}: {
    plan: any;
    billingCycle: string;
    total: number;
    baseTotal?: number;
    appliedCredit?: number;
    isEn?: boolean;
}) => {
    const [showMobileFeatures, setShowMobileFeatures] = useState(false);

    const months =
        billingCycle === 'BIENNIAL'
            ? 24
            : billingCycle === 'YEARLY'
              ? 12
              : billingCycle === 'QUARTERLY'
                ? 3
                : 1;
    const discountPercent =
        billingCycle === 'BIENNIAL'
            ? Number(plan.biennialDiscountPercent ?? 29)
            : billingCycle === 'YEARLY'
              ? Number(plan.annualDiscountPercent ?? 25)
              : billingCycle === 'QUARTERLY'
                ? Number(plan.quarterlyDiscountPercent ?? 5)
                : Number(plan.monthlyDiscountPercent ?? 20);
    const subtotal = Number((Number(plan.monthlyPrice || 0) * months).toFixed(2));
    const effectiveBaseTotal = typeof baseTotal === 'number' ? baseTotal : total;
    const discount = Math.max(0, Number((subtotal - effectiveBaseTotal).toFixed(2)));
    const cycleLabel = isEn
        ? billingCycle === 'BIENNIAL'
            ? 'Biennial (24m)'
            : billingCycle === 'YEARLY'
              ? 'Annual Billing'
              : billingCycle === 'QUARTERLY'
                ? 'Quarterly (3m)'
                : 'Monthly · Black Friday'
        : billingCycle === 'BIENNIAL'
          ? 'Cobrança Bianual (24 meses)'
          : billingCycle === 'YEARLY'
            ? 'Cobrança Anual'
            : billingCycle === 'QUARTERLY'
              ? 'Cobrança Trimestral (3 meses)'
              : 'Mensal · Black Friday';
    const discountTitle =
        billingCycle === 'MONTHLY'
            ? `Black Friday (-${discountPercent}%)`
            : billingCycle === 'QUARTERLY'
              ? isEn
                  ? `Quarterly Discount (-${discountPercent}%)`
                  : `Desconto Trimestral (-${discountPercent}%)`
              : billingCycle === 'BIENNIAL'
                ? isEn
                    ? `Biennial Discount (-${discountPercent}%)`
                    : `Desconto Bianual (-${discountPercent}%)`
                : isEn
                  ? `Annual Discount (-${discountPercent}%)`
                  : `Desconto Anual (-${discountPercent}%)`;

    const hasFeatures = Array.isArray(plan.features) && plan.features.length > 0;

    return (
        <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="space-y-3.5 sm:space-y-4 bg-slate-50/70 lg:bg-transparent border border-slate-200/90 lg:border-0 rounded-2xl p-4 lg:p-0"
        >
            <div className="flex flex-col pb-3 sm:pb-4 border-b border-slate-200">
                <span className="text-indigo-600 text-[11px] font-bold uppercase tracking-wider mb-0.5 block">
                    {isEn ? 'Selected Plan' : 'Plano Selecionado'}
                </span>
                <div className="flex justify-between items-baseline gap-2">
                    <h3 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">{plan.tier}</h3>
                    <div className="text-right">
                        <span className="text-[10px] text-slate-500 uppercase tracking-widest block font-bold">
                            {cycleLabel}
                        </span>
                    </div>
                </div>
            </div>

            {/* Price Breakdown (Strictly USD) */}
            <div className="space-y-2 py-0.5 text-sm">
                <div className="flex justify-between text-slate-600">
                    <span>{isEn ? 'Base Price' : 'Preço Base'}</span>
                    <span className="font-mono text-slate-800 font-semibold">
                        $ {subtotal.toFixed(2)} USD
                    </span>
                </div>
                {discount > 0 && discountPercent > 0 && (
                    <div className="flex justify-between text-emerald-700 font-semibold bg-emerald-50 px-2.5 py-2 rounded-xl border border-emerald-200 text-xs sm:text-sm">
                        <span>{discountTitle}</span>
                        <span className="font-mono">- $ {discount.toFixed(2)} USD</span>
                    </div>
                )}
                {appliedCredit > 0 && (
                    <div className="flex justify-between text-indigo-700 font-semibold bg-indigo-50 px-2.5 py-2 rounded-xl border border-indigo-200 text-xs sm:text-sm">
                        <span>{isEn ? 'Affiliate Credits' : 'Créditos de Afiliado'}</span>
                        <span className="font-mono">- $ {appliedCredit.toFixed(2)} USD</span>
                    </div>
                )}
                <div className="flex justify-between items-baseline pt-2.5 border-t border-slate-200 text-slate-900">
                    <span className="font-bold">{isEn ? 'Total Due' : 'Total a Pagar'}</span>
                    <div className="text-right">
                        <span className="text-xl sm:text-2xl font-black font-mono text-slate-900">
                            $ {total.toFixed(2)} USD
                        </span>
                    </div>
                </div>
            </div>

            {hasFeatures && (
                <div className="bg-white lg:bg-slate-50/80 border border-slate-200 rounded-2xl p-3.5 sm:p-5 shadow-xs">
                    <button
                        type="button"
                        onClick={() => setShowMobileFeatures((v) => !v)}
                        className="w-full flex items-center justify-between gap-2 lg:pointer-events-none cursor-pointer lg:cursor-default"
                    >
                        <h4 className="text-[11px] sm:text-xs font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 animate-pulse" />
                            <span>
                                {isEn
                                    ? `Included Capabilities (${plan.features.length})`
                                    : `Benefícios Inclusos (${plan.features.length})`}
                            </span>
                        </h4>
                        <ChevronDown
                            size={15}
                            className={`text-slate-500 lg:hidden transition-transform ${showMobileFeatures ? 'rotate-180' : ''}`}
                        />
                    </button>
                    <ul className={`${showMobileFeatures ? 'block' : 'hidden'} lg:block space-y-2 mt-3`}>
                        {plan.features.map((feat: string, i: number) => (
                            <li
                                key={i}
                                className="flex items-start gap-2.5 text-xs sm:text-sm text-slate-600"
                            >
                                <Check size={15} className="text-emerald-600 mt-0.5 flex-shrink-0" />
                                <span>{feat}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <div className="hidden lg:flex items-center gap-3 p-3.5 bg-indigo-50/70 border border-indigo-200/80 rounded-2xl text-xs text-indigo-800">
                <ShieldCheck size={18} className="flex-shrink-0 text-indigo-600" />
                <p>
                    {isEn
                        ? 'Your transaction is secured with end-to-end encryption.'
                        : 'Sua transação é protegida por criptografia de ponta a ponta.'}
                </p>
            </div>
        </motion.div>
    );
};

// --- Payment Method Badge ---

export const PaymentMethodBadge = ({
    id,
    label,
    mobileLabel,
    icon: Icon,
    img,
    active,
    onClick,
    hasActiveBadge = false,
    className = '',
}: {
    id: CheckoutMethodId;
    label: string;
    mobileLabel?: string;
    icon?: any;
    img?: string;
    active: boolean;
    onClick: () => void;
    hasActiveBadge?: boolean;
    className?: string;
}) => {
    const subTag =
        id === 'card'
            ? 'Visa · MC'
            : id === 'crypto'
              ? 'BTC · USDT'
              : id === 'pix'
                ? 'Instantâneo'
                : id === 'payfast'
                  ? 'EFT · Card'
                  : 'Mobile Money';

    const activeCardClass =
        id === 'pix'
            ? 'border-2 border-teal-600 bg-teal-50/70 shadow-[0_6px_20px_-4px_rgba(13,148,136,0.2)] text-teal-950'
            : id === 'payfast'
              ? 'border-2 border-rose-600 bg-rose-50/70 shadow-[0_6px_20px_-4px_rgba(225,29,72,0.18)] text-rose-950'
              : id === 'mpesa'
                ? 'border-2 border-red-600 bg-red-50/60 shadow-[0_6px_20px_-4px_rgba(220,38,38,0.18)] text-slate-900'
                : id === 'emola'
                  ? 'border-2 border-orange-500 bg-orange-50/70 shadow-[0_6px_20px_-4px_rgba(234,88,12,0.18)] text-slate-900'
                  : id === 'crypto'
                    ? 'border-2 border-amber-500 bg-amber-50/70 shadow-[0_6px_20px_-4px_rgba(245,158,11,0.18)] text-slate-900'
                    : 'border-2 border-indigo-600 bg-indigo-50/70 shadow-[0_6px_20px_-4px_rgba(79,70,229,0.2)] text-indigo-950';

    const activeLabelClass =
        id === 'pix'
            ? 'text-teal-800'
            : id === 'payfast'
              ? 'text-rose-800'
              : id === 'mpesa'
                ? 'text-red-700'
                : id === 'emola'
                  ? 'text-orange-700'
                  : id === 'crypto'
                    ? 'text-amber-800'
                    : 'text-indigo-800';

    const activeDotClass =
        id === 'pix'
            ? 'bg-teal-600'
            : id === 'payfast'
              ? 'bg-rose-600'
              : id === 'mpesa'
                ? 'bg-red-600'
                : id === 'emola'
                  ? 'bg-orange-500'
                  : id === 'crypto'
                    ? 'bg-amber-500'
                    : 'bg-indigo-600';

    return (
        <motion.button
            type="button"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onClick}
            className={`relative group px-2 py-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl transition-all duration-200 flex flex-col items-center justify-center gap-1.5 sm:gap-2 overflow-hidden cursor-pointer min-h-[88px] sm:min-h-[104px] ${
                active
                    ? activeCardClass
                    : 'border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 shadow-sm'
            } ${className}`}
        >
            <div
                className={`flex items-center justify-center rounded-lg sm:rounded-xl transition-all duration-200 shrink-0 ${
                    id === 'payfast'
                        ? 'w-14 h-9 sm:w-[76px] sm:h-11 p-0.5 sm:p-1 bg-white border'
                        : id === 'card' || id === 'mpesa' || id === 'emola'
                          ? 'w-11 h-9 sm:w-14 sm:h-11 p-1 sm:p-1.5 bg-white border'
                          : 'w-10 h-9 sm:w-12 sm:h-11 border'
                } ${
                    active
                        ? 'border-slate-300 shadow-sm'
                        : id === 'payfast' || id === 'card' || id === 'mpesa' || id === 'emola'
                          ? 'border-slate-200/90 group-hover:border-slate-300'
                          : 'bg-slate-50 border-slate-200/80 group-hover:bg-white'
                }`}
            >
                {img ? (
                    <img src={img} alt={label} className="w-full h-full object-contain p-0.5 sm:p-1 rounded-lg sm:rounded-xl" />
                ) : Icon ? (
                    <Icon size={id === 'card' ? 32 : id === 'crypto' ? 28 : 24} />
                ) : null}
            </div>

            <div className="text-center w-full min-w-0">
                <span
                    className={`text-[10px] sm:text-[11px] font-black uppercase tracking-tight sm:tracking-wider block truncate leading-tight ${
                        active ? activeLabelClass : 'text-slate-700'
                    }`}
                >
                    {mobileLabel ? (
                        <>
                            <span className="sm:hidden">{mobileLabel}</span>
                            <span className="hidden sm:inline">{label}</span>
                        </>
                    ) : (
                        label
                    )}
                </span>
                <span className="text-[8px] sm:text-[9px] font-bold text-slate-500 px-1.5 sm:px-2 py-0.5 bg-slate-100 border border-slate-200/80 rounded-full mt-0.5 sm:mt-1 inline-block whitespace-nowrap">
                    {subTag}
                </span>
            </div>

            {hasActiveBadge ? (
                <div className="absolute top-1.5 right-1.5 sm:top-2.5 sm:right-2.5">
                    <span className="flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
                    </span>
                </div>
            ) : (
                active && (
                    <div className="absolute top-1.5 right-1.5 sm:top-2.5 sm:right-2.5">
                        <div className={`w-2 h-2 rounded-full ${activeDotClass}`} />
                    </div>
                )
            )}
        </motion.button>
    );
};

// --- 1. M-Pesa / e-Mola Form (Synced country flag + phone contact input) ---

export const MobileMoneyForm = ({
    method,
    phoneNumber,
    setPhoneNumber,
    selectedIso2 = 'MZ',
    onCountryChange,
    onSubmit,
    processing,
    savePreference,
    setSavePreference,
    payableTotalUSD,
    errorMessage,
    isEn = false,
}: {
    method: 'mpesa' | 'emola';
    phoneNumber: string;
    setPhoneNumber: (v: string) => void;
    selectedIso2?: string;
    onCountryChange?: (iso2: string) => void;
    onSubmit: () => void;
    processing: boolean;
    savePreference: boolean;
    setSavePreference: (v: boolean) => void;
    payableTotalUSD: number;
    errorMessage?: string | null;
    isEn?: boolean;
}) => {
    const isInvalid =
        phoneNumber.length === 9 &&
        ((method === 'mpesa' && !['84', '85'].includes(phoneNumber.substring(0, 2))) ||
            (method === 'emola' && !['86', '87'].includes(phoneNumber.substring(0, 2))));

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4 pt-1"
        >
            {errorMessage && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 flex items-start gap-2.5 text-xs text-rose-700">
                    <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                    <span>{errorMessage}</span>
                </div>
            )}

            <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block">
                    {isEn ? 'Phone Number' : 'Contacto Telefónico'}
                </label>

                <CountryPhoneInput
                    hideLabel
                    value={phoneNumber}
                    onNationalChange={setPhoneNumber}
                    onChange={() => {}}
                    selectedIso2={selectedIso2}
                    onCountryChange={(c) => onCountryChange?.(c.iso2)}
                    maxLength={9}
                    disabled={processing}
                    placeholder={method === 'mpesa' ? '84 / 85 XXX XXXX' : '86 / 87 XXX XXXX'}
                    error={
                        isInvalid
                            ? isEn
                                ? `Invalid ${method.toUpperCase()} number.`
                                : `Número ${method.toUpperCase()} inválido.`
                            : undefined
                    }
                    focusClassName="focus-within:border-indigo-500 focus-within:ring-4 focus-within:ring-indigo-500/10"
                />
            </div>

            <div className="flex items-center gap-3 px-1">
                <button
                    type="button"
                    onClick={() => setSavePreference(!savePreference)}
                    className="flex items-center gap-2 group cursor-pointer"
                    disabled={processing}
                >
                    <div
                        className={`w-4.5 h-4.5 rounded-md border flex items-center justify-center transition-all ${
                            savePreference
                                ? 'bg-indigo-600 border-indigo-600'
                                : 'border-slate-300 bg-white'
                        }`}
                    >
                        {savePreference && <Check size={10} className="text-white" />}
                    </div>
                    <span className="text-xs text-slate-600 font-medium">
                        {isEn ? 'Save number for next time' : 'Salvar contacto para próximos pagamentos'}
                    </span>
                </button>
            </div>

            <motion.button
                type="button"
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                onClick={onSubmit}
                disabled={processing || phoneNumber.length !== 9 || isInvalid}
                className="group relative w-full min-h-[52px] h-[52px] px-6 bg-gradient-to-r from-indigo-600 via-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white rounded-2xl font-black text-sm uppercase tracking-wider transition-all duration-200 disabled:opacity-55 disabled:hover:translate-y-0 disabled:shadow-none shadow-[0_14px_30px_-6px_rgba(79,70,229,0.55)] ring-2 ring-indigo-500/20 hover:-translate-y-0.5 overflow-hidden cursor-pointer flex items-center justify-center"
            >
                <span className="relative z-10 flex items-center justify-center gap-2.5">
                    {processing ? (
                        <>
                            <Loader2 className="animate-spin" size={18} />
                            <span>{isEn ? 'Processing...' : 'Processando...'}</span>
                        </>
                    ) : (
                        <>
                            <Lock size={16} className="opacity-90" />
                            <span>
                                {isEn
                                    ? `Pay $${payableTotalUSD.toFixed(2)} USD`
                                    : `Pagar $${payableTotalUSD.toFixed(2)} USD`}
                            </span>
                            <ArrowRight size={17} className="transition-transform group-hover:translate-x-0.5" />
                        </>
                    )}
                </span>
            </motion.button>
        </motion.div>
    );
};

// --- 2. Visa / Mastercard Form (Synced country flag dropdown + contact field + redirect notice) ---

export const CardPaymentView = ({
    onSubmit,
    processing,
    onPhoneChange,
    nationalPhone,
    onNationalPhoneChange,
    selectedIso2,
    onCountryChange,
    payableTotalUSD,
    errorMessage,
    isEn = false,
}: {
    onSubmit: () => void;
    processing: boolean;
    onPhoneChange: (v: string) => void;
    nationalPhone?: string;
    onNationalPhoneChange?: (digits: string) => void;
    selectedIso2?: string | null;
    onCountryChange?: (iso2: string) => void;
    payableTotalUSD: number;
    errorMessage?: string | null;
    isEn?: boolean;
}) => (
    <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-4 pt-1"
    >
        {errorMessage && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 flex items-start gap-2.5 text-xs text-rose-700">
                <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                <span>{errorMessage}</span>
            </div>
        )}

        <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block">
                {isEn ? 'Contact Number' : 'Contacto Telefónico'}
            </label>
            <CountryPhoneInput
                hideLabel
                value={nationalPhone}
                onNationalChange={onNationalPhoneChange}
                onChange={onPhoneChange}
                selectedIso2={selectedIso2}
                onCountryChange={(c) => onCountryChange?.(c.iso2)}
                disabled={processing}
                placeholder={isEn ? 'Phone number' : 'Número de contacto'}
                focusClassName="focus-within:border-indigo-500 focus-within:ring-4 focus-within:ring-indigo-500/10"
            />
        </div>

        <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-2xl bg-slate-50 border border-slate-200 text-xs text-slate-600">
            <ExternalLink size={15} className="text-indigo-600 shrink-0 mt-0.5" />
            <span>
                {isEn
                    ? 'You will be redirected to a secure payment page to complete your transaction.'
                    : 'Você será redirecionado para uma página de pagamento seguro para concluir a transação.'}
            </span>
        </div>

        <motion.button
            type="button"
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            onClick={onSubmit}
            disabled={processing}
            className="group relative w-full min-h-[52px] h-[52px] px-6 bg-gradient-to-r from-indigo-600 via-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white rounded-2xl font-black text-sm uppercase tracking-wider transition-all duration-200 disabled:opacity-55 disabled:hover:translate-y-0 disabled:shadow-none shadow-[0_14px_30px_-6px_rgba(79,70,229,0.55)] ring-2 ring-indigo-500/20 hover:-translate-y-0.5 overflow-hidden cursor-pointer flex items-center justify-center"
        >
            <span className="relative z-10 flex items-center justify-center gap-2.5">
                {processing ? <Loader2 className="animate-spin" size={18} /> : <CreditCard size={18} />}
                <span>
                    {processing
                        ? isEn
                            ? 'Redirecting...'
                            : 'Redirecionando...'
                        : isEn
                          ? `Pay $${payableTotalUSD.toFixed(2)} USD`
                          : `Pagar $${payableTotalUSD.toFixed(2)} USD`}
                </span>
                {!processing && (
                    <ArrowRight size={17} className="transition-transform group-hover:translate-x-0.5" />
                )}
            </span>
        </motion.button>
    </motion.div>
);

// --- 3. PayFast Form (ZA — synced country flag dropdown + compact contact field + redirect notice) ---

export const PayFastPaymentView = ({
    phoneNumber,
    setPhoneNumber,
    selectedIso2 = 'ZA',
    onCountryChange,
    onSubmit,
    processing,
    payableTotalUSD,
    errorMessage,
    isEn = true,
}: {
    phoneNumber: string;
    setPhoneNumber: (v: string) => void;
    selectedIso2?: string;
    onCountryChange?: (iso2: string) => void;
    onSubmit: () => void;
    processing: boolean;
    payableTotalUSD: number;
    errorMessage?: string | null;
    isEn?: boolean;
}) => (
    <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-4 pt-1"
    >
        {errorMessage && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 flex items-start gap-2.5 text-xs text-rose-700">
                <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                <span>{errorMessage}</span>
            </div>
        )}

        <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block">
                {isEn ? 'Contact Number' : 'Contacto Telefónico'}
            </label>
            <CountryPhoneInput
                hideLabel
                value={phoneNumber}
                onNationalChange={setPhoneNumber}
                onChange={() => {}}
                selectedIso2={selectedIso2}
                onCountryChange={(c) => onCountryChange?.(c.iso2)}
                maxLength={10}
                disabled={processing}
                placeholder="82 123 4567"
                focusClassName="focus-within:border-rose-500 focus-within:ring-4 focus-within:ring-rose-500/10"
            />
        </div>

        <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3 space-y-2">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block">
                {isEn ? 'Accepted via PayFast' : 'Métodos disponíveis no PayFast'}
            </span>
            <div className="grid grid-cols-4 gap-2">
                {PAYFAST_COMPILED_ICONS.map((item) => (
                    <div
                        key={item.src}
                        className="h-9 rounded-xl bg-white border border-slate-200 px-2 py-1 flex items-center justify-center shadow-sm"
                    >
                        <img
                            src={item.src}
                            alt={item.alt}
                            className="max-h-full max-w-full object-contain"
                        />
                    </div>
                ))}
            </div>
        </div>

        <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-2xl bg-slate-50 border border-slate-200 text-xs text-slate-600">
            <ExternalLink size={15} className="text-rose-600 shrink-0 mt-0.5" />
            <span>
                {isEn
                    ? 'You will be redirected to a secure payment page to complete your transaction.'
                    : 'Você será redirecionado para uma página de pagamento seguro para concluir a transação.'}
            </span>
        </div>

        <motion.button
            type="button"
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            onClick={onSubmit}
            disabled={processing}
            className="group relative w-full min-h-[52px] h-[52px] px-6 bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white rounded-2xl font-black text-sm uppercase tracking-wider transition-all duration-200 disabled:opacity-55 disabled:hover:translate-y-0 disabled:shadow-none shadow-[0_14px_30px_-6px_rgba(225,29,72,0.48)] ring-2 ring-rose-500/20 hover:-translate-y-0.5 overflow-hidden cursor-pointer flex items-center justify-center"
        >
            <span className="relative z-10 flex items-center justify-center gap-2.5">
                {processing ? (
                    <Loader2 className="animate-spin" size={18} />
                ) : (
                    <ExternalLink size={17} />
                )}
                <span>
                    {processing
                        ? isEn
                            ? 'Redirecting...'
                            : 'Redirecionando...'
                        : isEn
                          ? `Pay $${payableTotalUSD.toFixed(2)} USD`
                          : `Pagar $${payableTotalUSD.toFixed(2)} USD`}
                </span>
                {!processing && (
                    <ArrowRight size={17} className="transition-transform group-hover:translate-x-0.5" />
                )}
            </span>
        </motion.button>
    </motion.div>
);

// --- 4. PIX Form (BR ONLY — ONLY CPF/CNPJ field, zero FX/rules display, USD total) ---

export const PixPaymentView = ({
    payerDocument,
    setPayerDocument,
    activePixPayment,
    payableTotalUSD,
    processing,
    checkingStatus,
    cancelling,
    errorMessage,
    onGeneratePix,
    onCheckStatus,
    onResetPix,
    isEn = false,
}: {
    payerDocument: string;
    setPayerDocument: (v: string) => void;
    activePixPayment: ActivePixPayment | null;
    payableTotalUSD: number;
    processing: boolean;
    checkingStatus: boolean;
    cancelling: boolean;
    errorMessage: string | null;
    onGeneratePix: (forceNew?: boolean) => void;
    onCheckStatus: () => void;
    onResetPix: () => void;
    isEn?: boolean;
}) => {
    const [copiedCode, setCopiedCode] = useState(false);
    const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

    const docValidation = validateCpfCnpjClient(payerDocument);
    const hasCompleteDigits =
        docValidation.digits.length === 11 || docValidation.digits.length === 14;
    const isDocInvalid = hasCompleteDigits && !docValidation.valid;

    useEffect(() => {
        if (!activePixPayment?.expiresAt) {
            setSecondsLeft(null);
            return;
        }
        const computeRemaining = () => {
            const target = new Date(activePixPayment.expiresAt!).getTime();
            if (!Number.isFinite(target)) return null;
            return Math.max(0, Math.floor((target - Date.now()) / 1000));
        };
        setSecondsLeft(computeRemaining());
        const timer = window.setInterval(() => {
            setSecondsLeft(computeRemaining());
        }, 1000);
        return () => window.clearInterval(timer);
    }, [activePixPayment?.expiresAt]);

    const formatCountdown = (totalSeconds: number) => {
        const mins = Math.floor(totalSeconds / 60);
        const secs = totalSeconds % 60;
        return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    };

    const copyEmvCode = async (code: string) => {
        try {
            await navigator.clipboard.writeText(code);
        } catch {
            const el = document.createElement('textarea');
            el.value = code;
            el.style.position = 'fixed';
            el.style.opacity = '0';
            document.body.appendChild(el);
            el.select();
            document.execCommand('copy');
            document.body.removeChild(el);
        }
        setCopiedCode(true);
        window.setTimeout(() => setCopiedCode(false), 2500);
    };

    // State 2: Active Persisted PIX QR Code + Copia e Cola
    if (activePixPayment) {
        const st = (activePixPayment.providerStatus || 'pending').toLowerCase();
        const isExpired =
            st === 'expired' ||
            st === 'failed' ||
            st === 'cancelled' ||
            st === 'canceled' ||
            (secondsLeft === 0 && ['pending', 'waiting', 'created'].includes(st));

        return (
            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-4 pt-2"
            >
                {errorMessage && (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 flex items-start gap-2.5 text-xs text-rose-700">
                        <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                        <span>{errorMessage}</span>
                    </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 p-3.5 rounded-2xl bg-slate-50 border border-teal-200">
                    <div className="flex items-center gap-2.5">
                        <PixIcon size={20} />
                        <span className="text-xs font-black text-slate-900 uppercase tracking-wider">
                            PIX · ${Number(activePixPayment.amountUsd).toFixed(2)} USD
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-bold ${
                                isExpired
                                    ? 'bg-rose-50 text-rose-700 border-rose-200'
                                    : 'bg-teal-50 text-teal-800 border-teal-200'
                            }`}
                        >
                            <span
                                className={`w-1.5 h-1.5 rounded-full ${
                                    isExpired ? 'bg-rose-500' : 'bg-teal-500 animate-pulse'
                                }`}
                            />
                            {isExpired
                                ? isEn
                                    ? 'Expired'
                                    : 'Expirado'
                                : isEn
                                  ? 'Awaiting Payment'
                                  : 'Aguardando Pagamento'}
                        </span>
                        {secondsLeft !== null && !isExpired && (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white border border-slate-200 text-[11px] font-mono font-bold text-slate-800 tabular-nums">
                                <Clock size={12} className="text-teal-600" />
                                {formatCountdown(secondsLeft)}
                            </span>
                        )}
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-5 p-4 rounded-3xl bg-slate-50 border border-slate-200">
                    <div className="md:col-span-5 flex flex-col items-center justify-center text-center space-y-2.5">
                        <div className="p-3 bg-white rounded-2xl border border-slate-200 shadow-md">
                            <img
                                src={activePixPayment.qrCodeDataUrl}
                                alt="QR Code PIX"
                                className="w-40 h-40 sm:w-44 sm:h-44 object-contain block"
                            />
                        </div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                            <QrCode size={12} className="text-teal-600" />
                            {isEn ? 'Scan QR Code' : 'Escaneie o QR Code'}
                        </span>
                    </div>

                    <div className="md:col-span-7 flex flex-col justify-center space-y-3">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block">
                            PIX Copia e Cola
                        </label>
                        <div className="p-3 rounded-xl bg-white border border-slate-200 space-y-2.5">
                            <div className="font-mono text-[11px] text-slate-800 break-all line-clamp-3 select-all leading-relaxed">
                                {activePixPayment.emvCode}
                            </div>
                            <button
                                type="button"
                                onClick={() => void copyEmvCode(activePixPayment.emvCode)}
                                className={`w-full h-10 rounded-xl font-bold text-xs uppercase tracking-wider inline-flex items-center justify-center gap-2 transition-all cursor-pointer ${
                                    copiedCode
                                        ? 'bg-emerald-600 text-white'
                                        : 'bg-teal-600 hover:bg-teal-500 text-white'
                                }`}
                            >
                                {copiedCode ? <Check size={15} /> : <Copy size={15} />}
                                <span>
                                    {copiedCode
                                        ? isEn
                                            ? 'Copied!'
                                            : 'Código Copiado!'
                                        : isEn
                                          ? 'Copy PIX Code'
                                          : 'Copiar Código PIX'}
                                </span>
                            </button>
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono">
                            Ref: {activePixPayment.reference}
                        </div>
                    </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-3">
                    {isExpired ? (
                        <button
                            type="button"
                            onClick={() => onGeneratePix(true)}
                            disabled={processing}
                            className="flex-1 h-12 rounded-2xl bg-teal-600 hover:bg-teal-500 text-white font-black text-xs uppercase tracking-widest inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-50 shadow-md cursor-pointer"
                        >
                            {processing ? (
                                <Loader2 size={15} className="animate-spin" />
                            ) : (
                                <RefreshCw size={15} />
                            )}
                            <span>{isEn ? 'Generate New QR Code' : 'Gerar Novo QR Code'}</span>
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={onCheckStatus}
                            disabled={checkingStatus}
                            className="flex-1 h-12 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs uppercase tracking-widest inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-50 shadow-md cursor-pointer"
                        >
                            {checkingStatus ? (
                                <Loader2 size={15} className="animate-spin" />
                            ) : (
                                <RefreshCw size={15} />
                            )}
                            <span>
                                {checkingStatus
                                    ? isEn
                                        ? 'Checking...'
                                        : 'Verificando...'
                                    : isEn
                                      ? 'I Paid · Verify'
                                      : 'Já Paguei · Verificar'}
                            </span>
                        </button>
                    )}

                    <button
                        type="button"
                        onClick={onResetPix}
                        disabled={cancelling || processing}
                        className="sm:w-auto px-5 h-12 rounded-2xl bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-800 font-bold text-xs uppercase tracking-wider inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-50 cursor-pointer"
                    >
                        {cancelling ? (
                            <Loader2 size={14} className="animate-spin" />
                        ) : (
                            <ArrowLeftRight size={14} />
                        )}
                        <span>{isEn ? 'Change CPF/CNPJ' : 'Alterar CPF/CNPJ'}</span>
                    </button>
                </div>
            </motion.div>
        );
    }

    // State 1: Minimal CPF / CNPJ Input ONLY (no extra name/email, no FX breakdown)
    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-5 pt-2"
        >
            {errorMessage && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 flex items-start gap-2.5 text-xs text-rose-700">
                    <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                    <span>{errorMessage}</span>
                </div>
            )}

            <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                    <label
                        htmlFor="pix-payer-document"
                        className="text-[10px] font-black text-slate-500 uppercase tracking-widest"
                    >
                        CPF / CNPJ <span className="text-rose-500">*</span>
                    </label>
                    {docValidation.valid && docValidation.type && (
                        <span className="text-[10px] font-bold text-emerald-700 inline-flex items-center gap-1">
                            <CheckCircle2 size={11} />
                            {docValidation.type} {isEn ? 'valid' : 'válido'}
                        </span>
                    )}
                </div>
                <input
                    id="pix-payer-document"
                    type="text"
                    inputMode="numeric"
                    value={payerDocument}
                    onChange={(e) => setPayerDocument(formatCpfCnpj(e.target.value))}
                    placeholder="000.000.000-00 ou 00.000.000/0001-00"
                    maxLength={18}
                    disabled={processing}
                    className={`w-full bg-white border rounded-2xl px-4 py-3.5 text-base font-mono font-bold text-slate-900 placeholder:text-slate-400 outline-none transition-all focus:ring-4 ${
                        isDocInvalid
                            ? 'border-rose-400 focus:ring-rose-500/10'
                            : docValidation.valid
                              ? 'border-emerald-500 focus:ring-emerald-500/10'
                              : 'border-slate-200 focus:border-teal-500 focus:ring-teal-500/10'
                    }`}
                />
                {isDocInvalid && (
                    <p className="text-[11px] text-rose-600 flex items-center gap-1 px-1">
                        <Info size={12} />
                        {isEn ? 'Invalid CPF or CNPJ.' : 'CPF ou CNPJ inválido.'}
                    </p>
                )}
            </div>

            <motion.button
                type="button"
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                onClick={() => onGeneratePix(false)}
                disabled={processing || !docValidation.valid}
                className="group relative w-full min-h-[56px] h-14 px-6 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white rounded-2xl font-black text-sm uppercase tracking-wider transition-all duration-200 disabled:opacity-55 disabled:hover:translate-y-0 disabled:shadow-none shadow-[0_14px_30px_-6px_rgba(13,148,136,0.48)] ring-2 ring-teal-500/20 hover:-translate-y-0.5 overflow-hidden cursor-pointer flex items-center justify-center"
            >
                <span className="relative z-10 flex items-center justify-center gap-2.5">
                    {processing ? (
                        <>
                            <Loader2 className="animate-spin" size={18} />
                            <span>{isEn ? 'Generating QR Code...' : 'Gerando QR Code...'}</span>
                        </>
                    ) : (
                        <>
                            <QrCode size={18} />
                            <span>
                                {isEn
                                    ? `Pay $${payableTotalUSD.toFixed(2)} USD with PIX`
                                    : `Pagar $${payableTotalUSD.toFixed(2)} USD com PIX`}
                            </span>
                            <ChevronRight size={17} className="transition-transform group-hover:translate-x-0.5" />
                        </>
                    )}
                </span>
            </motion.button>
        </motion.div>
    );
};

// --- 5. Cryptocurrency Form (Universal Bitcoin option -> expands sub-coins -> persisted Wallet + QR) ---

/**
 * Filters available cryptocurrencies by symbol, name, network, or currency code,
 * normalizing separators so queries like "usdt trc20" match "USDT.TRC20".
 */
export function filterCryptoCurrencies(
    coins: CryptoCurrencyOption[],
    rawQuery: string,
): CryptoCurrencyOption[] {
    const q = String(rawQuery || '').trim().toLowerCase();
    if (!q) return coins;
    const tokens = q.split(/[\s._/-]+/).filter(Boolean);
    return coins.filter((coin) => {
        const haystack = [
            coin.symbol,
            coin.shortName,
            coin.displayName,
            coin.network,
            coin.payCurrency,
        ]
            .join(' ')
            .toLowerCase();
        const compact = haystack.replace(/[.\-_/()]+/g, ' ');
        return tokens.every((tok) => compact.includes(tok) || haystack.includes(tok));
    });
}

export const CryptoPaymentView = ({
    currencies,
    selectedCrypto,
    setSelectedCrypto,
    activePayment,
    payableTotalUSD,
    processing,
    checkingStatus,
    cancelling,
    errorMessage,
    autoCopiedBanner,
    onGenerateWallet,
    onCheckStatus,
    onChangeCoin,
    isEn = false,
}: {
    currencies: CryptoCurrencyOption[];
    selectedCrypto: string;
    setSelectedCrypto: (symbol: string) => void;
    activePayment: ActiveCryptoPayment | null;
    payableTotalUSD: number;
    processing: boolean;
    checkingStatus: boolean;
    cancelling: boolean;
    errorMessage: string | null;
    autoCopiedBanner?: boolean;
    onGenerateWallet: (forceNew?: boolean) => void;
    onCheckStatus: () => void;
    onChangeCoin: () => void;
    isEn?: boolean;
}) => {
    const [copiedField, setCopiedField] = useState<'wallet' | 'amount' | 'extra' | 'paymentId' | null>(null);
    const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
    const [coinSearchQuery, setCoinSearchQuery] = useState<string>('');

    const availableCoins = currencies.length > 0 ? currencies : DEFAULT_CRYPTO_CURRENCIES;
    const filteredCoins = filterCryptoCurrencies(availableCoins, coinSearchQuery);
    const trimmedSearch = coinSearchQuery.trim();
    const visibleCoins = trimmedSearch ? filteredCoins.slice(0, 60) : availableCoins.slice(0, 18);
    const selectedCoinInfo =
        availableCoins.find((c) => c.symbol.toUpperCase() === selectedCrypto.toUpperCase()) ||
        availableCoins[0];

    useEffect(() => {
        if (!activePayment?.expiresAt) {
            setSecondsLeft(null);
            return;
        }
        const computeRemaining = () => {
            const target = new Date(activePayment.expiresAt!).getTime();
            if (!Number.isFinite(target)) return null;
            return Math.max(0, Math.floor((target - Date.now()) / 1000));
        };
        setSecondsLeft(computeRemaining());
        const timer = window.setInterval(() => {
            setSecondsLeft(computeRemaining());
        }, 1000);
        return () => window.clearInterval(timer);
    }, [activePayment?.expiresAt]);

    const copyText = async (value: string, field: 'wallet' | 'amount' | 'extra' | 'paymentId') => {
        try {
            await navigator.clipboard.writeText(value);
        } catch {
            const el = document.createElement('textarea');
            el.value = value;
            el.style.position = 'fixed';
            el.style.opacity = '0';
            document.body.appendChild(el);
            el.select();
            document.execCommand('copy');
            document.body.removeChild(el);
        }
        setCopiedField(field);
        window.setTimeout(() => setCopiedField((prev) => (prev === field ? null : prev)), 2500);
    };

    const formatCountdown = (totalSeconds: number) => {
        const mins = Math.floor(totalSeconds / 60);
        const secs = totalSeconds % 60;
        return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    };

    const getProviderStatusBadge = (status: string) => {
        const s = (status || 'waiting').toLowerCase();
        if (s === 'finished' || s === 'confirmed' || s === 'sending') {
            return {
                label: isEn ? 'Confirmed' : 'Confirmado',
                className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                dot: 'bg-emerald-500',
            };
        }
        if (s === 'confirming') {
            return {
                label: isEn ? 'Confirming' : 'Confirmando',
                className: 'bg-sky-50 text-sky-700 border-sky-200',
                dot: 'bg-sky-500 animate-pulse',
            };
        }
        if (s === 'partially_paid') {
            return {
                label: isEn ? 'Partially Paid' : 'Parcialmente Pago',
                className: 'bg-amber-50 text-amber-800 border-amber-200',
                dot: 'bg-amber-500',
            };
        }
        if (s === 'expired' || s === 'failed' || s === 'refunded' || s === 'cancelled') {
            return {
                label: isEn ? 'Expired' : 'Expirado',
                className: 'bg-rose-50 text-rose-700 border-rose-200',
                dot: 'bg-rose-500',
            };
        }
        return {
            label: isEn ? 'Awaiting Payment' : 'Aguardando Pagamento',
            className: 'bg-amber-50 text-amber-800 border-amber-200',
            dot: 'bg-amber-500 animate-pulse',
        };
    };

    // State 2: Active Persisted Wallet + QR Code View
    if (activePayment) {
        const normalizedStatus = (activePayment.providerStatus || 'waiting').toLowerCase();
        const isExpiredOrFailed =
            normalizedStatus === 'expired' ||
            normalizedStatus === 'failed' ||
            normalizedStatus === 'cancelled' ||
            (secondsLeft === 0 && normalizedStatus === 'waiting');
        const statusBadge = getProviderStatusBadge(
            isExpiredOrFailed ? 'expired' : normalizedStatus,
        );

        return (
            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-4 pt-2"
            >
                {autoCopiedBanner && (
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 flex items-center gap-2.5 text-xs text-emerald-800 font-semibold">
                        <CheckCircle2 size={15} className="shrink-0" />
                        <span>
                            {isEn
                                ? 'Wallet ID copied to clipboard.'
                                : 'ID da carteira copiado automaticamente.'}
                        </span>
                    </div>
                )}

                {errorMessage && (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 flex items-start gap-2.5 text-xs text-rose-700">
                        <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                        <span>{errorMessage}</span>
                    </div>
                )}

                {/* Status Header Strip */}
                <div className="flex flex-wrap items-center justify-between gap-2 p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
                    <div className="flex items-center gap-2.5">
                        <CoinAvatar
                            iconUrl={activePayment.iconUrl}
                            shortName={activePayment.cryptoCurrency}
                        />
                        <div>
                            <div className="text-xs sm:text-sm font-black text-slate-900 leading-tight">
                                {activePayment.displayName}
                            </div>
                            <div className="text-[11px] text-slate-500 font-semibold">
                                {activePayment.network}
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-bold ${statusBadge.className}`}
                        >
                            <span className={`w-1.5 h-1.5 rounded-full ${statusBadge.dot}`} />
                            {statusBadge.label}
                        </span>
                        {secondsLeft !== null && !isExpiredOrFailed && (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white border border-slate-200 text-[11px] font-mono font-bold text-slate-800 tabular-nums">
                                <Clock size={12} className="text-amber-500" />
                                {formatCountdown(secondsLeft)}
                            </span>
                        )}
                    </div>
                </div>

                {/* Main QR + Wallet Card */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-5 p-4 rounded-3xl bg-slate-50 border border-slate-200">
                    <div className="md:col-span-5 flex flex-col items-center justify-center text-center space-y-2.5">
                        <div className="p-3.5 bg-white rounded-2xl border border-slate-200 shadow-md">
                            {activePayment.qrCodeDataUrl ? (
                                <img
                                    src={activePayment.qrCodeDataUrl}
                                    alt={`QR Code ${activePayment.cryptoCurrency}`}
                                    className="w-40 h-40 sm:w-44 sm:h-44 object-contain block"
                                />
                            ) : (
                                <div className="w-40 h-40 sm:w-44 sm:h-44 flex flex-col items-center justify-center gap-2 text-slate-400">
                                    <QrCode size={48} />
                                    <span className="text-[11px] font-semibold">
                                        {isEn ? 'Use wallet address' : 'Use o endereço ao lado'}
                                    </span>
                                </div>
                            )}
                        </div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1">
                            <QrCode size={12} className="text-amber-600" />
                            {isEn ? 'Scan QR Code' : 'Escaneie o QR Code'}
                        </span>
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-[10px] font-bold text-amber-800">
                            {activePayment.network}
                        </span>
                    </div>

                    <div className="md:col-span-7 flex flex-col justify-between space-y-3">
                        {/* Exact Crypto Amount */}
                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block">
                                {isEn ? 'Exact Amount to Send' : 'Valor Exato a Enviar'}
                            </label>
                            <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-white border border-slate-200">
                                <div className="min-w-0">
                                    <div className="font-mono text-base font-black text-slate-900 truncate select-all">
                                        {activePayment.cryptoAmount}{' '}
                                        <span className="text-amber-600 text-xs">
                                            {activePayment.cryptoCurrency}
                                        </span>
                                    </div>
                                    <div className="text-[10px] text-slate-500 font-mono">
                                        ${Number(activePayment.fiatAmountUsd).toFixed(2)} USD
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => copyText(String(activePayment.cryptoAmount), 'amount')}
                                    className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                                        copiedField === 'amount'
                                            ? 'bg-emerald-600 text-white'
                                            : 'bg-slate-100 hover:bg-slate-200 text-slate-800'
                                    }`}
                                >
                                    {copiedField === 'amount' ? (
                                        <Check size={13} />
                                    ) : (
                                        <Copy size={13} />
                                    )}
                                    <span>
                                        {copiedField === 'amount'
                                            ? isEn
                                                ? 'Copied'
                                                : 'Copiado'
                                            : isEn
                                              ? 'Copy'
                                              : 'Copiar'}
                                    </span>
                                </button>
                            </div>
                        </div>

                        {/* Correct Wallet Address (Copyable) */}
                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block">
                                {isEn
                                    ? `Deposit Address (${activePayment.network})`
                                    : `Endereço da Carteira (${activePayment.network})`}
                            </label>
                            <div className="p-2.5 rounded-xl bg-white border border-indigo-200 space-y-2">
                                <div className="font-mono text-xs font-bold text-slate-900 break-all select-all leading-relaxed">
                                    {activePayment.walletAddress}
                                </div>
                                <button
                                    type="button"
                                    onClick={() => copyText(activePayment.walletAddress, 'wallet')}
                                    className={`w-full h-9 rounded-xl font-bold text-xs uppercase tracking-wider inline-flex items-center justify-center gap-2 transition-all cursor-pointer ${
                                        copiedField === 'wallet'
                                            ? 'bg-emerald-600 text-white'
                                            : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                                    }`}
                                >
                                    {copiedField === 'wallet' ? <Check size={14} /> : <Copy size={14} />}
                                    <span>
                                        {copiedField === 'wallet'
                                            ? isEn
                                                ? 'Address Copied!'
                                                : 'Endereço Copiado!'
                                            : isEn
                                              ? 'Copy Wallet Address'
                                              : 'Copiar Endereço da Carteira'}
                                    </span>
                                </button>
                            </div>
                        </div>

                        {/* Copyable Wallet / Payment ID */}
                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block">
                                {isEn ? 'Wallet / Payment ID' : 'ID da Carteira'}
                            </label>
                            <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-white border border-slate-200">
                                <div className="min-w-0">
                                    <div className="font-mono text-xs font-bold text-slate-900 truncate select-all">
                                        {activePayment.paymentId || activePayment.reference}
                                    </div>
                                    <div className="text-[10px] text-slate-500 font-mono truncate">
                                        Ref: {activePayment.reference}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() =>
                                        copyText(
                                            String(activePayment.paymentId || activePayment.reference),
                                            'paymentId',
                                        )
                                    }
                                    className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                                        copiedField === 'paymentId'
                                            ? 'bg-emerald-600 text-white'
                                            : 'bg-slate-100 hover:bg-slate-200 text-slate-800'
                                    }`}
                                >
                                    {copiedField === 'paymentId' ? (
                                        <Check size={13} />
                                    ) : (
                                        <Copy size={13} />
                                    )}
                                    <span>
                                        {copiedField === 'paymentId'
                                            ? isEn
                                                ? 'Copied'
                                                : 'Copiado'
                                            : isEn
                                              ? 'Copy ID'
                                              : 'Copiar ID'}
                                    </span>
                                </button>
                            </div>
                        </div>

                        {activePayment.payinExtraId && (
                            <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-amber-50 border border-amber-200">
                                <div className="min-w-0">
                                    <span className="text-[9px] font-black uppercase text-amber-700 block">
                                        Memo / Destination Tag
                                    </span>
                                    <span className="font-mono text-xs font-bold text-slate-900 break-all select-all">
                                        {activePayment.payinExtraId}
                                    </span>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => copyText(activePayment.payinExtraId || '', 'extra')}
                                    className="shrink-0 px-2.5 py-1 rounded-lg bg-amber-600 text-white text-[11px] font-bold cursor-pointer"
                                >
                                    {copiedField === 'extra' ? 'OK' : isEn ? 'Copy' : 'Copiar'}
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                <div className="rounded-2xl border border-indigo-200 bg-indigo-50/70 p-3 flex items-center gap-2.5 text-[11px] text-indigo-800">
                    <Mail size={14} className="shrink-0 text-indigo-600" />
                    <span>
                        {isEn
                            ? 'Wallet ID & QR Code sent to your email and notifications.'
                            : 'ID da carteira e QR Code enviados para o seu e-mail e notificações.'}
                    </span>
                </div>

                <div className="flex flex-col sm:flex-row gap-3">
                    {isExpiredOrFailed ? (
                        <button
                            type="button"
                            onClick={() => onGenerateWallet(true)}
                            disabled={processing}
                            className="flex-1 h-12 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-black text-xs uppercase tracking-widest inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-50 shadow-md cursor-pointer"
                        >
                            {processing ? (
                                <Loader2 size={15} className="animate-spin" />
                            ) : (
                                <RefreshCw size={15} />
                            )}
                            <span>{isEn ? 'Generate New Wallet' : 'Gerar Nova Carteira'}</span>
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={onCheckStatus}
                            disabled={checkingStatus}
                            className="flex-1 h-12 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs uppercase tracking-widest inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-50 shadow-md cursor-pointer"
                        >
                            {checkingStatus ? (
                                <Loader2 size={15} className="animate-spin" />
                            ) : (
                                <RefreshCw size={15} />
                            )}
                            <span>
                                {checkingStatus
                                    ? isEn
                                        ? 'Checking...'
                                        : 'Verificando...'
                                    : isEn
                                      ? 'I Paid · Verify'
                                      : 'Já Paguei · Verificar'}
                            </span>
                        </button>
                    )}

                    <button
                        type="button"
                        onClick={onChangeCoin}
                        disabled={cancelling || processing}
                        className="sm:w-auto px-5 h-12 rounded-2xl bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-800 font-bold text-xs uppercase tracking-wider inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-50 cursor-pointer"
                    >
                        {cancelling ? (
                            <Loader2 size={14} className="animate-spin" />
                        ) : (
                            <ArrowLeftRight size={14} />
                        )}
                        <span>{isEn ? 'Change Coin' : 'Trocar Moeda'}</span>
                    </button>
                </div>
            </motion.div>
        );
    }

    // State 1: Select Cryptocurrency sub-method (USDT, BTC, BNB/Binance, ETH, SOL...)
    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-5 pt-2"
        >
            {errorMessage && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 flex items-start gap-2.5 text-xs text-rose-700">
                    <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                    <span>{errorMessage}</span>
                </div>
            )}

            <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                    <label
                        htmlFor="crypto-currency-search"
                        className="text-[10px] font-black text-slate-500 uppercase tracking-widest block"
                    >
                        {isEn ? 'Search & Select Cryptocurrency' : 'Pesquisar Criptomoeda'}
                    </label>
                    <span className="text-[10px] font-bold text-slate-500">
                        {trimmedSearch
                            ? `${filteredCoins.length} ${isEn ? 'results' : 'resultados'}`
                            : `${availableCoins.length} ${isEn ? 'available' : 'disponíveis'}`}
                    </span>
                </div>

                <div className="relative">
                    <Search
                        size={17}
                        className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                    />
                    <input
                        id="crypto-currency-search"
                        type="search"
                        value={coinSearchQuery}
                        onChange={(e) => setCoinSearchQuery(e.target.value)}
                        placeholder={
                            isEn
                                ? 'Search any crypto (e.g. BTC, USDT, SOL, DOGE, ADA, XRP...)'
                                : 'Pesquisar qualquer cripto (ex.: BTC, USDT, SOL, DOGE, ADA, XRP...)'
                        }
                        disabled={processing}
                        autoComplete="off"
                        className="w-full bg-white border border-slate-200 focus:border-amber-500 focus:ring-4 focus:ring-amber-500/10 rounded-2xl pl-11 pr-10 py-3.5 text-sm font-bold text-slate-900 placeholder:text-slate-400 placeholder:font-medium outline-none transition-all"
                    />
                    {trimmedSearch && (
                        <button
                            type="button"
                            onClick={() => setCoinSearchQuery('')}
                            aria-label={isEn ? 'Clear search' : 'Limpar pesquisa'}
                            className="absolute right-3.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center cursor-pointer transition-colors"
                        >
                            <X size={13} />
                        </button>
                    )}
                </div>

                {selectedCoinInfo && (
                    <div className="flex items-center justify-between gap-2 px-3.5 py-2 rounded-xl bg-amber-50/80 border border-amber-200 text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                            <CoinAvatar
                                iconUrl={selectedCoinInfo.iconUrl}
                                shortName={selectedCoinInfo.shortName}
                            />
                            <div className="min-w-0">
                                <span className="font-black text-slate-900">
                                    {selectedCoinInfo.symbol}
                                </span>
                                <span className="text-slate-500 mx-1.5">·</span>
                                <span className="text-slate-700 font-semibold truncate">
                                    {selectedCoinInfo.network}
                                </span>
                            </div>
                        </div>
                        <span className="text-[10px] font-black uppercase tracking-wider text-amber-800 shrink-0">
                            {isEn ? 'Selected' : 'Selecionada'}
                        </span>
                    </div>
                )}
            </div>

            {visibleCoins.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-center space-y-2.5">
                    <p className="text-xs text-slate-600 font-semibold">
                        {isEn
                            ? `No matching coin found for "${trimmedSearch}".`
                            : `Nenhuma criptomoeda encontrada para "${trimmedSearch}".`}
                    </p>
                    <button
                        type="button"
                        onClick={() => setCoinSearchQuery('')}
                        className="px-3.5 py-1.5 rounded-xl bg-white border border-slate-200 hover:bg-slate-100 text-xs font-bold text-slate-700 cursor-pointer transition-colors"
                    >
                        {isEn ? 'Show all coins' : 'Mostrar todas as moedas'}
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-[224px] overflow-y-auto pr-1">
                    {visibleCoins.map((coin) => {
                        const isSelected = coin.symbol.toUpperCase() === selectedCrypto.toUpperCase();
                        return (
                            <button
                                key={coin.symbol}
                                type="button"
                                disabled={processing}
                                onClick={() => setSelectedCrypto(coin.symbol)}
                                className={`flex items-center gap-2 p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                                    isSelected
                                        ? 'border-2 border-amber-500 bg-amber-50 shadow-sm'
                                        : 'border-slate-200 bg-slate-50/70 hover:border-slate-300 hover:bg-white'
                                }`}
                            >
                                <CoinAvatar iconUrl={coin.iconUrl} shortName={coin.shortName} />
                                <div className="min-w-0 flex-1">
                                    <div className="text-xs font-black text-slate-900 truncate leading-tight">
                                        {coin.symbol}
                                    </div>
                                    <div className="text-[10px] text-slate-500 truncate">
                                        {coin.network}
                                    </div>
                                </div>
                            </button>
                        );
                    })}
                </div>
            )}

            <motion.button
                type="button"
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                onClick={() => onGenerateWallet(false)}
                disabled={processing || !selectedCrypto}
                className="group relative w-full min-h-[56px] h-14 px-6 bg-gradient-to-r from-amber-500 via-orange-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white rounded-2xl font-black text-sm uppercase tracking-wider transition-all duration-200 disabled:opacity-55 disabled:hover:translate-y-0 disabled:shadow-none shadow-[0_14px_30px_-6px_rgba(234,88,12,0.45)] ring-2 ring-amber-500/20 hover:-translate-y-0.5 overflow-hidden cursor-pointer flex items-center justify-center"
            >
                <span className="relative z-10 flex items-center justify-center gap-2.5">
                    {processing ? (
                        <>
                            <Loader2 className="animate-spin" size={18} />
                            <span>
                                {isEn ? 'Generating Wallet & QR Code...' : 'Gerando Carteira e QR Code...'}
                            </span>
                        </>
                    ) : (
                        <>
                            <QrCode size={18} />
                            <span>
                                {isEn
                                    ? `Pay $${payableTotalUSD.toFixed(2)} USD`
                                    : `Gerar Carteira · $${payableTotalUSD.toFixed(2)} USD`}
                            </span>
                            <ChevronRight size={17} className="transition-transform group-hover:translate-x-0.5" />
                        </>
                    )}
                </span>
            </motion.button>
        </motion.div>
    );
};

export const PollingOverlay = ({
    method,
    total,
    isEn = false,
}: {
    method: string;
    total: number;
    isEn?: boolean;
}) => {
    const isCard = method === 'card' || method === 'payfast';
    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mt-4"
        >
            <div className="relative p-7 bg-white rounded-3xl border border-slate-200 shadow-xl flex flex-col items-center overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 via-cyan-500 to-indigo-500 animate-pulse" />
                <div className="w-14 h-14 bg-indigo-50 border border-indigo-200 rounded-2xl flex items-center justify-center text-indigo-600 mb-5">
                    {isCard ? <CreditCard size={28} /> : <Smartphone size={28} className="animate-bounce" />}
                </div>
                <div className="w-full text-center space-y-4">
                    <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">
                        {isEn ? 'Awaiting Confirmation' : 'Aguardando Confirmação'}
                    </h3>
                    <p className="text-slate-600 text-xs max-w-[280px] leading-relaxed mx-auto">
                        {isEn
                            ? `Confirm the $${total.toFixed(2)} USD payment on your phone.`
                            : `Confirme o pagamento de $${total.toFixed(2)} USD no seu telemóvel.`}
                    </p>
                </div>
            </div>
        </motion.div>
    );
};

export interface PaymentFailedModalProps {
    open: boolean;
    title: string;
    message: string;
    methodLabel?: string;
    reference?: string;
    isEn?: boolean;
    onRetry: () => void;
    onClose: () => void;
}

export const PaymentFailedModal = ({
    open,
    title,
    message,
    methodLabel,
    reference,
    isEn = false,
    onRetry,
    onClose,
}: PaymentFailedModalProps) => {
    if (!open) return null;

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="payment-failed-modal-title"
            className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-md bg-slate-900/50"
        >
            <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="bg-white border border-slate-200 rounded-[28px] p-6 sm:p-8 max-w-sm w-full text-center relative overflow-hidden shadow-2xl space-y-5"
            >
                <div className="flex justify-center">
                    <div className="w-14 h-14 rounded-2xl bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center">
                        <AlertTriangle size={28} />
                    </div>
                </div>

                <div className="space-y-2">
                    <h3
                        id="payment-failed-modal-title"
                        className="text-lg font-black text-slate-900 tracking-tight"
                    >
                        {title}
                    </h3>
                    <p className="text-slate-600 text-xs sm:text-sm leading-relaxed">
                        {message}
                    </p>
                </div>

                {(methodLabel || reference) && (
                    <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 text-[11px] text-slate-600 space-y-1 text-left">
                        {methodLabel && (
                            <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold text-slate-500">
                                    {isEn ? 'Method' : 'Método'}
                                </span>
                                <span className="font-bold text-slate-800 uppercase">
                                    {methodLabel}
                                </span>
                            </div>
                        )}
                        {reference && (
                            <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold text-slate-500">Ref.</span>
                                <span className="font-mono font-semibold text-slate-800 truncate">
                                    {reference}
                                </span>
                            </div>
                        )}
                    </div>
                )}

                <div className="space-y-2.5 pt-1">
                    <button
                        type="button"
                        onClick={onRetry}
                        className="w-full h-11 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black uppercase tracking-wider transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-md shadow-indigo-500/20"
                    >
                        <RefreshCw size={14} />
                        <span>{isEn ? 'Try Again' : 'Tentar Novamente'}</span>
                    </button>
                    <button
                        type="button"
                        onClick={onClose}
                        className="w-full h-10 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors cursor-pointer"
                    >
                        {isEn ? 'Choose Another Method' : 'Fechar / Escolher Outro Método'}
                    </button>
                </div>
            </motion.div>
        </div>
    );
};
