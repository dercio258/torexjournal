import { Controller, Get, Post, Body, Param, UseGuards, Req, Delete, Query } from '@nestjs/common';
import { NetworkService } from './network.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('network')
export class NetworkController {
    constructor(private readonly networkService: NetworkService) { }

    @Get('feed')
    @UseGuards(JwtAuthGuard)
    async getFeed(@Req() req, @Query('page') page: number = 1) {
        return this.networkService.getFeed(req.user.id, page);
    }

    @Post('post')
    @UseGuards(JwtAuthGuard)
    async createPost(@Req() req, @Body() body: any) {
        return this.networkService.createPost(req.user.id, body.content, body.type, body.tradeData);
    }

    @Post('post/:id/like')
    @UseGuards(JwtAuthGuard)
    async toggleLike(@Req() req, @Param('id') postId: number) {
        return this.networkService.toggleLike(req.user.id, postId);
    }

    @Post('post/:id/comment')
    @UseGuards(JwtAuthGuard)
    async addComment(@Req() req, @Param('id') postId: number, @Body() body: { content: string }) {
        return this.networkService.addComment(req.user.id, postId, body.content);
    }

    @Get('chat/history')
    @UseGuards(JwtAuthGuard)
    async getChatHistory() {
        return this.networkService.getChatHistory();
    }

    @Get('trending')
    @UseGuards(JwtAuthGuard)
    async getTrending() {
        return this.networkService.getTrending();
    }

    @Get('suggestions')
    @UseGuards(JwtAuthGuard)
    async getSuggestions(@Req() req) {
        return this.networkService.getSuggestedUsers(req.user.id);
    }

    @Post('follow/:id')
    @UseGuards(JwtAuthGuard)
    async followUser(@Req() req, @Param('id') id: string) {
        return this.networkService.followUser(req.user.id, id);
    }

    @Delete('follow/:id')
    @UseGuards(JwtAuthGuard)
    async unfollowUser(@Req() req, @Param('id') id: string) {
        return this.networkService.unfollowUser(req.user.id, id);
    }
    @Get('users')
    @UseGuards(JwtAuthGuard)
    async getUsers(@Req() req, @Query('q') query: string) {
        return this.networkService.getUsers(req.user.id, query);
    }

    @Get('profile/:id')
    @UseGuards(JwtAuthGuard)
    async getUserProfile(@Req() req, @Param('id') id: string) {
        const targetId = id === 'me' ? req.user.id : id;
        return this.networkService.getUserProfile(targetId, req.user.id);
    }

    @Get('profile/:id/posts')
    @UseGuards(JwtAuthGuard)
    async getUserPosts(@Req() req, @Param('id') id: string) {
        const targetId = id === 'me' ? req.user.id : id;
        return this.networkService.getUserPosts(targetId, req.user.id);
    }
}
