import {
    Injectable,
    CanActivate,
    ExecutionContext,
    UnauthorizedException,
    ForbiddenException,
    Optional,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import {
    extractTrustedClientIp,
    getAdminJwtSecret,
} from '../common/security/security.config';
import { extractAdminToken } from '../common/security/cookie-security.util';
import { RedisSecurityService } from '../common/security/redis-security.service';

@Injectable()
export class AdminAuthGuard implements CanActivate {
    constructor(
        private jwtService: JwtService,
        private configService: ConfigService,
        @Optional() private redisSecurity?: RedisSecurityService,
    ) {}

    private isIpAllowed(request: any): boolean {
        const allowlistRaw = (this.configService.get<string>('ADMIN_IP_ALLOWLIST') || '').trim();
        if (!allowlistRaw) return true;
        const clientIp = extractTrustedClientIp(request);
        const entries = allowlistRaw
            .split(',')
            .map((e) => e.trim())
            .filter(Boolean);
        return entries.some((allowed) =>
            allowed.endsWith('*')
                ? clientIp.startsWith(allowed.slice(0, -1))
                : clientIp === allowed,
        );
    }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();

        if (!this.isIpAllowed(request)) {
            throw new ForbiddenException('Acesso administrativo restrito a IPs autorizados.');
        }

        const token = extractAdminToken(request);
        if (!token) {
            throw new UnauthorizedException('Token de administrador ausente');
        }

        const secret = getAdminJwtSecret(this.configService);

        try {
            const payload = await this.jwtService.verifyAsync(token, { secret });
            const adminEmail = (this.configService.get<string>('ADMIN_EMAIL') || '')
                .trim()
                .toLowerCase();
            const tokenEmail = String(payload?.email || '').trim().toLowerCase();

            if (!adminEmail || payload.role !== 'admin' || tokenEmail !== adminEmail || !payload.isAdmin) {
                throw new UnauthorizedException('Acesso não autorizado para administradores');
            }

            if (payload?.jti && this.redisSecurity) {
                const revoked = await this.redisSecurity
                    .getValue(`jwt_revoked:${payload.jti}`)
                    .catch(() => null);
                if (revoked) {
                    throw new UnauthorizedException('Sessão de administrador revogada');
                }
            }

            request.admin = payload;
            return true;
        } catch (err) {
            if (err instanceof UnauthorizedException || err instanceof ForbiddenException) {
                throw err;
            }
            throw new UnauthorizedException('Sessão de administrador inválida ou expirada');
        }
    }
}
