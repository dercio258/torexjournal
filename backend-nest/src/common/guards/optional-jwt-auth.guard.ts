import { Injectable, CanActivate, ExecutionContext, Inject, Optional } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { DataSource } from 'typeorm';
import { getJwtSecret } from '../security/security.config';

@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
    constructor(
        private readonly jwtService: JwtService,
        private readonly configService: ConfigService,
        @Optional()
        @Inject(CACHE_MANAGER)
        private readonly cacheManager?: Cache,
        @Optional()
        private readonly dataSource?: DataSource,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const authHeader = request.headers?.authorization;

        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.split(' ')[1];
            const secret = getJwtSecret(this.configService);
            try {
                const payload = await this.jwtService.verifyAsync(token, { secret });
                if (payload?.isTwoFactorPending) {
                    request.user = null;
                    return true;
                }

                const userId = payload?.id || payload?.sub;
                if (!userId) {
                    request.user = null;
                    return true;
                }

                let sessionActive = true;
                if (this.dataSource) {
                    const cached = this.cacheManager
                        ? await this.cacheManager.get(`user_session:${token}`).catch(() => null)
                        : null;

                    if (cached !== 'active') {
                        const rows = await this.dataSource
                            .query(
                                `SELECT id, "expiresAt", "isActive" FROM "sessions" WHERE token = $1 LIMIT 1`,
                                [token],
                            )
                            .catch(() => []);
                        const sess = Array.isArray(rows) ? rows[0] : null;
                        if (!sess || !sess.isActive || new Date() > new Date(sess.expiresAt)) {
                            sessionActive = false;
                        } else if (this.cacheManager) {
                            await this.cacheManager.set(`user_session:${token}`, 'active', 300_000).catch(() => {});
                        }
                    }

                    if (sessionActive) {
                        const userRows = await this.dataSource
                            .query(
                                `SELECT "is_blocked" FROM "users" WHERE id = $1 LIMIT 1`,
                                [userId],
                            )
                            .catch(() => []);
                        const uRow = Array.isArray(userRows) ? userRows[0] : null;
                        if (!uRow || uRow.is_blocked) {
                            sessionActive = false;
                        }
                    }
                }

                request.user = sessionActive ? payload : null;
            } catch {
                request.user = null;
            }
        } else {
            request.user = null;
        }

        return true;
    }
}
