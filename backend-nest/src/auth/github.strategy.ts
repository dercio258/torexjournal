import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile } from 'passport-github2';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class GithubStrategy extends PassportStrategy(Strategy, 'github') {
    constructor(private configService: ConfigService) {
        super({
            clientID: configService.get<string>('GITHUB_CLIENT_ID'),
            clientSecret: configService.get<string>('GITHUB_CLIENT_SECRET'),
            callbackURL: configService.get<string>('GITHUB_CALLBACK_URL'),
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
