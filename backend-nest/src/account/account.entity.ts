import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, OneToMany, Index } from 'typeorm';
import { PositionEntity } from '../mt5/position.entity';
import { ColumnNumericTransformer } from '../common/transformers/numeric.transformer';
import { AccountTransactionEntity } from './account-transaction.entity';

export enum AccountType {
    LIVE = 'live',
    DEMO = 'demo',
    PROP_FIRM = 'prop_firm',
    CHALLENGE = 'challenge',
    FUNDED = 'funded',
    CUSTOM = 'custom'
}

@Entity('accounts')
@Index(['userId', 'isArchived', 'isPrimary'])
@Index(['userId', 'mt5Id'])
export class AccountEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ default: 'Conta Principal' })
    name: string;

    @Column({ default: 'MetaTrader 5' })
    broker: string;

    @Column({
        type: 'varchar',
        length: 20,
        default: AccountType.LIVE
    })
    type: AccountType;

    @Column({ length: 10, default: 'USD' })
    currency: string;

    @Column('decimal', {
        precision: 15,
        scale: 2,
        default: 0,
        name: 'initial_balance',
        transformer: new ColumnNumericTransformer()
    })
    initialBalance: number;

    @Column({ default: true, name: 'is_primary' })
    isPrimary: boolean;

    @Column({ default: false, name: 'is_archived' })
    isArchived: boolean;

    @Column({ type: 'timestamp', nullable: true, name: 'archived_at' })
    archivedAt: Date | null;

    @Column({ type: 'jsonb', nullable: true, name: 'prop_firm_rules' })
    propFirmRules: {
        profitTarget?: number;
        dailyLossLimit?: number;
        maxDrawdown?: number;
        minTradingDays?: number;
        rulesDescription?: string;
        [key: string]: any;
    } | null;

    @Column({ name: 'mt5_id', nullable: true })
    mt5Id: string;

    @Column('decimal', { precision: 15, scale: 2, default: 0, transformer: new ColumnNumericTransformer() })
    balance: number;

    @Column('decimal', { precision: 15, scale: 2, default: 0, transformer: new ColumnNumericTransformer() })
    equity: number;

    @Column('decimal', { precision: 15, scale: 2, default: 0, transformer: new ColumnNumericTransformer() })
    margin: number;

    @Column('decimal', { precision: 15, scale: 2, default: 0, name: 'margin_free', transformer: new ColumnNumericTransformer() })
    marginFree: number;

    @Column('decimal', { precision: 15, scale: 2, default: 0, name: 'margin_level', transformer: new ColumnNumericTransformer() })
    marginLevel: number;

    @Column('int', { default: 1 })
    leverage: number;

    @Column({ default: false, name: 'is_connected' })
    isConnected: boolean;

    @Column({ type: 'timestamp', nullable: true, name: 'last_seen' })
    lastSeen: Date;

    @Index()
    @Column({ nullable: true, unique: true, name: 'app_token' })
    appToken: string;

    @Index()
    @Column({ name: 'user_id', nullable: true })
    userId: string;

    @Column({ name: 'telegram_chat_id', nullable: true })
    telegramChatId: string;

    @Column({ name: 'notifications_enabled', default: true })
    notificationsEnabled: boolean;

    @Column({ name: 'telegram_enabled', default: false })
    telegramEnabled: boolean;

    @Index()
    @Column({ type: 'varchar', length: 80, nullable: true, name: 'assigned_worker_id' })
    assignedWorkerId: string | null;

    @Column({ type: 'int', default: 1, name: 'mt5_lease_epoch' })
    mt5LeaseEpoch: number;

    @Column({ type: 'varchar', length: 24, default: 'HOT', name: 'mt5_sync_tier' })
    mt5SyncTier: string;

    @Column({ type: 'text', nullable: true, select: false, name: 'mt5_encrypted_pass' })
    mt5EncryptedPass?: string | null;

    @Column({ type: 'timestamp', nullable: true, name: 'zero_balance_since' })
    zeroBalanceSince: Date | null;

    @Column({ type: 'timestamp', nullable: true, name: 'inactivity_warned_at' })
    inactivityWarnedAt: Date | null;

    @Column({ type: 'timestamp', nullable: true, name: 'inactivity_disconnect_at' })
    inactivityDisconnectAt: Date | null;

    @OneToMany(() => PositionEntity, (position) => position.account)
    positions: PositionEntity[];

    @OneToMany(() => AccountTransactionEntity, (tx) => tx.account)
    transactions: AccountTransactionEntity[];

    // Computed / Virtual stats populated when listing accounts
    tradesCount?: number;
    netPnl?: number;
    winRate?: number;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
