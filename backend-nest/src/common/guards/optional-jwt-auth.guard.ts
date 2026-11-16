import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { getJwtSecret } from '../security/security.config';

@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
    constructor(
        private readonly jwtService: JwtService,
        private readonly configService: ConfigService,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const authHeader = request.headers?.authorization;

        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.split(' ')[1];
            const secret = getJwtSecret(this.configService);
            try {
                const payload = await this.jwtService.verifyAsync(token, { secret });
                request.user = payload?.isTwoFactorPending ? null : payload;
            } catch {
                request.user = null;
            }
        } else {
            request.user = null;
        }

        return true;
    }
}
