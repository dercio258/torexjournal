import { Controller, Get, Post, UseGuards, Request } from '@nestjs/common';
import { AccountService } from './account.service';
import { AuthGuard } from '@nestjs/passport';

@Controller('account')
export class AccountController {
    constructor(private accountService: AccountService) { }

    @UseGuards(AuthGuard('jwt'))
    @Get()
    async getAccount(@Request() req) {
        return this.accountService.findOneByUserId(req.user.id);
    }

    @UseGuards(AuthGuard('jwt'))
    @Post('reset-connection')
    async resetConnection(@Request() req) {
        return this.accountService.resetConnection(req.user.id);
    }
}
