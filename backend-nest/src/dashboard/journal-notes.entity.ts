import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    Index,
} from 'typeorm';

@Entity('daily_notes')
@Index(['userId', 'accountKey', 'date'], { unique: true })
@Index(['userId', 'date'])
export class DailyNoteEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'user_id' })
    userId: string;

    @Column({ name: 'account_key', default: 'all' })
    accountKey: string;

    @Column({ type: 'date' })
    date: string; // YYYY-MM-DD

    @Column({ nullable: true })
    title: string | null;

    @Column({ type: 'text', default: '' })
    content: string;

    @Column({ nullable: true })
    mood: string | null;

    @Column({ name: 'market_bias', nullable: true })
    marketBias: string | null;

    @Column({ name: 'psych_check', type: 'jsonb', default: () => "'{}'::jsonb" })
    psychCheck: {
        sleep?: string | null;
        energy?: string | null;
        focus?: string | null;
        caffeine?: string | null;
        moodState?: string | null;
        stress?: string | null;
    };

    @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
    images: string[];

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}

@Entity('trade_notes')
@Index(['userId', 'tradeId'], { unique: true })
@Index(['userId', 'updatedAt'])
export class TradeNoteEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'user_id' })
    userId: string;

    @Column({ name: 'trade_id' })
    tradeId: string;

    @Column({ type: 'text', default: '' })
    content: string;

    @Column({ name: 'screenshot_url', type: 'text', nullable: true })
    screenshotUrl: string | null;

    @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
    screenshots: string[];

    @Column({ nullable: true })
    setup: string | null;

    @Column({ type: 'text', nullable: true })
    mistakes: string | null;

    @Column({ type: 'text', nullable: true })
    lessons: string | null;

    @Column({ type: 'int', default: 0 })
    rating: number;

    @Column({ name: 'psych_check', type: 'jsonb', default: () => "'{}'::jsonb" })
    psychCheck: {
        feeling?: string | null;
        followingPlan?: string | null;
        entryDriver?: string | null;
        riskComfort?: string | null;
    };

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}

@Entity('general_notes')
@Index(['userId', 'isTemplate', 'pinned'])
export class GeneralNoteEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'user_id' })
    userId: string;

    @Column()
    title: string;

    @Column({ default: 'GENERAL' })
    category: string; // PLAYBOOK | RISK_RULES | PSYCHOLOGY | GENERAL

    @Column({ type: 'text', default: '' })
    content: string;

    @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
    images: string[];

    @Column({ default: false })
    pinned: boolean;

    @Column({ name: 'is_template', default: false })
    isTemplate: boolean;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
