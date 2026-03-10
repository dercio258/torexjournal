import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { AccountEntity } from '../account/account.entity';

@Entity('ai_insights')
export class AiInsightEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'account_id' })
    accountId: string;

    @ManyToOne(() => AccountEntity)
    @JoinColumn({ name: 'account_id' })
    account: AccountEntity;

    @Column({ type: 'varchar', length: 255 })
    headline: string;

    // We store the structured JSON array of insights directly
    @Column({ type: 'json' })
    insights: { text: string; severity: 'green' | 'yellow' | 'red' }[];

    // We store the structured JSON array of actions directly
    @Column({ type: 'json' })
    actions: string[];

    // Tying this to a specific import run if applicable
    @Column({ name: 'import_log_id', nullable: true })
    importLogId: number;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;
}
