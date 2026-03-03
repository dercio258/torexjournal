import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany, ManyToOne, JoinColumn } from 'typeorm';
import { UserEntity } from '../users/user.entity';

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

@Entity('network_chat_members')
export class ChatMember {
    @PrimaryGeneratedColumn()
    id: number;

    @ManyToOne(() => ChatRoom, room => room.members)
    @JoinColumn({ name: 'roomId' })
    room: ChatRoom;

    @Column()
    roomId: string;

    @ManyToOne(() => UserEntity)
    @JoinColumn({ name: 'userId' })
    user: UserEntity;

    @Column()
    userId: string;
}
