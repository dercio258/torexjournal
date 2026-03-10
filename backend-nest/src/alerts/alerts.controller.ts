import { Controller, Get, Post, Patch, Param, Body, UseGuards, Request } from '@nestjs/common';
import { AlertsService } from './alerts.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ScoringService } from './scoring.service';

@Controller('alerts')
@UseGuards(JwtAuthGuard)
export class AlertsController {
    constructor(
        private readonly alertsService: AlertsService,
        private readonly scoringService: ScoringService
    ) { }

    @Get()
    findAll(@Request() req) {
        return this.alertsService.findAll(req.user.id);
    }

    @Get('stats')
    getStats(@Request() req) {
        return this.alertsService.getStats(req.user.id);
    }

    @Get('score')
    getScore(@Request() req) {
        return this.scoringService.calculateHealthScore(req.user.id);
    }

    @Patch(':id/resolve')
    resolve(@Param('id') id: string, @Request() req) {
        return this.alertsService.resolve(id, req.user.id);
    }
}
