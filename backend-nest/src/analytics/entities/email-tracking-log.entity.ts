import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    Index,
} from 'typeorm';

@Entity('email_tracking_logs')
@Index(['token'], { unique: true })
@Index(['template', 'sentAt'])
@Index(['broadcastId'])
@Index(['recipientEmail'])
export class EmailTrackingLogEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'token', length: 64, unique: true })
    token: string;

    @Column({ name: 'recipient_email', length: 320 })
    recipientEmail: string;

    @Column({ name: 'user_id', type: 'uuid', nullable: true })
    userId: string | null;

    @Column({ name: 'template', length: 120 })
    template: string;

    @Column({ name: 'subject', length: 320, nullable: true })
    subject: string | null;

    @Column({ name: 'broadcast_id', length: 120, nullable: true })
    broadcastId: string | null;

    @Column({ name: 'utm_campaign', length: 200, nullable: true })
    utmCampaign: string | null;

    @Column({ name: 'utm_medium', length: 120, nullable: true })
    utmMedium: string | null;

    @CreateDateColumn({ name: 'sent_at', type: 'timestamptz' })
    sentAt: Date;

    @Column({ name: 'opened_at', type: 'timestamptz', nullable: true })
    openedAt: Date | null;

    @Column({ name: 'open_count', type: 'int', default: 0 })
    openCount: number;

    @Column({ name: 'first_clicked_at', type: 'timestamptz', nullable: true })
    firstClickedAt: Date | null;

    @Column({ name: 'click_count', type: 'int', default: 0 })
    clickCount: number;

    @Column({ name: 'last_clicked_url', length: 1024, nullable: true })
    lastClickedUrl: string | null;

    @Column({ name: 'last_cta_tag', length: 160, nullable: true })
    lastCtaTag: string | null;

    @Column({ name: 'metadata', type: 'jsonb', nullable: true })
    metadata: Record<string, any> | null;
}
