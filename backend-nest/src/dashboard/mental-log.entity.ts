
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { AccountEntity } from '../account/account.entity';

@Entity('mental_logs')
export class MentalLog {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: 'date' })
    date: string; // YYYY-MM-DD

    @Column({ nullable: true })
    time: string; // HH:mm

    @Column({ nullable: true })
    session: string; // London, New York, Asian, etc.

    @Column()
    sleepQuality: number; // 1-10

    @Column()
    energy: number; // 1-10

    @Column()
    focus: number; // 1-10

    @Column()
    mood: number; // 1-10

    @Column()
    stress: number; // 1-10

    @Column()
    caffeine: number; // 1-10

    @Column({ type: 'text', nullable: true })
    notes: string;

    @Column({ type: 'text', nullable: true })
    imageUrl: string;

    @Column({ type: 'float', default: 0 })
    overallScore: number;

    @Column({ name: 'account_id', nullable: true })
    accountId: string;

    @ManyToOne(() => AccountEntity)
    @JoinColumn({ name: 'account_id' })
    account: AccountEntity;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
