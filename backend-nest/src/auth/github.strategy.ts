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

    async validate(_accessToken: string, _refreshToken: string, profile: Profile): Promise<any> {
        const { id, username, emails, photos, displayName } = profile as any;
        const emailList: any[] = Array.isArray(emails) ? emails : [];
        const verifiedEntry =
            emailList.find((e) => e?.verified === true && e?.primary === true) ||
            emailList.find((e) => e?.verified === true) ||
            emailList[0];

        const rawEmail = verifiedEntry?.value ? String(verifiedEntry.value).trim().toLowerCase() : null;
        const hasVerifiedFlag = typeof verifiedEntry?.verified === 'boolean';
        const emailVerified = hasVerifiedFlag ? Boolean(verifiedEntry.verified) : Boolean(rawEmail);

        return {
            githubId: id,
            email: rawEmail,
            emailVerified,
            name: displayName || username,
            avatarUrl: photos?.[0]?.value,
        };
    }
}
