import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { AccountEntity } from '../account/account.entity';
import { ColumnNumericTransformer } from '../common/transformers/numeric.transformer';

@Entity('positions')
export class PositionEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'account_id' })
    accountId: string;

    @ManyToOne(() => AccountEntity, (account) => account.positions)
    @JoinColumn({ name: 'account_id' })
    account: AccountEntity;

    @Column({ nullable: true })
    ticket: string;

    @Column()
    symbol: string;

    @Column()
    type: string;

    @Column('decimal', { precision: 10, scale: 2, transformer: new ColumnNumericTransformer() })
    volume: number;

    @Column('decimal', { precision: 10, scale: 5, name: 'open_price', transformer: new ColumnNumericTransformer() })
    openPrice: number;

    @Column('decimal', { precision: 10, scale: 5, nullable: true, name: 'current_price', transformer: new ColumnNumericTransformer() })
    currentPrice: number;

    @Column('decimal', { precision: 10, scale: 2, transformer: new ColumnNumericTransformer() })
    profit: number;

    @Column('decimal', { precision: 10, scale: 5, nullable: true, transformer: new ColumnNumericTransformer() })
    sl: number;

    @Column('decimal', { precision: 10, scale: 5, nullable: true, transformer: new ColumnNumericTransformer() })
    tp: number;

    @Column({ type: 'timestamp', name: 'open_time' })
    openTime: Date;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
