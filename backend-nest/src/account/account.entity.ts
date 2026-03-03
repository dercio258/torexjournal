import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { PositionEntity } from '../mt5/position.entity';
import { ColumnNumericTransformer } from '../common/transformers/numeric.transformer';

@Entity('accounts')
export class AccountEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'mt5_id', unique: true, nullable: true })
  mt5Id: string;

  @Column('decimal', { precision: 15, scale: 2, default: 0, transformer: new ColumnNumericTransformer() })
  balance: number;

  @Column('decimal', { precision: 15, scale: 2, default: 0, transformer: new ColumnNumericTransformer() })
  equity: number;

  @Column('decimal', { precision: 15, scale: 2, default: 0, transformer: new ColumnNumericTransformer() })
  margin: number;

  @Column('decimal', { precision: 15, scale: 2, default: 0, name: 'margin_free', transformer: new ColumnNumericTransformer() })
  marginFree: number;

  @Column('decimal', { precision: 15, scale: 2, default: 0, name: 'margin_level', transformer: new ColumnNumericTransformer() })
  marginLevel: number;

  @Column('int', { default: 1 })
  leverage: number;

  @Column({ default: false, name: 'is_connected' })
  isConnected: boolean;

  @Column({ type: 'timestamp', nullable: true, name: 'last_seen' })
  lastSeen: Date;

  @Column({ nullable: true, unique: true, name: 'app_token' })
  appToken: string;

  @Column({ name: 'user_id', nullable: true })
  userId: string;

  @Column({ name: 'telegram_chat_id', nullable: true })
  telegramChatId: string;

  @Column({ name: 'notifications_enabled', default: true })
  notificationsEnabled: boolean;

  @Column({ name: 'telegram_enabled', default: false })
  telegramEnabled: boolean;

  @OneToMany(() => PositionEntity, (position) => position.account)
  positions: PositionEntity[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
