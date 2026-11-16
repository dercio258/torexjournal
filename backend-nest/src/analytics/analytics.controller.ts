import {
    Body,
    Controller,
    Get,
    Param,
    Post,
    Query,
    Req,
    Res,
    UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { OptionalJwtAuthGuard } from '../common/guards/optional-jwt-auth.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { extractTrustedClientIp } from '../common/security/security.config';
import { AnalyticsService, TRANSPARENT_1X1_GIF } from './analytics.service';
import { IdentifyVisitorDto, RecordUserActivityDto, TrackBatchDto } from './dto/analytics.dto';

@Controller()
export class AnalyticsController {
    constructor(private readonly analyticsService: AnalyticsService) {}

    @SkipThrottle()
    @Get('analytics/pixel-config')
    async getPublicPixelConfig() {
        return this.analyticsService.getPublicPixelConfig();
    }

    @UseGuards(OptionalJwtAuthGuard)
    @Post('analytics/track')
    async trackEvents(@Body() body: TrackBatchDto, @Req() req: any) {
        const userId = req?.user?.userId || req?.user?.id || req?.user?.sub || null;
        const ip = extractTrustedClientIp(req);
        const userAgent = req?.headers?.['user-agent'] || '';
        return this.analyticsService.recordEventsBatch(body.events || [], {
            userId,
            ip,
            userAgent,
        });
    }

    @UseGuards(JwtAuthGuard)
    @Post('analytics/identify')
    async identifyVisitor(@Body() body: IdentifyVisitorDto, @Req() req: any) {
        const userId = req?.user?.userId || req?.user?.id || req?.user?.sub;
        return this.analyticsService.identifyVisitor(
            userId,
            body.visitorId,
            body.attributionData,
        );
    }

    @UseGuards(JwtAuthGuard)
    @Post('analytics/activity')
    async recordActivity(@Body() body: RecordUserActivityDto, @Req() req: any) {
        const userId = req?.user?.userId || req?.user?.id || req?.user?.sub;
        return this.analyticsService.recordAuthenticatedActivity(userId, body, {
            ip: extractTrustedClientIp(req),
            userAgent: req?.headers?.['user-agent'] || '',
        });
    }

    @SkipThrottle()
    @Get('track/email/open/:token')
    async trackEmailOpen(
        @Param('token') token: string,
        @Req() req: any,
        @Res() reply: any,
    ) {
        const ip = extractTrustedClientIp(req);
        const userAgent = req?.headers?.['user-agent'] || '';
        await this.analyticsService.trackEmailOpen(token, ip, userAgent);

        reply
            .header('Content-Type', 'image/gif')
            .header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
            .header('Pragma', 'no-cache')
            .header('Expires', '0')
            .send(TRANSPARENT_1X1_GIF);
    }

    @SkipThrottle()
    @Get('track/email/click')
    async trackEmailClick(
        @Query('t') token: string,
        @Query('u') rawUrl: string,
        @Query('sig') sig: string,
        @Query('cta') cta: string,
        @Req() req: any,
        @Res() reply: any,
    ) {
        const ip = extractTrustedClientIp(req);
        const userAgent = req?.headers?.['user-agent'] || '';
        const safeDest = await this.analyticsService.trackEmailClick(
            token,
            rawUrl,
            sig,
            cta,
            ip,
            userAgent,
        );
        return reply.status(302).redirect(safeDest);
    }
}
