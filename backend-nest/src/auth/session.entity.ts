import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('sessions')
@Index('IDX_sessions_user_active_expires', ['userId', 'isActive', 'expiresAt'])
export class SessionEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    @Index()
    userId: string;

    @Column({ type: 'text' })
    @Index()
    token: string;

    @Column({ nullable: true })
    userAgent: string;

    @Column({ nullable: true })
    ipAddress: string;

    @Column({ type: 'timestamp' })
    expiresAt: Date;

    @Column({ default: true })
    isActive: boolean;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
