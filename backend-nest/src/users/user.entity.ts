import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { Subscription } from '../payment/subscription.entity';
import { Post } from '../network/post.entity';

@Entity('users')
export class UserEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ nullable: true })
    name: string;

    @Column({ nullable: true, unique: true })
    username: string;

    @Column({ nullable: true })
    avatarUrl: string;

    @Column({ unique: true, nullable: true })
    email: string;

    @Column({ name: 'password_hash', nullable: true })
    passwordHash: string;

    @Column({ nullable: true })
    whatsapp: string;

    @Column({ name: 'api_token', nullable: true, unique: true })
    apiToken: string;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @OneToMany(() => Subscription, (subscription) => subscription.user)
    subscriptions: Subscription[];

    @OneToMany(() => Post, (post) => post.user)
    posts: Post[];

    @Column({ name: 'telegram_chat_id', nullable: true, unique: true })
    telegramChatId: string;

    @Column({ type: 'jsonb', nullable: true, default: {} })
    notificationPreferences: Record<string, boolean>;
}
