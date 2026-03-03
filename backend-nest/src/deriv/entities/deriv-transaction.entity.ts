import { Entity, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('deriv_transactions')
export class DerivTransactionEntity {
    @PrimaryColumn()
    transactionId: string; // From Deriv transaction_id (string to support UUIDs)

    @Column({ nullable: true })
    @Index()
    contractId: string; // From Deriv contract_id

    @Column()
    userId: string;

    @Column({ nullable: true })
    action: string; // buy, sell, deposit, withdrawal, etc.

    @Column('decimal', { precision: 20, scale: 2 })
    amount: number;

    @Column('decimal', { precision: 20, scale: 2, nullable: true })
    balance: number;

    @Column({ length: 10, nullable: true })
    currency: string;

    @Column({ type: 'timestamp' })
    transactionTime: Date;

    @Column({ default: false })
    processed: boolean;

    @Column({ type: 'jsonb', nullable: true })
    raw: any;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
