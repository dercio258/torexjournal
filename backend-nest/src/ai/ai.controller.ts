import { Controller, Get, Post, UseGuards, Req, Param, Body, NotFoundException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AiService } from './ai.service';
import { AccountEntity } from '../account/account.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
    constructor(
        private readonly aiService: AiService,
        @InjectRepository(AccountEntity)
        private readonly accountRepo: Repository<AccountEntity>
    ) { }

    @Get('insights')
    async getInsights(@Req() req) {
        const userId = req.user.id;
        const account = await this.accountRepo.findOne({ where: { userId } });
        if (!account) throw new NotFoundException('Account not found');

        return this.aiService.getInsightsByAccount(account.id);
    }

    // Manual triggers if needed
    @Post('generate')
    async forceGenerate(@Req() req, @Body() data: { metrics: any }) {
        const userId = req.user.id;
        const account = await this.accountRepo.findOne({ where: { userId } });
        if (!account) throw new NotFoundException('Account not found');

        return this.aiService.generateInsights(account.id, userId, data.metrics);
    }
}
