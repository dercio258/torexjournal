import {
    Entity,
    PrimaryColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';

export const AI_SUPPORT_FALLBACK_MESSAGE =
    'Não consigo ajudar-lhe neste momento, entre em contacto com o suporte oficial pelos contactos +258858923752 info@torexjournal.com';

export const AI_SUPPORT_FALLBACK_MESSAGE_EN =
    'I am unable to assist right now. Please contact official support at +258858923752 or info@torexjournal.com.';

export interface AiCreditStatusDto {
    planTier: string;
    dailyLimit: number;
    creditsRemaining: number;
    creditsUsedToday: number;
    totalCreditsUsed: number;
    lastResetDate: string;
    nextResetAt: string;
    canInteract: boolean;
    maxMessageChars: number;
}

@Entity('ai_user_credits')
export class AiUserCreditEntity {
    @PrimaryColumn({ name: 'user_id', type: 'varchar' })
    userId: string;

    @Column({ name: 'plan_tier', type: 'varchar', length: 30, default: 'FREE' })
    planTier: string;

    @Column({ name: 'daily_limit', type: 'int', default: 0 })
    dailyLimit: number;

    @Column({ name: 'credits_remaining', type: 'int', default: 0 })
    creditsRemaining: number;

    @Column({ name: 'credits_used_today', type: 'int', default: 0 })
    creditsUsedToday: number;

    @Column({ name: 'total_credits_used', type: 'int', default: 0 })
    totalCreditsUsed: number;

    @Column({ name: 'last_reset_date', type: 'varchar', length: 10 })
    lastResetDate: string;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
