import { Injectable, ExecutionContext, UnauthorizedException, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { UsersService } from '../users/users.service';
import * as crypto from 'crypto';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
    constructor(
        @Inject(CACHE_MANAGER) private cacheManager: Cache,
        private usersService: UsersService
    ) {
        super();
    }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();

        // 1. Rate Limiting on private/dashboard routes
        const ip = request.headers['x-forwarded-for'] || request.socket.remoteAddress || request.ip || 'unknown_ip';
        const userAgent = request.headers['user-agent'] || 'unknown_ua';
        const deviceSignature = request.headers['x-device-signature'] || 'no_sig';

        // Hash UA + IP + Sig to create a secure request fingerprint
        const fingerprint = crypto.createHash('sha256').update(`${ip}:${userAgent}:${deviceSignature}`).digest('hex');
        const rateLimitKey = `rl:private_access:${fingerprint}`;

        let attempts = (await this.cacheManager.get<number>(rateLimitKey)) || 0;
        if (attempts >= 9) {
            throw new HttpException({
                statusCode: HttpStatus.TOO_MANY_REQUESTS,
                message: 'Limite de requisições excedido. Máximo de 9 tentativas por minuto.',
                error: 'Too Many Requests'
            }, HttpStatus.TOO_MANY_REQUESTS);
        }
        await this.cacheManager.set(rateLimitKey, attempts + 1, 60000); // 1 minute window

        // 2. Validate JWT token using Passport AuthGuard
        try {
            const isAuth = await super.canActivate(context);
            if (!isAuth) {
                throw new UnauthorizedException('Não autenticado');
            }
        } catch (err) {
            throw new UnauthorizedException(err.message || 'Token de autenticação inválido ou expirado');
        }

        const reqUser = request.user;
        if (!reqUser || !reqUser.id) {
            throw new UnauthorizedException('Usuário não identificado no token');
        }

        // 3. Enforce 2FA verification check if user has 2FA enabled
        const user = await this.usersService.findOneById(reqUser.id);
        if (!user) {
            throw new UnauthorizedException('Usuário não encontrado no banco de dados');
        }

        if (user.isBlocked) {
            throw new HttpException({
                statusCode: HttpStatus.FORBIDDEN,
                message: 'Acesso bloqueado. Por favor, recupere sua conta através do link enviado por e-mail.',
                error: 'Blocked Account'
            }, HttpStatus.FORBIDDEN);
        }

        if (user.twoFactorEnabled && user.isTwoFactorConfirmed) {
            if (!reqUser.isTwoFactorVerified) {
                throw new UnauthorizedException('Verificação 2FA pendente para esta sessão');
            }
        }

        return true;
    }
}
