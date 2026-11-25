import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    Index,
} from 'typeorm';

@Entity('pix_payment_sessions')
@Index(['userId', 'providerStatus', 'createdAt'])
@Index(['subscriptionId'])
export class PixPaymentSession {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'user_id', type: 'uuid' })
    userId: string;

    @Column({ name: 'subscription_id', type: 'uuid' })
    subscriptionId: string;

    @Column({ name: 'payment_reference', type: 'varchar', length: 80, unique: true })
    paymentReference: string;

    @Column({ name: 'provider_transaction_id', type: 'varchar', length: 120 })
    providerTransactionId: string;

    @Column({ type: 'varchar', length: 50 })
    tier: string;

    @Column({ type: 'varchar', length: 30 })
    cycle: string;

    @Column({ name: 'amount_usd', type: 'decimal', precision: 10, scale: 2 })
    amountUsd: number;

    @Column({ name: 'usd_to_brl_rate', type: 'decimal', precision: 10, scale: 4 })
    usdToBrlRate: number;

    @Column({ name: 'amount_brl', type: 'decimal', precision: 10, scale: 2 })
    amountBrl: number;

    @Column({ name: 'rate_source', type: 'varchar', length: 32, default: 'live_market' })
    rateSource: string;

    @Column({ name: 'payer_name', type: 'varchar', length: 140 })
    payerName: string;

    @Column({ name: 'payer_document_type', type: 'varchar', length: 10 })
    payerDocumentType: string;

    @Column({ name: 'payer_document_masked', type: 'varchar', length: 32 })
    payerDocumentMasked: string;

    @Column({ name: 'emv_code', type: 'text' })
    emvCode: string;

    @Column({ name: 'qr_code_data_url', type: 'text' })
    qrCodeDataUrl: string;

    @Column({ name: 'provider_status', type: 'varchar', length: 40, default: 'pending' })
    providerStatus: string;

    @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
    expiresAt: Date | null;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
