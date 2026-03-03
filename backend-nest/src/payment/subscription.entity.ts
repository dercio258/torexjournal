import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    ManyToOne,
    JoinColumn,
} from 'typeorm';
import { UserEntity } from '../users/user.entity';
import { SubscriptionPlanConfig } from './subscription-plan.entity';

export enum SubscriptionStatus {
    APPROVAL_PENDING = 'APPROVAL_PENDING',
    APPROVED = 'APPROVED',
    ACTIVE = 'ACTIVE',
    SUSPENDED = 'SUSPENDED',
    CANCELLED = 'CANCELLED',
    EXPIRED = 'EXPIRED',
}

export enum SubscriptionCycle {
    MONTHLY = 'MONTHLY',
    YEARLY = 'YEARLY',
}

@Entity('subscriptions')
export class Subscription {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @ManyToOne(() => UserEntity, (user) => user.subscriptions)
    @JoinColumn({ name: 'userId' })
    user: UserEntity;

    @Column()
    userId: string;

    @ManyToOne(() => SubscriptionPlanConfig)
    @JoinColumn({ name: 'planConfigId' })
    planConfig: SubscriptionPlanConfig;

    @Column()
    planConfigId: string;

    @Column()
    paypalSubscriptionId: string;

    @Column({
        type: 'enum',
        enum: SubscriptionStatus,
        default: SubscriptionStatus.APPROVAL_PENDING,
    })
    status: SubscriptionStatus;

    @Column({
        type: 'enum',
        enum: SubscriptionCycle,
        default: SubscriptionCycle.MONTHLY,
    })
    cycle: SubscriptionCycle;

    @Column({ type: 'timestamp', nullable: true })
    currentPeriodEnd: Date;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
