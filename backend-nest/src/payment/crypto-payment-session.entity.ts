import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    Index,
} from 'typeorm';

@Entity('crypto_payment_sessions')
@Index(['userId', 'providerStatus', 'createdAt'])
@Index(['subscriptionId'])
export class CryptoPaymentSession {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'user_id', type: 'uuid' })
    userId: string;

    @Column({ name: 'subscription_id', type: 'uuid' })
    subscriptionId: string;

    @Column({ name: 'payment_reference', type: 'varchar', length: 80, unique: true })
    paymentReference: string;

    @Column({ name: 'provider_payment_id', type: 'varchar', length: 100, unique: true })
    providerPaymentId: string;

    @Column({ type: 'varchar', length: 50 })
    tier: string;

    @Column({ type: 'varchar', length: 30 })
    cycle: string;

    @Column({ name: 'fiat_amount_usd', type: 'decimal', precision: 10, scale: 2 })
    fiatAmountUsd: number;

    @Column({ name: 'fiat_currency', type: 'varchar', length: 10, default: 'USD' })
    fiatCurrency: string;

    @Column({ name: 'crypto_currency', type: 'varchar', length: 32 })
    cryptoCurrency: string;

    @Column({ name: 'pay_currency_code', type: 'varchar', length: 32 })
    payCurrencyCode: string;

    @Column({ name: 'display_name', type: 'varchar', length: 100 })
    displayName: string;

    @Column({ type: 'varchar', length: 100 })
    network: string;

    @Column({ name: 'icon_url', type: 'varchar', length: 320, nullable: true })
    iconUrl: string | null;

    @Column({ name: 'wallet_address', type: 'varchar', length: 255 })
    walletAddress: string;

    @Column({ name: 'payin_extra_id', type: 'varchar', length: 120, nullable: true })
    payinExtraId: string | null;

    @Column({ name: 'crypto_amount', type: 'varchar', length: 64 })
    cryptoAmount: string;

    @Column({ name: 'actually_paid', type: 'varchar', length: 64, nullable: true })
    actuallyPaid: string | null;

    @Column({ name: 'qr_code_data_url', type: 'text' })
    qrCodeDataUrl: string;

    @Column({ name: 'provider_status', type: 'varchar', length: 40, default: 'waiting' })
    providerStatus: string;

    @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
    expiresAt: Date | null;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
