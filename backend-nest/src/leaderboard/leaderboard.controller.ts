import { Controller, Get, Post, Query, UseGuards, Req } from '@nestjs/common';
import { LeaderboardService, LeaderboardFilterDto } from './leaderboard.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlanGuard, RequirePlan } from '../payment/plan.guard';
import { PlanTier } from '../payment/plan-permission.service';
import { AdminAuthGuard } from '../admin/admin-auth.guard';

@Controller('leaderboard')
export class LeaderboardController {
    constructor(private readonly leaderboardService: LeaderboardService) {}

    @Get()
    @UseGuards(JwtAuthGuard, PlanGuard)
    @RequirePlan(PlanTier.BASIC)
    async getLeaderboard(@Req() req, @Query() query: LeaderboardFilterDto) {
        const currentUserId = req.user?.id || req.user?.sub;
        return this.leaderboardService.getLeaderboard(query, currentUserId);
    }

    @Get('me')
    @UseGuards(JwtAuthGuard, PlanGuard)
    @RequirePlan(PlanTier.BASIC)
    async getMyRank(@Req() req) {
        const userId = req.user?.id || req.user?.sub;
        return this.leaderboardService.getMyRank(userId);
    }

    @Post('recalculate')
    @UseGuards(AdminAuthGuard)
    async recalculate() {
        await this.leaderboardService.recalculateRanks();
        return { success: true, message: 'Classificação recalculada com sucesso.' };
    }
}
