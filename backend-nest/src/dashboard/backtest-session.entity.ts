import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { AccountEntity } from '../account/account.entity';
import { UserEntity } from '../users/user.entity';

@Entity('backtest_sessions')
@Index('IDX_backtest_sessions_user_client_id', ['userId', 'clientSessionId'])
@Index('IDX_backtest_sessions_user_mode_updated', ['userId', 'mode', 'updatedAt'])
export class BacktestSession {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'user_id' })
    userId: string;

    @Column({ name: 'client_session_id', type: 'varchar', length: 120, nullable: true })
    clientSessionId: string | null;

    @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id' })
    user: UserEntity;

    @Column({ name: 'account_id', nullable: true })
    accountId: string;

    @ManyToOne(() => AccountEntity, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'account_id' })
    account: AccountEntity;

    @Column({ default: 'Nova Simulação de Backtest' })
    name: string;

    @Column({ default: 'ACCOUNT_HISTORY' })
    mode: string; // 'ACCOUNT_HISTORY' | 'STRATEGY_SIM'

    @Column({ nullable: true })
    strategy: string;

    @Column({ nullable: true })
    symbol: string;

    @Column({ type: 'jsonb', default: {} })
    config: Record<string, any>;

    @Column({ type: 'jsonb', default: {} })
    results: Record<string, any>;

    @Column({ type: 'text', nullable: true })
    notes: string;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
