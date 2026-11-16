import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { UserEntity } from '../users/user.entity';
import { AccountEntity } from '../account/account.entity';

export enum ImportMethod {
    EA = 'EA',
    FILE = 'FILE',
    AUTO_SYNC = 'AUTO_SYNC',
    MANUAL = 'MANUAL',
    DERIV = 'DERIV'
}

export enum ImportStatus {
    SUCCESS = 'SUCCESS',
    FAILED = 'FAILED',
    PARTIAL = 'PARTIAL'
}

@Entity('import_logs')
@Index(['userId', 'createdAt'])
@Index(['accountId', 'createdAt'])
export class ImportLog {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ nullable: true })
    userId: string;

    @ManyToOne(() => UserEntity)
    @JoinColumn({ name: 'userId' })
    user: UserEntity;

    @Column({ name: 'account_id', nullable: true })
    accountId: string;

    @ManyToOne(() => AccountEntity, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'account_id' })
    account: AccountEntity;

    @Column({
        type: 'enum',
        enum: ImportMethod,
        default: ImportMethod.EA
    })
    method: ImportMethod;

    @Column({
        type: 'enum',
        enum: ImportStatus,
        default: ImportStatus.SUCCESS
    })
    status: ImportStatus;

    @Column({ type: 'text', nullable: true })
    details: string; // e.g., "Imported 15 trades from Account 12345"

    @Column({ type: 'int', default: 0 })
    tradesCount: number;

    @CreateDateColumn()
    createdAt: Date;
}
