
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { AccountEntity } from '../account/account.entity';

export enum NotificationType {
    TRADE_SUCCESS = 'trade_success',
    RISK_ALERT = 'risk_alert',
    MENTAL_INSIGHT = 'mental_insight',
    SYSTEM = 'system',
    TRADE_NEUTRAL = 'trade_neutral'
}

@Entity('notifications')
export class NotificationEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'account_id' })
    accountId: string;

    @ManyToOne(() => AccountEntity)
    @JoinColumn({ name: 'account_id' })
    account: AccountEntity;

    @Column({
        type: 'enum',
        enum: NotificationType,
        default: NotificationType.SYSTEM
    })
    type: NotificationType;

    @Column()
    title: string;

    @Column('text')
    message: string;

    @Column({ name: 'is_read', default: false })
    isRead: boolean;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;
}
