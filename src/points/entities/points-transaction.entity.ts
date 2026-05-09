import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export type PointsTransactionType = 'COUPON_SCAN' | 'REWARD_REDEEM';

@Entity({ name: 'points_transactions' })
export class PointsTransaction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user!: User;

  @Column({ type: 'text' })
  type!: PointsTransactionType;

  @Column({ name: 'points_delta', type: 'integer' })
  pointsDelta!: number;

  @Column({ type: 'text' })
  title!: string;

  @Column({ type: 'text', nullable: true })
  site!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
