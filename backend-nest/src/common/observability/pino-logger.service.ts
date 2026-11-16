import { Injectable, LoggerService } from '@nestjs/common';
import pino, { Logger as PinoInstance } from 'pino';
import { getCorrelationStore } from './correlation.context';
import { formatErrorDetails } from './error-formatter';

/**
 * Scrubs sensitive tokens, passwords, and 6-digit OTPs from free-form log strings.
 */
function scrubSensitiveText(input: string): string {
    if (!input) return input;
    return input
        .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1[REDACTED]')
        .replace(/((?:token|sig|password|pass|secret|apiKey)=)[^&\s]+/gi, '$1[REDACTED]');
}

@Injectable()
export class PinoLoggerService implements LoggerService {
    private readonly logger: PinoInstance;
    private readonly isProd = process.env.NODE_ENV === 'production';

    constructor() {
        const level = process.env.LOG_LEVEL || (this.isProd ? 'info' : 'info');

        this.logger = pino({
            level,
            base: {
                service: process.env.MT5_DEDICATED_SERVER === 'true' ? 'torex-mt5-api' : 'torex-api',
                env: process.env.NODE_ENV || 'development',
            },
            timestamp: pino.stdTimeFunctions.isoTime,
            redact: {
                paths: [
                    'req.headers.authorization',
                    'req.headers.cookie',
                    'req.headers["app-token"]',
                    'password',
                    'pass',
                    'newPassword',
                    'investorPassword',
                    'masterPassword',
                    'otp',
                    'otpCode',
                    'verificationCode',
                    'token',
                    'sig',
                ],
                censor: '[REDACTED]',
            },
            formatters: {
                level(label) {
                    return { level: label };
                },
            },
        });
    }

    private extractContextAndMeta(optionalParams: any[]): {
        context?: string;
        trace?: string;
        extra?: Record<string, unknown>;
        errorDetail?: string;
    } {
        if (!optionalParams || optionalParams.length === 0) {
            return {};
        }

        const last = optionalParams[optionalParams.length - 1];
        let context: string | undefined;
        let trace: string | undefined;
        let extra: Record<string, unknown> | undefined;
        let errorDetail: string | undefined;

        if (typeof last === 'string') {
            context = last;
            if (optionalParams.length > 1) {
                const first = optionalParams[0];
                if (typeof first === 'string') {
                    trace = first;
                } else if (first instanceof Error) {
                    trace = first.stack;
                    errorDetail = formatErrorDetails(first);
                    extra = { errorName: first.name, errorMessage: errorDetail };
                } else if (first && typeof first === 'object') {
                    extra = first;
                }
            }
        } else if (last instanceof Error) {
            trace = last.stack;
            errorDetail = formatErrorDetails(last);
            extra = { errorName: last.name, errorMessage: errorDetail };
        } else if (last && typeof last === 'object') {
            extra = last;
        }

        return { context, trace, extra, errorDetail };
    }

    private formatEntry(
        level: 'info' | 'warn' | 'error' | 'debug' | 'trace',
        message: any,
        optionalParams: any[],
    ) {
        const store = getCorrelationStore();
        const { context, trace, extra, errorDetail } = this.extractContextAndMeta(optionalParams);

        let msgText =
            typeof message === 'string'
                ? scrubSensitiveText(message)
                : message instanceof Error
                  ? scrubSensitiveText(formatErrorDetails(message))
                  : scrubSensitiveText(JSON.stringify(message));

        if (errorDetail && !msgText.includes(errorDetail)) {
            msgText = `${msgText} — ${scrubSensitiveText(errorDetail)}`;
        }

        if (!this.isProd) {
            // Clean, human-readable single-line console format in development without raw JSON noise
            const ts = new Date().toISOString().slice(11, 23);
            const lvl = level.toUpperCase().padEnd(5);
            const ctx = context ? `[${context}] ` : '';
            const cid = store?.correlationId ? ` (cid:${store.correlationId.slice(0, 8)})` : '';
            let metaSuffix = '';
            if (extra) {
                const filtered = Object.entries(extra).filter(
                    ([k]) => k !== 'errorName' && k !== 'errorMessage',
                );
                if (filtered.length > 0) {
                    metaSuffix = ` ${scrubSensitiveText(JSON.stringify(Object.fromEntries(filtered)))}`;
                }
            }
            const line = `${ts} ${lvl} ${ctx}${msgText}${metaSuffix}${cid}`;
            if (level === 'error') {
                process.stderr.write(`${line}\n`);
                if (trace) process.stderr.write(`${scrubSensitiveText(trace)}\n`);
            } else {
                process.stdout.write(`${line}\n`);
            }
            return;
        }

        const payload: Record<string, unknown> = {
            ...(context ? { context } : {}),
            ...(store?.correlationId ? { correlationId: store.correlationId } : {}),
            ...(store?.userId ? { userId: store.userId } : {}),
            ...(extra || {}),
            ...(trace ? { stack: scrubSensitiveText(trace) } : {}),
        };

        this.logger[level](payload, msgText);
    }

    log(message: any, ...optionalParams: any[]) {
        this.formatEntry('info', message, optionalParams);
    }

    error(message: any, ...optionalParams: any[]) {
        this.formatEntry('error', message, optionalParams);
    }

    warn(message: any, ...optionalParams: any[]) {
        this.formatEntry('warn', message, optionalParams);
    }

    debug(message: any, ...optionalParams: any[]) {
        if (process.env.LOG_LEVEL === 'debug' || process.env.LOG_LEVEL === 'trace') {
            this.formatEntry('debug', message, optionalParams);
        }
    }

    verbose(message: any, ...optionalParams: any[]) {
        if (process.env.LOG_LEVEL === 'trace') {
            this.formatEntry('trace', message, optionalParams);
        }
    }
}
