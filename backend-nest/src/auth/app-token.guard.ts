import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountEntity } from '../account/account.entity';

@Injectable()
export class AppTokenGuard implements CanActivate {
    constructor(
        @InjectRepository(AccountEntity)
        private accountRepo: Repository<AccountEntity>,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<any>();
        const rawHeaderToken = request.headers?.['x-app-token'];
        const rawBodyToken = request.body?.token;
        const token = String(rawHeaderToken || rawBodyToken || '').trim();

        if (!token || token.length < 8) {
            throw new UnauthorizedException('Missing App Token');
        }

        const account = await this.accountRepo.findOne({
            where: { appToken: token },
            select: ['id', 'userId', 'appToken', 'mt5Id'],
        });

        if (!account) {
            throw new UnauthorizedException('Invalid App Token');
        }

        request['account'] = account;
        return true;
    }
}
