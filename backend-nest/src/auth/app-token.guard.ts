import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountEntity } from '../account/account.entity';

@Injectable()
export class AppTokenGuard implements CanActivate {
    constructor(
        @InjectRepository(AccountEntity)
        private accountRepo: Repository<AccountEntity>,
    ) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<any>();
        // Headers are lowercase in Express unless configured otherwise
        const token = request.headers['x-app-token'] as string || request.body.token;

        if (!token) {
            throw new UnauthorizedException('Missing App Token');
        }

        // We check if any account owns this token
        // Optimization: In real world, we might cache this or check specifically against the MT5 ID payload if provided
        // But for generic 'save-history', we just need ANY valid app token.
        // However, we should probably attach the account to the request for the controller to use.
        const account = await this.accountRepo.findOne({ where: { appToken: token } });

        if (!account) {
            throw new UnauthorizedException('Invalid App Token');
        }

        // Attach account to request object
        request['account'] = account;
        return true;
    }
}
