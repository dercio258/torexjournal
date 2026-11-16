import {
    BadRequestException,
    ForbiddenException,
    Inject,
    Injectable,
    NotFoundException,
    forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Post } from './post.entity';
import { Comment } from './comment.entity';
import { Like } from './like.entity';
import { Follow } from './follow.entity';
import { ChatMessage } from './chat-message.entity';
import { NetworkDirectMessageEntity } from './video-lesson.entity';
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
        @InjectRepository(NetworkDirectMessageEntity)
        private dmRepo: Repository<NetworkDirectMessageEntity>,
        @InjectRepository(Follow)
        private followRepo: Repository<Follow>,
        @InjectRepository(UserEntity)
        private userRepo: Repository<UserEntity>,
        @Inject(forwardRef(() => NetworkGateway))
        private networkGateway: NetworkGateway
    ) {}

    async followUser(followerId: string, followingId: string) {
        if (followerId === followingId) {
            throw new BadRequestException('Não pode seguir a si mesmo.');
        }

        const existing = await this.followRepo.findOne({
            where: { followerId, followingId },
        });
        if (existing) return existing;

        const follow = this.followRepo.create({ followerId, followingId });
        return this.followRepo.save(follow);
    }

    async unfollowUser(followerId: string, followingId: string) {
        const existing = await this.followRepo.findOne({
            where: { followerId, followingId },
        });
        if (existing) {
            await this.followRepo.remove(existing);
        }
        return { success: true };
    }

    async getFollowers(userId: string) {
        return this.followRepo.find({
            where: { followingId: userId },
            relations: ['follower'],
        });
    }

    async getFollowing(userId: string) {
        return this.followRepo.find({
            where: { followerId: userId },
            relations: ['following'],
        });
    }

    // =========================================================================
    // SALAS DE CONVERSA DA COMUNIDADE (CANAIS EM TEMPO REAL)
    // =========================================================================

    async getChatHistory(room: string = 'global') {
        const safeRoom = String(room || 'global').trim().slice(0, 50) || 'global';
        const recent = await this.chatRepo.find({
            where: { room: safeRoom },
            order: { createdAt: 'DESC' },
            take: 80,
            relations: ['user'],
        });

        return recent.reverse().map((m) => ({
            id: m.id,
            content: m.content,
            room: m.room || 'global',
            userId: m.userId,
            createdAt: m.createdAt,
            user: {
                id: m.user?.id || m.userId,
                username: m.user?.username || m.user?.name || 'Trader',
                name: m.user?.name || m.user?.username || 'Trader',
                avatarUrl: m.user?.avatarUrl || null,
            },
        }));
    }

    async saveChatMessage(
        userId: string,
        content: string,
        room: string = 'global'
    ) {
        const cleanContent = String(content || '').trim().slice(0, 1000);
        if (!cleanContent) {
            throw new BadRequestException('Mensagem vazia.');
        }
        const safeRoom = String(room || 'global').trim().slice(0, 50) || 'global';

        const user = await this.userRepo.findOne({ where: { id: userId } });
        if (!user) {
            throw new NotFoundException('Utilizador não encontrado.');
        }

        const msg = this.chatRepo.create({
            user,
            userId,
            content: cleanContent,
            room: safeRoom,
        });
        await this.chatRepo.save(msg);

        return {
            id: msg.id,
            content: msg.content,
            room: safeRoom,
            userId,
            createdAt: msg.createdAt,
            user: {
                id: user.id,
                username: user.username || user.name || 'Trader',
                name: user.name || user.username || 'Trader',
                avatarUrl: user.avatarUrl || null,
            },
        };
    }

    // =========================================================================
    // CONVERSAS DIRETAS 1-PARA-1 ENTRE USUÁRIOS (DMs)
    // =========================================================================

    async listDirectConversations(userId: string) {
        const messages = await this.dmRepo.find({
            where: [{ senderId: userId }, { recipientId: userId }],
            order: { createdAt: 'DESC' },
            take: 400,
        });

        const byPartner = new Map<
            string,
            {
                partnerId: string;
                lastMessage: string;
                lastMessageAt: Date;
                lastSenderId: string;
                unreadCount: number;
            }
        >();

        for (const msg of messages) {
            const partnerId =
                msg.senderId === userId ? msg.recipientId : msg.senderId;
            if (!partnerId || partnerId === userId) continue;

            const existing = byPartner.get(partnerId);
            if (!existing) {
                byPartner.set(partnerId, {
                    partnerId,
                    lastMessage: msg.content,
                    lastMessageAt: msg.createdAt,
                    lastSenderId: msg.senderId,
                    unreadCount:
                        msg.recipientId === userId && !msg.isRead ? 1 : 0,
                });
            } else if (msg.recipientId === userId && !msg.isRead) {
                existing.unreadCount += 1;
            }
        }

        const partnerIds = Array.from(byPartner.keys());
        if (partnerIds.length === 0) {
            return [];
        }

        const partners = await this.userRepo.find({
            where: { id: In(partnerIds) },
            select: ['id', 'username', 'name', 'avatarUrl'],
        });
        const partnerMap = new Map(partners.map((p) => [p.id, p]));

        return Array.from(byPartner.values())
            .sort(
                (a, b) =>
                    new Date(b.lastMessageAt).getTime() -
                    new Date(a.lastMessageAt).getTime()
            )
            .map((entry) => {
                const p = partnerMap.get(entry.partnerId);
                return {
                    partner: {
                        id: entry.partnerId,
                        username: p?.username || p?.name || 'trader',
                        name: p?.name || p?.username || 'Trader',
                        avatarUrl: p?.avatarUrl || null,
                    },
                    lastMessage: entry.lastMessage,
                    lastMessageAt: entry.lastMessageAt,
                    lastSenderId: entry.lastSenderId,
                    unreadCount: entry.unreadCount,
                };
            });
    }

    async getDirectMessages(userId: string, partnerId: string) {
        if (!partnerId) {
            throw new BadRequestException('Destinatário inválido.');
        }

        const partner = await this.userRepo.findOne({
            where: { id: partnerId },
            select: ['id', 'username', 'name', 'avatarUrl'],
        });
        if (!partner) {
            throw new NotFoundException('Utilizador não encontrado.');
        }

        // Marca mensagens recebidas deste parceiro como lidas
        await this.dmRepo.update(
            { senderId: partnerId, recipientId: userId, isRead: false },
            { isRead: true }
        );

        const messages = await this.dmRepo.find({
            where: [
                { senderId: userId, recipientId: partnerId },
                { senderId: partnerId, recipientId: userId },
            ],
            order: { createdAt: 'ASC' },
            take: 150,
        });

        return {
            partner: {
                id: partner.id,
                username: partner.username || partner.name || 'trader',
                name: partner.name || partner.username || 'Trader',
                avatarUrl: partner.avatarUrl || null,
            },
            messages: messages.map((m) => ({
                id: m.id,
                senderId: m.senderId,
                recipientId: m.recipientId,
                content: m.content,
                isRead: m.isRead,
                createdAt: m.createdAt,
            })),
        };
    }

    async sendDirectMessage(
        senderId: string,
        recipientId: string,
        rawContent: string
    ) {
        const content = String(rawContent || '').trim().slice(0, 1000);
        if (!content) {
            throw new BadRequestException('Digite uma mensagem válida.');
        }
        if (senderId === recipientId) {
            throw new BadRequestException(
                'Não pode enviar mensagem direta para si mesmo.'
            );
        }

        const [sender, recipient] = await Promise.all([
            this.userRepo.findOne({
                where: { id: senderId },
                select: ['id', 'username', 'name', 'avatarUrl'],
            }),
            this.userRepo.findOne({
                where: { id: recipientId },
                select: ['id', 'username', 'name', 'avatarUrl'],
            }),
        ]);

        if (!sender || !recipient) {
            throw new NotFoundException('Utilizador não encontrado.');
        }

        const saved = await this.dmRepo.save(
            this.dmRepo.create({
                senderId,
                recipientId,
                content,
                isRead: false,
            })
        );

        const payload = {
            id: saved.id,
            senderId: saved.senderId,
            recipientId: saved.recipientId,
            content: saved.content,
            isRead: saved.isRead,
            createdAt: saved.createdAt,
            sender: {
                id: sender.id,
                username: sender.username || sender.name || 'trader',
                name: sender.name || sender.username || 'Trader',
                avatarUrl: sender.avatarUrl || null,
            },
            recipient: {
                id: recipient.id,
                username: recipient.username || recipient.name || 'trader',
                name: recipient.name || recipient.username || 'Trader',
                avatarUrl: recipient.avatarUrl || null,
            },
        };

        this.networkGateway.broadcastDirectMessage(
            senderId,
            recipientId,
            payload
        );

        return payload;
    }

    // =========================================================================
    // FEED DA COMUNIDADE, INTERAÇÕES & PERFIS
    // =========================================================================

    private mapPostComments(comments?: Comment[]) {
        if (!Array.isArray(comments)) return [];
        return [...comments]
            .sort(
                (a, b) =>
                    new Date(a.createdAt).getTime() -
                    new Date(b.createdAt).getTime()
            )
            .map((c) => ({
                id: c.id,
                postId: c.postId,
                content: c.content,
                createdAt: c.createdAt,
                user: {
                    id: c.user?.id || c.userId,
                    username:
                        c.user?.username || c.user?.name || 'trader',
                    name: c.user?.name || c.user?.username || 'Trader',
                    avatarUrl: c.user?.avatarUrl || null,
                },
            }));
    }

    async getFeed(userId: string, page: number = 1) {
        const take = 20;
        const pageNum = Number(page) || 1;
        const safePage = pageNum > 0 ? pageNum : 1;
        const skip = (safePage - 1) * take;

        const [posts, total] = await this.postRepo.findAndCount({
            where: [{ visibility: 'public' }, { userId }],
            order: { createdAt: 'DESC' },
            take,
            skip,
            relations: ['user', 'comments', 'comments.user'],
        });

        const postIds = posts.map((p) => p.id);
        const likedRows =
            postIds.length > 0 && userId
                ? await this.likeRepo.find({
                      where: { userId, postId: In(postIds) },
                      select: ['postId'],
                  })
                : [];
        const likedPostIds = new Set(likedRows.map((l) => l.postId));

        const postsWithStatus = posts.map((p) => ({
            ...p,
            isLiked: likedPostIds.has(p.id),
            comments: this.mapPostComments(p.comments),
            user: {
                id: p.user?.id || p.userId || 'deleted',
                username: p.user?.username || p.user?.name || 'Trader',
                name: p.user?.name || p.user?.username || 'Trader',
                avatarUrl: p.user?.avatarUrl || null,
            },
        }));

        return {
            data: postsWithStatus,
            meta: { total, page: safePage, last_page: Math.ceil(total / take) },
        };
    }

    async createPost(
        userId: string,
        content: string,
        type: string = 'text',
        tradeData?: any,
        visibility: string = 'public',
        imageUrl?: string
    ) {
        const user = await this.userRepo.findOne({ where: { id: userId } });
        if (!user) throw new NotFoundException('Utilizador não encontrado.');

        const post = this.postRepo.create({
            user,
            userId,
            content: String(content || '').trim(),
            type,
            tradeData,
            visibility,
            imageUrl,
        });

        const savedPost = await this.postRepo.save(post);

        const fullPost = await this.postRepo.findOne({
            where: { id: savedPost.id },
            relations: ['user', 'comments', 'comments.user'],
        });

        const formatted = {
            ...fullPost,
            comments: this.mapPostComments(fullPost?.comments),
            user: {
                id: user.id,
                username: user.username || user.name || 'Trader',
                name: user.name || user.username || 'Trader',
                avatarUrl: user.avatarUrl || null,
            },
            isLiked: false,
        };

        this.networkGateway.broadcastNewPost(formatted);
        return formatted;
    }

    async deletePost(userId: string, postId: number) {
        const post = await this.postRepo.findOne({ where: { id: postId } });
        if (!post) throw new NotFoundException('Publicação não encontrada.');
        if (post.userId !== userId) {
            throw new ForbiddenException('Sem permissão para remover esta publicação.');
        }
        await this.likeRepo.delete({ postId });
        await this.commentRepo.delete({ postId });
        await this.postRepo.delete({ id: postId });
        return { success: true };
    }

    async toggleLike(userId: string, postId: number) {
        const post = await this.postRepo.findOne({ where: { id: postId } });
        if (!post) throw new NotFoundException('Publicação não encontrada.');

        const existing = await this.likeRepo.findOne({
            where: { userId, postId },
        });

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
            userId,
        });

        return { liked: !existing, count: post.likesCount };
    }

    async addComment(userId: string, postId: number, rawContent: string) {
        const content = String(rawContent || '').trim().slice(0, 800);
        if (!content) {
            throw new BadRequestException('Escreva um comentário.');
        }

        const [user, post] = await Promise.all([
            this.userRepo.findOne({ where: { id: userId } }),
            this.postRepo.findOne({ where: { id: postId } }),
        ]);
        if (!post || !user) {
            throw new NotFoundException('Publicação não encontrada.');
        }

        const comment = this.commentRepo.create({
            user,
            userId,
            post,
            postId,
            content,
        });

        const savedComment = await this.commentRepo.save(comment);

        post.commentsCount += 1;
        await this.postRepo.save(post);

        const formattedComment = {
            id: savedComment.id,
            postId,
            content: savedComment.content,
            createdAt: savedComment.createdAt,
            user: {
                id: user.id,
                username: user.username || user.name || 'Trader',
                name: user.name || user.username || 'Trader',
                avatarUrl: user.avatarUrl || null,
            },
        };

        this.networkGateway.broadcastInteraction({
            type: 'comment',
            postId,
            commentsCount: post.commentsCount,
            comment: formattedComment,
        });

        return formattedComment;
    }

    async getTrending() {
        const posts = await this.postRepo.find({
            order: { likesCount: 'DESC', createdAt: 'DESC' },
            take: 5,
            relations: ['user'],
        });

        return posts.map((post) => ({
            id: post.id,
            content: post.content,
            likesCount: post.likesCount,
            commentsCount: post.commentsCount,
            createdAt: post.createdAt,
            type: post.type,
            imageUrl: post.imageUrl,
            tradeData: post.tradeData,
            user: post.user
                ? {
                      id: post.user.id,
                      username: post.user.username,
                      name: post.user.name,
                      avatarUrl: post.user.avatarUrl || null,
                  }
                : null,
        }));
    }

    async getSuggestedUsers(userId: string) {
        // Evita full table scan com ORDER BY RANDOM(): amostra os 48 membros mais recentes e embaralha em memória
        const candidates = await this.userRepo
            .createQueryBuilder('user')
            .where('user.id != :userId', { userId })
            .select(['user.id', 'user.username', 'user.avatarUrl', 'user.name', 'user.createdAt'])
            .orderBy('user.createdAt', 'DESC')
            .take(48)
            .getMany();

        for (let i = candidates.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
        }
        return candidates.slice(0, 6).map(({ id, username, avatarUrl, name }) => ({
            id,
            username,
            avatarUrl,
            name,
        }));
    }

    async getUsers(currentUserId: string, query?: string) {
        const qb = this.userRepo
            .createQueryBuilder('user')
            .where('user.id != :currentUserId', { currentUserId })
            .select(['user.id', 'user.username', 'user.avatarUrl', 'user.name']);

        if (query) {
            qb.andWhere(
                '(user.username ILIKE :query OR user.name ILIKE :query)',
                { query: `%${query}%` }
            );
        }

        const users = await qb.take(30).getMany();
        const userIds = users.map((u) => u.id);
        const followRows =
            userIds.length > 0 && currentUserId
                ? await this.followRepo.find({
                      where: { followerId: currentUserId, followingId: In(userIds) },
                      select: ['followingId'],
                  })
                : [];
        const followingSet = new Set(followRows.map((f) => f.followingId));

        return users.map((u) => ({
            ...u,
            isFollowing: followingSet.has(u.id),
        }));
    }

    async getUserProfile(targetUserId: string, currentUserId: string) {
        const user = await this.userRepo.findOne({
            where: { id: targetUserId },
            select: ['id', 'username', 'name', 'avatarUrl', 'createdAt'],
        });

        if (!user) return null;

        const [followersCount, followingCount, postsCount, isFollowing] =
            await Promise.all([
                this.followRepo.count({ where: { followingId: targetUserId } }),
                this.followRepo.count({ where: { followerId: targetUserId } }),
                this.postRepo.count({ where: { userId: targetUserId } }),
                this.followRepo.findOne({
                    where: {
                        followerId: currentUserId,
                        followingId: targetUserId,
                    },
                }),
            ]);

        return {
            ...user,
            stats: {
                followers: followersCount,
                following: followingCount,
                posts: postsCount,
            },
            isFollowing: !!isFollowing,
        };
    }

    async getUserPosts(userId: string, currentUserId: string) {
        const whereCondition =
            userId === currentUserId
                ? { userId }
                : { userId, visibility: 'public' };

        const posts = await this.postRepo.find({
            where: whereCondition,
            order: { createdAt: 'DESC' },
            take: 50,
            relations: ['user', 'comments', 'comments.user'],
        });

        const postIds = posts.map((p) => p.id);
        const likedRows =
            postIds.length > 0 && currentUserId
                ? await this.likeRepo.find({
                      where: { userId: currentUserId, postId: In(postIds) },
                      select: ['postId'],
                  })
                : [];
        const likedSet = new Set(likedRows.map((l) => l.postId));

        return posts.map((p) => ({
            ...p,
            isLiked: likedSet.has(p.id),
            comments: this.mapPostComments(p.comments),
            user: {
                id: p.user?.id || 'deleted',
                username: p.user?.username || p.user?.name || 'Trader',
                name: p.user?.name || p.user?.username || 'Trader',
                avatarUrl: p.user?.avatarUrl || null,
            },
        }));
    }
}
