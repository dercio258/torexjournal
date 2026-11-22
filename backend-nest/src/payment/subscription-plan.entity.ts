import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';

@Entity('subscription_plan_configs')
export class SubscriptionPlanConfig {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({
        type: 'varchar',
        length: 50,
        default: 'BASIC',
    })
    tier: string;

    @Column({ nullable: true })
    description: string;

    @Column('simple-json', { nullable: true })
    features: string[];

    @Column('decimal', { precision: 10, scale: 2 })
    monthlyPrice: number;

    @Column('decimal', { precision: 10, scale: 2, nullable: true })
    annualMonthlyPrice: number | null;

    @Column('decimal', { precision: 10, scale: 2, nullable: true })
    compareAtPrice: number | null;

    @Column('int', { default: 35 })
    promoDiscountPercent: number;

    @Column('decimal', { precision: 10, scale: 2, nullable: true })
    monthlyPriceMzn: number | null;

    @Column('decimal', { precision: 10, scale: 2, nullable: true })
    quarterlyPriceMzn: number | null;

    @Column('decimal', { precision: 10, scale: 2, nullable: true })
    annualPriceMzn: number | null;

    @Column('decimal', { precision: 10, scale: 2, nullable: true })
    biennialPriceMzn: number | null;

    @Column('decimal', { precision: 10, scale: 2, default: 74 })
    usdToMznRate: number;

    @Column('int', { default: 20 })
    monthlyDiscountPercent: number;

    @Column('int', { default: 5 })
    quarterlyDiscountPercent: number;

    @Column('int', { default: 0 })
    annualDiscountPercent: number;

    @Column('int', { default: 29 })
    biennialDiscountPercent: number;

    @Column('int', { default: 1 })
    maxTradingAccounts: number;

    @Column('int', { default: 0 })
    monthlyBacktestsLimit: number;

    @Column({ default: false })
    trialEnabled: boolean;

    @Column('int', { default: 0 })
    trialDays: number;

    @Column('decimal', { precision: 10, scale: 2, default: 0 })
    trialPrice: number;

    @Column('int', { nullable: true })
    aiDailyCredits: number;

    @Column({ default: true })
    isActive: boolean;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
