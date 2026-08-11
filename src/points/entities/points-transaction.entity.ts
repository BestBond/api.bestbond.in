import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export type PointsTransactionType =
  | 'COUPON_SCAN'
  | 'REWARD_REDEEM'
  | 'REDEMPTION_REFUND'
  | 'POINTS_EXPIRE'
  | 'ADMIN_ADJUSTMENT';

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

  /** Raw FK, mapped alongside the relation below so it can be read without a join. */
  @Column({ type: 'uuid', nullable: true })
  performedById!: string | null;

  /** SuperAdmin who made a manual adjustment (ADMIN_ADJUSTMENT only). Null for all other types. */
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'performedById' })
  performedBy!: User | null;

  /** Required, audit-facing reason for ADMIN_ADJUSTMENT; null for all other types. */
  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
