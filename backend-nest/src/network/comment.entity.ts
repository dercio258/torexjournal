import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { UserEntity } from '../users/user.entity';
import { Post } from './post.entity';

@Entity('network_comments')
@Index('IDX_network_comments_post_created', ['postId', 'createdAt'])
export class Comment {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: 'text' })
    content: string;

    @ManyToOne(() => UserEntity)
    @JoinColumn({ name: 'userId' })
    user: UserEntity;

    @Column()
    userId: string;

    @ManyToOne(() => Post, post => post.comments, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'postId' })
    post: Post;

    @Column()
    postId: number;

    @CreateDateColumn()
    createdAt: Date;
}
