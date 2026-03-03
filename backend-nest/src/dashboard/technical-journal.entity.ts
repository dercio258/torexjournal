
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { AccountEntity } from '../account/account.entity';

@Entity('technical_journals')
export class TechnicalJournal {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: 'date' })
    date: string; // YYYY-MM-DD

    @Column({ nullable: true })
    marketTrend: string; // Bullish, Bearish, Sideways

    @Column({ nullable: true })
    volatility: string; // Low, Medium, High

    @Column({ nullable: true })
    session: string; // London, NY, Asia

    @Column({ type: 'text', nullable: true })
    strategyUsed: string;

    @Column({ type: 'text', nullable: true })
    mistakes: string; // Array or text

    @Column({ type: 'text', nullable: true })
    lessons: string;

    @Column({ type: 'int', default: 0 })
    rating: number; // 1-10

    @Column({ type: 'text', nullable: true })
    notes: string;

    @Column({ name: 'account_id', nullable: true })
    accountId: string;

    @Column({ nullable: true })
    entryPrecision: string; // 'Perfect', 'Early', 'Late', 'Impulse'

    @Column({ nullable: true })
    riskManagement: string; // 'Planned', 'High', 'NoStop', 'Fear'

    @Column({ nullable: true })
    tradeExit: string; // 'Target', 'Stop', 'Early', 'Late'

    @Column({ nullable: true })
    emotionalState: string; // 'Focused', 'Anxious', 'Confident', 'Frustrated'

    @ManyToOne(() => AccountEntity)
    @JoinColumn({ name: 'account_id' })
    account: AccountEntity;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
