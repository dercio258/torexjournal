import {
    Controller,
    Get,
    Post,
    Body,
    Param,
    UseGuards,
    Req,
    Delete,
    Query,
    UseInterceptors,
    UploadedFile,
    Optional,
} from '@nestjs/common';
import { FastifyFileInterceptor } from '../common/interceptors/fastify-file.interceptor';
import { CloudflareR2StorageService } from '../common/security/cloudflare-r2-storage.service';
import { NetworkService } from './network.service';
import { NetworkAcademyService } from './video-lesson.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlanGuard, RequirePlan } from '../payment/plan.guard';
import { PlanTier } from '../payment/plan-permission.service';
import { NetworkGateway } from './network.gateway';
import {
    AddPostCommentDto,
    CreateNetworkPostDto,
    DirectMessageDto,
    LessonCommentDto,
    MarkLessonWatchedDto,
    PostChannelMessageDto,
} from './dto/network.dto';
import {
    sanitizeInternalImageUrl,
    sanitizePlainText,
    sanitizeRichHtml,
} from '../common/security/input-sanitizer.util';

@Controller('network')
@UseGuards(JwtAuthGuard, PlanGuard)
@RequirePlan(PlanTier.BASIC)
export class NetworkController {
    constructor(
        private readonly networkService: NetworkService,
        private readonly academyService: NetworkAcademyService,
        private readonly networkGateway: NetworkGateway,
        @Optional() private readonly r2Storage?: CloudflareR2StorageService,
    ) {}

    // =========================================================================
    // VIDEOAULAS & PLAYER DEDICADO (LIKES, COMENTÁRIOS E SELO BLOQUEADO/ASSISTIDO)
    // =========================================================================

    @Get('lessons')
    async listLessons(@Req() req) {
        return this.academyService.listLessonsForUser(req.user.id);
    }

    @Get('lessons/:id')
    async getLessonDetail(@Req() req, @Param('id') id: string) {
        return this.academyService.getLessonDetailForUser(req.user.id, id);
    }

    @Post('lessons/:id/watch')
    async markLessonWatched(
        @Req() req,
        @Param('id') id: string,
        @Body() body: MarkLessonWatchedDto
    ) {
        return this.academyService.markLessonWatched(
            req.user.id,
            id,
            body?.isWatched !== undefined ? Boolean(body.isWatched) : true
        );
    }

    @Post('lessons/:id/like')
    @RequirePlan(PlanTier.PRO)
    async toggleLessonLike(@Req() req, @Param('id') id: string) {
        return this.academyService.toggleLessonLike(req.user.id, id);
    }

    @Post('lessons/:id/comments')
    @RequirePlan(PlanTier.PRO)
    async addLessonComment(
        @Req() req,
        @Param('id') id: string,
        @Body() body: LessonCommentDto
    ) {
        return this.academyService.addLessonComment(
            req.user.id,
            id,
            sanitizePlainText(body?.content, 2000)
        );
    }

    @Delete('lessons/:id/comments/:commentId')
    @RequirePlan(PlanTier.PRO)
    async deleteLessonComment(
        @Req() req,
        @Param('id') id: string,
        @Param('commentId') commentId: string
    ) {
        return this.academyService.deleteLessonComment(
            req.user.id,
            id,
            commentId
        );
    }

    // =========================================================================
    // CONVERSAS ENTRE USUÁRIOS (SALAS TEMÁTICAS & MENSAGENS DIRETAS 1-A-1)
    // =========================================================================

    @Get('chat/history')
    async getChatHistory(@Query('room') room: string = 'global') {
        const safeRoom = /^[a-z0-9_-]{2,32}$/i.test(String(room || '').trim())
            ? String(room).trim().toLowerCase()
            : 'global';
        return this.networkService.getChatHistory(safeRoom);
    }

    @Post('chat/message')
    @RequirePlan(PlanTier.PRO)
    async postChannelMessage(
        @Req() req,
        @Body() body: PostChannelMessageDto
    ) {
        const rawRoom = String(body?.room || 'global').trim().toLowerCase();
        const safeRoom = /^[a-z0-9_-]{2,32}$/i.test(rawRoom) ? rawRoom : 'global';
        const msg = await this.networkService.saveChatMessage(
            req.user.id,
            sanitizePlainText(body?.content, 2000),
            safeRoom
        );
        this.networkGateway.server?.to(safeRoom).emit('msgToClient', msg);
        return msg;
    }

    @Get('conversations')
    async listDirectConversations(@Req() req) {
        return this.networkService.listDirectConversations(req.user.id);
    }

    @Get('conversations/:partnerId/messages')
    async getDirectMessages(
        @Req() req,
        @Param('partnerId') partnerId: string
    ) {
        return this.networkService.getDirectMessages(req.user.id, partnerId);
    }

    @Post('conversations/:partnerId/messages')
    @RequirePlan(PlanTier.PRO)
    async sendDirectMessage(
        @Req() req,
        @Param('partnerId') partnerId: string,
        @Body() body: DirectMessageDto
    ) {
        return this.networkService.sendDirectMessage(
            req.user.id,
            partnerId,
            sanitizePlainText(body?.content, 2000)
        );
    }

    // =========================================================================
    // FEED DA COMUNIDADE, PUBLICAÇÕES, MEMBROS E PERFIS
    // =========================================================================

    @Get('feed')
    async getFeed(@Req() req, @Query('page') page: number = 1) {
        return this.networkService.getFeed(req.user.id, page);
    }

    @Post('upload')
    @RequirePlan(PlanTier.PRO)
    @UseInterceptors(
        new FastifyFileInterceptor('file', {
            allowedImageOnly: true,
            maxFileSizeBytes: 5 * 1024 * 1024,
        }),
    )
    async uploadImage(@UploadedFile() file) {
        const mime = String(file?.mimetype || '').toLowerCase();
        const ext = mime.includes('webp')
            ? 'webp'
            : mime.includes('gif')
              ? 'gif'
              : mime.includes('jp')
                ? 'jpg'
                : 'png';
        if (this.r2Storage && file?.buffer) {
            const stored = await this.r2Storage.uploadPublicObject({
                folder: 'network',
                buffer: file.buffer,
                ext,
                contentType: file.mimetype,
            });
            return {
                imageUrl: stored.url,
                provider: stored.provider,
            };
        }
        return { imageUrl: `/uploads/${file.filename}` };
    }

    @Post('post')
    @RequirePlan(PlanTier.PRO)
    async createPost(@Req() req, @Body() body: CreateNetworkPostDto) {
        const safeContent = sanitizeRichHtml(body.content, 10000);
        const safeImageUrl = sanitizeInternalImageUrl(body.imageUrl);
        return this.networkService.createPost(
            req.user.id,
            safeContent,
            body.type,
            body.tradeData,
            body.visibility,
            safeImageUrl
        );
    }

    @Delete('post/:id')
    @RequirePlan(PlanTier.PRO)
    async deletePost(@Req() req, @Param('id') postId: number) {
        return this.networkService.deletePost(req.user.id, Number(postId));
    }

    @Post('post/:id/like')
    @RequirePlan(PlanTier.PRO)
    async toggleLike(@Req() req, @Param('id') postId: number) {
        return this.networkService.toggleLike(req.user.id, Number(postId));
    }

    @Post('post/:id/comment')
    @RequirePlan(PlanTier.PRO)
    async addComment(
        @Req() req,
        @Param('id') postId: number,
        @Body() body: AddPostCommentDto
    ) {
        return this.networkService.addComment(
            req.user.id,
            Number(postId),
            sanitizePlainText(body.content, 2000)
        );
    }

    @Get('trending')
    async getTrending() {
        return this.networkService.getTrending();
    }

    @Get('suggestions')
    async getSuggestions(@Req() req) {
        return this.networkService.getSuggestedUsers(req.user.id);
    }

    @Post('follow/:id')
    @RequirePlan(PlanTier.PRO)
    async followUser(@Req() req, @Param('id') id: string) {
        return this.networkService.followUser(req.user.id, id);
    }

    @Delete('follow/:id')
    @RequirePlan(PlanTier.PRO)
    async unfollowUser(@Req() req, @Param('id') id: string) {
        return this.networkService.unfollowUser(req.user.id, id);
    }

    @Get('users')
    async getUsers(@Req() req, @Query('q') query: string) {
        return this.networkService.getUsers(req.user.id, query);
    }

    @Get('profile/:id')
    async getUserProfile(@Req() req, @Param('id') id: string) {
        const targetId = id === 'me' ? req.user.id : id;
        return this.networkService.getUserProfile(targetId, req.user.id);
    }

    @Get('profile/:id/posts')
    async getUserPosts(@Req() req, @Param('id') id: string) {
        const targetId = id === 'me' ? req.user.id : id;
        return this.networkService.getUserPosts(targetId, req.user.id);
    }
}
