import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { UserEntity } from '../users/user.entity';

export enum AlertType {
    RISK = 'RISK',
    DISCIPLINE = 'DISCIPLINE',
    JOURNAL = 'JOURNAL',
    PSYCHOLOGY = 'PSYCHOLOGY',
    PERFORMANCE = 'PERFORMANCE',
    DATA = 'DATA',
    COACHING = 'COACHING',
    SYSTEM = 'SYSTEM',
    MARKETING = 'MARKETING'
}

export enum AlertSeverity {
    INFO = 'INFO',
    WARNING = 'WARNING',
    CRITICAL = 'CRITICAL'
}

@Entity('alerts')
export class AlertEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'user_id' })
    @Index()
    userId: string;

    @ManyToOne(() => UserEntity)
    @JoinColumn({ name: 'user_id' })
    user: UserEntity;

    @Column({ name: 'trade_id', nullable: true })
    tradeId: string;

    @Column({
        type: 'enum',
        enum: AlertType,
        default: AlertType.COACHING
    })
    type: AlertType;

    @Column({
        type: 'enum',
        enum: AlertSeverity,
        default: AlertSeverity.INFO
    })
    severity: AlertSeverity;

    @Column()
    title: string;

    @Column('text')
    description: string;

    @Column({ default: false })
    resolved: boolean;

    @Column({ type: 'jsonb', nullable: true })
    metadata: any; // Flexible field for rule-specific data (e.g. { current_risk: 3.5, limit: 2.0 })

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
