import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { extractTrustedClientIp } from '../security/security.config';

@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
    async canActivate(context: ExecutionContext): Promise<boolean> {
        const res = context.switchToHttp().getResponse();

        // Skip throttling for non-HTTP contexts (e.g., Telegraf long-polling / internal microservices)
        if (!res || typeof res.header !== 'function') {
            return true;
        }

        return super.canActivate(context);
    }

    protected async getTracker(req: Record<string, any>): Promise<string> {
        // Use Fastify's trusted-proxy IP resolution (never trust spoofable UA or raw headers)
        return extractTrustedClientIp(req);
    }
}
