import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index, ValueTransformer } from 'typeorm';

export class ColumnNumericTransformer implements ValueTransformer {
    to(data?: number | null): number | null {
        if (data === null || data === undefined) return null;
        return Number(data);
    }
    from(data?: string | number | null): number | null {
        if (data === null || data === undefined) return null;
        const parsed = parseFloat(String(data));
        return isNaN(parsed) ? null : parsed;
    }
}

const numericTransformer = new ColumnNumericTransformer();

@Entity('trades')
@Index(['accountId', 'contractId'], { unique: true })
@Index(['accountId', 'closeTime'])
@Index(['accountId', 'status'])
@Index(['importLogId'])
export class TradeEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'account_id' })
    accountId: string;

    @Column({ nullable: true })
    ticket: string;

    @Column({ nullable: true })
    contractId: string; // Deriv contract_id or MT5 positionId/ticket

    @Column({ nullable: true })
    buyTransactionId: string;

    @Column({ nullable: true })
    sellTransactionId: string;

    @Column()
    symbol: string;

    @Column()
    type: string;

    @Column('decimal', { precision: 18, scale: 4, transformer: numericTransformer })
    volume: number;

    @Column('decimal', { precision: 18, scale: 5, name: 'open_price', transformer: numericTransformer })
    openPrice: number;

    @Column('decimal', { precision: 18, scale: 5, name: 'close_price', transformer: numericTransformer })
    closePrice: number;

    @Column('decimal', { precision: 18, scale: 2, transformer: numericTransformer })
    profit: number;

    @Column('decimal', { precision: 18, scale: 5, nullable: true, transformer: numericTransformer })
    sl: number;

    @Column('decimal', { precision: 18, scale: 5, nullable: true, transformer: numericTransformer })
    tp: number;

    @Column('decimal', { precision: 18, scale: 2, default: 0, transformer: numericTransformer })
    commission: number;

    @Column('decimal', { precision: 18, scale: 2, default: 0, transformer: numericTransformer })
    swap: number;

    @Column('decimal', { precision: 20, scale: 2, nullable: true, transformer: numericTransformer })
    grossResult: number;

    @Column('decimal', { precision: 20, scale: 2, nullable: true, transformer: numericTransformer })
    netPnl: number;

    @Column('decimal', { precision: 18, scale: 2, default: 0, transformer: numericTransformer })
    fees: number;

    @Column({ length: 10, nullable: true })
    currency: string;

    @Column({ type: 'timestamp', name: 'open_time', nullable: true })
    openTime: Date;

    @Column({ type: 'timestamp', name: 'close_time', nullable: true })
    closeTime: Date;

    @Column({ default: 'CLOSED' })
    status: string;

    @Column({ nullable: true })
    magic: number;

    @Column({ nullable: true })
    comment: string;

    @Column({ nullable: true })
    session: string;

    @Column({ nullable: true })
    mood: string;

    @Column({ nullable: true, type: 'int' })
    rating: number;

    @Column({ nullable: true })
    setup: string;

    @Column({ nullable: true, type: 'text' })
    lesson: string;

    @Column('text', { array: true, nullable: true })
    tags: string[];

    @Column({ type: 'jsonb', nullable: true })
    qualityFlags: any;

    @Column('decimal', { precision: 18, scale: 5, nullable: true, transformer: numericTransformer })
    entrySpot: number;

    @Column('decimal', { precision: 18, scale: 5, nullable: true, transformer: numericTransformer })
    exitSpot: number;

    @Column('decimal', { precision: 18, scale: 2, nullable: true, transformer: numericTransformer })
    buyPrice: number;

    @Column('decimal', { precision: 18, scale: 2, nullable: true, transformer: numericTransformer })
    sellPrice: number;

    @Column('decimal', { precision: 18, scale: 2, nullable: true, transformer: numericTransformer })
    payout: number;

    @Column({ type: 'enum', enum: ['ok', 'partial', 'broken'], default: 'ok' })
    dataQuality: string;

    @Column({ default: false })
    syntheticTxid: boolean;

    @Column({ type: 'int', nullable: true, name: 'import_log_id' })
    importLogId: number | null;

    @CreateDateColumn()
    created_at: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
