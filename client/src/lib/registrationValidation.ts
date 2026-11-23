import { EMAIL_RE, MIN_PASSWORD_LENGTH } from './authErrors';

export interface ClientPasswordContext {
    name?: string;
    email?: string;
    contact?: string;
}

export interface ClientPasswordEvaluation {
    valid: boolean;
    score: 0 | 1 | 2 | 3 | 4;
    checks: {
        minLength: boolean;
        hasUpperAndLower: boolean;
        hasUppercase: boolean;
        hasLowercase: boolean;
        hasNumber: boolean;
        hasSpecial: boolean;
        noPredictablePatterns: boolean;
        noSequentialNumbers: boolean;
        noSequentialLettersOrKeyboard: boolean;
        noRepeatedChars: boolean;
        noPersonalInfo: boolean;
        noCommonWeakPassword: boolean;
    };
    errorPt: string | null;
    errorEn: string | null;
}

const DISPOSABLE_EMAIL_DOMAINS = new Set([
    'temp-mail.org',
    'temp-mail.io',
    'temp-mail.ru',
    'temp-mail.de',
    'temp-mails.com',
    'tempmail.com',
    'tempmail.net',
    'tempmail.org',
    'tempmail.eu',
    'tempmail.plus',
    'tempmail.ninja',
    'tempmailo.com',
    'tempmailaddress.com',
    'tempail.com',
    'tempinbox.com',
    'tmpmail.org',
    'tmpmail.net',
    'tmpmail.dev',
    'tmailor.com',
    'tmail.ws',
    'tmail.gg',
    'tmail.io',
    'tempr.email',
    'mytemp.email',
    'temporarioemail.com.br',
    'emailtemporario.com.br',
    'emailtemporaria.com.br',
    'correiotemporario.com.br',
    'descartavel.com',
    '10minutemail.com',
    '10minutemail.net',
    '10minutemail.org',
    '10minutemail.de',
    '10minutemail.co.za',
    '10minutemail.co.uk',
    '10mail.org',
    '20minutemail.com',
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
    'yopmail.com',
    'yopmail.fr',
    'yopmail.net',
    'jetable.org',
    'mailinator.com',
    'mailinator.net',
    'mailinator.org',
    'mailinator2.com',
    'mailin8r.com',
    'mailnator.com',
    'notmailinator.com',
    'trashmail.com',
    'trashmail.net',
    'trashmail.org',
    'trashmail.de',
    'trashmail.me',
    'trash-mail.com',
    'trashemail.de',
    'wegwerfmail.de',
    'discard.email',
    'discardmail.com',
    'maildrop.cc',
    'dispostable.com',
    'disposablemail.com',
    'getnada.com',
    'nada.email',
    'mohmal.com',
    'mohmal.im',
    'mohmal.in',
    'fakemail.net',
    'fakemail.io',
    'fakemailgenerator.com',
    'fakeinbox.com',
    'emailfake.com',
    'generator.email',
    'emailondeck.com',
    'throwawaymail.com',
    'throwawayemailaddress.com',
    'burnermail.io',
    'mail.tm',
    'mail.gw',
    'dropmail.me',
    'moakt.com',
    'moakt.cc',
    'moakt.ws',
    '1secmail.com',
    '1secmail.org',
    '1secmail.net',
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
    'inboxes.com',
    'crazymailing.com',
    'mailslurp.com',
    'ethereal.email',
    'mailtrap.io',
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
    'spamgourmet.com',
    'spambox.us',
    'spambog.com',
    'meltmail.com',
    'one-time.email',
]);

const DISPOSABLE_DOMAIN_HEURISTIC_RE =
    /(^|[.-])(tempmail|temp-mail|tmpmail|10minutemail|20minutemail|guerrillamail|mailinator|yopmail|trashmail|trash-mail|throwaway|burnermail|disposable|fakemail|fakeinbox|emailtemporario|temporarioemail|correiotemporario|wegwerf|maildrop|getnada|mohmal|1secmail|tmailor|dropmail|inboxkitten|mailslurp|mailsac|sharklasers|mailnesia|dispostable|harakirimail|mailpoof)([.-]|$)/i;

const RESERVED_TLDS = new Set([
    'localhost',
    'local',
    'localdomain',
    'invalid',
    'test',
    'example',
]);

export function isDisposableEmailClient(rawEmail: string): boolean {
    const email = String(rawEmail || '').trim().toLowerCase();
    const atIdx = email.lastIndexOf('@');
    if (atIdx < 1) return false;

    const domain = email.slice(atIdx + 1).replace(/\.+$/, '');
    if (!domain) return false;

    if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) return true;

    const labels = domain.split('.');
    for (let i = 1; i < labels.length - 1; i++) {
        if (DISPOSABLE_EMAIL_DOMAINS.has(labels.slice(i).join('.'))) {
            return true;
        }
    }

    return DISPOSABLE_DOMAIN_HEURISTIC_RE.test(domain);
}

export function validateRegistrationEmailClient(
    rawEmail: string,
    locale: 'pt' | 'en' = 'pt',
): string | null {
    const email = String(rawEmail || '').trim().toLowerCase();
    const isEn = locale === 'en';

    if (!EMAIL_RE.test(email)) {
        return isEn ? 'Enter a valid email address.' : 'Informe um e-mail válido.';
    }

    const domain = email.slice(email.lastIndexOf('@') + 1).replace(/\.+$/, '');
    const tld = domain.split('.').pop() || '';
    if (RESERVED_TLDS.has(tld) || /^\d{1,3}(\.\d{1,3}){3}$/.test(domain)) {
        return isEn
            ? 'Enter a valid personal or work email address.'
            : 'Informe um e-mail pessoal ou profissional válido.';
    }

    if (isDisposableEmailClient(email)) {
        return isEn
            ? 'Temporary or disposable emails are not allowed. Use a permanent email address.'
            : 'E-mails temporários ou descartáveis não são permitidos. Utilize um e-mail permanente.';
    }

    return null;
}

const KEYBOARD_DIGIT_SEQUENCES = ['01234567890', '09876543210'];
const ALPHA_FWD = 'abcdefghijklmnopqrstuvwxyz';
const ALPHA_REV = 'zyxwvutsrqponmlkjihgfedcba';
const KEYBOARD_ROWS = [
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

const IGNORED_STOPWORDS = new Set([
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

const WEAK_SUBSTRINGS = [
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

const WEAK_CORES = new Set([
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

function hasSequentialNumbers(pw: string): boolean {
    const runs = pw.match(/\d{3,}/g);
    if (!runs) return false;
    for (const run of runs) {
        for (let i = 0; i <= run.length - 3; i++) {
            const tri = run.slice(i, i + 3);
            if (KEYBOARD_DIGIT_SEQUENCES.some((seq) => seq.includes(tri))) {
                return true;
            }
        }
    }
    return false;
}

function hasSequentialLettersOrKeyboard(pw: string): boolean {
    const lower = stripAccentsLower(pw);
    for (const row of KEYBOARD_ROWS) {
        for (let i = 0; i <= row.length - 4; i++) {
            if (lower.includes(row.slice(i, i + 4))) return true;
        }
    }
    const alphaRuns = lower.match(/[a-z]{4,}/g);
    if (alphaRuns) {
        for (const run of alphaRuns) {
            for (let i = 0; i <= run.length - 4; i++) {
                const quad = run.slice(i, i + 4);
                if (ALPHA_FWD.includes(quad) || ALPHA_REV.includes(quad)) return true;
            }
        }
    }
    return false;
}

function containsPersonalInfo(pw: string, context?: ClientPasswordContext): boolean {
    if (!context) return false;
    const norm = stripAccentsLower(pw);
    const leet = decodeLeet(pw);
    const leetAlt = decodeLeetAlt(pw);

    const tokens = new Set<string>();
    if (context.name) {
        for (const t of stripAccentsLower(context.name).split(/[^a-z0-9]+/)) {
            if (t.length >= 3 && !IGNORED_STOPWORDS.has(t)) tokens.add(t);
        }
    }
    if (context.email) {
        const local = stripAccentsLower(context.email.split('@')[0] || '');
        for (const t of local.split(/[^a-z0-9]+/)) {
            if (t.length >= 3 && !IGNORED_STOPWORDS.has(t)) tokens.add(t);
            const alpha = t.replace(/\d+/g, '');
            if (alpha.length >= 4 && !IGNORED_STOPWORDS.has(alpha)) tokens.add(alpha);
        }
    }

    for (const token of tokens) {
        if (norm.includes(token) || leet.includes(token) || leetAlt.includes(token)) {
            return true;
        }
    }

    if (context.contact) {
        const digits = context.contact.replace(/\D/g, '');
        if (digits.length >= 6) {
            const last4 = digits.slice(-4);
            if (last4.length === 4 && pw.includes(last4)) return true;
            for (let i = 0; i <= digits.length - 5; i++) {
                if (pw.includes(digits.slice(i, i + 5))) return true;
            }
        }
    }

    return false;
}

function isCommonWeak(pw: string): boolean {
    const lower = stripAccentsLower(pw);
    const leet = decodeLeet(pw);
    const leetAlt = decodeLeetAlt(pw);

    if (
        WEAK_SUBSTRINGS.some(
            (w) => lower.includes(w) || leet.includes(w) || leetAlt.includes(w),
        )
    ) {
        return true;
    }

    return (
        WEAK_CORES.has(lower.replace(/[^a-z]/g, '')) ||
        WEAK_CORES.has(leet.replace(/[^a-z]/g, '')) ||
        WEAK_CORES.has(leetAlt.replace(/[^a-z]/g, ''))
    );
}

export function evaluatePasswordStrength(
    password: string,
    context?: ClientPasswordContext,
): ClientPasswordEvaluation {
    const pw = typeof password === 'string' ? password : '';

    const minLength = pw.length >= MIN_PASSWORD_LENGTH;
    const hasLowercase = /[a-z]/.test(pw);
    const hasUppercase = /[A-Z]/.test(pw);
    const hasUpperAndLower = hasLowercase && hasUppercase;
    const hasNumber = /[0-9]/.test(pw);
    const hasSpecial = /[^A-Za-z0-9\s]/.test(pw);
    const noSequentialNumbers = !hasSequentialNumbers(pw);
    const noSequentialLettersOrKeyboard = !hasSequentialLettersOrKeyboard(pw);
    const noRepeatedChars = !/(.)\1{2,}/i.test(pw);
    const noPersonalInfo = !containsPersonalInfo(pw, context);
    const noCommonWeakPassword = !isCommonWeak(pw);

    const noPredictablePatterns =
        noSequentialNumbers &&
        noSequentialLettersOrKeyboard &&
        noRepeatedChars &&
        noPersonalInfo &&
        noCommonWeakPassword;

    let errorPt: string | null = null;
    let errorEn: string | null = null;

    if (!minLength) {
        errorPt = `A senha deve ter no mínimo ${MIN_PASSWORD_LENGTH} caracteres.`;
        errorEn = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    } else if (pw.length > 128) {
        errorPt = 'A senha deve ter no máximo 128 caracteres.';
        errorEn = 'Password must be at most 128 characters.';
    } else if (!hasUppercase) {
        errorPt = 'Inclua pelo menos uma letra maiúscula (A-Z).';
        errorEn = 'Include at least one uppercase letter (A-Z).';
    } else if (!hasLowercase) {
        errorPt = 'Inclua pelo menos uma letra minúscula (a-z).';
        errorEn = 'Include at least one lowercase letter (a-z).';
    } else if (!hasNumber) {
        errorPt = 'Inclua pelo menos um número (0-9).';
        errorEn = 'Include at least one number (0-9).';
    } else if (!hasSpecial) {
        errorPt = 'Inclua pelo menos um caractere especial (ex.: !@#$%&*).';
        errorEn = 'Include at least one special character (e.g. !@#$%&*).';
    } else if (!noPersonalInfo) {
        errorPt = 'A senha não pode conter partes do seu nome, e-mail ou telefone.';
        errorEn = 'Password cannot contain parts of your name, email, or phone number.';
    } else if (!noSequentialNumbers) {
        errorPt = 'Evite sequências numéricas previsíveis (ex.: 123, 456, 987).';
        errorEn = 'Avoid predictable number sequences (e.g. 123, 456, 987).';
    } else if (!noSequentialLettersOrKeyboard) {
        errorPt = 'Evite sequências de letras ou padrões de teclado (ex.: abcd, qwerty).';
        errorEn = 'Avoid letter sequences or keyboard patterns (e.g. abcd, qwerty).';
    } else if (!noRepeatedChars) {
        errorPt = 'Evite repetir o mesmo caractere 3 ou mais vezes seguidas (ex.: aaa, 111).';
        errorEn = 'Avoid repeating the same character 3 or more times in a row (e.g. aaa, 111).';
    } else if (!noCommonWeakPassword) {
        errorPt = 'Esta senha é muito comum ou previsível. Escolha uma combinação mais forte.';
        errorEn = 'This password is too common or predictable. Choose a stronger combination.';
    }

    const valid = errorPt === null;
    let score: 0 | 1 | 2 | 3 | 4 = 0;
    if (pw.length > 0) {
        const classCount =
            Number(hasLowercase) +
            Number(hasUppercase) +
            Number(hasNumber) +
            Number(hasSpecial);
        if (valid && pw.length >= 12) {
            score = 4;
        } else if (valid) {
            score = 3;
        } else if (minLength && classCount >= 3 && noPredictablePatterns) {
            score = 2;
        } else {
            score = 1;
        }
    }

    return {
        valid,
        score,
        checks: {
            minLength,
            hasUpperAndLower,
            hasUppercase,
            hasLowercase,
            hasNumber,
            hasSpecial,
            noPredictablePatterns,
            noSequentialNumbers,
            noSequentialLettersOrKeyboard,
            noRepeatedChars,
            noPersonalInfo,
            noCommonWeakPassword,
        },
        errorPt,
        errorEn,
    };
}
