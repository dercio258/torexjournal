import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile } from 'passport-github2';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class GithubStrategy extends PassportStrategy(Strategy, 'github') {
    constructor(private configService: ConfigService) {
        const baseUrl = (configService.get<string>('BASE_URL') || '').trim().replace(/\/+$/, '');
        const defaultCallback = baseUrl
            ? `${baseUrl}/api/auth/github/callback`
            : 'http://localhost:3000/api/auth/github/callback';

        super({
            clientID:
                configService.get<string>('GITHUB_CLIENT_ID') ||
                configService.get<string>('client_auth_github') ||
                'dummy_github_client_id',
            clientSecret:
                configService.get<string>('GITHUB_CLIENT_SECRET') ||
                configService.get<string>('secret_key_github') ||
                'dummy_github_secret',
            callbackURL: configService.get<string>('GITHUB_CALLBACK_URL') || defaultCallback,
            scope: ['user:email'],
        });
    }

    async validate(accessToken: string, _refreshToken: string, profile: Profile): Promise<any> {
        const { id, username, emails, photos, displayName } = profile as any;
        const emailList: any[] = Array.isArray(emails) ? emails : [];
        const verifiedEntry =
            emailList.find((e) => e?.verified === true && e?.primary === true) ||
            emailList.find((e) => e?.verified === true);

        let rawEmail = verifiedEntry?.value
            ? String(verifiedEntry.value).trim().toLowerCase()
            : emailList[0]?.value
              ? String(emailList[0].value).trim().toLowerCase()
              : null;
        let emailVerified = verifiedEntry?.verified === true;

        // Se o perfil retornado pelo passport-github2 não incluir flag `verified`, valida diretamente na API /user/emails
        if (!emailVerified && accessToken) {
            try {
                const res = await fetch('https://api.github.com/user/emails', {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        Accept: 'application/vnd.github+json',
                        'User-Agent': 'TorexJournal',
                    },
                    signal: AbortSignal.timeout(5000),
                });
                if (res.ok) {
                    const apiEmails = (await res.json()) as any[];
                    if (Array.isArray(apiEmails)) {
                        const verifiedApiEntry =
                            apiEmails.find((e) => e?.verified === true && e?.primary === true) ||
                            apiEmails.find((e) => e?.verified === true);
                        if (verifiedApiEntry?.email) {
                            rawEmail = String(verifiedApiEntry.email).trim().toLowerCase();
                            emailVerified = true;
                        }
                    }
                }
            } catch {
                // Fail-closed: mantém emailVerified = false se não conseguir confirmar
            }
        }

        return {
            githubId: id,
            email: rawEmail,
            emailVerified,
            name: displayName || username,
            avatarUrl: photos?.[0]?.value,
        };
    }
}
