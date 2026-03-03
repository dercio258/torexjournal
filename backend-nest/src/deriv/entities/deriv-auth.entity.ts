import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { UserEntity } from '../../users/user.entity';

@Entity('deriv_auth')
export class DerivAuthEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    userId: string;

    @ManyToOne(() => UserEntity)
    @JoinColumn({ name: 'userId' })
    user: UserEntity;

    @Column({ name: 'account_id' })
    accountId: string; // The Deriv account ID (e.g., CR12345)

    @Column({ type: 'text' })
    encryptedToken: string;

    @Column({ nullable: true })
    currency: string;

    @Column({ default: true })
    isActive: boolean;

    @Column({ type: 'jsonb', nullable: true })
    metadata: any; // Store extra info like scopes, account type, etc.

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
