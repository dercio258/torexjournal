import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Post } from './post.entity';
import { Comment } from './comment.entity';
import { Like } from './like.entity';
import { Follow } from './follow.entity';
import { ChatMessage } from './chat-message.entity';
import { UserEntity } from '../users/user.entity';
import { NetworkGateway } from './network.gateway';

@Injectable()
export class NetworkService {
    constructor(
        @InjectRepository(Post)
        private postRepo: Repository<Post>,
        @InjectRepository(Comment)
        private commentRepo: Repository<Comment>,
        @InjectRepository(Like)
        private likeRepo: Repository<Like>,
        @InjectRepository(ChatMessage)
        private chatRepo: Repository<ChatMessage>,
        @InjectRepository(Follow)
        private followRepo: Repository<Follow>,
        @InjectRepository(UserEntity)
        private userRepo: Repository<UserEntity>,
        @Inject(forwardRef(() => NetworkGateway))
        private networkGateway: NetworkGateway
    ) { }

    async followUser(followerId: string, followingId: string) {
        if (followerId === followingId) throw new Error('Cannot follow yourself');

        const existing = await this.followRepo.findOne({ where: { followerId, followingId } });
        if (existing) return existing;

        const follow = this.followRepo.create({ followerId, followingId });
        return this.followRepo.save(follow);
    }

    async unfollowUser(followerId: string, followingId: string) {
        const existing = await this.followRepo.findOne({ where: { followerId, followingId } });
        if (existing) {
            await this.followRepo.remove(existing);
        }
        return { success: true };
    }

    async getFollowers(userId: string) {
        return this.followRepo.find({
            where: { followingId: userId },
            relations: ['follower']
        });
    }

    async getFollowing(userId: string) {
        return this.followRepo.find({
            where: { followerId: userId },
            relations: ['following']
        });
    }

    async getChatHistory() {
        return this.chatRepo.find({
            order: { createdAt: 'DESC' },
            take: 50,
            relations: ['user']
        });
    }

    async saveChatMessage(userId: string, content: string) {
        const user = await this.userRepo.findOne({ where: { id: userId } });
        const msg = this.chatRepo.create({
            user,
            userId,
            content,
            room: 'global'
        });
        await this.chatRepo.save(msg);

        return {
            id: msg.id,
            content: msg.content,
            createdAt: msg.createdAt,
            user: {
                id: user.id,
                username: user.username || user.name || 'Desconhecido',
                avatarUrl: user.avatarUrl
            }
        };
    }

    async getFeed(userId: string, page: number = 1) {
        const take = 20;
        const pageNum = Number(page) || 1;
        const safePage = pageNum > 0 ? pageNum : 1;
        const skip = (safePage - 1) * take;

        const [posts, total] = await this.postRepo.findAndCount({
            where: [
                { visibility: 'public' },
                { userId } // User can always see their own posts
            ],
            order: { createdAt: 'DESC' },
            take,
            skip,
            relations: ['user', 'comments'], // Load user and comments
        });

        // Check if current user liked each post
        // Optimization: Could be done with query builder for performance
        const postsWithStatus = await Promise.all(posts.map(async p => {
            const isLiked = await this.likeRepo.findOne({ where: { postId: p.id, userId } });
            return {
                ...p,
                isLiked: !!isLiked,
                user: {
                    id: p.user?.id || 'deleted',
                    username: p.user?.username || p.user?.name || 'Desconhecido',
                    avatarUrl: p.user?.avatarUrl
                }
            };
        }));

        return {
            data: postsWithStatus,
            meta: { total, page, last_page: Math.ceil(total / take) }
        };
    }

    async createPost(userId: string, content: string, type: string = 'text', tradeData?: any, visibility: string = 'public', imageUrl?: string) {
        const user = await this.userRepo.findOne({ where: { id: userId } });
        if (!user) throw new Error('User not found');

        const post = this.postRepo.create({
            user,
            userId,
            content,
            type,
            tradeData,
            visibility,
            imageUrl
        });

        const savedPost = await this.postRepo.save(post);

        // Broadcast
        const fullPost = await this.postRepo.findOne({
            where: { id: savedPost.id },
            relations: ['user', 'comments'] // Ensure structure matches feed
        });

        this.networkGateway.broadcastNewPost({
            ...fullPost,
            user: { username: user.username || user.name || 'Desconhecido', avatarUrl: user.avatarUrl },
            isLiked: false
        });

        return savedPost;
    }

    async toggleLike(userId: string, postId: number) {
        const existing = await this.likeRepo.findOne({ where: { userId, postId } });
        const post = await this.postRepo.findOne({ where: { id: postId } });

        if (existing) {
            await this.likeRepo.remove(existing);
            post.likesCount = Math.max(0, post.likesCount - 1);
        } else {
            const like = this.likeRepo.create({ userId, postId });
            await this.likeRepo.save(like);
            post.likesCount += 1;
        }
        await this.postRepo.save(post);

        this.networkGateway.broadcastInteraction({
            type: 'like',
            postId,
            likesCount: post.likesCount,
            userId
        });

        return { liked: !existing, count: post.likesCount };
    }

    async addComment(userId: string, postId: number, content: string) {
        const user = await this.userRepo.findOne({ where: { id: userId } });
        const post = await this.postRepo.findOne({ where: { id: postId } });

        const comment = this.commentRepo.create({
            user,
            userId,
            post,
            postId,
            content
        });

        const savedComment = await this.commentRepo.save(comment);

        post.commentsCount += 1;
        await this.postRepo.save(post);

        this.networkGateway.broadcastInteraction({
            type: 'comment',
            postId,
            commentsCount: post.commentsCount,
            comment: {
                ...savedComment,
                user: { username: user.username || user.name || 'Desconhecido', avatarUrl: user.avatarUrl }
            }
        });

        return {
            ...savedComment,
            user: { username: user.username || user.name || 'Desconhecido', avatarUrl: user.avatarUrl }
        };
    }

    async getTrending() {
        return this.postRepo.find({
            order: { likesCount: 'DESC', createdAt: 'DESC' },
            take: 5,
            relations: ['user']
        });
    }

    async getSuggestedUsers(userId: string) {
        // Simple suggestion: Get 5 users who are not the current user
        // In a real app, this would be based on mutuals, activity, etc.
        return this.userRepo.createQueryBuilder('user')
            .where('user.id != :userId', { userId })
            .select(['user.id', 'user.username', 'user.avatarUrl', 'user.name'])
            .orderBy('RANDOM()')
            .take(5)
            .getMany();
    }

    async getUsers(currentUserId: string, query?: string) {
        const qb = this.userRepo.createQueryBuilder('user')
            .where('user.id != :currentUserId', { currentUserId })
            .select(['user.id', 'user.username', 'user.avatarUrl', 'user.name']);

        if (query) {
            qb.andWhere('(user.username ILIKE :query OR user.name ILIKE :query)', { query: `%${query}%` });
        }

        const users = await qb.take(20).getMany();

        // Check following status
        return Promise.all(users.map(async u => {
            const isFollowing = await this.followRepo.findOne({
                where: { followerId: currentUserId, followingId: u.id }
            });
            return {
                ...u,
                isFollowing: !!isFollowing
            };
        }));
    }

    async getUserProfile(targetUserId: string, currentUserId: string) {
        const user = await this.userRepo.findOne({
            where: { id: targetUserId },
            select: ['id', 'username', 'name', 'avatarUrl', 'createdAt']
        });

        if (!user) return null;

        const followersCount = await this.followRepo.count({ where: { followingId: targetUserId } });
        const followingCount = await this.followRepo.count({ where: { followerId: targetUserId } });
        const postsCount = await this.postRepo.count({ where: { userId: targetUserId } });

        const isFollowing = await this.followRepo.findOne({
            where: { followerId: currentUserId, followingId: targetUserId }
        });

        return {
            ...user,
            stats: {
                followers: followersCount,
                following: followingCount,
                posts: postsCount
            },
            isFollowing: !!isFollowing
        };
    }

    async getUserPosts(userId: string, currentUserId: string) {
        // Build query condition
        const whereCondition = userId === currentUserId
            ? { userId } // Own profile, see everything
            : { userId, visibility: 'public' }; // Other profile, see only public

        const posts = await this.postRepo.find({
            where: whereCondition,
            order: { createdAt: 'DESC' },
            relations: ['user', 'comments']
        });

        return Promise.all(posts.map(async p => {
            const isLiked = await this.likeRepo.findOne({ where: { postId: p.id, userId: currentUserId } });
            return {
                ...p,
                isLiked: !!isLiked,
                user: {
                    id: p.user?.id || 'deleted',
                    username: p.user?.username || p.user?.name || 'Desconhecido',
                    avatarUrl: p.user?.avatarUrl
                }
            };
        }));
    }
}
