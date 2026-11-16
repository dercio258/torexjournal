import {
    Entity,
    PrimaryColumn,
    Column,
    UpdateDateColumn,
} from 'typeorm';

@Entity('tracking_configs')
export class TrackingConfigEntity {
    @PrimaryColumn({ name: 'key', length: 64, default: 'default' })
    key: string;

    @Column({ name: 'meta_pixel_id', length: 120, nullable: true })
    metaPixelId: string | null;

    @Column({ name: 'meta_capi_access_token', length: 512, nullable: true })
    metaCapiAccessToken: string | null;

    @Column({ name: 'ga4_measurement_id', length: 120, nullable: true })
    ga4MeasurementId: string | null;

    @Column({ name: 'gtm_container_id', length: 120, nullable: true })
    gtmContainerId: string | null;

    @Column({ name: 'tiktok_pixel_id', length: 120, nullable: true })
    tiktokPixelId: string | null;

    @Column({ name: 'utmify_pixel_id', length: 120, nullable: true })
    utmifyPixelId: string | null;

    @Column({ name: 'enable_first_party_tracking', type: 'boolean', default: true })
    enableFirstPartyTracking: boolean;

    @Column({ name: 'enable_email_tracking', type: 'boolean', default: true })
    enableEmailTracking: boolean;

    @Column({ name: 'enable_cta_auto_tracking', type: 'boolean', default: true })
    enableCtaAutoTracking: boolean;

    @Column({ name: 'custom_head_script', type: 'text', nullable: true })
    customHeadScript: string | null;

    @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
    updatedAt: Date;
}
