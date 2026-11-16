import { Entity, PrimaryGeneratedColumn, ManyToOne, JoinColumn, CreateDateColumn, Column, Index } from 'typeorm';
import { UserEntity } from '../users/user.entity';

@Entity('network_follows')
@Index('IDX_network_follows_pair', ['followerId', 'followingId'])
export class Follow {
    @PrimaryGeneratedColumn()
    id: number;

    @ManyToOne(() => UserEntity)
    @JoinColumn({ name: 'followerId' })
    follower: UserEntity;

    @Column()
    followerId: string;

    @ManyToOne(() => UserEntity)
    @JoinColumn({ name: 'followingId' })
    following: UserEntity;

    @Column()
    followingId: string;

    @CreateDateColumn()
    createdAt: Date;
}
