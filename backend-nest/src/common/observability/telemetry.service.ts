import { Injectable } from '@nestjs/common';

export interface ErrorSnapshot {
    timestamp: string;
    domain: string;
    message: string;
    correlationId?: string;
    meta?: Record<string, unknown>;
}

const MAX_LATENCY_SAMPLES = 500;
const MAX_ERROR_BUFFER = 50;

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

@Injectable()
export class TelemetryService {
    private readonly bootTime = Date.now();

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

    // Ring buffer of recent operational errors
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
        this.recordError('email', errorMsg, correlationId, { template, willRetry });
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

    recordError(
        domain: string,
        message: string,
        correlationId?: string,
        meta?: Record<string, unknown>,
    ): void {
        this.recentErrors.unshift({
            timestamp: new Date().toISOString(),
            domain,
            message: String(message).slice(0, 400),
            correlationId,
            meta,
        });
        if (this.recentErrors.length > MAX_ERROR_BUFFER) {
            this.recentErrors.length = MAX_ERROR_BUFFER;
        }
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
            recentErrors: [...this.recentErrors],
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
