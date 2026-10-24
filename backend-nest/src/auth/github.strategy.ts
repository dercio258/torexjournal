import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile } from 'passport-github2';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class GithubStrategy extends PassportStrategy(Strategy, 'github') {
    constructor(private configService: ConfigService) {
        super({
            clientID: configService.get<string>('GITHUB_CLIENT_ID') || configService.get<string>('client_auth_github') || 'dummy_github_client_id',
            clientSecret: configService.get<string>('GITHUB_CLIENT_SECRET') || configService.get<string>('secret_key_github') || 'dummy_github_secret',
            callbackURL: configService.get<string>('GITHUB_CALLBACK_URL') || 'http://localhost:3000/api/auth/github/callback',
            scope: ['user:email'],
        });
    }

    async validate(accessToken: string, refreshToken: string, profile: Profile): Promise<any> {
        const { id, username, emails, photos, displayName } = profile;
        const user = {
            githubId: id,
            email: emails?.[0]?.value,
            name: displayName || username,
            avatarUrl: photos?.[0]?.value,
        };
        return user;
    }
}
