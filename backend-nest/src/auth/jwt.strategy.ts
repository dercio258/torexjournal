import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SessionEntity } from './session.entity';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor(
        private configService: ConfigService,
        @InjectRepository(SessionEntity)
        private sessionRepository: Repository<SessionEntity>,
        @Inject(CACHE_MANAGER)
        private cacheManager: Cache,
    ) {
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: configService.get<string>('JWT_SECRET') || 'default_secret_key',
            passReqToCallback: true,
        });
    }

    async validate(req: any, payload: any) {
        const token = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
        if (!token) {
            throw new UnauthorizedException('Token não encontrado no cabeçalho da requisição');
        }

        const cacheKey = `user_session:${token}`;
        const isCachedActive = await this.cacheManager.get(cacheKey);

        if (isCachedActive === 'active') {
            return { 
                id: payload.id, 
                email: payload.email, 
                isTwoFactorVerified: !!payload.isTwoFactorVerified 
            };
        }

        // Verify session exists and is active in DB
        const session = await this.sessionRepository.findOne({
            where: { token, isActive: true }
        });

        if (!session || new Date() > session.expiresAt) {
            throw new UnauthorizedException('Sessão inválida ou expirada');
        }

        // Cache active session status back in Redis
        const remainingTime = Math.max(0, session.expiresAt.getTime() - Date.now());
        if (remainingTime > 0) {
            await this.cacheManager.set(cacheKey, 'active', remainingTime);
        }

        return { 
            id: payload.id, 
            email: payload.email, 
            isTwoFactorVerified: !!payload.isTwoFactorVerified 
        };
    }
}
