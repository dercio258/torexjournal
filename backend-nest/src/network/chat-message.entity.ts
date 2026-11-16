import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { UserEntity } from '../users/user.entity';

@Entity('network_chat_messages')
@Index('IDX_network_chat_room_created', ['room', 'createdAt'])
export class ChatMessage {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: 'text' })
    content: string;

    @ManyToOne(() => UserEntity)
    @JoinColumn({ name: 'userId' })
    user: UserEntity;

    @Column()
    userId: string;

    @Column({ default: 'global' })
    room: string;

    @CreateDateColumn()
    createdAt: Date;
}
