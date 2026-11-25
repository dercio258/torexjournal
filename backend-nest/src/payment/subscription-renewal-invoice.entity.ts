import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    Index,
} from 'typeorm';

export enum RenewalInvoiceStatus {
    PENDING = 'PENDING',
    PAID = 'PAID',
    EXPIRED = 'EXPIRED',
    CANCELLED = 'CANCELLED',
}

@Entity('subscription_renewal_invoices')
@Index(['subscriptionId', 'status'])
@Index(['userId', 'status'])
export class SubscriptionRenewalInvoice {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar', length: 96, unique: true })
    token: string;

    @Column({ name: 'subscription_id', type: 'uuid' })
    subscriptionId: string;

    @Column({ name: 'user_id', type: 'uuid' })
    userId: string;

    @Column({ name: 'plan_config_id', type: 'uuid' })
    planConfigId: string;

    @Column({ type: 'varchar', length: 50 })
    tier: string;

    @Column({ type: 'varchar', length: 30 })
    cycle: string;

    @Column({ name: 'amount_usd', type: 'decimal', precision: 10, scale: 2 })
    amountUsd: number;

    @Column({
        type: 'varchar',
        length: 24,
        default: RenewalInvoiceStatus.PENDING,
    })
    status: RenewalInvoiceStatus;

    @Column({ name: 'due_date', type: 'timestamptz' })
    dueDate: Date;

    @Column({ name: 'expires_at', type: 'timestamptz' })
    expiresAt: Date;

    @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
    paidAt: Date | null;

    @Column({ name: 'paid_subscription_id', type: 'uuid', nullable: true })
    paidSubscriptionId: string | null;

    @Column({ name: 'payment_method', type: 'varchar', length: 40, nullable: true })
    paymentMethod: string | null;

    @Column({ name: 'payment_reference', type: 'varchar', length: 80, nullable: true })
    paymentReference: string | null;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
