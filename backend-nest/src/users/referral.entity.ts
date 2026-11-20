import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';

export type ReferralStatus = 'REGISTERED' | 'VERIFIED' | 'PAID';

@Entity('referrals')
@Index('IDX_referrals_referrer_status', ['referrerUserId', 'status'])
@Index('IDX_referrals_referred_unique', ['referredUserId'], { unique: true })
export class ReferralEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'referrer_user_id', type: 'varchar', length: 64 })
    referrerUserId: string;

    @Column({ name: 'referred_user_id', type: 'varchar', length: 64 })
    referredUserId: string;

    @Column({ type: 'varchar', length: 24, default: 'REGISTERED' })
    status: ReferralStatus;

    @Column({ name: 'reward_credits_usd', type: 'numeric', precision: 10, scale: 2, default: 0 })
    rewardCreditsUsd: number;

    @Column({ name: 'tier_boost_awarded', type: 'boolean', default: false })
    tierBoostAwarded: boolean;

    @Column({ name: 'verified_at', type: 'timestamp', nullable: true })
    verifiedAt: Date | null;

    @Column({ name: 'paid_at', type: 'timestamp', nullable: true })
    paidAt: Date | null;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
