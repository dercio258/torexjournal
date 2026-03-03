import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany } from 'typeorm';
import { ChatMember } from './chat-member.entity';

@Entity('network_chat_rooms')
export class ChatRoom {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ nullable: true })
    name: string; // For groups

    @Column({ default: 'dm' }) // 'dm' or 'group'
    type: string;

    @CreateDateColumn()
    createdAt: Date;

    @OneToMany(() => ChatMember, member => member.room)
    members: ChatMember[];
}
