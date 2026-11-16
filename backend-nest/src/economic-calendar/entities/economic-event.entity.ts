import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export enum EconomicEventImpact {
    LOW = 'LOW',
    MEDIUM = 'MEDIUM',
    HIGH = 'HIGH',
}

export enum EconomicEventStatus {
    SCHEDULED = 'SCHEDULED',
    COMPLETED = 'COMPLETED',
    CANCELLED = 'CANCELLED',
    POSTPONED = 'POSTPONED',
}

export enum EconomicEventCategory {
    EMPLOYMENT = 'EMPLOYMENT',
    INFLATION = 'INFLATION',
    INTEREST_RATE = 'INTEREST_RATE',
    GDP = 'GDP',
    MANUFACTURING = 'MANUFACTURING',
    SERVICES = 'SERVICES',
    CONSUMER = 'CONSUMER',
    HOUSING = 'HOUSING',
    TRADE = 'TRADE',
    CENTRAL_BANK = 'CENTRAL_BANK',
    GOVERNMENT = 'GOVERNMENT',
    ENERGY = 'ENERGY',
    HOLIDAY = 'HOLIDAY',
    OTHER = 'OTHER',
}

@Entity('economic_events')
export class EconomicEvent {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Index()
    @Column({ type: 'timestamp with time zone', name: 'event_date' })
    eventDate: Date;

    @Index()
    @Column({ type: 'varchar', length: 10 })
    currency: string; // Normalized to uppercase, e.g. USD, EUR, GBP

    @Column({ type: 'varchar', length: 100, nullable: true })
    country: string; // e.g. United States, Eurozone, United Kingdom

    @Column({ type: 'varchar', length: 255 })
    title: string; // e.g. Non-Farm Payrolls, CPI m/m

    @Index()
    @Column({
        type: 'varchar',
        length: 50,
        default: EconomicEventCategory.OTHER
    })
    category: EconomicEventCategory;

    @Index()
    @Column({
        type: 'varchar',
        length: 20,
        default: EconomicEventImpact.MEDIUM
    })
    impact: EconomicEventImpact;

    @Index()
    @Column({
        type: 'varchar',
        length: 30,
        default: EconomicEventStatus.SCHEDULED
    })
    status: EconomicEventStatus;

    @Column({ type: 'varchar', length: 50, nullable: true })
    actual: string | null;

    @Column({ type: 'varchar', length: 50, nullable: true })
    forecast: string | null;

    @Column({ type: 'varchar', length: 50, nullable: true })
    previous: string | null;

    @Column({ type: 'varchar', length: 30, nullable: true })
    unit: string | null; // e.g. %, K, M, B, pts, index

    @Column({ type: 'text', nullable: true })
    description: string | null;

    @Column({ name: 'external_id', type: 'varchar', length: 64, nullable: true })
    @Index('IDX_economic_events_external_id')
    externalId: string | null;

    @Column({ type: 'varchar', length: 50, default: 'MT5_CALENDAR' })
    source: string; // 'MT5_CALENDAR'

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
