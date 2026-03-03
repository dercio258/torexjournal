import { Entity, PrimaryGeneratedColumn, ManyToOne, JoinColumn, Column } from 'typeorm';
import { UserEntity } from '../users/user.entity';
import { ChatRoom } from './chat-room.entity';

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
