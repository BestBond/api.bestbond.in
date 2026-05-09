import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Reward } from './reward.entity';
import { User } from '../../users/entities/user.entity';

export type RedemptionStatus =
  | 'PROCESSING'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED';

@Entity({ name: 'redemptions' })
export class Redemption {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ name: 'tracking_id', type: 'text' })
  trackingId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user!: User;

  @ManyToOne(() => Reward, { onDelete: 'RESTRICT' })
  reward!: Reward;

  @Column({ name: 'points_cost', type: 'integer' })
  pointsCost!: number;

  // Minimal delivery snapshot to match "Office Site A" style in design.
  @Column({ name: 'delivery_label', type: 'text', nullable: true })
  deliveryLabel!: string | null;

  @Column({ name: 'delivery_address', type: 'text', nullable: true })
  deliveryAddress!: string | null;

  @Column({ type: 'text', default: 'PROCESSING' })
  status!: RedemptionStatus;

  @Column({ name: 'eta_text', type: 'text', nullable: true })
  etaText!: string | null; // e.g. "5-7 Business Days"

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
