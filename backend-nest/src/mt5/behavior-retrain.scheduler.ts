import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { promisify } from 'util';
import { DataSource } from 'typeorm';
import { getQuantInternalHeaders } from '../common/security/security.config';
import { RedisSecurityService } from '../common/security/redis-security.service';

const execFileAsync = promisify(execFile);

@Injectable()
export class BehaviorRetrainScheduler {
    private readonly logger = new Logger(BehaviorRetrainScheduler.name);
    private isRetraining = false;

    constructor(
        @Optional()
        private readonly dataSource?: DataSource,
        @Optional()
        private readonly redisSecurity?: RedisSecurityService,
    ) {}

    private getBehaviorMlBaseUrl(): string {
        const raw =
            process.env.BEHAVIOR_ML_URL ||
            process.env.QUANT_ENGINE_URL ||
            'http://127.0.0.1:8001';
        return raw.trim().replace(/\/$/, '');
    }

    private resolveQuantPaths(): { pythonBin: string; scriptPath: string } | null {
        const candidateRoots = [
            resolve(process.cwd(), '..', 'quant-engine'),
            resolve(process.cwd(), 'quant-engine'),
        ];

        for (const root of candidateRoots) {
            const scriptPath = resolve(root, 'scripts', 'build_and_train_behavior_ml.py');
            if (!existsSync(scriptPath)) continue;

            const venvWin = resolve(root, '.venv', 'Scripts', 'python.exe');
            const venvUnix = resolve(root, '.venv', 'bin', 'python');
            const pythonBin = existsSync(venvWin)
                ? venvWin
                : existsSync(venvUnix)
                  ? venvUnix
                  : process.platform === 'win32'
                    ? 'python'
                    : 'python3';
            return { pythonBin, scriptPath };
        }
        return null;
    }

    @Cron('0 3 * * 0') // Sundays at 03:00 UTC
    async handleWeeklyRetrain() {
        if (process.env.MT5_DEDICATED_SERVER === 'true') return;
        if (this.redisSecurity) {
            await this.redisSecurity.withLock('cron:mt5_behavior_retrain', 30 * 60_000, async () => {
                await this.runScheduledRetrainCheck(false);
            });
            return;
        }
        await this.runScheduledRetrainCheck(false);
    }

    async runScheduledRetrainCheck(force = false): Promise<{
        triggered: boolean;
        reloaded?: boolean;
        reason: string;
        feedbackCount?: number;
    }> {
        if (this.isRetraining) {
            return { triggered: false, reason: 'already_running' };
        }
        if (!this.dataSource && !force) {
            return { triggered: false, reason: 'no_datasource' };
        }

        let feedbackCount = 0;
        let latestFeedbackAt: string | null = null;
        if (this.dataSource) {
            try {
                const rows = await this.dataSource.query(
                    `SELECT COUNT(*)::int AS cnt,
                            MAX(("qualityFlags"->'behavioralFeedback'->>'updatedAt')) AS latest_fb
                     FROM trades
                     WHERE "qualityFlags"->'behavioralFeedback' IS NOT NULL`,
                );
                feedbackCount = Number(rows?.[0]?.cnt || 0);
                latestFeedbackAt = rows?.[0]?.latest_fb ? String(rows[0].latest_fb) : null;
            } catch (err: any) {
                this.logger.warn(`Failed to query behavioral feedback state: ${err?.message || err}`);
            }
        }

        const baseUrl = this.getBehaviorMlBaseUrl();
        let trainedAtUtc: string | null = null;
        try {
            const statusRes = await fetch(`${baseUrl}/api/ml/behavior/status`, {
                headers: getQuantInternalHeaders(),
                signal: AbortSignal.timeout(3000),
            });
            if (statusRes.ok) {
                const statusJson: any = await statusRes.json();
                trainedAtUtc = statusJson?.trainingMetrics?.trainedAtUtc
                    ? String(statusJson.trainingMetrics.trainedAtUtc)
                    : null;
            }
        } catch {
            // Engine might be cold or offline; status check is best-effort
        }

        const hasNewFeedback =
            Boolean(latestFeedbackAt) &&
            (!trainedAtUtc || new Date(latestFeedbackAt!).getTime() > new Date(trainedAtUtc).getTime());

        if (!force && !hasNewFeedback) {
            return {
                triggered: false,
                reason: 'no_new_feedback_since_last_train',
                feedbackCount,
            };
        }

        const paths = this.resolveQuantPaths();
        if (!paths) {
            this.isRetraining = true;
            try {
                const remoteRes = await fetch(`${baseUrl}/api/ml/behavior/retrain`, {
                    method: 'POST',
                    headers: getQuantInternalHeaders(),
                    signal: AbortSignal.timeout(30_000),
                });
                if (remoteRes.ok) {
                    this.logger.log('Behavioral ML remote retrain triggered successfully on Quant Engine.');
                    return { triggered: true, reloaded: true, reason: 'retrained_remote', feedbackCount };
                }
            } catch {
                // Fall through if quant-engine remote retrain endpoint is unavailable
            } finally {
                this.isRetraining = false;
            }
            this.logger.warn('Quant-engine training script not found on disk; skipping scheduled retrain.');
            return { triggered: false, reason: 'script_not_found', feedbackCount };
        }

        this.isRetraining = true;
        try {
            this.logger.log(
                `Triggering scheduled Behavioral ML retraining (${feedbackCount} human feedback rows)...`,
            );
            await execFileAsync(
                paths.pythonBin,
                [paths.scriptPath, '--epochs', '28', '--backfill-db'],
                {
                    timeout: 10 * 60 * 1000,
                    maxBuffer: 16 * 1024 * 1024,
                    windowsHide: true,
                },
            );

            let reloaded = false;
            try {
                const reloadRes = await fetch(`${baseUrl}/api/ml/behavior/reload`, {
                    method: 'POST',
                    headers: getQuantInternalHeaders(),
                    signal: AbortSignal.timeout(5000),
                });
                reloaded = reloadRes.ok;
            } catch (reloadErr: any) {
                this.logger.warn(`Hot-reload call failed after retraining: ${reloadErr?.message || reloadErr}`);
            }

            this.logger.log(`Behavioral ML weekly retrain finished (reloaded=${reloaded}).`);
            return { triggered: true, reloaded, reason: 'retrained', feedbackCount };
        } catch (err: any) {
            this.logger.error(`Scheduled Behavioral ML retrain failed: ${err?.message || err}`);
            return { triggered: false, reason: `error:${err?.message || err}`, feedbackCount };
        } finally {
            this.isRetraining = false;
        }
    }
}
