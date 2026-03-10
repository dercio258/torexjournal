import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('trades')
@Index(['accountId', 'contractId'], { unique: true })
export class TradeEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'account_id' })
    accountId: string;

    @Column({ nullable: true })
    ticket: string;

    @Column({ nullable: true })
    contractId: string; // Deriv contract_id or MT5 ticket

    @Column({ nullable: true })
    buyTransactionId: string;

    @Column({ nullable: true })
    sellTransactionId: string;

    @Column()
    symbol: string;

    @Column()
    type: string;

    @Column('decimal', { precision: 10, scale: 2 })
    volume: number;

    @Column('decimal', { precision: 10, scale: 5, name: 'open_price' })
    openPrice: number;

    @Column('decimal', { precision: 10, scale: 5, name: 'close_price' })
    closePrice: number;

    @Column('decimal', { precision: 10, scale: 2 })
    profit: number;

    @Column('decimal', { precision: 10, scale: 5, nullable: true })
    sl: number;

    @Column('decimal', { precision: 10, scale: 5, nullable: true })
    tp: number;

    @Column('decimal', { precision: 10, scale: 2, default: 0 })
    commission: number;

    @Column('decimal', { precision: 10, scale: 2, default: 0 })
    swap: number;

    @Column('decimal', { precision: 20, scale: 2, nullable: true })
    grossResult: number;

    @Column('decimal', { precision: 20, scale: 2, nullable: true })
    netPnl: number;

    @Column('decimal', { precision: 10, scale: 2, default: 0 })
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
    qualityFlags: any; // e.g., { missing_sell: true, inconsistent_pnl: true }

    @Column('decimal', { precision: 10, scale: 5, nullable: true })
    entrySpot: number;

    @Column('decimal', { precision: 10, scale: 5, nullable: true })
    exitSpot: number;

    @Column('decimal', { precision: 10, scale: 2, nullable: true })
    buyPrice: number;

    @Column('decimal', { precision: 10, scale: 2, nullable: true })
    sellPrice: number;

    @Column('decimal', { precision: 10, scale: 2, nullable: true })
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
