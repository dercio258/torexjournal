import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountEntity } from './account.entity';
import { UsersService } from '../users/users.service';

@Injectable()
export class AccountService {
    constructor(
        @InjectRepository(AccountEntity)
        private accountRepository: Repository<AccountEntity>,
        private usersService: UsersService,
    ) { }

    async findOneByUserId(userId: string): Promise<AccountEntity> {
        const account = await this.accountRepository.findOne({ where: { userId } });
        if (!account) {
            throw new NotFoundException('Account not found');
        }
        return account;
    }

    async resetConnection(userId: string) {
        const account = await this.accountRepository.findOne({ where: { userId } });
        if (!account) {
            throw new NotFoundException('Account not found');
        }

        account.mt5Id = 'PENDING';
        account.isConnected = false;
        account.balance = 0;
        account.equity = 0;
        account.margin = 0;
        account.marginFree = 0;
        account.marginLevel = 0;

        // We do NOT clear the appToken, so the user doesn't strictly need to update EA if they just want to switch accounts on the same token.
        // But usually a reset implies a fresh start. Keeping token is better UX though.

        await this.accountRepository.save(account);
        return { success: true, message: 'Connection reset successfully' };
    }
}
