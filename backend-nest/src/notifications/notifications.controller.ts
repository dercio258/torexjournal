
import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlanGuard, RequirePlan } from '../payment/plan.guard';
import { PlanTier } from '../payment/plan-permission.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard, PlanGuard)
@RequirePlan(PlanTier.BASIC)
export class NotificationsController {
    constructor(
        private readonly notificationsService: NotificationsService,
    ) { }

    @Get()
    async findAll(
        @Req() req,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
        @Query('paginated') paginated?: string,
    ) {
        return this.notificationsService.findAll(req.user.id, {
            page: page ? Number(page) : undefined,
            limit: limit ? Number(limit) : undefined,
            paginated: paginated === 'true' || paginated === '1',
        });
    }

    @Patch('read-all')
    async markAllAsRead(@Req() req) {
        return this.notificationsService.markAllAsRead(req.user.id);
    }

    @Patch(':id/read')
    async markAsRead(@Param('id') id: string, @Req() req) {
        return this.notificationsService.markAsRead(id, req.user.id);
    }

    @Delete(':id')
    async remove(@Param('id') id: string, @Req() req) {
        return this.notificationsService.remove(id, req.user.id);
    }

    @Post('settings')
    async updateSettings(@Req() req, @Body() body: any) {
        return this.notificationsService.updateSettings(req.user.id, body);
    }

    @Post('test')
    async sendTest(@Req() req, @Body() body: { title: string; message: string; type?: string }) {
        return this.notificationsService.create(req.user.id, {
            title: body.title || 'Test Notification',
            message: body.message || 'This is a test notification.',
            type: body.type as any || 'INFO'
        });
    }
}
