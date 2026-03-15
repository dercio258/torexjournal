import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum BroadcastStatus {
    DRAFT = 'draft',
    SCHEDULED = 'scheduled',
    SENT = 'sent',
    CANCELLED = 'cancelled'
}

export enum BroadcastCategory {
    ALL = 'all',
    FREE = 'free',
    BASIC = 'basic',
    PREMIUM = 'premium'
}

export enum RecurrenceInterval {
    NONE = 'none',
    DAILY = 'daily',
    WEEKLY = 'weekly',
    MONTHLY = 'monthly'
}

@Entity('broadcast_notifications')
export class BroadcastNotificationEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    title: string;

    @Column('text')
    message: string;

    @Column({
        type: 'enum',
        enum: BroadcastCategory,
        default: BroadcastCategory.ALL
    })
    category: BroadcastCategory;

    @Column('simple-json', { nullable: true })
    channels: string[]; // ['email', 'telegram', 'in_app']

    @Column({
        type: 'enum',
        enum: BroadcastStatus,
        default: BroadcastStatus.DRAFT
    })
    status: BroadcastStatus;

    @Column({ type: 'timestamp', nullable: true, name: 'scheduled_at' })
    scheduledAt: Date;

    @Column({ default: false, name: 'is_recurring' })
    isRecurring: boolean;

    @Column({
        type: 'enum',
        enum: RecurrenceInterval,
        default: RecurrenceInterval.NONE,
        name: 'recurrence_interval'
    })
    recurrenceInterval: RecurrenceInterval;

    @Column({ type: 'timestamp', nullable: true, name: 'next_run_at' })
    nextRunAt: Date;

    @Column({ type: 'timestamp', nullable: true, name: 'sent_at' })
    sentAt: Date;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
