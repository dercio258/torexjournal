export interface RedisErrorDiagnosis {
    category: string;
    isNoGroup: boolean;
    explanation: string;
    technicalSummary: string;
}

/**
 * Extracts a complete, human-readable summary from any JS/Node/Redis/TypeORM error,
 * including Node 20+ AggregateError (where err.message is often empty), network codes,
 * ioredis ReplyError command metadata, and Postgres/TypeORM details.
 */
export function formatErrorDetails(err: unknown): string {
    if (err === null || err === undefined) {
        return 'Erro desconhecido (valor nulo/indefinido)';
    }
    if (typeof err === 'string') {
        return err || 'Erro vazio';
    }
    if (typeof err !== 'object') {
        return String(err);
    }

    const e = err as Record<string, any>;
    const name = typeof e.name === 'string' && e.name !== 'Error' ? e.name : '';
    const code = typeof e.code === 'string' || typeof e.code === 'number' ? String(e.code) : '';

    let baseMsg = typeof e.message === 'string' ? e.message.trim() : '';

    // Node 20+ AggregateError often has an empty .message and stores real causes in .errors[]
    if (Array.isArray(e.errors) && e.errors.length > 0) {
        const subMessages = Array.from(
            new Set(
                e.errors
                    .map((sub: any) => {
                        if (!sub) return '';
                        const subMsg = typeof sub.message === 'string' ? sub.message.trim() : String(sub);
                        const subCode = sub.code ? String(sub.code) : '';
                        const addr =
                            sub.address && sub.port
                                ? `${sub.address}:${sub.port}`
                                : sub.address || '';
                        const parts = [subMsg || subCode || 'SubError'];
                        if (subCode && !parts[0].includes(subCode)) parts.push(`code=${subCode}`);
                        if (addr && !parts[0].includes(addr)) parts.push(`addr=${addr}`);
                        return parts.join(' ');
                    })
                    .filter(Boolean),
            ),
        );
        if (subMessages.length > 0) {
            const joined = subMessages.join(' | ');
            baseMsg = baseMsg ? `${baseMsg} (${joined})` : joined;
        }
    }

    if (!baseMsg) {
        try {
            baseMsg = JSON.stringify(err);
        } catch {
            baseMsg = String(err);
        }
    }

    const metaParts: string[] = [];

    if (code && !baseMsg.includes(code)) {
        metaParts.push(`code=${code}`);
    }
    if (e.syscall && typeof e.syscall === 'string' && !baseMsg.includes(e.syscall)) {
        metaParts.push(`syscall=${e.syscall}`);
    }
    if (e.address && typeof e.address === 'string') {
        const endpoint = e.port ? `${e.address}:${e.port}` : e.address;
        if (!baseMsg.includes(endpoint)) {
            metaParts.push(`target=${endpoint}`);
        }
    }

    // ioredis ReplyError attaches the failed Redis command & arguments
    if (e.command && typeof e.command === 'object' && typeof e.command.name === 'string') {
        const cmdName = e.command.name.toUpperCase();
        if (cmdName === 'AUTH') {
            metaParts.push('redisCmd=AUTH');
        } else {
            const rawArgs = Array.isArray(e.command.args) ? e.command.args.slice(0, 5) : [];
            const safeArgs = rawArgs
                .map((a: unknown) => {
                    const s = String(a ?? '');
                    return s.length > 48 ? `${s.slice(0, 45)}...` : s;
                })
                .join(', ');
            metaParts.push(safeArgs ? `redisCmd=${cmdName}(${safeArgs})` : `redisCmd=${cmdName}`);
        }
    }

    // PostgreSQL / TypeORM QueryFailedError fields
    if (typeof e.table === 'string') metaParts.push(`table=${e.table}`);
    if (typeof e.column === 'string') metaParts.push(`column=${e.column}`);
    if (typeof e.constraint === 'string') metaParts.push(`constraint=${e.constraint}`);
    if (typeof e.detail === 'string' && e.detail.trim()) metaParts.push(`detail=${e.detail.trim()}`);
    if (typeof e.hint === 'string' && e.hint.trim()) metaParts.push(`hint=${e.hint.trim()}`);

    if (e.cause) {
        const causeSummary = formatErrorDetails(e.cause);
        if (causeSummary && !baseMsg.includes(causeSummary)) {
            metaParts.push(`cause=${causeSummary}`);
        }
    }

    const prefix = name && !baseMsg.startsWith(name) ? `${name}: ` : '';
    const suffix = metaParts.length > 0 ? ` [${metaParts.join(' | ')}]` : '';
    return `${prefix}${baseMsg}${suffix}`;
}

/**
 * Classifies Redis errors into clear Portuguese operational diagnoses alongside technical details.
 */
export function diagnoseRedisError(err: unknown, endpoint?: string): RedisErrorDiagnosis {
    const technicalSummary = formatErrorDetails(err);
    const upper = technicalSummary.toUpperCase();
    const targetLabel = endpoint ? ` (${endpoint})` : '';

    if (upper.includes('NOGROUP')) {
        return {
            category: 'NOGROUP',
            isNoGroup: true,
            explanation: `Stream ou grupo consumidor inexistente no Redis${targetLabel}`,
            technicalSummary,
        };
    }
    if (upper.includes('WRONGPASS') || upper.includes('NOAUTH')) {
        return {
            category: 'AUTH',
            isNoGroup: false,
            explanation: `Falha de autenticação no Redis${targetLabel} — verifique REDIS_PASSWORD`,
            technicalSummary,
        };
    }
    if (upper.includes('ECONNREFUSED')) {
        return {
            category: 'CONNECTION_REFUSED',
            isNoGroup: false,
            explanation: `Conexão recusada pelo Redis${targetLabel} — servidor Redis offline ou porta bloqueada`,
            technicalSummary,
        };
    }
    if (
        upper.includes('ETIMEDOUT') ||
        upper.includes('EHOSTUNREACH') ||
        upper.includes('ENETUNREACH') ||
        upper.includes('ENOTFOUND') ||
        upper.includes('EAI_AGAIN') ||
        upper.includes('ECONNRESET')
    ) {
        return {
            category: 'NETWORK',
            isNoGroup: false,
            explanation: `Falha de rede/timeout ao comunicar com o Redis${targetLabel}`,
            technicalSummary,
        };
    }
    if (upper.includes('CROSSSLOT')) {
        return {
            category: 'CROSSSLOT',
            isNoGroup: false,
            explanation: `Chaves em hash-slots diferentes no Redis${targetLabel} — verifique REDIS_PREFIX com '{...}'`,
            technicalSummary,
        };
    }
    if (upper.includes('READONLY')) {
        return {
            category: 'READONLY',
            isNoGroup: false,
            explanation: `Instância Redis${targetLabel} em modo somente leitura (réplica)`,
            technicalSummary,
        };
    }
    if (upper.includes('OOM')) {
        return {
            category: 'OOM',
            isNoGroup: false,
            explanation: `Memória esgotada no Redis${targetLabel} (OOM / maxmemory)`,
            technicalSummary,
        };
    }

    return {
        category: 'REDIS_ERROR',
        isNoGroup: false,
        explanation: `Erro operacional no Redis${targetLabel}`,
        technicalSummary,
    };
}
