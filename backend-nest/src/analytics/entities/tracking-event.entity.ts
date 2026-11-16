import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    Index,
} from 'typeorm';

@Entity('tracking_events')
@Index(['eventType', 'createdAt'])
@Index(['visitorId', 'createdAt'])
@Index(['userId', 'createdAt'])
@Index(['utmSource', 'createdAt'])
@Index(['ctaTag', 'createdAt'])
export class TrackingEventEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'event_name', length: 120 })
    eventName: string;

    @Column({ name: 'event_type', length: 32 })
    eventType: string;

    @Column({ name: 'visitor_id', length: 120 })
    visitorId: string;

    @Column({ name: 'session_id', length: 120, nullable: true })
    sessionId: string | null;

    @Column({ name: 'user_id', type: 'uuid', nullable: true })
    userId: string | null;

    @Column({ name: 'page_path', length: 512, nullable: true })
    pagePath: string | null;

    @Column({ name: 'page_title', length: 256, nullable: true })
    pageTitle: string | null;

    @Column({ name: 'element_id', length: 120, nullable: true })
    elementId: string | null;

    @Column({ name: 'element_label', length: 256, nullable: true })
    elementLabel: string | null;

    @Column({ name: 'cta_tag', length: 120, nullable: true })
    ctaTag: string | null;

    @Column({ name: 'intent', length: 120, nullable: true })
    intent: string | null;

    @Column({ name: 'target_url', length: 1024, nullable: true })
    targetUrl: string | null;

    @Column({ name: 'referrer', length: 1024, nullable: true })
    referrer: string | null;

    @Column({ name: 'utm_source', length: 160, nullable: true })
    utmSource: string | null;

    @Column({ name: 'utm_medium', length: 160, nullable: true })
    utmMedium: string | null;

    @Column({ name: 'utm_campaign', length: 200, nullable: true })
    utmCampaign: string | null;

    @Column({ name: 'utm_content', length: 200, nullable: true })
    utmContent: string | null;

    @Column({ name: 'utm_term', length: 200, nullable: true })
    utmTerm: string | null;

    @Column({ name: 'utm_id', length: 160, nullable: true })
    utmId: string | null;

    @Column({ name: 'click_id', length: 200, nullable: true })
    clickId: string | null;

    @Column({ name: 'locale', length: 16, nullable: true })
    locale: string | null;

    @Column({ name: 'device_type', length: 32, nullable: true })
    deviceType: string | null;

    @Column({ name: 'ip_hash', length: 64, nullable: true })
    ipHash: string | null;

    @Column({ name: 'user_agent', length: 512, nullable: true })
    userAgent: string | null;

    @Column({ name: 'revenue', type: 'double precision', nullable: true })
    revenue: number | null;

    @Column({ name: 'currency', length: 16, nullable: true })
    currency: string | null;

    @Column({ name: 'metadata', type: 'jsonb', nullable: true })
    metadata: Record<string, any> | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt: Date;
}
