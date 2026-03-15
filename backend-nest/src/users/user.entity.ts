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

    @Column({ name: 'google_id', unique: true, nullable: true })
    googleId: string;

    @Column({ name: 'github_id', unique: true, nullable: true })
    githubId: string;

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

    @Column({ nullable: true })
    preferredMpesa: string;

    @Column({ nullable: true })
    preferredEmola: string;

    @Column({ nullable: true })
    lastPaymentMethod: string;

    @Column({ name: 'two_factor_enabled', default: false })
    twoFactorEnabled: boolean;

    @Column({ name: 'onboarding_completed', default: false })
    onboardingCompleted: boolean;

    @Column({ type: 'jsonb', nullable: true, name: 'survey_answers' })
    surveyAnswers: any;

    @Column({ name: 'sms_usage_count', default: 0 })
    smsUsageCount: number;

    @Column({ name: 'last_sms_reset', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
    lastSmsReset: Date;

    @Column({ name: 'refresh_token', nullable: true })
    refreshToken: string;

    @Column({ name: 'two_factor_secret', nullable: true })
    twoFactorSecret: string;

    @Column({ name: 'is_two_factor_confirmed', default: false })
    isTwoFactorConfirmed: boolean;
}
