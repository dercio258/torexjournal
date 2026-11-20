import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, OneToMany, Index } from 'typeorm';
import { Subscription } from '../payment/subscription.entity';
import { Post } from '../network/post.entity';

@Entity('users')
@Index('IDX_users_refresh_token', ['refreshToken'])
@Index('IDX_users_created_at', ['createdAt'])
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

    @Column({ name: 'is_blocked', default: false })
    isBlocked: boolean;

    @Column({ name: 'daily_loss_limit', type: 'decimal', precision: 12, scale: 2, nullable: true })
    dailyLossLimit: number;

    @Column({ name: 'last_warning_shown', type: 'timestamp', nullable: true })
    lastWarningShown: Date;

    @Column({ name: 'has_used_trial', default: false })
    hasUsedTrial: boolean;

    @Column({ name: 'trial_used_at', type: 'timestamp', nullable: true })
    trialUsedAt: Date;

    @Column({ name: 'preferred_locale', length: 8, default: 'pt' })
    preferredLocale: string;

    @Column({ name: 'timezone', length: 64, nullable: true })
    timezone: string;

    @Column({ name: 'attribution_data', type: 'jsonb', nullable: true })
    attributionData: any;

    @Column({ name: 'visitor_id', length: 120, nullable: true })
    visitorId: string | null;

    @Column({ name: 'acquisition_source', length: 160, nullable: true })
    acquisitionSource: string | null;

    @Column({ name: 'acquisition_medium', length: 160, nullable: true })
    acquisitionMedium: string | null;

    @Column({ name: 'acquisition_campaign', length: 200, nullable: true })
    acquisitionCampaign: string | null;

    @Column({ name: 'acquisition_content', length: 200, nullable: true })
    acquisitionContent: string | null;

    @Column({ name: 'acquisition_term', length: 200, nullable: true })
    acquisitionTerm: string | null;

    @Column({ name: 'landing_path', length: 512, nullable: true })
    landingPath: string | null;

    @Column({ name: 'referrer', length: 1024, nullable: true })
    referrer: string | null;

    @Column({ name: 'last_login_at', type: 'timestamp', nullable: true })
    lastLoginAt: Date | null;

    @Column({ name: 'last_active_at', type: 'timestamp', nullable: true })
    lastActiveAt: Date | null;

    @Column({ name: 'last_action_type', type: 'varchar', length: 64, nullable: true })
    lastActionType: string | null;

    @Column({ name: 'last_action_label', type: 'varchar', length: 180, nullable: true })
    lastActionLabel: string | null;

    @Column({ name: 'last_action_path', type: 'varchar', length: 255, nullable: true })
    lastActionPath: string | null;

    @Column({ name: 'email_verified_at', type: 'timestamp', nullable: true })
    emailVerifiedAt: Date | null;

    @Column({ name: 'referral_code', type: 'varchar', length: 32, unique: true, nullable: true })
    referralCode: string | null;

    @Column({ name: 'referred_by_user_id', type: 'varchar', length: 64, nullable: true })
    referredByUserId: string | null;

    @Column({ name: 'referral_credits_usd', type: 'numeric', precision: 10, scale: 2, default: 0 })
    referralCreditsUsd: number;

    @Column({ name: 'referral_pending_credits_usd', type: 'numeric', precision: 10, scale: 2, default: 0 })
    referralPendingCreditsUsd: number;

    @Column({ name: 'referral_ai_bonus_until', type: 'timestamp', nullable: true })
    referralAiBonusUntil: Date | null;

    @Column({ name: 'referral_tier_boost', type: 'boolean', default: false })
    referralTierBoost: boolean;
}
