import { HttpStatus } from '@nestjs/common';
import { randomBytes } from 'crypto';

export const SUPPORT_EMAIL = 'info@torexjournal.com';

export type ErrorDomainCode =
    | 'REG'
    | 'AUTH'
    | 'PAY'
    | 'MT5'
    | 'DRV'
    | 'IMP'
    | 'MKT'
    | 'AI'
    | 'APP'
    | 'NET'
    | 'NTF'
    | 'ADM'
    | 'SYS';

interface DomainErrorConfig {
    code: ErrorDomainCode;
    labelPt: string;
    buildServerMessage: (ref: string) => string;
    buildClientLeakFallback: (ref: string) => string;
}

const DOMAIN_CONFIGS: Record<ErrorDomainCode, DomainErrorConfig> = {
    REG: {
        code: 'REG',
        labelPt: 'Registo',
        buildServerMessage: (ref) =>
            `Erro no registo. Por favor, tente novamente ou contacte o suporte em ${SUPPORT_EMAIL} informando a referência ${ref}.`,
        buildClientLeakFallback: (ref) =>
            `Não foi possível validar os dados do registo. Revise as informações ou contacte o suporte em ${SUPPORT_EMAIL} (Ref.: ${ref}).`,
    },
    AUTH: {
        code: 'AUTH',
        labelPt: 'Autenticação',
        buildServerMessage: (ref) =>
            `Não foi possível concluir a autenticação neste momento. Contacte o suporte em ${SUPPORT_EMAIL} informando a referência ${ref}.`,
        buildClientLeakFallback: (ref) =>
            `Não foi possível validar o seu pedido de acesso. Tente novamente ou contacte o suporte em ${SUPPORT_EMAIL} (Ref.: ${ref}).`,
    },
    PAY: {
        code: 'PAY',
        labelPt: 'Pagamentos & Subscrição',
        buildServerMessage: (ref) =>
            `Não foi possível processar o pagamento ou a subscrição neste momento. Contacte o suporte em ${SUPPORT_EMAIL} informando a referência ${ref}.`,
        buildClientLeakFallback: (ref) =>
            `Não foi possível validar os dados de pagamento. Verifique as informações ou contacte o suporte em ${SUPPORT_EMAIL} (Ref.: ${ref}).`,
    },
    MT5: {
        code: 'MT5',
        labelPt: 'Sincronização MT5',
        buildServerMessage: (ref) =>
            `Não foi possível concluir a sincronização da sua conta neste momento. Contacte o suporte em ${SUPPORT_EMAIL} informando a referência ${ref}.`,
        buildClientLeakFallback: (ref) =>
            `Não foi possível validar os dados da ligação da conta. Verifique as informações ou contacte o suporte em ${SUPPORT_EMAIL} (Ref.: ${ref}).`,
    },
    DRV: {
        code: 'DRV',
        labelPt: 'Integração Deriv',
        buildServerMessage: (ref) =>
            `Não foi possível concluir a sincronização da integração neste momento. Contacte o suporte em ${SUPPORT_EMAIL} informando a referência ${ref}.`,
        buildClientLeakFallback: (ref) =>
            `Não foi possível validar os dados da integração. Tente novamente ou contacte o suporte em ${SUPPORT_EMAIL} (Ref.: ${ref}).`,
    },
    IMP: {
        code: 'IMP',
        labelPt: 'Importação de Dados',
        buildServerMessage: (ref) =>
            `Não foi possível processar o arquivo enviado neste momento. Contacte o suporte em ${SUPPORT_EMAIL} informando a referência ${ref}.`,
        buildClientLeakFallback: (ref) =>
            `Não foi possível ler o arquivo enviado. Confirme se está no formato suportado ou contacte o suporte em ${SUPPORT_EMAIL} (Ref.: ${ref}).`,
    },
    MKT: {
        code: 'MKT',
        labelPt: 'Dados de Mercado',
        buildServerMessage: (ref) =>
            `Os dados de mercado estão temporariamente indisponíveis. Tente novamente em instantes ou contacte o suporte em ${SUPPORT_EMAIL} informando a referência ${ref}.`,
        buildClientLeakFallback: (ref) =>
            `Não foi possível consultar os dados de mercado solicitados. Tente novamente ou contacte o suporte em ${SUPPORT_EMAIL} (Ref.: ${ref}).`,
    },
    AI: {
        code: 'AI',
        labelPt: 'Assistente Torex AI',
        buildServerMessage: (ref) =>
            `Não foi possível processar o seu pedido neste momento. Contacte o suporte em ${SUPPORT_EMAIL} informando a referência ${ref}.`,
        buildClientLeakFallback: (ref) =>
            `Não foi possível concluir a análise solicitada. Tente novamente ou contacte o suporte em ${SUPPORT_EMAIL} (Ref.: ${ref}).`,
    },
    APP: {
        code: 'APP',
        labelPt: 'Conta & Dashboard',
        buildServerMessage: (ref) =>
            `Não foi possível concluir a operação na sua conta neste momento. Contacte o suporte em ${SUPPORT_EMAIL} informando a referência ${ref}.`,
        buildClientLeakFallback: (ref) =>
            `Os dados enviados não puderam ser processados. Verifique os campos ou contacte o suporte em ${SUPPORT_EMAIL} (Ref.: ${ref}).`,
    },
    NET: {
        code: 'NET',
        labelPt: 'Comunidade',
        buildServerMessage: (ref) =>
            `Não foi possível concluir esta ação na comunidade neste momento. Contacte o suporte em ${SUPPORT_EMAIL} informando a referência ${ref}.`,
        buildClientLeakFallback: (ref) =>
            `Não foi possível validar o conteúdo enviado. Tente novamente ou contacte o suporte em ${SUPPORT_EMAIL} (Ref.: ${ref}).`,
    },
    NTF: {
        code: 'NTF',
        labelPt: 'Notificações',
        buildServerMessage: (ref) =>
            `Não foi possível atualizar as suas notificações neste momento. Contacte o suporte em ${SUPPORT_EMAIL} informando a referência ${ref}.`,
        buildClientLeakFallback: (ref) =>
            `Não foi possível processar as preferências de notificação. Tente novamente ou contacte o suporte em ${SUPPORT_EMAIL} (Ref.: ${ref}).`,
    },
    ADM: {
        code: 'ADM',
        labelPt: 'Administração',
        buildServerMessage: (ref) =>
            `Não foi possível concluir a operação administrativa neste momento (Ref.: ${ref}).`,
        buildClientLeakFallback: (ref) =>
            `Os dados informados não puderam ser processados (Ref.: ${ref}).`,
    },
    SYS: {
        code: 'SYS',
        labelPt: 'Sistema',
        buildServerMessage: (ref) =>
            `Ocorreu um erro inesperado. Por favor, tente novamente ou contacte o suporte em ${SUPPORT_EMAIL} informando a referência ${ref}.`,
        buildClientLeakFallback: (ref) =>
            `Não foi possível concluir a sua solicitação. Verifique os dados ou contacte o suporte em ${SUPPORT_EMAIL} (Ref.: ${ref}).`,
    },
};

export function resolveErrorDomain(path: string): DomainErrorConfig {
    const p = String(path || '').toLowerCase();
    if (p.startsWith('/api/auth/register') || p.startsWith('/api/auth/send-otp')) {
        return DOMAIN_CONFIGS.REG;
    }
    if (p.startsWith('/api/auth')) {
        return DOMAIN_CONFIGS.AUTH;
    }
    if (
        p.startsWith('/api/subscription') ||
        p.startsWith('/api/payment') ||
        p.startsWith('/api/webhook')
    ) {
        return DOMAIN_CONFIGS.PAY;
    }
    if (p.startsWith('/api/mt5') || p.startsWith('/api/v1/mt5-worker')) {
        return DOMAIN_CONFIGS.MT5;
    }
    if (p.startsWith('/api/integrations/deriv')) {
        return DOMAIN_CONFIGS.DRV;
    }
    if (p.startsWith('/api/import') || p.startsWith('/api/market-data/upload')) {
        return DOMAIN_CONFIGS.IMP;
    }
    if (
        p.startsWith('/api/tradingview') ||
        p.startsWith('/api/market-data') ||
        p.startsWith('/api/economic-calendar')
    ) {
        return DOMAIN_CONFIGS.MKT;
    }
    if (p.startsWith('/api/ai')) {
        return DOMAIN_CONFIGS.AI;
    }
    if (
        p.startsWith('/api/dashboard') ||
        p.startsWith('/api/account') ||
        p.startsWith('/api/referrals')
    ) {
        return DOMAIN_CONFIGS.APP;
    }
    if (p.startsWith('/api/network') || p.startsWith('/api/leaderboard')) {
        return DOMAIN_CONFIGS.NET;
    }
    if (p.startsWith('/api/notifications') || p.startsWith('/api/alerts')) {
        return DOMAIN_CONFIGS.NTF;
    }
    if (p.startsWith('/api/admin')) {
        return DOMAIN_CONFIGS.ADM;
    }
    return DOMAIN_CONFIGS.SYS;
}

export function buildErrorReference(path: string, correlationId?: string): string {
    const domain = resolveErrorDomain(path);
    const cleanedCid = String(correlationId || '')
        .replace(/[^a-zA-Z0-9]/g, '')
        .toUpperCase()
        .slice(0, 8);
    const suffix =
        cleanedCid.length >= 6
            ? cleanedCid
            : randomBytes(4).toString('hex').toUpperCase();
    return `TRX-${domain.code}-${suffix}`;
}

/**
 * Detects technical stack traces, DB/ORM errors, infrastructure names, third-party
 * providers, file paths, or raw validation jargon that must NEVER leak to end users.
 */
const TECHNICAL_LEAK_PATTERNS: RegExp[] = [
    // Database / ORM / SQL
    /\b(QueryFailedError|EntityNotFoundError|TypeORMError|TypeORM|Prisma|PostgreSQL|Postgres|ClickHouse|pg_catalog)\b/i,
    /\b(invalid input syntax|duplicate key value|violates (foreign key|unique|not-null|check) constraint|syntax error at or near)\b/i,
    /\b(relation|column|constraint|table)\s+"[^"]+"/i,
    /\bcode=(22|23|42|08|53|57)[A-Z0-9]{3}\b/i,
    /\bfor type uuid\b/i,
    /\bSELECT\s+.+\s+FROM\b|\bINSERT\s+INTO\b|\bUPDATE\s+\w+\s+SET\b/i,

    // JS / Node / Runtime / File Paths
    /\b(TypeError|ReferenceError|RangeError|SyntaxError|AggregateError|EvalError|URIError)\b/,
    /\b(Cannot read propert|is not a function|is not defined|undefined is not|null is not|Maximum call stack)\b/i,
    /\b(ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|ENOENT|EACCES|EADDRINUSE|ERR_[A-Z_]+)\b/,
    /\b(Multipart parsing failed|Failed to parse|socket hang up|Unexpected token|JSON at position)\b/i,
    /(\/var\/www\/|\/home\/|node_modules\/|dist\/[a-z0-9_-]+\/|src\/[a-z0-9_-]+\/|[A-Z]:\\[^ ]+\\)/i,
    /\bat\s+(async\s+)?[A-Za-z0-9_$.]+\s+\([^)]+:\d+:\d+\)/,

    // Internal Infrastructure / Providers / Secrets / Business Logic Internals
    /\b(Redis|ioredis|BullMQ|RabbitMQ|SMTP|nodemailer|Fastify|NestJS|Socket\.IO|Workbox)\b/i,
    /\b(Mt5WorkerService|Mt5InstanceService|AiLlmProviderService|FastifyFileInterceptor|AdminAuthGuard|PlanGuard)\b/i,
    /\b(Gemini|Qwen|OpenAI|TradingView|models\/gemini|aistudio\.google\.com|Interactions API)\b/i,
    /\b(HTTP\s+[45]\d{2}|status code\s+[45]\d{2})\b/i,
    /\b(X-Worker-Key|JWT_SECRET|ADMIN_JWT_SECRET|WORKER_KEY|DATABASE_URL|REDIS_PASSWORD|\.env)\b/i,
    /\b(exchangeRate|leaseEpoch|assignedWorkerId|mt5EncryptedPass|credit_reset|74\s*MZN)\b/i,

    // Raw English class-validator internal field leakage
    /\bproperty\s+[a-zA-Z0-9_.]+\s+should not exist\b/i,
    /\b[a-zA-Z0-9_.]+\s+must be (a|an)\s+(uuid|string|number|boolean|object|array|email|integer|ISO 8601)\b/i,
    /\b[a-zA-Z0-9_.]+\s+should not be empty\b/i,
    /\b(Cannot (GET|POST|PUT|PATCH|DELETE)\s+\/)/i,
];

export function containsTechnicalLeak(message: string): boolean {
    const text = String(message || '').trim();
    if (!text) return false;
    return TECHNICAL_LEAK_PATTERNS.some((rx) => rx.test(text));
}

/**
 * Redacts credentials, JWTs, API keys, and sensitive tokens before storing
 * technical diagnostics in Admin logs/database.
 */
export function redactSensitiveMetadata(input: string, maxLength = 2000): string {
    const text = String(input || '')
        .replace(/(Bearer\s+)[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/gi, '$1[REDACTED_JWT]')
        .replace(/eyJ[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}/g, '[REDACTED_JWT]')
        .replace(
            /((?:password|pass|secret|token|api[_-]?key|worker[_-]?key|authorization|cookie)\s*[:=]\s*["']?)([^\s"',;}\]]+)/gi,
            '$1[REDACTED]',
        );
    return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

export function getStandardHttpErrorLabel(status: number): string {
    switch (status) {
        case HttpStatus.BAD_REQUEST:
            return 'Bad Request';
        case HttpStatus.UNAUTHORIZED:
            return 'Unauthorized';
        case HttpStatus.FORBIDDEN:
            return 'Forbidden';
        case HttpStatus.NOT_FOUND:
            return 'Not Found';
        case HttpStatus.METHOD_NOT_ALLOWED:
            return 'Method Not Allowed';
        case HttpStatus.CONFLICT:
            return 'Conflict';
        case HttpStatus.PAYLOAD_TOO_LARGE:
            return 'Payload Too Large';
        case HttpStatus.UNPROCESSABLE_ENTITY:
            return 'Unprocessable Entity';
        case HttpStatus.TOO_MANY_REQUESTS:
            return 'Too Many Requests';
        case HttpStatus.BAD_GATEWAY:
            return 'Bad Gateway';
        case HttpStatus.SERVICE_UNAVAILABLE:
            return 'Service Unavailable';
        case HttpStatus.GATEWAY_TIMEOUT:
            return 'Gateway Timeout';
        default:
            return status >= 500 ? 'Internal Server Error' : 'Request Error';
    }
}

export interface SanitizePublicErrorInput {
    status: number;
    rawMessage: string;
    path: string;
    correlationId?: string;
}

export interface SanitizedPublicErrorResult {
    errorRef: string;
    domainCode: ErrorDomainCode;
    domainLabel: string;
    publicMessage: string;
    publicError: string;
    wasSanitized: boolean;
}

export function sanitizePublicErrorResponse(
    input: SanitizePublicErrorInput,
): SanitizedPublicErrorResult {
    const domain = resolveErrorDomain(input.path);
    const errorRef = buildErrorReference(input.path, input.correlationId);
    const publicError = getStandardHttpErrorLabel(input.status);
    const trimmedRaw = String(input.rawMessage || '').trim();

    // All 5xx errors MUST always be sanitized — never expose internals
    if (input.status >= 500) {
        return {
            errorRef,
            domainCode: domain.code,
            domainLabel: domain.labelPt,
            publicMessage: domain.buildServerMessage(errorRef),
            publicError,
            wasSanitized: true,
        };
    }

    // 4xx errors: inspect for accidental technical / architecture / business-logic leaks
    const leaked = !trimmedRaw || containsTechnicalLeak(trimmedRaw);
    if (leaked) {
        let fallbackMsg: string;
        switch (input.status) {
            case HttpStatus.UNAUTHORIZED:
                fallbackMsg = `A sua sessão expirou ou as credenciais são inválidas. Inicie sessão novamente (Ref.: ${errorRef}).`;
                break;
            case HttpStatus.FORBIDDEN:
                fallbackMsg = `Não tem permissão para aceder a este recurso. Caso acredite ser um engano, contacte ${SUPPORT_EMAIL} (Ref.: ${errorRef}).`;
                break;
            case HttpStatus.NOT_FOUND:
                fallbackMsg = `O recurso solicitado não foi encontrado (Ref.: ${errorRef}).`;
                break;
            case HttpStatus.TOO_MANY_REQUESTS:
                fallbackMsg = `Muitas tentativas num curto espaço de tempo. Aguarde alguns instantes e tente novamente (Ref.: ${errorRef}).`;
                break;
            case HttpStatus.CONFLICT:
                fallbackMsg = `Já existe um registo conflitante para esta operação. Caso precise de ajuda, contacte ${SUPPORT_EMAIL} (Ref.: ${errorRef}).`;
                break;
            default:
                fallbackMsg = domain.buildClientLeakFallback(errorRef);
                break;
        }
        return {
            errorRef,
            domainCode: domain.code,
            domainLabel: domain.labelPt,
            publicMessage: fallbackMsg,
            publicError,
            wasSanitized: true,
        };
    }

    // Safe, intentional user-facing 4xx message (e.g. validation, wrong OTP, weak password, disposable email)
    return {
        errorRef,
        domainCode: domain.code,
        domainLabel: domain.labelPt,
        publicMessage: trimmedRaw,
        publicError,
        wasSanitized: false,
    };
}
