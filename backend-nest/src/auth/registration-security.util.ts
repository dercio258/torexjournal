import { BadRequestException } from '@nestjs/common';
import * as dns from 'dns';

export type SupportedLocale = 'pt' | 'en';

export interface PasswordValidationContext {
    name?: string | null;
    email?: string | null;
    contact?: string | null;
}

export interface PasswordChecks {
    minLength: boolean;
    maxLength: boolean;
    hasLowercase: boolean;
    hasUppercase: boolean;
    hasNumber: boolean;
    hasSpecial: boolean;
    noSequentialNumbers: boolean;
    noSequentialLettersOrKeyboard: boolean;
    noRepeatedChars: boolean;
    noPersonalInfo: boolean;
    noCommonWeakPassword: boolean;
}

export interface PasswordValidationResult {
    valid: boolean;
    score: 0 | 1 | 2 | 3 | 4;
    checks: PasswordChecks;
    failedRule: keyof PasswordChecks | null;
    messagePt: string | null;
    messageEn: string | null;
}

export interface EmailValidationResult {
    valid: boolean;
    reasonCode?: 'INVALID_FORMAT' | 'DISPOSABLE_DOMAIN' | 'DISPOSABLE_MX' | 'UNREACHABLE_DOMAIN';
    messagePt?: string;
    messageEn?: string;
}

/**
 * Curated blocklist of disposable / temporary email domains (exact + subdomains).
 * Never includes legitimate personal, privacy-first, or corporate mail providers
 * (e.g. gmail, outlook, icloud, yahoo, proton, fastmail, zoho, gmx, sapo, uol).
 */
export const DISPOSABLE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
    // Temp-mail / TmpMail / TMailor family
    'temp-mail.org',
    'temp-mail.io',
    'temp-mail.ru',
    'temp-mail.de',
    'temp-mails.com',
    'tempmail.com',
    'tempmail.net',
    'tempmail.org',
    'tempmail.eu',
    'tempmail.it',
    'tempmail.plus',
    'tempmail.ninja',
    'tempmailo.com',
    'tempmailaddress.com',
    'tempmail2.com',
    'tempmaildemo.com',
    'tempmailer.com',
    'tempmailer.de',
    'tempmailid.com',
    'tempmails.net',
    'tempail.com',
    'tempalias.com',
    'tempe-mail.com',
    'tempemail.biz',
    'tempemail.co',
    'tempemail.co.za',
    'tempemail.com',
    'tempemail.net',
    'tempemail.org',
    'tempinbox.co.uk',
    'tempinbox.com',
    'tempomail.fr',
    'temporarily.de',
    'temporarioemail.com.br',
    'temporaryemail.net',
    'temporaryforwarding.com',
    'temporaryinbox.com',
    'temporarymail.com',
    'temporarymailaddress.com',
    'tempr.email',
    'tempthe.net',
    'tempbox.io',
    'tempbox.org',
    'temp-box.org',
    'tmpmail.org',
    'tmpmail.net',
    'tmpmail.dev',
    'tmailor.com',
    'tmail.ws',
    'tmail.gg',
    'tmail.io',
    'tmail.link',
    'tmail.pro',
    'mytemp.email',
    'mail-temp.com',
    'mailtemp.info',
    'mailtemp.net',
    'mail-temporaire.fr',
    'mail-temporaire.com',
    'emailtemp.org',
    'emailtemporario.com.br',
    'emailtemporaria.com.br',
    'correiotemporario.com.br',
    'descartavel.com',
    'emltmp.com',
    'ephemail.net',

    // 10-minute / short-lived mail
    '10minutemail.com',
    '10minutemail.net',
    '10minutemail.org',
    '10minutemail.de',
    '10minutemail.co.za',
    '10minutemail.co.uk',
    '10mail.org',
    'my10minutemail.com',
    '20minutemail.com',
    '20minutemail.it',
    'minutemailbox.com',
    'zehnminuten.de',
    'zehnminutenmail.de',

    // Guerrilla Mail family
    'guerrillamail.com',
    'guerrillamail.net',
    'guerrillamail.org',
    'guerrillamail.biz',
    'guerrillamail.de',
    'guerrillamail.info',
    'guerrillamailblock.com',
    'sharklasers.com',
    'grr.la',
    'pokemail.net',
    'spam4.me',

    // YOPmail & French throwaways
    'yopmail.com',
    'yopmail.fr',
    'yopmail.net',
    'cool.fr.nf',
    'jetable.fr.nf',
    'courriel.fr.nf',
    'moncourrier.fr.nf',
    'monemail.fr.nf',
    'monmail.fr.nf',
    'hide.biz.st',
    'mymail.infos.st',
    'jetable.org',
    'jetable.net',
    'jetable.com',

    // Mailinator & aliases
    'mailinator.com',
    'mailinator.net',
    'mailinator.org',
    'mailinator.us',
    'mailinator.co.uk',
    'mailinator2.com',
    'mailin8r.com',
    'mailinater.com',
    'mailnator.com',
    'notmailinator.com',
    'tmailinator.com',
    'binkmail.com',
    'bobmail.info',
    'chammy.info',
    'devnullmail.com',
    'letthemeatspam.com',
    'mailismagic.com',
    'mailmetrash.com',
    'mailmoat.com',
    'mailnull.com',
    'reallymymail.com',
    'reconmail.com',
    'safetymail.info',
    'sendspamhere.com',
    'sogetthis.com',
    'spamherelots.com',
    'spamhereplease.com',
    'spamthisplease.com',
    'streetwisemail.com',
    'suremail.info',
    'thisisnotmyrealemail.com',
    'tradermail.info',
    'veryrealemail.com',
    'zippymail.info',

    // TrashMail / Discard / Wegwerf
    'trashmail.com',
    'trashmail.net',
    'trashmail.org',
    'trashmail.de',
    'trashmail.me',
    'trashmail.at',
    'trashmail.ws',
    'trashmailer.com',
    'trash-mail.com',
    'trash-mail.de',
    'trash-mail.at',
    'trash-amil.com',
    'trash2009.com',
    'trashdevil.com',
    'trashemail.de',
    'trashymail.com',
    'trashymail.net',
    'mytrashmail.com',
    'mail4trash.com',
    'mailtrash.net',
    'wegwerfmail.de',
    'wegwerfmail.info',
    'wegwerfmail.net',
    'wegwerfmail.org',
    'wegwerfemail.com',
    'wegwerfemail.de',
    'wegwerfadresse.de',
    'weg-werf-email.de',
    'wegwerf-emails.de',
    'discard.email',
    'discard.cf',
    'discard.ga',
    'discard.gq',
    'discard.ml',
    'discard.tk',
    'discardmail.com',
    'discardmail.de',

    // Popular API / modern temp-mail providers
    'maildrop.cc',
    'maildrop.cf',
    'maildrop.ga',
    'maildrop.gq',
    'maildrop.ml',
    'dispostable.com',
    'disposablemail.com',
    'disposableinbox.com',
    'getnada.com',
    'nada.email',
    'nada.ltd',
    'mohmal.com',
    'mohmal.im',
    'mohmal.in',
    'mohmal.tech',
    'fakemail.net',
    'fakemail.io',
    'fakemail.org',
    'fakemail.fr',
    'fakemailgenerator.com',
    'fakeinbox.com',
    'emailfake.com',
    'generator.email',
    'emailondeck.com',
    'throwawaymail.com',
    'throwawayemailaddress.com',
    'burnermail.io',
    'burnmail.ca',
    'mail.tm',
    'mail.gw',
    'dropmail.me',
    'moakt.com',
    'moakt.cc',
    'moakt.ws',
    'moakt.co',
    '1secmail.com',
    '1secmail.org',
    '1secmail.net',
    'esiix.com',
    'wwjmp.com',
    'xojxe.com',
    'yoggm.com',
    'dcctb.com',
    'laafd.com',
    'vjuum.com',
    'txcct.com',
    'icznn.com',
    'ezztt.com',
    'mintemail.com',
    'mailnesia.com',
    'getairmail.com',
    'mailcatch.com',
    'inboxkitten.com',
    'inboxbear.com',
    'harakirimail.com',
    'mailpoof.com',
    'mailsac.com',
    'mail7.io',
    'luxusmail.org',
    'cmail.club',
    'cmail.net',
    'cmail.org',
    'inboxes.com',
    'blondmail.com',
    'chapsmail.com',
    'clowmail.com',
    'dropjar.com',
    'fivermail.com',
    'gimpmail.com',
    'guysmail.com',
    'replyloop.com',
    'robot-mail.com',
    'tafmail.com',
    'tupmail.com',
    'vomoto.com',
    'vubby.com',
    'crazymailing.com',
    'mailhero.io',
    'mailna.co',
    'mailna.in',
    'mailna.me',
    'mailslurp.com',
    'mailslurp.biz',
    'mailslurp.info',
    'mailslurp.mx',
    'mailslurp.net',
    'mailslurp.org',
    'mailslurp.xyz',
    'ethereal.email',
    'mailtrap.io',
    'testmail.app',
    'kuku.lu',
    'byom.de',
    'one-time.email',

    // FakeMailGenerator / Classic throwaway domains
    'armyspy.com',
    'cuvox.de',
    'dayrep.com',
    'einrot.com',
    'fleckens.hu',
    'gustr.com',
    'jourrapide.com',
    'rhyta.com',
    'superrito.com',
    'teleworm.com',
    'teleworm.us',

    // Spam / Anonymous burn-box domains
    'spamgourmet.com',
    'spamgourmet.net',
    'spamgourmet.org',
    'spambox.us',
    'spambox.info',
    'spambog.com',
    'spambog.de',
    'spambog.ru',
    'spambob.com',
    'spambob.net',
    'spambob.org',
    'spamfree24.com',
    'spamfree24.de',
    'spamfree24.eu',
    'spamfree24.info',
    'spamfree24.net',
    'spamfree24.org',
    'spamex.com',
    'spamhole.com',
    'spaml.com',
    'spaml.de',
    'spamobox.com',
    'spamspot.com',
    'spam.la',
    'spam.su',
    'spamavert.com',
    'spamcannon.com',
    'spamcannon.net',
    'spamcero.com',
    'spamcon.org',
    'spamcowboy.com',
    'spamcowboy.net',
    'spamcowboy.org',
    'spamday.com',
    'spammotel.com',
    'spamoff.de',
    'spamthis.co.uk',
    'spamtrail.com',
    'spamtroll.net',
    'spoofmail.de',
    'meltmail.com',
    'mailexpire.com',
    'anonbox.net',
    'anonmails.de',
    'dodgit.com',
    'e4ward.com',
    'filzmail.com',
    'gishpuppy.com',
    'haltospam.com',
    'incognitomail.com',
    'incognitomail.net',
    'incognitomail.org',
    'instant-mail.de',
    'kasmail.com',
    'kurzepost.de',
    'mailbidon.com',
    'mailblocks.com',
    'maildu.de',
    'mailforspam.com',
    'mailfreeonline.com',
    'mailguard.me',
    'mailincubator.com',
    'mailtothis.com',
    'mailzilla.com',
    'mailzilla.org',
    'mbx.cc',
    'mycleaninbox.net',
    'neverbox.com',
    'no-spam.ws',
    'nobulk.com',
    'noclickemail.com',
    'nospam4.us',
    'nospamfor.us',
    'nospammail.net',
    'nospamthanks.info',
    'nowmymail.com',
    'nurfuerspam.de',
    'objectmail.com',
    'odnorazovoe.ru',
    'oneoffemail.com',
    'onewaymail.com',
    'otherinbox.com',
    'pookmail.com',
    'proxymail.eu',
    'quickinbox.com',
    'rcpt.at',
    'recode.me',
    'recursor.net',
    'rppkn.com',
    'rtrtr.com',
    'selfdestructingmail.com',
    'shiftmail.com',
    'shitmail.me',
    'shortmail.net',
    'skeefmail.com',
    'slaskpost.se',
    'slopsbox.com',
    'smellfear.com',
    'snakemail.com',
    'sneakemail.com',
    'sofort-mail.de',
    'tilien.com',
    'uggsrock.com',
    'venompen.com',
    'webm4il.info',
    'wh4f.org',
    'whyspam.me',
    'willselfdestruct.com',
    'wuzup.net',
    'wuzupmail.net',
    'xagloo.com',
    'xemaps.com',
    'xents.com',
    'xmaily.com',
    'xoxy.net',
    'yep.it',
    'yuurok.com',
    'zoemail.net',
    'zoemail.org',
    'zomg.info',
]);

/**
 * Unambiguous throwaway-provider keyword patterns to catch brand-new clone domains.
 */
const DISPOSABLE_DOMAIN_HEURISTIC_RE =
    /(^|[.-])(tempmail|temp-mail|tmpmail|10minutemail|20minutemail|guerrillamail|mailinator|yopmail|trashmail|trash-mail|throwaway|burnermail|disposable|fakemail|fakeinbox|emailtemporario|temporarioemail|correiotemporario|wegwerf|maildrop|getnada|mohmal|1secmail|tmailor|dropmail|inboxkitten|mailslurp|mailsac|sharklasers|mailnesia|dispostable|harakirimail|mailpoof)([.-]|$)/i;

/**
 * Known MX host suffixes belonging to temporary email networks.
 * Catches rotating random throwaway domains backed by the same temp-mail MX infrastructure.
 */
const DISPOSABLE_MX_SUFFIXES = [
    'mailinator.com',
    'guerrillamail.com',
    'temp-mail.org',
    'tempmail.plus',
    'tempmailo.com',
    'yopmail.com',
    'mail.tm',
    '1secmail.com',
    'dropmail.me',
    'emailfake.com',
    'tmailor.com',
    'mohmal.com',
    'moakt.com',
    'maildrop.cc',
    'trashmail.com',
    'inboxkitten.com',
    'mailsac.com',
    'sharklasers.com',
    'dispostable.com',
    'getnada.com',
    'burnermail.io',
    'mailnesia.com',
    'fakemail.net',
    'emailondeck.com',
    'mailslurp.com',
];

const RESERVED_INVALID_TLDS = new Set([
    'localhost',
    'local',
    'localdomain',
    'invalid',
    'test',
    'example',
    'lan',
    'home',
    'internal',
]);

const DNS_MX_CACHE_TTL_MS = 10 * 60 * 1000;
const DNS_MX_CACHE_MAX_SIZE = 1000;
const dnsMxCache = new Map<
    string,
    { status: 'OK' | 'DISPOSABLE_MX' | 'UNREACHABLE'; expiresAt: number }
>();

const BASIC_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function matchesDomainOrSubdomain(host: string, target: string): boolean {
    return host === target || host.endsWith(`.${target}`);
}

export function isDisposableEmailDomain(rawDomain: string): boolean {
    const domain = String(rawDomain || '')
        .trim()
        .toLowerCase()
        .replace(/\.+$/, '');
    if (!domain) return true;

    if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) {
        return true;
    }

    // Check parent domains (e.g., foo.mailinator.com -> mailinator.com)
    const labels = domain.split('.');
    for (let i = 1; i < labels.length - 1; i++) {
        const parent = labels.slice(i).join('.');
        if (DISPOSABLE_EMAIL_DOMAINS.has(parent)) {
            return true;
        }
    }

    if (DISPOSABLE_DOMAIN_HEURISTIC_RE.test(domain)) {
        return true;
    }

    return false;
}

async function resolveWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((_, reject) => {
                timer = setTimeout(() => reject(Object.assign(new Error('DNS_TIMEOUT'), { code: 'ETIMEOUT' })), timeoutMs);
                if (typeof timer.unref === 'function') timer.unref();
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

async function inspectDomainMx(domain: string): Promise<'OK' | 'DISPOSABLE_MX' | 'UNREACHABLE'> {
    const now = Date.now();
    const cached = dnsMxCache.get(domain);
    if (cached && cached.expiresAt > now) {
        return cached.status;
    }

    const remember = (status: 'OK' | 'DISPOSABLE_MX' | 'UNREACHABLE') => {
        if (dnsMxCache.size >= DNS_MX_CACHE_MAX_SIZE) {
            const firstKey = dnsMxCache.keys().next().value;
            if (firstKey) dnsMxCache.delete(firstKey);
        }
        dnsMxCache.set(domain, { status, expiresAt: now + DNS_MX_CACHE_TTL_MS });
        return status;
    };

    const checkAddressFallback = async (): Promise<'OK' | 'DISPOSABLE_MX' | 'UNREACHABLE'> => {
        try {
            const addrs = await resolveWithTimeout(dns.promises.resolve4(domain), 1000);
            if (Array.isArray(addrs) && addrs.length > 0) {
                return remember('OK');
            }
            return remember('UNREACHABLE');
        } catch (aErr: any) {
            const aCode = String(aErr?.code || '').toUpperCase();
            if (aCode === 'ENOTFOUND' || aCode === 'ENODATA') {
                return remember('UNREACHABLE');
            }
            return 'OK'; // fail-open on transient DNS issues
        }
    };

    try {
        const records = await resolveWithTimeout(dns.promises.resolveMx(domain), 1500);
        if (Array.isArray(records) && records.length > 0) {
            for (const rec of records) {
                const exchange = String(rec?.exchange || '')
                    .trim()
                    .toLowerCase()
                    .replace(/\.+$/, '');
                if (!exchange) continue;
                if (
                    DISPOSABLE_MX_SUFFIXES.some((suffix) =>
                        matchesDomainOrSubdomain(exchange, suffix),
                    ) ||
                    DISPOSABLE_DOMAIN_HEURISTIC_RE.test(exchange)
                ) {
                    return remember('DISPOSABLE_MX');
                }
            }
            return remember('OK');
        }
        return await checkAddressFallback();
    } catch (err: any) {
        const code = String(err?.code || '').toUpperCase();
        if (code === 'ENOTFOUND') {
            return remember('UNREACHABLE');
        }
        if (code === 'ENODATA') {
            // RFC 5321 allows fallback to A/AAAA if no MX record exists
            return await checkAddressFallback();
        }
        // Fail-open on transient network/DNS timeouts so legitimate users are never locked out
        return 'OK';
    }
}

export async function validateRegistrationEmail(
    rawEmail: string,
    options?: { checkDnsMx?: boolean },
): Promise<EmailValidationResult> {
    const email = String(rawEmail || '').trim().toLowerCase();
    if (!email || email.length > 254 || !BASIC_EMAIL_RE.test(email)) {
        return {
            valid: false,
            reasonCode: 'INVALID_FORMAT',
            messagePt: 'Informe um endereço de e-mail válido.',
            messageEn: 'Please enter a valid email address.',
        };
    }

    const atIdx = email.lastIndexOf('@');
    const domain = email.slice(atIdx + 1).replace(/\.+$/, '');
    const tld = domain.split('.').pop() || '';

    if (
        !domain ||
        domain.startsWith('[') ||
        /^\d{1,3}(\.\d{1,3}){3}$/.test(domain) ||
        RESERVED_INVALID_TLDS.has(tld)
    ) {
        return {
            valid: false,
            reasonCode: 'INVALID_FORMAT',
            messagePt: 'Informe um endereço de e-mail pessoal ou profissional válido.',
            messageEn: 'Please enter a valid personal or work email address.',
        };
    }

    if (isDisposableEmailDomain(domain)) {
        return {
            valid: false,
            reasonCode: 'DISPOSABLE_DOMAIN',
            messagePt:
                'E-mails temporários ou descartáveis não são permitidos. Utilize um e-mail pessoal ou profissional permanente.',
            messageEn:
                'Temporary or disposable email addresses are not allowed. Please use a permanent personal or work email.',
        };
    }

    const shouldCheckDns =
        options?.checkDnsMx !== undefined
            ? options.checkDnsMx
            : process.env.NODE_ENV !== 'test' &&
              process.env.SKIP_EMAIL_DNS_CHECK !== 'true';

    if (shouldCheckDns) {
        const mxStatus = await inspectDomainMx(domain);
        if (mxStatus === 'DISPOSABLE_MX') {
            return {
                valid: false,
                reasonCode: 'DISPOSABLE_MX',
                messagePt:
                    'E-mails temporários ou descartáveis não são permitidos. Utilize um e-mail pessoal ou profissional permanente.',
                messageEn:
                    'Temporary or disposable email addresses are not allowed. Please use a permanent personal or work email.',
            };
        }
        if (mxStatus === 'UNREACHABLE') {
            return {
                valid: false,
                reasonCode: 'UNREACHABLE_DOMAIN',
                messagePt:
                    'O domínio deste e-mail não foi encontrado ou não aceita mensagens. Verifique se digitou corretamente.',
                messageEn:
                    'This email domain could not be found or does not accept mail. Please check for typos.',
            };
        }
    }

    return { valid: true };
}

export async function assertAllowedRegistrationEmail(
    email: string,
    options?: { locale?: SupportedLocale; checkDnsMx?: boolean },
): Promise<void> {
    const res = await validateRegistrationEmail(email, {
        checkDnsMx: options?.checkDnsMx,
    });
    if (!res.valid) {
        const locale = options?.locale === 'en' ? 'en' : 'pt';
        throw new BadRequestException(
            locale === 'en' ? res.messageEn : res.messagePt,
        );
    }
}

// =============================================================================
// STRONG PASSWORD POLICY (Complexity + Anti-Predictable Patterns)
// =============================================================================

const KEYBOARD_DIGIT_SEQUENCES = ['01234567890', '09876543210'];
const ALPHA_SEQUENCE_FWD = 'abcdefghijklmnopqrstuvwxyz';
const ALPHA_SEQUENCE_REV = 'zyxwvutsrqponmlkjihgfedcba';
const KEYBOARD_LETTER_ROWS = [
    'qwertyuiop',
    'poiuytrewq',
    'asdfghjkl',
    'lkjhgfdsa',
    'zxcvbnm',
    'mnbvcxz',
    'qazwsxedc',
    'cdewsxzaq',
    '1qaz2wsx3edc',
];

const IGNORED_NAME_STOPWORDS = new Set([
    'dos',
    'das',
    'del',
    'der',
    'van',
    'von',
    'the',
    'and',
    'for',
    'com',
    'net',
    'org',
    'gmail',
    'hotmail',
    'outlook',
    'yahoo',
    'icloud',
    'live',
    'proton',
    'protonmail',
    'mail',
]);

const WEAK_PASSWORD_SUBSTRINGS = [
    'password',
    'passw0rd',
    'passwd',
    'senha',
    'qwerty',
    'asdfgh',
    'zxcvbn',
    'letmein',
    'iloveyou',
    'welcome',
    'bemvindo',
    'torexjournal',
    'torex',
    '123456',
    '654321',
    'abc123',
    'mudar123',
    'admin123',
    'trading123',
    'forex123',
];

const WEAK_PASSWORD_EXACT_CORES = new Set([
    'admin',
    'administrator',
    'root',
    'guest',
    'user',
    'test',
    'teste',
    'demo',
    'trader',
    'trading',
    'forex',
    'crypto',
    'bitcoin',
    'mudar',
    'trocar',
    'secret',
    'secreto',
    'default',
    'master',
    'access',
    'acesso',
    'dragon',
    'football',
    'futebol',
    'monkey',
    'shadow',
    'superman',
    'batman',
    'brasil',
    'maputo',
    'mocambique',
    'mozambique',
]);

function stripAccentsLower(input: string): string {
    return String(input || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

function decodeLeet(input: string): string {
    return stripAccentsLower(input)
        .replace(/0/g, 'o')
        .replace(/1/g, 'i')
        .replace(/3/g, 'e')
        .replace(/4/g, 'a')
        .replace(/5/g, 's')
        .replace(/7/g, 't')
        .replace(/@/g, 'a')
        .replace(/\$/g, 's')
        .replace(/!/g, 'i');
}

function decodeLeetAlt(input: string): string {
    return stripAccentsLower(input)
        .replace(/0/g, 'o')
        .replace(/1/g, 'l')
        .replace(/3/g, 'e')
        .replace(/4/g, 'a')
        .replace(/5/g, 's')
        .replace(/7/g, 't')
        .replace(/@/g, 'a')
        .replace(/\$/g, 's');
}

function hasSequentialNumbers(password: string): boolean {
    const digitRuns = password.match(/\d{3,}/g);
    if (!digitRuns) return false;

    for (const run of digitRuns) {
        for (let i = 0; i <= run.length - 3; i++) {
            const tri = run.slice(i, i + 3);
            if (KEYBOARD_DIGIT_SEQUENCES.some((seq) => seq.includes(tri))) {
                return true;
            }
        }
    }
    return false;
}

function hasSequentialLettersOrKeyboard(password: string): boolean {
    const lower = stripAccentsLower(password);

    // Check keyboard walks of length >= 4
    for (const row of KEYBOARD_LETTER_ROWS) {
        for (let i = 0; i <= row.length - 4; i++) {
            const chunk = row.slice(i, i + 4);
            if (lower.includes(chunk)) {
                return true;
            }
        }
    }

    // Check alphabetical ascending/descending sequences of length >= 4
    const alphaRuns = lower.match(/[a-z]{4,}/g);
    if (alphaRuns) {
        for (const run of alphaRuns) {
            for (let i = 0; i <= run.length - 4; i++) {
                const quad = run.slice(i, i + 4);
                if (
                    ALPHA_SEQUENCE_FWD.includes(quad) ||
                    ALPHA_SEQUENCE_REV.includes(quad)
                ) {
                    return true;
                }
            }
        }
    }

    return false;
}

function hasRepeatedChars(password: string): boolean {
    return /(.)\1{2,}/i.test(password);
}

function containsPersonalInfo(
    password: string,
    context?: PasswordValidationContext,
): boolean {
    if (!context) return false;

    const normalizedPw = stripAccentsLower(password);
    const leetPw = decodeLeet(password);
    const leetAltPw = decodeLeetAlt(password);

    const candidateTokens = new Set<string>();

    if (context.name) {
        const cleanName = stripAccentsLower(context.name);
        for (const token of cleanName.split(/[^a-z0-9]+/)) {
            if (token.length >= 3 && !IGNORED_NAME_STOPWORDS.has(token)) {
                candidateTokens.add(token);
            }
        }
    }

    if (context.email) {
        const localPart = stripAccentsLower(String(context.email).split('@')[0] || '');
        for (const token of localPart.split(/[^a-z0-9]+/)) {
            if (token.length >= 3 && !IGNORED_NAME_STOPWORDS.has(token)) {
                candidateTokens.add(token);
            }
            const alphaOnly = token.replace(/\d+/g, '');
            if (alphaOnly.length >= 4 && !IGNORED_NAME_STOPWORDS.has(alphaOnly)) {
                candidateTokens.add(alphaOnly);
            }
        }
    }

    for (const token of candidateTokens) {
        if (
            normalizedPw.includes(token) ||
            leetPw.includes(token) ||
            leetAltPw.includes(token)
        ) {
            return true;
        }
    }

    if (context.contact) {
        const contactDigits = String(context.contact).replace(/\D/g, '');
        if (contactDigits.length >= 6) {
            const last4 = contactDigits.slice(-4);
            if (last4.length === 4 && password.includes(last4)) {
                return true;
            }
            // Any 5+ consecutive digits from the phone number
            for (let i = 0; i <= contactDigits.length - 5; i++) {
                const sub = contactDigits.slice(i, i + 5);
                if (password.includes(sub)) {
                    return true;
                }
            }
        }
    }

    return false;
}

function isCommonWeakPassword(password: string): boolean {
    const lower = stripAccentsLower(password);
    const leet = decodeLeet(password);
    const leetAlt = decodeLeetAlt(password);

    for (const bad of WEAK_PASSWORD_SUBSTRINGS) {
        if (lower.includes(bad) || leet.includes(bad) || leetAlt.includes(bad)) {
            return true;
        }
    }

    // Strip non-letters from the leet-decoded forms to catch things like "Admin@2026!" or "Tr@der#92"
    const alphaCoreRaw = lower.replace(/[^a-z]/g, '');
    const alphaCoreLeet = leet.replace(/[^a-z]/g, '');
    const alphaCoreLeetAlt = leetAlt.replace(/[^a-z]/g, '');

    if (
        WEAK_PASSWORD_EXACT_CORES.has(alphaCoreRaw) ||
        WEAK_PASSWORD_EXACT_CORES.has(alphaCoreLeet) ||
        WEAK_PASSWORD_EXACT_CORES.has(alphaCoreLeetAlt)
    ) {
        return true;
    }

    return false;
}

const RULE_MESSAGES: Record<
    keyof PasswordChecks,
    { pt: string; en: string }
> = {
    minLength: {
        pt: 'A senha deve ter no mínimo 8 caracteres.',
        en: 'Password must be at least 8 characters long.',
    },
    maxLength: {
        pt: 'A senha deve ter no máximo 128 caracteres.',
        en: 'Password must be at most 128 characters long.',
    },
    hasLowercase: {
        pt: 'A senha deve incluir pelo menos uma letra minúscula (a-z).',
        en: 'Password must include at least one lowercase letter (a-z).',
    },
    hasUppercase: {
        pt: 'A senha deve incluir pelo menos uma letra maiúscula (A-Z).',
        en: 'Password must include at least one uppercase letter (A-Z).',
    },
    hasNumber: {
        pt: 'A senha deve incluir pelo menos um número (0-9).',
        en: 'Password must include at least one number (0-9).',
    },
    hasSpecial: {
        pt: 'A senha deve incluir pelo menos um caractere especial (ex.: !@#$%&*).',
        en: 'Password must include at least one special character (e.g. !@#$%&*).',
    },
    noSequentialNumbers: {
        pt: 'Evite sequências numéricas previsíveis na senha (ex.: 123, 456, 987).',
        en: 'Avoid predictable number sequences in your password (e.g. 123, 456, 987).',
    },
    noSequentialLettersOrKeyboard: {
        pt: 'Evite sequências de letras ou padrões de teclado na senha (ex.: abcd, qwerty).',
        en: 'Avoid letter sequences or keyboard patterns in your password (e.g. abcd, qwerty).',
    },
    noRepeatedChars: {
        pt: 'Evite repetir o mesmo caractere 3 ou mais vezes seguidas (ex.: aaa, 111).',
        en: 'Avoid repeating the same character 3 or more times in a row (e.g. aaa, 111).',
    },
    noPersonalInfo: {
        pt: 'A senha não pode conter partes do seu nome, e-mail ou telefone.',
        en: 'Password cannot contain parts of your name, email, or phone number.',
    },
    noCommonWeakPassword: {
        pt: 'Esta senha usa um padrão muito comum ou previsível. Escolha uma combinação mais forte.',
        en: 'This password uses a very common or predictable pattern. Please choose a stronger combination.',
    },
};

export function validateStrongPassword(
    rawPassword: string,
    context?: PasswordValidationContext,
): PasswordValidationResult {
    const password = typeof rawPassword === 'string' ? rawPassword : '';

    const checks: PasswordChecks = {
        minLength: password.length >= 8,
        maxLength: password.length <= 128,
        hasLowercase: /[a-z]/.test(password),
        hasUppercase: /[A-Z]/.test(password),
        hasNumber: /[0-9]/.test(password),
        hasSpecial: /[^A-Za-z0-9\s]/.test(password),
        noSequentialNumbers: !hasSequentialNumbers(password),
        noSequentialLettersOrKeyboard: !hasSequentialLettersOrKeyboard(password),
        noRepeatedChars: !hasRepeatedChars(password),
        noPersonalInfo: !containsPersonalInfo(password, context),
        noCommonWeakPassword: !isCommonWeakPassword(password),
    };

    const orderedKeys: Array<keyof PasswordChecks> = [
        'minLength',
        'maxLength',
        'hasUppercase',
        'hasLowercase',
        'hasNumber',
        'hasSpecial',
        'noPersonalInfo',
        'noSequentialNumbers',
        'noSequentialLettersOrKeyboard',
        'noRepeatedChars',
        'noCommonWeakPassword',
    ];

    const failedRule = orderedKeys.find((k) => !checks[k]) ?? null;
    const valid = failedRule === null;

    let score: 0 | 1 | 2 | 3 | 4 = 0;
    if (password.length > 0) {
        const classCount =
            Number(checks.hasLowercase) +
            Number(checks.hasUppercase) +
            Number(checks.hasNumber) +
            Number(checks.hasSpecial);
        const patternsClean =
            checks.noSequentialNumbers &&
            checks.noSequentialLettersOrKeyboard &&
            checks.noRepeatedChars &&
            checks.noPersonalInfo &&
            checks.noCommonWeakPassword;

        if (valid && password.length >= 12) {
            score = 4;
        } else if (valid) {
            score = 3;
        } else if (checks.minLength && classCount >= 3 && patternsClean) {
            score = 2;
        } else {
            score = 1;
        }
    }

    return {
        valid,
        score,
        checks,
        failedRule,
        messagePt: failedRule ? RULE_MESSAGES[failedRule].pt : null,
        messageEn: failedRule ? RULE_MESSAGES[failedRule].en : null,
    };
}

export function assertStrongPassword(
    password: string,
    context?: PasswordValidationContext,
    locale: SupportedLocale = 'pt',
): void {
    const result = validateStrongPassword(password, context);
    if (!result.valid) {
        throw new BadRequestException(
            locale === 'en'
                ? result.messageEn || 'Password does not meet security requirements.'
                : result.messagePt || 'A senha não cumpre os requisitos mínimos de segurança.',
        );
    }
}
