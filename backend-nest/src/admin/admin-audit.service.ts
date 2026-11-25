import { Injectable, Logger, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createHash, randomUUID } from 'crypto';
import { redactSensitiveMetadata } from '../common/observability/error-sanitizer.util';
import {
    DigitalSignatureEnvelope,
    DigitalSignatureService,
} from '../common/security/digital-signature.service';

export interface AdminAuditLogEntry {
    id: string;
    timestamp: string;
    adminEmail: string;
    action: string;
    targetType: string | null;
    targetId: string | null;
    ip: string | null;
    details: Record<string, unknown>;
    prevHash: string;
    entryHash: string;
}

const GENESIS_HASH = '0'.repeat(64);
const MAX_MEM_AUDIT_BUFFER = 200;

export function computeAdminAuditEntryHash(parts: {
    prevHash: string;
    timestamp: string;
    adminEmail: string;
    action: string;
    targetType: string | null;
    targetId: string | null;
    detailsJson: string;
}): string {
    const canonical = [
        parts.prevHash,
        parts.timestamp,
        parts.adminEmail,
        parts.action,
        parts.targetType || '',
        parts.targetId || '',
        parts.detailsJson,
    ].join('|');
    return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

@Injectable()
export class AdminAuditService {
    private readonly logger = new Logger(AdminAuditService.name);
    private readonly memoryChain: AdminAuditLogEntry[] = [];
    private lastHashMemory = GENESIS_HASH;

    constructor(
        @Optional() private readonly dataSource?: DataSource,
        @Optional() private readonly digitalSignature?: DigitalSignatureService,
    ) {}

    private buildSignedCheckpoint(
        items: AdminAuditLogEntry[],
        chainIntegrity: { valid: boolean; checked: number; brokenAtId?: string },
    ): DigitalSignatureEnvelope | undefined {
        if (!this.digitalSignature) return undefined;
        const head = items[0];
        return this.digitalSignature.signCanonicalPayload(
            {
                chainValid: chainIntegrity.valid,
                checkedEntries: chainIntegrity.checked,
                brokenAtId: chainIntegrity.brokenAtId || null,
                headId: head?.id || null,
                headEntryHash: head?.entryHash || GENESIS_HASH,
                headTimestamp: head?.timestamp || null,
                returnedCount: items.length,
            },
            'audit_checkpoint',
        );
    }

    private sanitizeDetails(details?: Record<string, unknown>): Record<string, unknown> {
        if (!details || typeof details !== 'object') return {};
        try {
            const raw = JSON.stringify(details);
            const redacted = redactSensitiveMetadata(raw, 2000);
            return JSON.parse(redacted);
        } catch {
            return {};
        }
    }

    async record(input: {
        adminEmail?: string | null;
        action: string;
        targetType?: string | null;
        targetId?: string | null;
        ip?: string | null;
        details?: Record<string, unknown>;
    }): Promise<AdminAuditLogEntry> {
        const adminEmail = String(input.adminEmail || 'admin').trim().toLowerCase().slice(0, 160);
        const action = String(input.action || 'UNKNOWN_ACTION').trim().toUpperCase().slice(0, 80);
        const targetType = input.targetType ? String(input.targetType).slice(0, 64) : null;
        const targetId = input.targetId ? String(input.targetId).slice(0, 120) : null;
        const ip = input.ip ? String(input.ip).slice(0, 64) : null;
        const details = this.sanitizeDetails(input.details);
        const detailsJson = JSON.stringify(details);
        const timestamp = new Date().toISOString();

        let prevHash = this.lastHashMemory;
        if (this.dataSource?.isInitialized) {
            try {
                const latest = await this.dataSource.query(
                    `SELECT "entry_hash" FROM "admin_audit_logs" ORDER BY "created_at" DESC, "id" DESC LIMIT 1`,
                );
                if (latest?.[0]?.entry_hash) {
                    prevHash = String(latest[0].entry_hash);
                }
            } catch {
                // use in-memory chain tail
            }
        }

        const entryHash = computeAdminAuditEntryHash({
            prevHash,
            timestamp,
            adminEmail,
            action,
            targetType,
            targetId,
            detailsJson,
        });

        const entry: AdminAuditLogEntry = {
            id: randomUUID(),
            timestamp,
            adminEmail,
            action,
            targetType,
            targetId,
            ip,
            details,
            prevHash,
            entryHash,
        };

        this.lastHashMemory = entryHash;
        this.memoryChain.unshift(entry);
        if (this.memoryChain.length > MAX_MEM_AUDIT_BUFFER) {
            this.memoryChain.length = MAX_MEM_AUDIT_BUFFER;
        }

        if (this.dataSource?.isInitialized) {
            try {
                await this.dataSource.query(
                    `INSERT INTO "admin_audit_logs" (
                        "id", "admin_email", "action", "target_type", "target_id",
                        "ip", "details", "prev_hash", "entry_hash", "created_at"
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)`,
                    [
                        entry.id,
                        entry.adminEmail,
                        entry.action,
                        entry.targetType,
                        entry.targetId,
                        entry.ip,
                        detailsJson,
                        entry.prevHash,
                        entry.entryHash,
                        entry.timestamp,
                    ],
                );
            } catch (err: any) {
                this.logger.warn(
                    `admin_audit_logs DB insert skipped (${action}): ${err?.message || err}`,
                );
            }
        }

        return entry;
    }

    async listLogs(query: { search?: string; action?: string; limit?: number } = {}): Promise<{
        items: AdminAuditLogEntry[];
        chainIntegrity: { valid: boolean; checked: number; brokenAtId?: string };
        signedCheckpoint?: DigitalSignatureEnvelope;
    }> {
        const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 250);
        const search = String(query.search || '').trim();
        const action = String(query.action || '').trim().toUpperCase();

        if (this.dataSource?.isInitialized) {
            try {
                const where: string[] = [];
                const params: any[] = [];
                let p = 1;
                if (search) {
                    where.push(
                        `("admin_email" ILIKE $${p} OR "action" ILIKE $${p} OR "target_id" ILIKE $${p} OR "target_type" ILIKE $${p})`,
                    );
                    params.push(`%${search}%`);
                    p += 1;
                }
                if (action && action !== 'ALL') {
                    where.push(`"action" = $${p}`);
                    params.push(action);
                    p += 1;
                }
                const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
                params.push(limit);

                const [rows, chainIntegrity] = await Promise.all([
                    this.dataSource.query(
                        `SELECT "id", "admin_email", "action", "target_type", "target_id",
                                "ip", "details", "prev_hash", "entry_hash", "created_at"
                         FROM "admin_audit_logs"
                         ${whereSql}
                         ORDER BY "created_at" DESC
                         LIMIT $${p}`,
                        params,
                    ),
                    this.verifyChainIntegrity(150),
                ]);

                const items: AdminAuditLogEntry[] = (rows || []).map((r: any) => ({
                    id: r.id,
                    timestamp:
                        r.created_at instanceof Date
                            ? r.created_at.toISOString()
                            : String(r.created_at),
                    adminEmail: r.admin_email,
                    action: r.action,
                    targetType: r.target_type || null,
                    targetId: r.target_id || null,
                    ip: r.ip || null,
                    details: r.details || {},
                    prevHash: r.prev_hash,
                    entryHash: r.entry_hash,
                }));

                return {
                    items,
                    chainIntegrity,
                    signedCheckpoint: this.buildSignedCheckpoint(items, chainIntegrity),
                };
            } catch {
                // fallback to in-memory
            }
        }

        const lower = search.toLowerCase();
        const filtered = this.memoryChain.filter((e) => {
            if (action && action !== 'ALL' && e.action !== action) return false;
            if (lower) {
                const hay = `${e.adminEmail} ${e.action} ${e.targetType || ''} ${e.targetId || ''}`.toLowerCase();
                if (!hay.includes(lower)) return false;
            }
            return true;
        });

        const chainIntegrity = this.verifyEntriesChain([...this.memoryChain].reverse());
        const sliced = filtered.slice(0, limit);
        return {
            items: sliced,
            chainIntegrity,
            signedCheckpoint: this.buildSignedCheckpoint(sliced, chainIntegrity),
        };
    }

    async verifyChainIntegrity(
        maxRows = 150,
    ): Promise<{ valid: boolean; checked: number; brokenAtId?: string }> {
        if (!this.dataSource?.isInitialized) {
            return this.verifyEntriesChain([...this.memoryChain].reverse());
        }
        try {
            const rows = await this.dataSource.query(
                `SELECT "id", "admin_email", "action", "target_type", "target_id",
                        "details", "prev_hash", "entry_hash", "created_at"
                 FROM "admin_audit_logs"
                 ORDER BY "created_at" ASC, "id" ASC
                 LIMIT $1`,
                [maxRows],
            );
            const entries: AdminAuditLogEntry[] = (rows || []).map((r: any) => ({
                id: r.id,
                timestamp:
                    r.created_at instanceof Date
                        ? r.created_at.toISOString()
                        : String(r.created_at),
                adminEmail: r.admin_email,
                action: r.action,
                targetType: r.target_type || null,
                targetId: r.target_id || null,
                ip: null,
                details: r.details || {},
                prevHash: r.prev_hash,
                entryHash: r.entry_hash,
            }));
            return this.verifyEntriesChain(entries);
        } catch {
            return { valid: true, checked: 0 };
        }
    }

    private verifyEntriesChain(entries: AdminAuditLogEntry[]): {
        valid: boolean;
        checked: number;
        brokenAtId?: string;
    } {
        let prevExpected: string | null = null;
        for (const e of entries) {
            if (prevExpected !== null && e.prevHash !== prevExpected) {
                return { valid: false, checked: entries.length, brokenAtId: e.id };
            }
            const recomputed = computeAdminAuditEntryHash({
                prevHash: e.prevHash,
                timestamp: e.timestamp,
                adminEmail: e.adminEmail,
                action: e.action,
                targetType: e.targetType,
                targetId: e.targetId,
                detailsJson: JSON.stringify(e.details || {}),
            });
            if (recomputed !== e.entryHash) {
                return { valid: false, checked: entries.length, brokenAtId: e.id };
            }
            prevExpected = e.entryHash;
        }
        return { valid: true, checked: entries.length };
    }
}
