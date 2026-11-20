import * as ct from 'countries-and-timezones';

export interface CountryDialMeta {
    iso2: string;
    name: string;
    dialCode: string;
    minLocalDigits: number;
    maxLocalDigits: number;
}

export const COUNTRY_DIAL_CATALOG: CountryDialMeta[] = [
    { iso2: 'MZ', name: 'Moçambique', dialCode: '+258', minLocalDigits: 9, maxLocalDigits: 9 },
    { iso2: 'AO', name: 'Angola', dialCode: '+244', minLocalDigits: 9, maxLocalDigits: 9 },
    { iso2: 'BR', name: 'Brasil', dialCode: '+55', minLocalDigits: 10, maxLocalDigits: 11 },
    { iso2: 'PT', name: 'Portugal', dialCode: '+351', minLocalDigits: 9, maxLocalDigits: 9 },
    { iso2: 'CV', name: 'Cabo Verde', dialCode: '+238', minLocalDigits: 7, maxLocalDigits: 7 },
    { iso2: 'GW', name: 'Guiné-Bissau', dialCode: '+245', minLocalDigits: 7, maxLocalDigits: 9 },
    { iso2: 'ST', name: 'São Tomé e Príncipe', dialCode: '+239', minLocalDigits: 7, maxLocalDigits: 7 },
    { iso2: 'ZA', name: 'África do Sul', dialCode: '+27', minLocalDigits: 9, maxLocalDigits: 9 },
    { iso2: 'NA', name: 'Namíbia', dialCode: '+264', minLocalDigits: 8, maxLocalDigits: 10 },
    { iso2: 'BW', name: 'Botswana', dialCode: '+267', minLocalDigits: 7, maxLocalDigits: 8 },
    { iso2: 'ZW', name: 'Zimbabwe', dialCode: '+263', minLocalDigits: 8, maxLocalDigits: 10 },
    { iso2: 'ZM', name: 'Zâmbia', dialCode: '+260', minLocalDigits: 9, maxLocalDigits: 9 },
    { iso2: 'MW', name: 'Malawi', dialCode: '+265', minLocalDigits: 8, maxLocalDigits: 9 },
    { iso2: 'TZ', name: 'Tanzânia', dialCode: '+255', minLocalDigits: 9, maxLocalDigits: 9 },
    { iso2: 'KE', name: 'Quénia', dialCode: '+254', minLocalDigits: 9, maxLocalDigits: 9 },
    { iso2: 'NG', name: 'Nigéria', dialCode: '+234', minLocalDigits: 10, maxLocalDigits: 10 },
    { iso2: 'GH', name: 'Gana', dialCode: '+233', minLocalDigits: 9, maxLocalDigits: 9 },
    { iso2: 'US', name: 'Estados Unidos', dialCode: '+1', minLocalDigits: 10, maxLocalDigits: 10 },
    { iso2: 'CA', name: 'Canadá', dialCode: '+1', minLocalDigits: 10, maxLocalDigits: 10 },
    { iso2: 'GB', name: 'Reino Unido', dialCode: '+44', minLocalDigits: 9, maxLocalDigits: 11 },
    { iso2: 'ES', name: 'Espanha', dialCode: '+34', minLocalDigits: 9, maxLocalDigits: 9 },
    { iso2: 'FR', name: 'França', dialCode: '+33', minLocalDigits: 9, maxLocalDigits: 9 },
    { iso2: 'DE', name: 'Alemanha', dialCode: '+49', minLocalDigits: 9, maxLocalDigits: 12 },
    { iso2: 'IT', name: 'Itália', dialCode: '+39', minLocalDigits: 9, maxLocalDigits: 11 },
    { iso2: 'NL', name: 'Países Baixos', dialCode: '+31', minLocalDigits: 9, maxLocalDigits: 9 },
    { iso2: 'BE', name: 'Bélgica', dialCode: '+32', minLocalDigits: 8, maxLocalDigits: 9 },
    { iso2: 'CH', name: 'Suíça', dialCode: '+41', minLocalDigits: 9, maxLocalDigits: 9 },
    { iso2: 'AE', name: 'Emirados Árabes Unidos', dialCode: '+971', minLocalDigits: 8, maxLocalDigits: 9 },
    { iso2: 'AU', name: 'Austrália', dialCode: '+61', minLocalDigits: 9, maxLocalDigits: 9 },
    { iso2: 'IN', name: 'Índia', dialCode: '+91', minLocalDigits: 10, maxLocalDigits: 10 },
    { iso2: 'JP', name: 'Japão', dialCode: '+81', minLocalDigits: 9, maxLocalDigits: 10 },
];

const BY_ISO2 = new Map(COUNTRY_DIAL_CATALOG.map((c) => [c.iso2.toUpperCase(), c]));
const BY_DIAL_DESC = [...COUNTRY_DIAL_CATALOG].sort(
    (a, b) => b.dialCode.length - a.dialCode.length,
);

export interface GeoHintResolution {
    countryIso2: string | null;
    dialCode: string | null;
    source: 'geo-header' | 'timezone' | 'accept-language' | 'none';
}

export function resolveCountryFromHeadersOrTimezone(
    headers: Record<string, any> | undefined,
    timezone?: string | null,
): GeoHintResolution {
    const h = headers || {};
    const rawHeaderCountry = String(
        h['cf-ipcountry'] ||
            h['x-vercel-ip-country'] ||
            h['cloudfront-viewer-country'] ||
            h['x-country-code'] ||
            '',
    )
        .trim()
        .toUpperCase();

    if (/^[A-Z]{2}$/.test(rawHeaderCountry) && rawHeaderCountry !== 'XX' && rawHeaderCountry !== 'T1') {
        const meta = BY_ISO2.get(rawHeaderCountry);
        if (meta) {
            return {
                countryIso2: meta.iso2,
                dialCode: meta.dialCode,
                source: 'geo-header',
            };
        }
    }

    const cleanTz = typeof timezone === 'string' ? timezone.trim() : '';
    if (cleanTz) {
        try {
            const tzInfo = ct.getTimezone(cleanTz);
            const firstIso = tzInfo?.countries?.[0]?.toUpperCase();
            if (firstIso && BY_ISO2.has(firstIso)) {
                const meta = BY_ISO2.get(firstIso)!;
                return {
                    countryIso2: meta.iso2,
                    dialCode: meta.dialCode,
                    source: 'timezone',
                };
            }
        } catch {
            // ignore timezone lookup failures
        }
    }

    const acceptLang = String(h['accept-language'] || '').split(',')[0] || '';
    const regionMatch = acceptLang.match(/[-_]([A-Za-z]{2})\b/);
    if (regionMatch) {
        const iso = regionMatch[1].toUpperCase();
        const meta = BY_ISO2.get(iso);
        if (meta) {
            return {
                countryIso2: meta.iso2,
                dialCode: meta.dialCode,
                source: 'accept-language',
            };
        }
    }

    return { countryIso2: null, dialCode: null, source: 'none' };
}

export interface NormalizedContactResult {
    valid: boolean;
    normalized: string;
    countryIso2: string | null;
    dialCode: string | null;
    reason?: string;
}

export function validateAndNormalizeContact(
    rawContact: string,
    countryIso2?: string | null,
): NormalizedContactResult {
    const trimmed = String(rawContact || '').trim();
    if (!trimmed) {
        return {
            valid: false,
            normalized: '',
            countryIso2: null,
            dialCode: null,
            reason: 'Número de contacto é obrigatório.',
        };
    }

    const stripped = trimmed.replace(/[\s()-]/g, '');
    const selectedMeta = countryIso2 ? BY_ISO2.get(countryIso2.trim().toUpperCase()) : undefined;

    let withPlus = stripped;
    if (!withPlus.startsWith('+')) {
        if (!selectedMeta) {
            return {
                valid: false,
                normalized: stripped,
                countryIso2: null,
                dialCode: null,
                reason: 'Selecione o indicativo do país (ex: +258, +55, +351) antes de inserir o número.',
            };
        }
        const digitsOnly = withPlus.replace(/^0+/, '').replace(/\D/g, '');
        withPlus = `${selectedMeta.dialCode}${digitsOnly}`;
    } else {
        withPlus = `+${withPlus.slice(1).replace(/\D/g, '')}`;
    }

    if (!/^\+[1-9]\d{6,14}$/.test(withPlus)) {
        return {
            valid: false,
            normalized: withPlus,
            countryIso2: selectedMeta?.iso2 || null,
            dialCode: selectedMeta?.dialCode || null,
            reason: 'Formato de telefone inválido. Inclua o prefixo internacional e entre 7 e 15 dígitos.',
        };
    }

    const matchedMeta =
        (selectedMeta && withPlus.startsWith(selectedMeta.dialCode) ? selectedMeta : undefined) ||
        BY_DIAL_DESC.find((item) => withPlus.startsWith(item.dialCode));

    if (matchedMeta) {
        const localNumber = withPlus.slice(matchedMeta.dialCode.length);
        if (/^(\d)\1{5,}$/.test(localNumber)) {
            return {
                valid: false,
                normalized: withPlus,
                countryIso2: matchedMeta.iso2,
                dialCode: matchedMeta.dialCode,
                reason: 'Número de contacto parece inválido.',
            };
        }
        if (
            localNumber.length < matchedMeta.minLocalDigits ||
            localNumber.length > matchedMeta.maxLocalDigits
        ) {
            return {
                valid: false,
                normalized: withPlus,
                countryIso2: matchedMeta.iso2,
                dialCode: matchedMeta.dialCode,
                reason: `Para ${matchedMeta.name} (${matchedMeta.dialCode}), informe entre ${matchedMeta.minLocalDigits} e ${matchedMeta.maxLocalDigits} dígitos locais.`,
            };
        }
        return {
            valid: true,
            normalized: withPlus,
            countryIso2: matchedMeta.iso2,
            dialCode: matchedMeta.dialCode,
        };
    }

    return {
        valid: true,
        normalized: withPlus,
        countryIso2: selectedMeta?.iso2 || null,
        dialCode: null,
    };
}
