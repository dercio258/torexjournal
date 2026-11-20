import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
} from 'typeorm';

export type PushDeliveryStatus = 'SENT' | 'CLICKED' | 'DISMISSED';
export type PushModerationMode = 'ENGAGED' | 'MODERATED' | 'FATIGUE_PAUSED';

@Entity('push_delivery_logs')
@Index('IDX_push_delivery_user_sent', ['userId', 'sentAt'])
@Index('IDX_push_delivery_category_sent', ['category', 'sentAt'])
@Index('IDX_push_delivery_status_sent', ['status', 'sentAt'])
export class PushDeliveryLogEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'user_id', type: 'varchar', length: 64 })
    userId: string;

    @Column({ name: 'click_token', type: 'varchar', length: 80, unique: true })
    clickToken: string;

    @Column({ type: 'varchar', length: 64 })
    category: string;

    @Column({ type: 'varchar', length: 120 })
    title: string;

    @Column({ type: 'varchar', length: 24, default: 'SENT' })
    status: PushDeliveryStatus;

    @Column({ name: 'sent_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
    sentAt: Date;

    @Column({ name: 'interacted_at', type: 'timestamp', nullable: true })
    interactedAt: Date | null;

    @Column({ name: 'moderation_mode', type: 'varchar', length: 32, default: 'ENGAGED' })
    moderationMode: PushModerationMode;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;
}
