import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AdminAuthGuard implements CanActivate {
    constructor(
        private jwtService: JwtService,
        private configService: ConfigService
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const authHeader = request.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            throw new UnauthorizedException('Token de administrador ausente');
        }

        const token = authHeader.split(' ')[1];
        const secret = this.configService.get<string>('JWT_SECRET');

        try {
            const payload = await this.jwtService.verifyAsync(token, { secret });
            const adminEmail = this.configService.get<string>('ADMIN_EMAIL');

            if (payload.role !== 'admin' || payload.email !== adminEmail || !payload.isAdmin) {
                throw new UnauthorizedException('Acesso não autorizado para administradores');
            }

            request.admin = payload;
            return true;
        } catch (error) {
            throw new UnauthorizedException('Sessão de administrador inválida ou expirada');
        }
    }
}
