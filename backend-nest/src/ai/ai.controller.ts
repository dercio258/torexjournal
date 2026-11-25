import {
    Controller,
    Get,
    Post,
    Delete,
    UseGuards,
    Req,
    Param,
    Query,
    Body,
    Patch,
    NotFoundException,
    BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlanGuard, RequirePlan } from '../payment/plan.guard';
import { PlanTier } from '../payment/plan-permission.service';
import { AiService } from './ai.service';
import { TorexAiChatService } from './torex-ai-chat.service';
import { AiCreditsService } from './ai-credits.service';
import {
    CreateAiChatSessionDto,
    ForceGenerateInsightsDto,
    MarkChatJobPresenceDto,
    RecordMessageSignalDto,
    SendAiChatMessageDto,
    SubmitMessageFeedbackDto,
} from './dto/ai.dto';
import { AccountEntity } from '../account/account.entity';
import { AiUserProfileService } from './ai-user-profile.service';
import { ProfileFactType } from './ai-profile-extractor';

const PROFILE_FACT_TYPES: ProfileFactType[] = ['NAME', 'EXPERIENCE', 'STYLE', 'MARKETS', 'GOAL'];

@Controller('ai')
@UseGuards(JwtAuthGuard, PlanGuard)
@RequirePlan(PlanTier.BASIC)
export class AiController {
    constructor(
        private readonly aiService: AiService,
        private readonly torexAiChatService: TorexAiChatService,
        private readonly aiCreditsService: AiCreditsService,
        @InjectRepository(AccountEntity)
        private readonly accountRepo: Repository<AccountEntity>,
        private readonly userProfile: AiUserProfileService
    ) {}

    // ------------------------------------------------------------------ private AI memory (profile)

    private async profileView(userId: string, locale: 'pt' | 'en') {
        const profile = await this.userProfile.getProfile(userId);
        return {
            consent: profile.consent,
            updatedAt: profile.updatedAtIso,
            facts: PROFILE_FACT_TYPES.filter((t) => profile.facts[t]?.value).map((t) => ({
                type: t,
                value: profile.facts[t]!.value,
                label: AiUserProfileService.describeFacts({ ...profile, consent: 'GRANTED', facts: { [t]: profile.facts[t] } }, locale)[0],
                updatedAt: profile.facts[t]!.updatedAtIso,
            })),
        };
    }

    @Get('profile')
    async getProfile(@Req() req: any, @Query('locale') locale?: string) {
        const userId = req.user.id || req.user.userId;
        return this.profileView(userId, locale === 'en' ? 'en' : 'pt');
    }

    @Patch('profile/consent')
    async setProfileConsent(@Req() req: any, @Body() body: { granted?: boolean }, @Query('locale') locale?: string) {
        const userId = req.user.id || req.user.userId;
        if (typeof body?.granted !== 'boolean') {
            throw new BadRequestException('granted must be a boolean');
        }
        await this.userProfile.setConsent(userId, body.granted);
        return this.profileView(userId, locale === 'en' ? 'en' : 'pt');
    }

    @Delete('profile/facts/:type')
    async deleteProfileFact(@Req() req: any, @Param('type') type: string, @Query('locale') locale?: string) {
        const userId = req.user.id || req.user.userId;
        const factType = String(type || '').toUpperCase() as ProfileFactType;
        if (!PROFILE_FACT_TYPES.includes(factType)) {
            throw new BadRequestException('Unknown profile fact type');
        }
        await this.userProfile.removeFact(userId, factType);
        return this.profileView(userId, locale === 'en' ? 'en' : 'pt');
    }

    @Delete('profile')
    async deleteProfile(@Req() req: any) {
        const userId = req.user.id || req.user.userId;
        await this.userProfile.deleteProfile(userId);
        return { deleted: true };
    }

    private resolveAccountId(req: any, queryAccountId?: string): string | undefined {
        const candidate =
            queryAccountId ||
            req.headers?.['x-account-id'] ||
            undefined;
        if (!candidate || candidate === 'all' || candidate === 'null' || candidate === 'undefined') {
            return undefined;
        }
        return String(candidate);
    }

    @Get('credits')
    async getCredits(@Req() req: any) {
        const userId = req.user.id || req.user.userId;
        return this.aiCreditsService.getCreditStatus(userId);
    }

    @Get('status')
    getArchitectureStatus() {
        return this.torexAiChatService.getArchitectureHealth();
    }

    @Get('insights')
    async getInsights(@Req() req: any, @Query('accountId') queryAccountId?: string) {
        const userId = req.user.id || req.user.userId;
        const resolvedId = this.resolveAccountId(req, queryAccountId);
        const account = resolvedId
            ? await this.accountRepo.findOne({ where: { id: resolvedId, userId } })
            : await this.accountRepo.findOne({ where: { userId } });
        if (!account) throw new NotFoundException('Account not found');

        return this.aiService.getInsightsByAccount(account.id);
    }

    @Post('generate')
    async forceGenerate(@Req() req: any, @Body() data: ForceGenerateInsightsDto) {
        const userId = req.user.id || req.user.userId;
        await this.aiCreditsService.assertCanInteract(userId);

        const resolvedId = this.resolveAccountId(req, data?.accountId);
        const account = resolvedId
            ? await this.accountRepo.findOne({ where: { id: resolvedId, userId } })
            : await this.accountRepo.findOne({ where: { userId } });
        if (!account) throw new NotFoundException('Account not found');

        const insight = await this.aiService.generateInsights(account.id, userId, data.metrics);
        if (insight) {
            const replyText = [
                insight.headline || '',
                ...(insight.insights || []),
                ...(insight.actions || []),
            ].join(' ');
            const { cost } = this.aiCreditsService.calculateInteractionCost({
                question: JSON.stringify(data?.metrics || {}),
                reply: replyText,
            });
            await this.aiCreditsService.consumeCredits(userId, cost);
        }
        return insight;
    }

    // ------------------------------------------------------------------------
    // Torex AI — Personal Coach & Platform Assistant (/ai/chat/*)
    // ------------------------------------------------------------------------

    @Get('chat/bootstrap')
    async getChatBootstrap(
        @Req() req: any,
        @Query('accountId') queryAccountId?: string,
        @Query('locale') queryLocale?: string
    ) {
        const userId = req.user.id || req.user.userId;
        const accountId = this.resolveAccountId(req, queryAccountId);
        const locale = queryLocale === 'en' ? 'en' : 'pt';
        return this.torexAiChatService.getBootstrap(userId, accountId, locale);
    }

    @Get('chat/sessions')
    async listChatSessions(@Req() req: any) {
        const userId = req.user.id || req.user.userId;
        return this.torexAiChatService.listSessions(userId);
    }

    @Post('chat/sessions')
    async createChatSession(
        @Req() req: any,
        @Body() body?: CreateAiChatSessionDto
    ) {
        const userId = req.user.id || req.user.userId;
        const accountId = this.resolveAccountId(req, body?.accountId || undefined);
        const locale = body?.locale === 'en' ? 'en' : 'pt';
        return this.torexAiChatService.createSession({
            userId,
            sessionId: body?.id || null,
            accountId: accountId || null,
            title: body?.title || null,
            locale,
        });
    }

    @Get('chat/sessions/:id')
    async getChatSession(@Req() req: any, @Param('id') id: string) {
        const userId = req.user.id || req.user.userId;
        return this.torexAiChatService.getSessionMessages(userId, id);
    }

    @Get('chat/jobs/:jobId')
    async getChatJobStatus(
        @Req() req: any,
        @Param('jobId') jobId: string,
        @Query('visible') visible?: string,
    ) {
        const userId = req.user.id || req.user.userId;
        const clientVisible = visible !== '0' && visible !== 'false';
        return this.torexAiChatService.getJobStatus(userId, jobId, clientVisible);
    }

    @Post('chat/jobs/:jobId/presence')
    async markChatJobPresence(
        @Req() req: any,
        @Param('jobId') jobId: string,
        @Body() body?: MarkChatJobPresenceDto,
    ) {
        const userId = req.user.id || req.user.userId;
        return this.torexAiChatService.markJobPresence(
            userId,
            jobId,
            body?.away !== undefined ? Boolean(body.away) : true,
        );
    }

    @Post('chat/message')
    async sendChatMessage(
        @Req() req: any,
        @Body() body: SendAiChatMessageDto
    ) {
        const userId = req.user.id || req.user.userId;
        const userName =
            req.user.name ||
            req.user.username ||
            req.user.email?.split('@')[0] ||
            'Trader';
        const accountId = this.resolveAccountId(req, body?.accountId || undefined);
        const locale = body?.locale === 'en' ? 'en' : 'pt';

        if (body?.async) {
            return this.torexAiChatService.enqueueMessage({
                userId,
                userName,
                question: body?.message || '',
                sessionId: body?.sessionId || null,
                accountId: accountId || null,
                locale,
            });
        }

        return this.torexAiChatService.sendMessage({
            userId,
            userName,
            question: body?.message || '',
            sessionId: body?.sessionId || null,
            accountId: accountId || null,
            locale,
        });
    }

    @Delete('chat/sessions/:id')
    async deleteChatSession(@Req() req: any, @Param('id') id: string) {
        const userId = req.user.id || req.user.userId;
        return this.torexAiChatService.deleteSession(userId, id);
    }

    /** Implicit feedback the client observes: the user opened a linked page or copied the reply. */
    @Post('chat/messages/:messageId/signal')
    async recordMessageSignal(
        @Req() req: any,
        @Param('messageId') messageId: string,
        @Body() body: RecordMessageSignalDto
    ) {
        const userId = req.user.id || req.user.userId;
        return this.torexAiChatService.recordClientSignal({
            userId,
            messageId,
            signal: String(body?.signal || ''),
        });
    }

    @Post('chat/messages/:messageId/feedback')
    async submitMessageFeedback(
        @Req() req: any,
        @Param('messageId') messageId: string,
        @Body() body: SubmitMessageFeedbackDto
    ) {
        const userId = req.user.id || req.user.userId;
        const userName =
            req.user.name ||
            req.user.username ||
            req.user.email?.split('@')[0] ||
            'Trader';
        const locale = body?.locale === 'en' ? 'en' : 'pt';
        return this.torexAiChatService.submitMessageFeedback({
            userId,
            userName,
            messageId,
            rating: body?.rating,
            reasonCode: body?.reasonCode,
            correctionNote: body?.correctionNote,
            locale,
        });
    }

    @Delete('chat/messages/:messageId/feedback')
    async removeMessageFeedback(
        @Req() req: any,
        @Param('messageId') messageId: string
    ) {
        const userId = req.user.id || req.user.userId;
        return this.torexAiChatService.removeMessageFeedback({
            userId,
            messageId,
        });
    }
}
