import { ExecutionContext, Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { getOAuthStateSecret, isRequestHttps } from '../common/security/security.config';
import {
    buildClearOAuthStateCookieHeader,
    generateOAuthState,
    verifyOAuthState,
} from './oauth-state.util';

function appendSetCookie(res: any, cookieValue: string) {
    if (!res) return;
    if (typeof res.getHeader === 'function' && typeof res.setHeader === 'function') {
        const prev = res.getHeader('Set-Cookie');
        const next = Array.isArray(prev)
            ? [...prev, cookieValue]
            : prev
              ? [String(prev), cookieValue]
              : [cookieValue];
        res.setHeader('Set-Cookie', next);
    } else if (typeof res.header === 'function') {
        res.header('Set-Cookie', cookieValue);
    }
}

function getQueryParams(req: any): Record<string, string | undefined> {
    if (req?.query && typeof req.query === 'object') {
        return req.query;
    }
    const rawUrl = String(req?.url || '');
    const qIdx = rawUrl.indexOf('?');
    if (qIdx === -1) return {};
    const parsed: Record<string, string> = {};
    const search = new URLSearchParams(rawUrl.slice(qIdx + 1));
    search.forEach((v, k) => {
        parsed[k] = v;
    });
    return parsed;
}

@Injectable()
export class GoogleOauthGuard extends AuthGuard('google') {
    constructor(@Optional() private readonly configService?: ConfigService) {
        super();
    }

    getRequest(context: ExecutionContext) {
        const req = context.switchToHttp().getRequest();
        return req.raw || req;
    }

    getResponse(context: ExecutionContext) {
        const res = context.switchToHttp().getResponse();
        return res.raw || res;
    }

    getAuthenticateOptions(context: ExecutionContext) {
        const req = context.switchToHttp().getRequest();
        const rawReq = req.raw || req;
        const cleanPath = String(rawReq?.url || '').split('?')[0];
        const query = getQueryParams(req);
        const isCallback =
            cleanPath.endsWith('/callback') ||
            Boolean(query.code || query.error || query.state);
        if (isCallback) {
            return undefined;
        }

        const secret = getOAuthStateSecret(this.configService);
        const https = isRequestHttps(req);
        const { state, setCookieHeader } = generateOAuthState(secret, https);
        const rawRes = this.getResponse(context);
        appendSetCookie(rawRes, setCookieHeader);
        return { state };
    }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const req = context.switchToHttp().getRequest();
        const rawReq = req.raw || req;
        const rawRes = this.getResponse(context);
        const cleanPath = String(rawReq?.url || '').split('?')[0];
        const query = getQueryParams(req);
        const isCallback =
            cleanPath.endsWith('/callback') ||
            Boolean(query.code || query.error || query.state);

        if (isCallback) {
            const secret = getOAuthStateSecret(this.configService);
            const https = isRequestHttps(req);
            const ok = verifyOAuthState(query.state, rawReq?.headers?.cookie, secret);
            appendSetCookie(rawRes, buildClearOAuthStateCookieHeader(https));
            if (!ok) {
                throw new UnauthorizedException(
                    'Falha na validação de segurança OAuth (state inválido ou expirado).',
                );
            }
        }

        const result = (await super.canActivate(context)) as boolean;
        if (req.raw && req.raw.user) {
            req.user = req.raw.user;
        }
        return result;
    }
}
