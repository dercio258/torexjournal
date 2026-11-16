import {
    Entity,
    PrimaryGeneratedColumn,
    PrimaryColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    ManyToOne,
    JoinColumn,
    Index,
} from 'typeorm';
import { AccountEntity } from '../account/account.entity';
import { UserEntity } from '../users/user.entity';
import { BacktestSession } from './backtest-session.entity';

@Entity('backtest_strategies')
@Index('IDX_backtest_strategies_user_updated', ['userId', 'updatedAt'])
@Index('IDX_backtest_strategies_user_client_id', ['userId', 'clientStrategyId'])
export class BacktestStrategyEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'user_id' })
    userId: string;

    @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id' })
    user: UserEntity;

    @Column({ name: 'client_strategy_id', type: 'varchar', length: 120, nullable: true })
    clientStrategyId: string | null;

    @Column({ length: 180 })
    name: string;

    @Column({ name: 'trading_method', length: 160, default: 'Smart Money Concepts (SMC / ICT)' })
    tradingMethod: string;

    @Column({ type: 'text', nullable: true })
    description: string | null;

    @Column({ name: 'session_tag', length: 120, default: 'London & NY' })
    sessionTag: string;

    @Column({ length: 32, default: 'ACTIVE' })
    status: string;

    @Column({ name: 'starting_capital', type: 'double precision', default: 100000 })
    startingCapital: number;

    @Column({ length: 16, default: 'USD' })
    currency: string;

    @Column({ name: 'risk_mode', length: 32, default: 'FIXED_RISK' })
    riskMode: string;

    @Column({ name: 'risk_per_trade', type: 'double precision', default: 1.0 })
    riskPerTrade: number;

    @Column({ name: 'default_timeframe', length: 16, default: '5m' })
    defaultTimeframe: string;

    @Column({ name: 'rr_target', type: 'double precision', default: 2.0 })
    rrTarget: number;

    @Column({ name: 'primary_symbol', length: 32, default: 'XAUUSD' })
    primarySymbol: string;

    @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
    symbols: string[];

    @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
    rules: any[];

    @Column({ name: 'journal_config', type: 'jsonb', nullable: true })
    journalConfig: Record<string, any> | null;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}

@Entity('backtest_session_blobs')
@Index('IDX_backtest_session_blobs_user', ['userId'])
export class BacktestSessionBlobEntity {
    @PrimaryColumn({ name: 'session_id', type: 'uuid' })
    sessionId: string;

    @ManyToOne(() => BacktestSession, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'session_id' })
    session: BacktestSession;

    @Column({ name: 'user_id' })
    userId: string;

    @Column({ type: 'integer', default: 0 })
    revision: number;

    @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
    orders: any[];

    @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
    drawings: any[];

    @Column({ name: 'drawn_items', type: 'jsonb', default: () => "'[]'::jsonb" })
    drawnItems: any[];

    @Column({ name: 'drawing_styles_by_id', type: 'jsonb', default: () => "'{}'::jsonb" })
    drawingStylesById: Record<string, any>;

    @Column({ name: 'overlay_geometries', type: 'jsonb', default: () => "'{}'::jsonb" })
    overlayGeometries: Record<string, any>;

    @Column({ name: 'session_screenshots', type: 'jsonb', default: () => "'[]'::jsonb" })
    sessionScreenshots: any[];

    @Column({ name: 'journal_images', type: 'jsonb', default: () => "'[]'::jsonb" })
    journalImages: string[];

    @Column({ name: 'quant_metrics', type: 'jsonb', nullable: true })
    quantMetrics: Record<string, any> | null;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}

@Entity('backtest_hypotheses')
@Index('IDX_backtest_hypotheses_user_updated', ['userId', 'updatedAt'])
@Index('IDX_backtest_hypotheses_user_account_updated', ['userId', 'accountId', 'updatedAt'])
export class BacktestHypothesisEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'user_id' })
    userId: string;

    @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id' })
    user: UserEntity;

    @Column({ name: 'account_id', nullable: true })
    accountId: string | null;

    @ManyToOne(() => AccountEntity, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'account_id' })
    account: AccountEntity | null;

    @Column({ length: 200 })
    name: string;

    @Column({ length: 48, default: 'ACCOUNT_HISTORY' })
    mode: string;

    @Column({ length: 160, default: 'Hipótese sobre o histórico' })
    strategy: string;

    @Column({ length: 32, default: 'ALL' })
    symbol: string;

    @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
    config: Record<string, any>;

    @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
    results: Record<string, any>;

    @Column({ type: 'text', nullable: true })
    notes: string | null;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
