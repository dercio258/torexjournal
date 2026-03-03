import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { UserEntity } from '../users/user.entity';
import { Comment } from './comment.entity';
import { Like } from './like.entity';

@Entity('network_posts')
export class Post {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: 'text' })
    content: string;

    @Column({ nullable: true })
    imageUrl: string;

    @Column({ default: 'text' }) // text, trade_share, milestone
    type: string;

    @Column({ type: 'jsonb', nullable: true })
    tradeData: any; // Snapshot of the trade if shared

    @ManyToOne(() => UserEntity, user => user.posts)
    @JoinColumn({ name: 'userId' })
    user: UserEntity;

    @Column()
    userId: string;

    @OneToMany(() => Comment, comment => comment.post)
    comments: Comment[];

    @OneToMany(() => Like, like => like.post)
    likes: Like[];

    @Column({ default: 0 })
    likesCount: number;

    @Column({ default: 0 })
    commentsCount: number;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
