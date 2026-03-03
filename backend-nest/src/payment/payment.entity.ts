import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('payments')
export class PaymentEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    email: string;

    @Column()
    nomeCliente: string;

    @Column()
    produto: string;

    @Column('decimal', { precision: 10, scale: 2 })
    preco: number;

    @Column({ default: 'aprovada' })
    status: string;

    @Column({ unique: true })
    vendaId: string;

    @Column({ type: 'timestamp' })
    dataHora: Date;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
