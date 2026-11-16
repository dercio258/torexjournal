import {
    BadRequestException,
    ForbiddenException,
    Inject,
    Injectable,
    Logger,
    NotFoundException,
    OnModuleInit,
    forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import {
    NetworkLessonCommentEntity,
    NetworkLessonLikeEntity,
    NetworkLessonProgressEntity,
    NetworkVideoLessonEntity,
} from './video-lesson.entity';
import { UserEntity } from '../users/user.entity';
import { NetworkGateway } from './network.gateway';

export interface AdminUpsertLessonDto {
    title: string;
    description?: string;
    embedInput: string;
    category?: string;
    thumbnailUrl?: string | null;
    durationLabel?: string | null;
    orderIndex?: number;
    isPublished?: boolean;
}

@Injectable()
export class NetworkAcademyService implements OnModuleInit {
    private readonly logger = new Logger(NetworkAcademyService.name);

    constructor(
        private readonly dataSource: DataSource,
        @InjectRepository(NetworkVideoLessonEntity)
        private readonly lessonRepo: Repository<NetworkVideoLessonEntity>,
        @InjectRepository(NetworkLessonProgressEntity)
        private readonly progressRepo: Repository<NetworkLessonProgressEntity>,
        @InjectRepository(NetworkLessonLikeEntity)
        private readonly lessonLikeRepo: Repository<NetworkLessonLikeEntity>,
        @InjectRepository(NetworkLessonCommentEntity)
        private readonly lessonCommentRepo: Repository<NetworkLessonCommentEntity>,
        @InjectRepository(UserEntity)
        private readonly userRepo: Repository<UserEntity>,
        @Inject(forwardRef(() => NetworkGateway))
        private readonly networkGateway: NetworkGateway
    ) {}

    async onModuleInit() {
        try {
            await this.dataSource.query(`
                CREATE TABLE IF NOT EXISTS network_video_lessons (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    title VARCHAR(220) NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    embed_input TEXT NOT NULL,
                    embed_url TEXT NOT NULL,
                    embed_type VARCHAR(30) NOT NULL DEFAULT 'iframe',
                    thumbnail_url TEXT,
                    category VARCHAR(100) NOT NULL DEFAULT 'Formação Principal',
                    duration_label VARCHAR(40),
                    order_index INT NOT NULL DEFAULT 0,
                    is_published BOOLEAN NOT NULL DEFAULT true,
                    likes_count INT NOT NULL DEFAULT 0,
                    comments_count INT NOT NULL DEFAULT 0,
                    views_count INT NOT NULL DEFAULT 0,
                    created_at TIMESTAMP NOT NULL DEFAULT now(),
                    updated_at TIMESTAMP NOT NULL DEFAULT now()
                );
                CREATE INDEX IF NOT EXISTS idx_network_video_lessons_order
                    ON network_video_lessons (is_published, order_index ASC, created_at ASC);

                CREATE TABLE IF NOT EXISTS network_video_progress (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    lesson_id UUID NOT NULL,
                    user_id VARCHAR NOT NULL,
                    is_watched BOOLEAN NOT NULL DEFAULT true,
                    watched_at TIMESTAMP DEFAULT now(),
                    created_at TIMESTAMP NOT NULL DEFAULT now(),
                    updated_at TIMESTAMP NOT NULL DEFAULT now(),
                    UNIQUE (lesson_id, user_id)
                );
                CREATE INDEX IF NOT EXISTS idx_network_video_progress_user
                    ON network_video_progress (user_id, is_watched);

                CREATE TABLE IF NOT EXISTS network_video_likes (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    lesson_id UUID NOT NULL,
                    user_id VARCHAR NOT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT now(),
                    UNIQUE (lesson_id, user_id)
                );
                CREATE INDEX IF NOT EXISTS idx_network_video_likes_lesson
                    ON network_video_likes (lesson_id);

                CREATE TABLE IF NOT EXISTS network_video_comments (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    lesson_id UUID NOT NULL,
                    user_id VARCHAR NOT NULL,
                    content TEXT NOT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT now()
                );
                CREATE INDEX IF NOT EXISTS idx_network_video_comments_lesson
                    ON network_video_comments (lesson_id, created_at DESC);

                CREATE TABLE IF NOT EXISTS network_direct_messages (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    sender_id VARCHAR NOT NULL,
                    recipient_id VARCHAR NOT NULL,
                    content TEXT NOT NULL,
                    is_read BOOLEAN NOT NULL DEFAULT false,
                    created_at TIMESTAMP NOT NULL DEFAULT now()
                );
                CREATE INDEX IF NOT EXISTS idx_network_dm_pair
                    ON network_direct_messages (sender_id, recipient_id, created_at ASC);
                CREATE INDEX IF NOT EXISTS idx_network_dm_recipient_unread
                    ON network_direct_messages (recipient_id, is_read);
            `);
        } catch (err) {
            this.logger.warn(
                `NetworkAcademyService DDL warning: ${(err as Error).message}`
            );
        }
    }

    /**
     * Converte código HTML <iframe ...> ou URL (YouTube, Vimeo, Loom, Drive, Panda, Bunny ou MP4)
     * informado pelo Admin num formato seguro e padronizado para o Player Dedicado e Previews.
     */
    parseEmbedInput(rawEmbed: string): {
        embedUrl: string;
        embedType: 'iframe' | 'video';
        autoThumbnailUrl: string | null;
    } {
        const raw = String(rawEmbed || '').trim();
        if (!raw) {
            throw new BadRequestException(
                'O código de embed ou link do vídeo é obrigatório.'
            );
        }

        let extractedUrl = raw;

        // 1. Se o Admin colou uma tag <iframe ... src="..."> completa
        if (/<iframe/i.test(raw)) {
            const srcMatch = raw.match(/src\s*=\s*["']([^"']+)["']/i);
            if (!srcMatch || !srcMatch[1]) {
                throw new BadRequestException(
                    'Tag <iframe> inválida: atributo src não encontrado.'
                );
            }
            extractedUrl = srcMatch[1].trim();
        }

        if (extractedUrl.startsWith('//')) {
            extractedUrl = `https:${extractedUrl}`;
        }

        if (
            !/^https?:\/\//i.test(extractedUrl) &&
            !extractedUrl.startsWith('/uploads/')
        ) {
            throw new BadRequestException(
                'Forneça um código <iframe> válido ou uma URL iniciada por https://'
            );
        }

        // 2. Ficheiros de vídeo diretos (.mp4, .webm, .ogg, .mov ou /uploads/)
        if (
            /\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(extractedUrl) ||
            extractedUrl.startsWith('/uploads/')
        ) {
            return {
                embedUrl: extractedUrl,
                embedType: 'video',
                autoThumbnailUrl: null,
            };
        }

        // 3. YouTube (watch?v=, youtu.be/, shorts/, live/, embed/)
        const ytMatch = extractedUrl.match(
            /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i
        );
        if (ytMatch && ytMatch[1]) {
            const videoId = ytMatch[1];
            return {
                embedUrl: `https://www.youtube.com/embed/${videoId}?rel=0&modestbranding=1`,
                embedType: 'iframe',
                autoThumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            };
        }

        // 4. Vimeo
        const vimeoMatch = extractedUrl.match(
            /(?:vimeo\.com\/|player\.vimeo\.com\/video\/)(\d+)/i
        );
        if (vimeoMatch && vimeoMatch[1]) {
            return {
                embedUrl: `https://player.vimeo.com/video/${vimeoMatch[1]}`,
                embedType: 'iframe',
                autoThumbnailUrl: null,
            };
        }

        // 5. Loom
        const loomMatch = extractedUrl.match(
            /loom\.com\/(?:share|embed)\/([a-zA-Z0-9]+)/i
        );
        if (loomMatch && loomMatch[1]) {
            return {
                embedUrl: `https://www.loom.com/embed/${loomMatch[1]}`,
                embedType: 'iframe',
                autoThumbnailUrl: null,
            };
        }

        // 6. Google Drive
        const driveMatch = extractedUrl.match(
            /drive\.google\.com\/file\/d\/([^/]+)/i
        );
        if (driveMatch && driveMatch[1]) {
            return {
                embedUrl: `https://drive.google.com/file/d/${driveMatch[1]}/preview`,
                embedType: 'iframe',
                autoThumbnailUrl: null,
            };
        }

        // 7. Qualquer outro player embed (PandaVideo, Bunny Stream, Wistia, Vturb, etc.)
        return {
            embedUrl: extractedUrl,
            embedType: 'iframe',
            autoThumbnailUrl: null,
        };
    }

    // =========================================================================
    // ADMIN CRUD (Setar Embed, Nome e Descrição dos Vídeos)
    // =========================================================================

    async adminListLessons() {
        return this.lessonRepo.find({
            order: { orderIndex: 'ASC', createdAt: 'DESC' },
        });
    }

    async adminCreateLesson(dto: AdminUpsertLessonDto) {
        const title = String(dto.title || '').trim();
        if (!title) {
            throw new BadRequestException('O nome do vídeo é obrigatório.');
        }

        const parsed = this.parseEmbedInput(dto.embedInput);
        const manualThumb = dto.thumbnailUrl ? String(dto.thumbnailUrl).trim() : '';

        let orderIndex = Number(dto.orderIndex);
        if (!Number.isFinite(orderIndex)) {
            const count = await this.lessonRepo.count();
            orderIndex = count + 1;
        }

        const lesson = this.lessonRepo.create({
            title: title.slice(0, 220),
            description: String(dto.description || '').trim(),
            embedInput: String(dto.embedInput || '').trim(),
            embedUrl: parsed.embedUrl,
            embedType: parsed.embedType,
            thumbnailUrl: manualThumb || parsed.autoThumbnailUrl,
            category: String(dto.category || 'Formação Principal').trim() || 'Formação Principal',
            durationLabel: dto.durationLabel ? String(dto.durationLabel).trim().slice(0, 40) : null,
            orderIndex,
            isPublished: dto.isPublished !== undefined ? Boolean(dto.isPublished) : true,
        });

        const saved = await this.lessonRepo.save(lesson);
        this.networkGateway.broadcastLessonCatalogUpdated();
        return saved;
    }

    async adminUpdateLesson(id: string, dto: Partial<AdminUpsertLessonDto>) {
        const existing = await this.lessonRepo.findOne({ where: { id } });
        if (!existing) {
            throw new NotFoundException('Videoaula não encontrada.');
        }

        if (dto.title !== undefined) {
            const cleanTitle = String(dto.title || '').trim();
            if (!cleanTitle) {
                throw new BadRequestException('O nome do vídeo não pode ficar vazio.');
            }
            existing.title = cleanTitle.slice(0, 220);
        }

        if (dto.description !== undefined) {
            existing.description = String(dto.description || '').trim();
        }

        if (dto.embedInput !== undefined && String(dto.embedInput).trim()) {
            const parsed = this.parseEmbedInput(dto.embedInput);
            existing.embedInput = String(dto.embedInput).trim();
            existing.embedUrl = parsed.embedUrl;
            existing.embedType = parsed.embedType;
            if (!dto.thumbnailUrl && parsed.autoThumbnailUrl) {
                existing.thumbnailUrl = parsed.autoThumbnailUrl;
            }
        }

        if (dto.thumbnailUrl !== undefined) {
            const cleanThumb = String(dto.thumbnailUrl || '').trim();
            existing.thumbnailUrl = cleanThumb || existing.thumbnailUrl || null;
        }

        if (dto.category !== undefined) {
            existing.category =
                String(dto.category || '').trim() || 'Formação Principal';
        }

        if (dto.durationLabel !== undefined) {
            const cleanDur = String(dto.durationLabel || '').trim();
            existing.durationLabel = cleanDur ? cleanDur.slice(0, 40) : null;
        }

        if (dto.orderIndex !== undefined && Number.isFinite(Number(dto.orderIndex))) {
            existing.orderIndex = Number(dto.orderIndex);
        }

        if (dto.isPublished !== undefined) {
            existing.isPublished = Boolean(dto.isPublished);
        }

        const saved = await this.lessonRepo.save(existing);
        this.networkGateway.broadcastLessonCatalogUpdated();
        return saved;
    }

    async adminDeleteLesson(id: string) {
        const existing = await this.lessonRepo.findOne({ where: { id } });
        if (!existing) {
            throw new NotFoundException('Videoaula não encontrada.');
        }

        await Promise.all([
            this.progressRepo.delete({ lessonId: id }),
            this.lessonLikeRepo.delete({ lessonId: id }),
            this.lessonCommentRepo.delete({ lessonId: id }),
        ]);
        await this.lessonRepo.delete({ id });
        this.networkGateway.broadcastLessonCatalogUpdated();
        return { success: true };
    }

    // =========================================================================
    // USER CATALOG, DEDICATED PLAYER, PROGRESS (URGENCY LOCKS), LIKES & COMMENTS
    // =========================================================================

    async listLessonsForUser(userId: string) {
        const lessons = await this.lessonRepo.find({
            where: { isPublished: true },
            order: { orderIndex: 'ASC', createdAt: 'ASC' },
        });

        if (lessons.length === 0) {
            return {
                lessons: [],
                summary: {
                    totalLessons: 0,
                    watchedCount: 0,
                    lockedUnwatchedCount: 0,
                    completionPercent: 0,
                    nextUnwatchedLessonId: null,
                },
            };
        }

        const lessonIds = lessons.map((l) => l.id);

        const [progressRows, likeRows] = await Promise.all([
            this.progressRepo.find({
                where: { userId, lessonId: In(lessonIds) },
            }),
            this.lessonLikeRepo.find({
                where: { userId, lessonId: In(lessonIds) },
            }),
        ]);

        const watchedMap = new Map<string, NetworkLessonProgressEntity>();
        for (const p of progressRows) {
            if (p.isWatched) {
                watchedMap.set(p.lessonId, p);
            }
        }
        const likedSet = new Set(likeRows.map((l) => l.lessonId));

        let watchedCount = 0;
        let nextUnwatchedLessonId: string | null = null;

        const enriched = lessons.map((lesson, idx) => {
            const prog = watchedMap.get(lesson.id);
            const isWatched = Boolean(prog?.isWatched);
            if (isWatched) {
                watchedCount += 1;
            } else if (!nextUnwatchedLessonId) {
                nextUnwatchedLessonId = lesson.id;
            }

            return {
                ...lesson,
                sequenceNumber: idx + 1,
                isWatched,
                watchedAt: prog?.watchedAt || null,
                isLiked: likedSet.has(lesson.id),
            };
        });

        const totalLessons = enriched.length;
        const lockedUnwatchedCount = totalLessons - watchedCount;
        const completionPercent =
            totalLessons > 0
                ? Math.round((watchedCount / totalLessons) * 100)
                : 0;

        return {
            lessons: enriched,
            summary: {
                totalLessons,
                watchedCount,
                lockedUnwatchedCount,
                completionPercent,
                nextUnwatchedLessonId,
            },
        };
    }

    async getLessonDetailForUser(userId: string, lessonId: string) {
        const lesson = await this.lessonRepo.findOne({
            where: { id: lessonId, isPublished: true },
        });
        if (!lesson) {
            throw new NotFoundException('Videoaula não encontrada.');
        }

        // Incrementa visualizações
        await this.lessonRepo.increment({ id: lesson.id }, 'viewsCount', 1);
        lesson.viewsCount += 1;

        const [catalog, likeRow, progressRow, rawComments] = await Promise.all([
            this.listLessonsForUser(userId),
            this.lessonLikeRepo.findOne({ where: { lessonId, userId } }),
            this.progressRepo.findOne({ where: { lessonId, userId } }),
            this.lessonCommentRepo.find({
                where: { lessonId },
                order: { createdAt: 'DESC' },
                take: 150,
            }),
        ]);

        const commenterIds = Array.from(
            new Set(rawComments.map((c) => c.userId))
        );
        const commenters =
            commenterIds.length > 0
                ? await this.userRepo.find({
                      where: { id: In(commenterIds) },
                      select: ['id', 'username', 'name', 'avatarUrl'],
                  })
                : [];
        const userMap = new Map(commenters.map((u) => [u.id, u]));

        const comments = rawComments.map((c) => {
            const u = userMap.get(c.userId);
            return {
                id: c.id,
                lessonId: c.lessonId,
                content: c.content,
                createdAt: c.createdAt,
                user: {
                    id: c.userId,
                    username: u?.username || u?.name || 'trader',
                    name: u?.name || u?.username || 'Trader',
                    avatarUrl: u?.avatarUrl || null,
                },
            };
        });

        const idx = catalog.lessons.findIndex((item) => item.id === lesson.id);
        const prevLesson = idx > 0 ? catalog.lessons[idx - 1] : null;
        const nextLesson =
            idx >= 0 && idx < catalog.lessons.length - 1
                ? catalog.lessons[idx + 1]
                : null;

        return {
            lesson: {
                ...lesson,
                sequenceNumber: idx >= 0 ? idx + 1 : 1,
                isWatched: Boolean(progressRow?.isWatched),
                watchedAt: progressRow?.watchedAt || null,
                isLiked: Boolean(likeRow),
            },
            comments,
            navigation: {
                prevLessonId: prevLesson?.id || null,
                nextLessonId: nextLesson?.id || null,
            },
            playlist: catalog.lessons,
            summary: catalog.summary,
        };
    }

    async markLessonWatched(
        userId: string,
        lessonId: string,
        isWatched: boolean = true
    ) {
        const lesson = await this.lessonRepo.findOne({
            where: { id: lessonId },
        });
        if (!lesson) {
            throw new NotFoundException('Videoaula não encontrada.');
        }

        let prog = await this.progressRepo.findOne({
            where: { lessonId, userId },
        });

        if (!prog) {
            prog = this.progressRepo.create({
                lessonId,
                userId,
                isWatched,
                watchedAt: isWatched ? new Date() : null,
            });
        } else {
            prog.isWatched = isWatched;
            prog.watchedAt = isWatched ? new Date() : null;
        }

        await this.progressRepo.save(prog);
        return {
            lessonId,
            isWatched: prog.isWatched,
            watchedAt: prog.watchedAt,
        };
    }

    async toggleLessonLike(userId: string, lessonId: string) {
        const lesson = await this.lessonRepo.findOne({
            where: { id: lessonId },
        });
        if (!lesson) {
            throw new NotFoundException('Videoaula não encontrada.');
        }

        const existing = await this.lessonLikeRepo.findOne({
            where: { lessonId, userId },
        });

        let liked = false;
        if (existing) {
            await this.lessonLikeRepo.delete({ id: existing.id });
            liked = false;
        } else {
            await this.lessonLikeRepo.save(
                this.lessonLikeRepo.create({ lessonId, userId })
            );
            liked = true;
        }

        const totalLikes = await this.lessonLikeRepo.count({
            where: { lessonId },
        });
        lesson.likesCount = totalLikes;
        await this.lessonRepo.save(lesson);

        this.networkGateway.broadcastLessonInteraction({
            type: 'like',
            lessonId,
            likesCount: totalLikes,
            userId,
        });

        return {
            liked,
            likesCount: totalLikes,
        };
    }

    async addLessonComment(userId: string, lessonId: string, rawContent: string) {
        const content = String(rawContent || '').trim().slice(0, 1200);
        if (!content) {
            throw new BadRequestException('Escreva um comentário antes de enviar.');
        }

        const [lesson, user] = await Promise.all([
            this.lessonRepo.findOne({ where: { id: lessonId } }),
            this.userRepo.findOne({
                where: { id: userId },
                select: ['id', 'username', 'name', 'avatarUrl'],
            }),
        ]);

        if (!lesson) {
            throw new NotFoundException('Videoaula não encontrada.');
        }

        const saved = await this.lessonCommentRepo.save(
            this.lessonCommentRepo.create({
                lessonId,
                userId,
                content,
            })
        );

        const totalComments = await this.lessonCommentRepo.count({
            where: { lessonId },
        });
        lesson.commentsCount = totalComments;
        await this.lessonRepo.save(lesson);

        const formattedComment = {
            id: saved.id,
            lessonId: saved.lessonId,
            content: saved.content,
            createdAt: saved.createdAt,
            user: {
                id: userId,
                username: user?.username || user?.name || 'trader',
                name: user?.name || user?.username || 'Trader',
                avatarUrl: user?.avatarUrl || null,
            },
        };

        this.networkGateway.broadcastLessonInteraction({
            type: 'comment',
            lessonId,
            commentsCount: totalComments,
            comment: formattedComment,
        });

        return {
            comment: formattedComment,
            commentsCount: totalComments,
        };
    }

    async deleteLessonComment(
        userId: string,
        lessonId: string,
        commentId: string,
        isAdmin = false
    ) {
        const comment = await this.lessonCommentRepo.findOne({
            where: { id: commentId, lessonId },
        });
        if (!comment) {
            throw new NotFoundException('Comentário não encontrado.');
        }

        if (!isAdmin && comment.userId !== userId) {
            throw new ForbiddenException(
                'Não tem permissão para remover este comentário.'
            );
        }

        await this.lessonCommentRepo.delete({ id: comment.id });

        const totalComments = await this.lessonCommentRepo.count({
            where: { lessonId },
        });
        await this.lessonRepo.update(
            { id: lessonId },
            { commentsCount: totalComments }
        );

        this.networkGateway.broadcastLessonInteraction({
            type: 'comment_deleted',
            lessonId,
            commentId,
            commentsCount: totalComments,
        });

        return {
            success: true,
            commentsCount: totalComments,
        };
    }
}
