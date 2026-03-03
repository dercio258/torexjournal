import { Entity, Column, PrimaryColumn, Index } from 'typeorm';

/**
 * Entidade otimizada para TimescaleDB.
 * Não usamos @PrimaryGeneratedColumn() porque em TimescaleDB
 * a chave primária composta geralmente é (timestamp, symbol).
 */
@Entity('market_ticks')
@Index(['symbol', 'timestamp']) // Índice composto para busca rápida
export class MarketTickEntity {

    @PrimaryColumn({ type: 'timestamptz' })
    timestamp: Date;

    @PrimaryColumn()
    symbol: string;

    @Column('float')
    bid: number;

    @Column('float')
    ask: number;

    @Column('float', { nullable: true })
    last: number;

    @Column('float', { nullable: true })
    volume: number;

    @Column()
    mt5Id: number;
}
