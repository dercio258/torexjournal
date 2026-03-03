import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';

// TradingTier enum removed in favor of dynamic strings
// export enum TradingTier { ... }

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

    @Column('int', { default: 0 })
    annualDiscountPercent: number;

    @Column({ default: false })
    trialEnabled: boolean;

    @Column('int', { default: 0 })
    trialDays: number;

    @Column('decimal', { precision: 10, scale: 2, default: 0 })
    trialPrice: number;

    @Column({ nullable: true })
    paypalMonthlyPlanId: string;

    @Column({ nullable: true })
    paypalYearlyPlanId: string;

    @Column({ default: true })
    isActive: boolean;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
