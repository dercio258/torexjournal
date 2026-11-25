import { Injectable, Logger, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import {
    buildErrorReference,
    redactSensitiveMetadata,
    resolveErrorDomain,
} from './error-sanitizer.util';

export type TechnicalErrorSeverity = 'critical' | 'error' | 'warning';
export type TechnicalErrorStatus = 'OPEN' | 'RESOLVED';

export interface ErrorSnapshot {
    id: string;
    errorRef: string;
    timestamp: string;
    domain: string;
    severity: TechnicalErrorSeverity;
    statusCode: number | null;
    method: string | null;
    path: string | null;
    userId: string | null;
    exceptionName: string | null;
    errorCode: string | null;
    message: string;
    technicalMessage: string;
    publicMessage: string | null;
    wasSanitized: boolean;
    stackPreview: string | null;
    correlationId?: string;
    status: TechnicalErrorStatus;
    resolvedAt: string | null;
    meta?: Record<string, unknown>;
}

export interface RecordTechnicalErrorInput {
    errorRef?: string;
    domain?: string;
    severity?: TechnicalErrorSeverity;
    statusCode?: number | null;
    method?: string | null;
    path?: string | null;
    userId?: string | null;
    exceptionName?: string | null;
    errorCode?: string | null;
    technicalMessage: string;
    publicMessage?: string | null;
    wasSanitized?: boolean;
    stack?: string | null;
    correlationId?: string;
    meta?: Record<string, unknown>;
}

export interface ListTechnicalErrorsQuery {
    search?: string;
    domain?: string;
    severity?: string;
    status?: string;
    limit?: number;
}

const MAX_LATENCY_SAMPLES = 500;
const MAX_ERROR_BUFFER = 200;

function computePercentiles(samples: number[]): {
    count: number;
    avgMs: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
} {
    if (samples.length === 0) {
        return { count: 0, avgMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0 };
    }
    const sorted = [...samples].sort((a, b) => a - b);
    const sum = sorted.reduce((acc, v) => acc + v, 0);
    const pick = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

    return {
        count: sorted.length,
        avgMs: Math.round((sum / sorted.length) * 100) / 100,
        p50Ms: Math.round(pick(0.5) * 100) / 100,
        p95Ms: Math.round(pick(0.95) * 100) / 100,
        p99Ms: Math.round(pick(0.99) * 100) / 100,
    };
}

function formatStackPreview(stack?: string | null): string | null {
    if (!stack || typeof stack !== 'string') return null;
    const lines = stack
        .split('\n')
        .map((l) => l.trimEnd())
        .filter(Boolean)
        .slice(0, 14)
        .join('\n');
    return lines ? redactSensitiveMetadata(lines, 2400) : null;
}

@Injectable()
export class TelemetryService {
    private readonly logger = new Logger(TelemetryService.name);
    private readonly bootTime = Date.now();

    constructor(@Optional() private readonly dataSource?: DataSource) {}

    // HTTP metrics
    private httpRequestsTotal = 0;
    private httpByStatusClass: Record<string, number> = {
        '2xx': 0,
        '3xx': 0,
        '4xx': 0,
        '5xx': 0,
    };
    private httpLatenciesMs: number[] = [];

    // Email Queue & SMTP metrics
    private emailStats = {
        enqueued: 0,
        deduplicated: 0,
        sent: 0,
        mocked: 0,
        failed: 0,
        retried: 0,
        byTemplate: {} as Record<
            string,
            { enqueued: number; sent: number; failed: number }
        >,
    };
    private smtpLatenciesMs: number[] = [];

    // MT5 Connectivity & Sync metrics
    private mt5Stats = {
        workerHeartbeats: 0,
        tcpHeartbeats: 0,
        accountsTouched: 0,
        disconnectChecksRun: 0,
        accountsMarkedOffline: 0,
        disconnectEmailsQueued: 0,
        disconnectAlertsSuppressedCooldown: 0,
        reconnectsRestored: 0,
        autoSyncBatches: 0,
        manualFileImports: 0,
        wsActiveClients: 0,
    };

    // Ring buffer of recent technical error incidents (also mirrored asynchronously in PostgreSQL)
    private recentErrors: ErrorSnapshot[] = [];

    recordHttpRequest(method: string, path: string, statusCode: number, durationMs: number): void {
        this.httpRequestsTotal += 1;
        const bucket =
            statusCode >= 500
                ? '5xx'
                : statusCode >= 400
                  ? '4xx'
                  : statusCode >= 300
                    ? '3xx'
                    : '2xx';
        this.httpByStatusClass[bucket] = (this.httpByStatusClass[bucket] || 0) + 1;

        this.pushSample(this.httpLatenciesMs, durationMs);
    }

    recordEmailEnqueued(template: string, count: number = 1): void {
        this.emailStats.enqueued += count;
        const entry = this.ensureTemplateStat(template);
        entry.enqueued += count;
    }

    recordEmailDeduplicated(): void {
        this.emailStats.deduplicated += 1;
    }

    recordEmailSent(template: string, durationMs: number, mocked = false): void {
        this.emailStats.sent += 1;
        if (mocked) this.emailStats.mocked += 1;
        const entry = this.ensureTemplateStat(template);
        entry.sent += 1;
        this.pushSample(this.smtpLatenciesMs, durationMs);
    }

    recordEmailFailed(template: string, errorMsg: string, willRetry: boolean, correlationId?: string): void {
        if (willRetry) {
            this.emailStats.retried += 1;
        } else {
            this.emailStats.failed += 1;
            const entry = this.ensureTemplateStat(template);
            entry.failed += 1;
        }
        this.recordTechnicalError({
            domain: 'NTF',
            severity: willRetry ? 'warning' : 'error',
            technicalMessage: `[SMTP:${template}] ${errorMsg}`,
            publicMessage: null,
            wasSanitized: true,
            correlationId,
            meta: { template, willRetry, subsystem: 'email' },
        });
    }

    recordMt5Metric(
        key: keyof Omit<TelemetryService['mt5Stats'], 'wsActiveClients'>,
        delta: number = 1,
    ): void {
        this.mt5Stats[key] += delta;
    }

    setWsActiveClients(count: number): void {
        this.mt5Stats.wsActiveClients = Math.max(0, count);
    }

    adjustWsActiveClients(delta: number): void {
        this.mt5Stats.wsActiveClients = Math.max(0, this.mt5Stats.wsActiveClients + delta);
    }

    recordTechnicalError(input: RecordTechnicalErrorInput): ErrorSnapshot {
        const domainCode = (
            input.domain ||
            resolveErrorDomain(input.path || '').code ||
            'SYS'
        )
            .toString()
            .toUpperCase()
            .slice(0, 16);

        const errorRef =
            input.errorRef ||
            buildErrorReference(input.path || '', input.correlationId);

        const redactedTechnical = redactSensitiveMetadata(
            input.technicalMessage || 'Erro técnico não detalhado',
            1800,
        );

        const statusCode =
            typeof input.statusCode === 'number' && Number.isFinite(input.statusCode)
                ? input.statusCode
                : null;

        const severity: TechnicalErrorSeverity =
            input.severity ||
            (statusCode === null || statusCode >= 500
                ? 'critical'
                : input.wasSanitized
                  ? 'error'
                  : 'warning');

        const entry: ErrorSnapshot = {
            id: randomUUID(),
            errorRef,
            timestamp: new Date().toISOString(),
            domain: domainCode,
            severity,
            statusCode,
            method: input.method ? String(input.method).toUpperCase().slice(0, 12) : null,
            path: input.path ? String(input.path).slice(0, 255) : null,
            userId: input.userId ? String(input.userId).slice(0, 64) : null,
            exceptionName: input.exceptionName ? String(input.exceptionName).slice(0, 120) : null,
            errorCode: input.errorCode ? String(input.errorCode).slice(0, 64) : null,
            message: redactedTechnical.slice(0, 400),
            technicalMessage: redactedTechnical,
            publicMessage: input.publicMessage ? String(input.publicMessage).slice(0, 500) : null,
            wasSanitized: Boolean(input.wasSanitized),
            stackPreview: formatStackPreview(input.stack),
            correlationId: input.correlationId,
            status: 'OPEN',
            resolvedAt: null,
            meta: input.meta,
        };

        this.recentErrors.unshift(entry);
        if (this.recentErrors.length > MAX_ERROR_BUFFER) {
            this.recentErrors.length = MAX_ERROR_BUFFER;
        }

        void this.persistErrorLog(entry);
        return entry;
    }

    /** Backwards-compatible wrapper used by legacy callers. */
    recordError(
        domain: string,
        message: string,
        correlationId?: string,
        meta?: Record<string, unknown>,
    ): void {
        const statusVal = typeof meta?.status === 'number' ? meta.status : null;
        this.recordTechnicalError({
            domain: domain === 'unhandled' || domain === 'http' ? undefined : domain,
            severity:
                domain === 'unhandled' || (statusVal !== null && statusVal >= 500)
                    ? 'critical'
                    : 'error',
            statusCode: statusVal,
            technicalMessage: String(message),
            correlationId,
            wasSanitized: true,
            meta,
        });
    }

    private async persistErrorLog(entry: ErrorSnapshot): Promise<void> {
        if (!this.dataSource?.isInitialized) return;
        try {
            await this.dataSource.query(
                `INSERT INTO "system_error_logs" (
                    "id", "error_ref", "domain", "severity", "status_code",
                    "method", "path", "user_id", "exception_name", "error_code",
                    "technical_message", "public_message", "was_sanitized",
                    "stack_preview", "correlation_id", "status", "meta", "created_at"
                ) VALUES (
                    $1, $2, $3, $4, $5,
                    $6, $7, $8, $9, $10,
                    $11, $12, $13,
                    $14, $15, $16, $17::jsonb, $18
                )`,
                [
                    entry.id,
                    entry.errorRef,
                    entry.domain,
                    entry.severity,
                    entry.statusCode,
                    entry.method,
                    entry.path,
                    entry.userId,
                    entry.exceptionName,
                    entry.errorCode,
                    entry.technicalMessage,
                    entry.publicMessage,
                    entry.wasSanitized,
                    entry.stackPreview,
                    entry.correlationId || null,
                    entry.status,
                    JSON.stringify(entry.meta || {}),
                    entry.timestamp,
                ],
            );
        } catch (err: any) {
            // Never throw from telemetry persistence (e.g. during bootstrap or transient DB outage)
            this.logger.debug?.(`system_error_logs persist skipped: ${err?.message || err}`);
        }
    }

    async listTechnicalErrors(query: ListTechnicalErrorsQuery = {}): Promise<{
        items: ErrorSnapshot[];
        stats: {
            total: number;
            open: number;
            criticalOpen: number;
            sanitizedCount: number;
            last24h: number;
            byDomain: Record<string, number>;
        };
    }> {
        const limit = Math.min(Math.max(Number(query.limit) || 80, 1), 250);
        const search = String(query.search || '').trim();
        const domain = String(query.domain || '').trim().toUpperCase();
        const severity = String(query.severity || '').trim().toLowerCase();
        const status = String(query.status || '').trim().toUpperCase();

        if (this.dataSource?.isInitialized) {
            try {
                const whereClauses: string[] = [];
                const params: any[] = [];
                let pIdx = 1;

                if (search) {
                    whereClauses.push(
                        `("error_ref" ILIKE $${pIdx} OR "technical_message" ILIKE $${pIdx} OR "path" ILIKE $${pIdx} OR "exception_name" ILIKE $${pIdx} OR "user_id" ILIKE $${pIdx} OR "correlation_id" ILIKE $${pIdx})`,
                    );
                    params.push(`%${search}%`);
                    pIdx += 1;
                }
                if (domain && domain !== 'ALL') {
                    whereClauses.push(`"domain" = $${pIdx}`);
                    params.push(domain);
                    pIdx += 1;
                }
                if (severity && severity !== 'ALL') {
                    whereClauses.push(`"severity" = $${pIdx}`);
                    params.push(severity);
                    pIdx += 1;
                }
                if (status && status !== 'ALL') {
                    whereClauses.push(`"status" = $${pIdx}`);
                    params.push(status);
                    pIdx += 1;
                }

                const whereSql =
                    whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
                params.push(limit);

                const [rows, statsRows, domainRows] = await Promise.all([
                    this.dataSource.query(
                        `SELECT
                            "id", "error_ref", "domain", "severity", "status_code",
                            "method", "path", "user_id", "exception_name", "error_code",
                            "technical_message", "public_message", "was_sanitized",
                            "stack_preview", "correlation_id", "status", "resolved_at",
                            "meta", "created_at"
                         FROM "system_error_logs"
                         ${whereSql}
                         ORDER BY "created_at" DESC
                         LIMIT $${pIdx}`,
                        params,
                    ),
                    this.dataSource.query(
                        `SELECT
                            COUNT(*)::int AS total,
                            COUNT(*) FILTER (WHERE "status" = 'OPEN')::int AS open,
                            COUNT(*) FILTER (WHERE "status" = 'OPEN' AND "severity" = 'critical')::int AS critical_open,
                            COUNT(*) FILTER (WHERE "was_sanitized" = true)::int AS sanitized_count,
                            COUNT(*) FILTER (WHERE "created_at" >= NOW() - INTERVAL '24 hours')::int AS last_24h
                         FROM "system_error_logs"`,
                    ),
                    this.dataSource.query(
                        `SELECT "domain", COUNT(*)::int AS cnt
                         FROM "system_error_logs"
                         WHERE "status" = 'OPEN'
                         GROUP BY "domain"`,
                    ),
                ]);

                const items: ErrorSnapshot[] = (rows || []).map((r: any) => ({
                    id: r.id,
                    errorRef: r.error_ref,
                    timestamp:
                        r.created_at instanceof Date
                            ? r.created_at.toISOString()
                            : String(r.created_at),
                    domain: r.domain,
                    severity: r.severity,
                    statusCode: r.status_code !== null ? Number(r.status_code) : null,
                    method: r.method || null,
                    path: r.path || null,
                    userId: r.user_id || null,
                    exceptionName: r.exception_name || null,
                    errorCode: r.error_code || null,
                    message: String(r.technical_message || '').slice(0, 400),
                    technicalMessage: r.technical_message || '',
                    publicMessage: r.public_message || null,
                    wasSanitized: Boolean(r.was_sanitized),
                    stackPreview: r.stack_preview || null,
                    correlationId: r.correlation_id || undefined,
                    status: r.status === 'RESOLVED' ? 'RESOLVED' : 'OPEN',
                    resolvedAt: r.resolved_at
                        ? r.resolved_at instanceof Date
                            ? r.resolved_at.toISOString()
                            : String(r.resolved_at)
                        : null,
                    meta: r.meta || undefined,
                }));

                const st = statsRows?.[0] || {};
                const byDomain: Record<string, number> = {};
                for (const d of domainRows || []) {
                    if (d?.domain) byDomain[d.domain] = Number(d.cnt) || 0;
                }

                return {
                    items,
                    stats: {
                        total: Number(st.total) || 0,
                        open: Number(st.open) || 0,
                        criticalOpen: Number(st.critical_open) || 0,
                        sanitizedCount: Number(st.sanitized_count) || 0,
                        last24h: Number(st.last_24h) || 0,
                        byDomain,
                    },
                };
            } catch {
                // Fall back to in-memory ring buffer seamlessly
            }
        }

        const lowerSearch = search.toLowerCase();
        const filtered = this.recentErrors.filter((item) => {
            if (domain && domain !== 'ALL' && item.domain !== domain) return false;
            if (severity && severity !== 'ALL' && item.severity !== severity) return false;
            if (status && status !== 'ALL' && item.status !== status) return false;
            if (lowerSearch) {
                const hay = [
                    item.errorRef,
                    item.technicalMessage,
                    item.path || '',
                    item.exceptionName || '',
                    item.userId || '',
                    item.correlationId || '',
                ]
                    .join(' ')
                    .toLowerCase();
                if (!hay.includes(lowerSearch)) return false;
            }
            return true;
        });

        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        const byDomain: Record<string, number> = {};
        for (const item of this.recentErrors) {
            if (item.status === 'OPEN') {
                byDomain[item.domain] = (byDomain[item.domain] || 0) + 1;
            }
        }

        return {
            items: filtered.slice(0, limit),
            stats: {
                total: this.recentErrors.length,
                open: this.recentErrors.filter((e) => e.status === 'OPEN').length,
                criticalOpen: this.recentErrors.filter(
                    (e) => e.status === 'OPEN' && e.severity === 'critical',
                ).length,
                sanitizedCount: this.recentErrors.filter((e) => e.wasSanitized).length,
                last24h: this.recentErrors.filter(
                    (e) => new Date(e.timestamp).getTime() >= cutoff,
                ).length,
                byDomain,
            },
        };
    }

    async setTechnicalErrorStatus(
        idOrRef: string,
        resolved: boolean,
    ): Promise<{ ok: boolean; status: TechnicalErrorStatus }> {
        const clean = String(idOrRef || '').trim();
        const nextStatus: TechnicalErrorStatus = resolved ? 'RESOLVED' : 'OPEN';
        const resolvedAt = resolved ? new Date().toISOString() : null;

        let updatedMemory = false;
        for (const item of this.recentErrors) {
            if (item.id === clean || item.errorRef === clean) {
                item.status = nextStatus;
                item.resolvedAt = resolvedAt;
                updatedMemory = true;
            }
        }

        if (this.dataSource?.isInitialized) {
            try {
                const isUuid =
                    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                        clean,
                    );
                await this.dataSource.query(
                    isUuid
                        ? `UPDATE "system_error_logs" SET "status" = $1, "resolved_at" = $2 WHERE "id" = $3`
                        : `UPDATE "system_error_logs" SET "status" = $1, "resolved_at" = $2 WHERE "error_ref" = $3`,
                    [nextStatus, resolvedAt, clean],
                );
                return { ok: true, status: nextStatus };
            } catch {
                // fallback to memory result
            }
        }

        return { ok: updatedMemory, status: nextStatus };
    }

    getSnapshot() {
        const mem = process.memoryUsage();
        return {
            timestamp: new Date().toISOString(),
            uptimeSeconds: Math.floor((Date.now() - this.bootTime) / 1000),
            process: {
                pid: process.pid,
                nodeVersion: process.version,
                rssMb: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
                heapUsedMb: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10,
                heapTotalMb: Math.round((mem.heapTotal / 1024 / 1024) * 10) / 10,
            },
            http: {
                totalRequests: this.httpRequestsTotal,
                byStatusClass: { ...this.httpByStatusClass },
                latency: computePercentiles(this.httpLatenciesMs),
            },
            email: {
                ...this.emailStats,
                smtpLatency: computePercentiles(this.smtpLatenciesMs),
            },
            mt5: {
                ...this.mt5Stats,
            },
            recentErrors: this.recentErrors.slice(0, 50),
        };
    }

    toPrometheusText(): string {
        const snap = this.getSnapshot();
        const lines: string[] = [
            '# HELP torex_uptime_seconds Process uptime in seconds',
            '# TYPE torex_uptime_seconds gauge',
            `torex_uptime_seconds ${snap.uptimeSeconds}`,
            '# HELP torex_process_rss_megabytes Resident set size in MB',
            '# TYPE torex_process_rss_megabytes gauge',
            `torex_process_rss_megabytes ${snap.process.rssMb}`,
            '# HELP torex_http_requests_total Total HTTP API requests',
            '# TYPE torex_http_requests_total counter',
            `torex_http_requests_total ${snap.http.totalRequests}`,
        ];

        for (const [cls, val] of Object.entries(snap.http.byStatusClass)) {
            lines.push(`torex_http_responses_total{status_class="${cls}"} ${val}`);
        }

        lines.push(
            '# HELP torex_http_latency_p95_ms Rolling HTTP p95 latency in ms',
            '# TYPE torex_http_latency_p95_ms gauge',
            `torex_http_latency_p95_ms ${snap.http.latency.p95Ms}`,
            '# HELP torex_email_enqueued_total Total emails enqueued in Redis',
            '# TYPE torex_email_enqueued_total counter',
            `torex_email_enqueued_total ${snap.email.enqueued}`,
            '# HELP torex_email_sent_total Total emails delivered via SMTP',
            '# TYPE torex_email_sent_total counter',
            `torex_email_sent_total ${snap.email.sent}`,
            '# HELP torex_email_failed_total Total emails permanently failed',
            '# TYPE torex_email_failed_total counter',
            `torex_email_failed_total ${snap.email.failed}`,
            '# HELP torex_email_retried_total Total email retry attempts',
            '# TYPE torex_email_retried_total counter',
            `torex_email_retried_total ${snap.email.retried}`,
            '# HELP torex_mt5_worker_heartbeats_total Total MT5 worker heartbeats received',
            '# TYPE torex_mt5_worker_heartbeats_total counter',
            `torex_mt5_worker_heartbeats_total ${snap.mt5.workerHeartbeats}`,
            '# HELP torex_mt5_disconnect_emails_total Total MT5 disconnect alert emails queued',
            '# TYPE torex_mt5_disconnect_emails_total counter',
            `torex_mt5_disconnect_emails_total ${snap.mt5.disconnectEmailsQueued}`,
            '# HELP torex_mt5_disconnect_suppressed_total Total MT5 disconnect alerts suppressed by hysteresis/cooldown',
            '# TYPE torex_mt5_disconnect_suppressed_total counter',
            `torex_mt5_disconnect_suppressed_total ${snap.mt5.disconnectAlertsSuppressedCooldown}`,
            '# HELP torex_mt5_ws_active_clients Active WebSocket clients on /mt5 namespace',
            '# TYPE torex_mt5_ws_active_clients gauge',
            `torex_mt5_ws_active_clients ${snap.mt5.wsActiveClients}`,
        );

        return lines.join('\n') + '\n';
    }

    private ensureTemplateStat(template: string) {
        const MAX_TEMPLATES = 64;
        const normalized = String(template || 'unknown').slice(0, 64);
        const key =
            this.emailStats.byTemplate[normalized] ||
            Object.keys(this.emailStats.byTemplate).length < MAX_TEMPLATES
                ? normalized
                : 'other_templates';
        if (!this.emailStats.byTemplate[key]) {
            this.emailStats.byTemplate[key] = { enqueued: 0, sent: 0, failed: 0 };
        }
        return this.emailStats.byTemplate[key];
    }

    private pushSample(arr: number[], value: number) {
        if (!Number.isFinite(value) || value < 0) return;
        arr.push(value);
        if (arr.length > MAX_LATENCY_SAMPLES) {
            arr.shift();
        }
    }
}
