import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
    ProfileFact,
    ProfileFactType,
    formatProfileFact,
} from './ai-profile-extractor';

export type ProfileConsent = 'PENDING' | 'GRANTED' | 'DENIED';

export interface StoredProfileFact {
    value: string;
    updatedAtIso: string;
}

export interface AiUserProfile {
    userId: string;
    consent: ProfileConsent;
    facts: Partial<Record<ProfileFactType, StoredProfileFact>>;
    updatedAtIso: string | null;
}

const FACT_ORDER: ProfileFactType[] = ['NAME', 'EXPERIENCE', 'STYLE', 'MARKETS', 'GOAL'];
const MAX_VALUE_LEN = 120;

/**
 * Private, user-controlled memory of what the user told the assistant about themselves.
 * Facts are kept only after explicit consent, are never shared across users and never
 * enter the global semantic memory. Age is never stored.
 */
@Injectable()
export class AiUserProfileService implements OnModuleInit {
    private readonly logger = new Logger(AiUserProfileService.name);

    constructor(private readonly dataSource: DataSource) {}

    async onModuleInit(): Promise<void> {
        if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) return;
        try {
            await this.dataSource.query(`
                CREATE TABLE IF NOT EXISTS ai_user_profile (
                    user_id VARCHAR PRIMARY KEY,
                    consent VARCHAR(10) NOT NULL DEFAULT 'PENDING',
                    facts JSONB NOT NULL DEFAULT '{}'::jsonb,
                    created_at TIMESTAMP NOT NULL DEFAULT now(),
                    updated_at TIMESTAMP NOT NULL DEFAULT now(),
                    CONSTRAINT chk_ai_user_profile_consent CHECK (consent IN ('PENDING', 'GRANTED', 'DENIED'))
                );
            `);
        } catch (err) {
            this.logger.warn(`ai_user_profile schema check failed: ${(err as Error).message}`);
        }
    }

    async getProfile(userId: string): Promise<AiUserProfile> {
        const rows = await this.dataSource.query(
            `SELECT user_id, consent, facts, updated_at FROM ai_user_profile WHERE user_id = $1`,
            [userId]
        );
        const row = Array.isArray(rows) ? rows[0] : null;
        if (!row) {
            return { userId, consent: 'PENDING', facts: {}, updatedAtIso: null };
        }
        return {
            userId,
            consent: (['PENDING', 'GRANTED', 'DENIED'].includes(row.consent) ? row.consent : 'PENDING') as ProfileConsent,
            facts: row.facts && typeof row.facts === 'object' ? row.facts : {},
            updatedAtIso: row.updated_at ? new Date(row.updated_at).toISOString() : null,
        };
    }

    /** Saves facts only when the user has already granted consent. */
    async mergeFacts(userId: string, facts: ProfileFact[]): Promise<AiUserProfile> {
        const profile = await this.getProfile(userId);
        if (profile.consent !== 'GRANTED' || facts.length === 0) return profile;
        const merged = { ...profile.facts, ...this.toStored(facts) };
        await this.upsert(userId, 'GRANTED', merged);
        return { ...profile, facts: merged };
    }

    /**
     * Records the user's answer. Granting saves the facts that were waiting for consent;
     * denying clears every stored fact.
     */
    async setConsent(userId: string, granted: boolean, pendingFacts: ProfileFact[] = []): Promise<AiUserProfile> {
        const profile = await this.getProfile(userId);
        const facts = granted ? { ...profile.facts, ...this.toStored(pendingFacts) } : {};
        const consent: ProfileConsent = granted ? 'GRANTED' : 'DENIED';
        await this.upsert(userId, consent, facts);
        return { ...profile, consent, facts };
    }

    async removeFact(userId: string, type: ProfileFactType): Promise<AiUserProfile> {
        const profile = await this.getProfile(userId);
        if (!profile.facts[type]) return profile;
        const facts = { ...profile.facts };
        delete facts[type];
        await this.upsert(userId, profile.consent, facts);
        return { ...profile, facts };
    }

    /** Deletes everything, including the consent answer. */
    async deleteProfile(userId: string): Promise<void> {
        await this.dataSource.query(`DELETE FROM ai_user_profile WHERE user_id = $1`, [userId]);
    }

    /** Short lines for the analyst prompt (max 5), only with consent. */
    async getPromptFacts(userId: string, locale: 'pt' | 'en'): Promise<string[]> {
        const profile = await this.getProfile(userId);
        return AiUserProfileService.describeFacts(profile, locale).slice(0, 5);
    }

    static describeFacts(profile: AiUserProfile, locale: 'pt' | 'en'): string[] {
        if (profile.consent !== 'GRANTED') return [];
        return FACT_ORDER.filter((t) => profile.facts[t]?.value).map((t) =>
            formatProfileFact({ type: t, value: String(profile.facts[t]!.value) }, locale)
        );
    }

    private toStored(facts: ProfileFact[]): Partial<Record<ProfileFactType, StoredProfileFact>> {
        const now = new Date().toISOString();
        const out: Partial<Record<ProfileFactType, StoredProfileFact>> = {};
        for (const f of facts) {
            if (!FACT_ORDER.includes(f.type)) continue;
            const value = String(f.value || '').trim().slice(0, MAX_VALUE_LEN);
            if (value) out[f.type] = { value, updatedAtIso: now };
        }
        return out;
    }

    private async upsert(
        userId: string,
        consent: ProfileConsent,
        facts: Partial<Record<ProfileFactType, StoredProfileFact>>
    ): Promise<void> {
        await this.dataSource.query(
            `INSERT INTO ai_user_profile (user_id, consent, facts, updated_at)
             VALUES ($1, $2, $3::jsonb, now())
             ON CONFLICT (user_id) DO UPDATE
                SET consent = EXCLUDED.consent, facts = EXCLUDED.facts, updated_at = now()`,
            [userId, consent, JSON.stringify(facts)]
        );
    }
}
