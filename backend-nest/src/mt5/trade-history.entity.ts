import { Entity, Column, PrimaryColumn, Index, CreateDateColumn } from 'typeorm';

@Entity('mt5_trade_history')
export class TradeHistoryEntity {
    // Usamos o Ticket como chave primária para evitar duplicidade
    @PrimaryColumn({ type: 'bigint' })
    ticket: number;

    @Index()
    @Column({ type: 'int' })
    mt5_id: number;

    @Column({ type: 'varchar', length: 20 })
    symbol: string;

    @Column({ type: 'varchar', length: 10 })
    type: string; // BUY ou SELL

    @Column({ type: 'decimal', precision: 10, scale: 2 })
    volume: number;

    @Column({ type: 'decimal', precision: 15, scale: 5 })
    open_price: number;

    @Column({ type: 'decimal', precision: 15, scale: 5 })
    close_price: number;

    @Column({ type: 'decimal', precision: 15, scale: 2 })
    profit: number;

    @Column({ type: 'bigint' })
    open_time: number; // Timestamp Unix

    @Column({ type: 'bigint' })
    close_time: number; // Timestamp Unix

    @CreateDateColumn()
    synced_at: Date;
}
