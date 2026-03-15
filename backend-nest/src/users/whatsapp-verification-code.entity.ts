import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    ManyToOne,
    JoinColumn,
} from 'typeorm';
import { UserEntity } from './user.entity';

@Entity('whatsapp_verification_codes')
export class WhatsAppVerificationCode {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id' })
    user: UserEntity;

    @Column({ type: 'varchar', length: 6 })
    code: string;

    @Column({ name: 'expires_at' })
    expiresAt: Date;

    @Column({ default: false })
    used: boolean;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;
}
