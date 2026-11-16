import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
    constructor(private configService: ConfigService) {
        const baseUrl = (configService.get<string>('BASE_URL') || '').trim().replace(/\/+$/, '');
        const defaultCallback = baseUrl
            ? `${baseUrl}/api/auth/google/callback`
            : 'http://localhost:3000/api/auth/google/callback';

        super({
            clientID:
                configService.get<string>('GOOGLE_CLIENT_ID') ||
                configService.get<string>('id_client_google') ||
                'dummy_google_client_id',
            clientSecret:
                configService.get<string>('GOOGLE_CLIENT_SECRET') ||
                configService.get<string>('secret_key_google') ||
                'dummy_google_secret',
            callbackURL: configService.get<string>('GOOGLE_CALLBACK_URL') || defaultCallback,
            scope: ['email', 'profile'],
        });
    }

    async validate(
        accessToken: string,
        _refreshToken: string,
        profile: any,
        done: VerifyCallback,
    ): Promise<any> {
        const { name, emails, photos, id, _json } = profile || {};
        const primaryEmailObj = emails?.[0];
        const email = primaryEmailObj?.value ? String(primaryEmailObj.value).trim().toLowerCase() : null;
        const emailVerified =
            typeof _json?.email_verified === 'boolean'
                ? _json.email_verified
                : typeof primaryEmailObj?.verified === 'boolean'
                  ? primaryEmailObj.verified
                  : true;

        const user = {
            googleId: id,
            email,
            emailVerified,
            name: [name?.givenName, name?.familyName].filter(Boolean).join(' ') || undefined,
            firstName: name?.givenName,
            lastName: name?.familyName,
            avatarUrl: photos?.[0]?.value,
            picture: photos?.[0]?.value,
            accessToken,
        };
        done(null, user);
    }
}
