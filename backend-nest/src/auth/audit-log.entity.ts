import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { UserEntity } from '../users/user.entity';

@Entity('audit_logs')
export class AuditLogEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'user_id', nullable: true })
    userId: string;

    @ManyToOne(() => UserEntity)
    @JoinColumn({ name: 'user_id' })
    user: UserEntity;

    @Column()
    action: string;

    @Column({ type: 'jsonb', nullable: true })
    metadata: any;

    @Column({ nullable: true })
    ip: string;

    @Column({ name: 'user_agent', nullable: true })
    userAgent: string;

    @CreateDateColumn()
    timestamp: Date;
}
