import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    Index,
} from 'typeorm';

@Entity('network_video_lessons')
@Index('IDX_network_lessons_pub_order', ['isPublished', 'orderIndex'])
export class NetworkVideoLessonEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar', length: 220 })
    title: string;

    @Column({ type: 'text', default: '' })
    description: string;

    @Column({ name: 'embed_input', type: 'text' })
    embedInput: string;

    @Column({ name: 'embed_url', type: 'text' })
    embedUrl: string;

    @Column({ name: 'embed_type', type: 'varchar', length: 30, default: 'iframe' })
    embedType: 'iframe' | 'video';

    @Column({ name: 'thumbnail_url', type: 'text', nullable: true })
    thumbnailUrl?: string | null;

    @Column({ type: 'varchar', length: 100, default: 'Formação Principal' })
    category: string;

    @Column({ name: 'duration_label', type: 'varchar', length: 40, nullable: true })
    durationLabel?: string | null;

    @Column({ name: 'order_index', type: 'int', default: 0 })
    orderIndex: number;

    @Column({ name: 'is_published', type: 'boolean', default: true })
    isPublished: boolean;

    @Column({ name: 'likes_count', type: 'int', default: 0 })
    likesCount: number;

    @Column({ name: 'comments_count', type: 'int', default: 0 })
    commentsCount: number;

    @Column({ name: 'views_count', type: 'int', default: 0 })
    viewsCount: number;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}

@Entity('network_video_progress')
@Index('IDX_network_video_progress_user_lesson', ['userId', 'lessonId'])
export class NetworkLessonProgressEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'lesson_id', type: 'uuid' })
    lessonId: string;

    @Column({ name: 'user_id', type: 'varchar' })
    userId: string;

    @Column({ name: 'is_watched', type: 'boolean', default: true })
    isWatched: boolean;

    @Column({ name: 'watched_at', type: 'timestamp', nullable: true })
    watchedAt?: Date | null;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}

@Entity('network_video_likes')
@Index('IDX_network_video_likes_lesson_user', ['lessonId', 'userId'])
export class NetworkLessonLikeEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'lesson_id', type: 'uuid' })
    lessonId: string;

    @Column({ name: 'user_id', type: 'varchar' })
    userId: string;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;
}

@Entity('network_video_comments')
@Index('IDX_network_video_comments_lesson_created', ['lessonId', 'createdAt'])
export class NetworkLessonCommentEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'lesson_id', type: 'uuid' })
    lessonId: string;

    @Column({ name: 'user_id', type: 'varchar' })
    userId: string;

    @Column({ type: 'text' })
    content: string;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;
}

@Entity('network_direct_messages')
@Index('IDX_network_dm_pair_created', ['senderId', 'recipientId', 'createdAt'])
@Index('IDX_network_dm_recipient_read', ['recipientId', 'isRead'])
export class NetworkDirectMessageEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'sender_id', type: 'varchar' })
    senderId: string;

    @Column({ name: 'recipient_id', type: 'varchar' })
    recipientId: string;

    @Column({ type: 'text' })
    content: string;

    @Column({ name: 'is_read', type: 'boolean', default: false })
    isRead: boolean;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;
}
