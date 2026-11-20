import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';

@Entity('push_subscriptions')
@Index(['userId', 'isActive'])
export class PushSubscriptionEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Index()
    @Column({ name: 'user_id', type: 'uuid' })
    userId: string;

    @Column({ type: 'varchar', length: 1024, unique: true })
    endpoint: string;

    @Column({ type: 'varchar', length: 256 })
    p256dh: string;

    @Column({ type: 'varchar', length: 128 })
    auth: string;

    @Column({ name: 'user_agent', type: 'varchar', length: 512, nullable: true })
    userAgent: string | null;

    @Column({ name: 'device_label', type: 'varchar', length: 120, nullable: true })
    deviceLabel: string | null;

    @Column({ name: 'is_standalone_app', type: 'boolean', default: false })
    isStandaloneApp: boolean;

    @Column({ type: 'varchar', length: 16, default: 'pt' })
    locale: string;

    @Column({ name: 'is_active', type: 'boolean', default: true })
    isActive: boolean;

    @Column({ name: 'last_sent_at', type: 'timestamptz', nullable: true })
    lastSentAt: Date | null;

    @Column({ name: 'failure_count', type: 'integer', default: 0 })
    failureCount: number;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
    updatedAt: Date;
}
