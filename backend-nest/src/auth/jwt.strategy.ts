import { Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException, Inject, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SessionEntity } from './session.entity';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { buildSessionCacheKey, getJwtSecret } from '../common/security/security.config';
import { extractUserAccessToken } from '../common/security/cookie-security.util';
import { RedisSecurityService } from '../common/security/redis-security.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor(
        private configService: ConfigService,
        @InjectRepository(SessionEntity)
        private sessionRepository: Repository<SessionEntity>,
        @Inject(CACHE_MANAGER)
        private cacheManager: Cache,
        @Optional()
        private redisSecurity?: RedisSecurityService,
    ) {
        super({
            jwtFromRequest: (req: any) => extractUserAccessToken(req),
            ignoreExpiration: false,
            secretOrKey: getJwtSecret(configService),
            passReqToCallback: true,
        });
    }

    async validate(req: any, payload: any) {
        if (payload?.isTwoFactorPending) {
            throw new UnauthorizedException('Token temporário de 2FA não autorizado nesta rota');
        }
        const token = extractUserAccessToken(req);
        if (!token) {
            throw new UnauthorizedException('Token não encontrado na requisição');
        }

        // Check explicit JTI revocation list (instant invalidation on logout / password reset / theft)
        if (payload?.jti && this.redisSecurity) {
            const revoked = await this.redisSecurity
                .getValue(`jwt_revoked:${payload.jti}`)
                .catch(() => null);
            if (revoked) {
                throw new UnauthorizedException('Sessão revogada. Inicie sessão novamente.');
            }
        }

        const cacheKey = buildSessionCacheKey(token);
        const isCachedActive = await this.cacheManager.get(cacheKey);

        if (isCachedActive === 'active') {
            return {
                id: payload.id,
                email: payload.email,
                jti: payload.jti,
                isTwoFactorVerified: !!payload.isTwoFactorVerified,
            };
        }

        // Verify session exists and is active in DB
        const session = await this.sessionRepository.findOne({
            where: { token, isActive: true },
        });

        if (!session || new Date() > session.expiresAt) {
            throw new UnauthorizedException('Sessão inválida ou expirada');
        }

        // Cache active session status back in Redis (hashed key)
        const remainingTime = Math.max(0, session.expiresAt.getTime() - Date.now());
        if (remainingTime > 0) {
            await this.cacheManager.set(cacheKey, 'active', remainingTime);
        }

        return {
            id: payload.id,
            email: payload.email,
            jti: payload.jti,
            isTwoFactorVerified: !!payload.isTwoFactorVerified,
        };
    }
}
