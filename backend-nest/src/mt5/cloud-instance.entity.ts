import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum CloudInstanceStatus {
    STARTING = 'STARTING',
    RUNNING = 'RUNNING',
    STOPPED = 'STOPPED',
    ERROR = 'ERROR'
}

@Entity('cloud_instances')
export class CloudInstanceEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    userId: string; // Foreign key to UserEntity (linked logically)

    @Column()
    mt5Id: string;

    @Column({ nullable: true })
    pid: number; // OS Process ID

    @Column({
        type: 'enum',
        enum: CloudInstanceStatus,
        default: CloudInstanceStatus.STOPPED
    })
    status: CloudInstanceStatus;

    @Column({ nullable: true })
    errorMessage: string;

    @Column({ nullable: true })
    connectionString: string; // e.g., "127.0.0.1:3000"

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
