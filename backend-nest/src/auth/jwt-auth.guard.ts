import {
    Injectable,
    ExecutionContext,
    UnauthorizedException,
    HttpException,
    HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UsersService } from '../users/users.service';
import { RedisSecurityService } from '../common/security/redis-security.service';
import { extractTrustedClientIp } from '../common/security/security.config';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
    constructor(
        private readonly redisSecurity: RedisSecurityService,
        private readonly usersService: UsersService,
    ) {
        super();
    }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();

        // 1. Atomic Redis Rate Limiting by trusted IP (not spoofable headers)
        const ip = extractTrustedClientIp(request);
        const rateLimitKey = `rl:private_access:${ip}`;
        const { count } = await this.redisSecurity.incrementWithWindow(rateLimitKey, 60_000);

        if (count > 200) {
            throw new HttpException(
                {
                    statusCode: HttpStatus.TOO_MANY_REQUESTS,
                    message: 'Limite de requisições excedido. Máximo de 200 tentativas por minuto.',
                    error: 'Too Many Requests',
                },
                HttpStatus.TOO_MANY_REQUESTS,
            );
        }

        // 2. Validate JWT token using Passport AuthGuard
        try {
            const isAuth = await super.canActivate(context);
            if (!isAuth) {
                throw new UnauthorizedException('Não autenticado');
            }
        } catch (err: any) {
            throw new UnauthorizedException(
                err?.message || 'Token de autenticação inválido ou expirado',
            );
        }

        const reqUser = request.user;
        if (!reqUser || !reqUser.id) {
            throw new UnauthorizedException('Usuário não identificado no token');
        }

        // 3. Enforce blocked status & 2FA verification check using Redis-cached lightweight snapshot
        const user = await this.usersService.getAuthGuardSnapshot(reqUser.id);
        if (!user) {
            throw new UnauthorizedException('Usuário não encontrado no banco de dados');
        }

        if (user.isBlocked) {
            throw new HttpException(
                {
                    statusCode: HttpStatus.FORBIDDEN,
                    message:
                        'Acesso bloqueado. Por favor, recupere sua conta através do link enviado por e-mail.',
                    error: 'Blocked Account',
                },
                HttpStatus.FORBIDDEN,
            );
        }

        if (user.twoFactorEnabled && user.isTwoFactorConfirmed) {
            if (!reqUser.isTwoFactorVerified) {
                throw new UnauthorizedException('Verificação 2FA pendente para esta sessão');
            }
        }

        return true;
    }
}
