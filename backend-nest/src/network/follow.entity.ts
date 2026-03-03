import { Entity, PrimaryGeneratedColumn, ManyToOne, JoinColumn, CreateDateColumn, Column } from 'typeorm';
import { UserEntity } from '../users/user.entity';

@Entity('network_follows')
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
