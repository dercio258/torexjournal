import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

@Entity('economic_events')
export class EconomicEvent {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ unique: true })
    externalId: string; // Composite key or specific ID from provider if available

    @Column()
    time: string; // ISO date string

    @Column()
    currency: string;

    @Column()
    event: string;

    @Column()
    impact: string; // Low, Medium, High

    @Column({ nullable: true })
    actual: string;

    @Column({ nullable: true })
    forecast: string;

    @Column({ nullable: true })
    previous: string;

    @CreateDateColumn()
    createdAt: Date;
}
