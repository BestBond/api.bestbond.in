import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export type CouponStatus = 'ACTIVE' | 'REDEEMED' | 'EXPIRED';

@Entity({ name: 'coupons' })
export class Coupon {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'text' })
  code!: string;

  /**
   * Groups many unique coupons into one printable/exportable batch.
   * All coupons generated in a single request share the same batchId/batchNumber.
   */
  @Index()
  @Column({ name: 'batch_id', type: 'text', nullable: true })
  batchId!: string | null;

  @Index()
  @Column({ name: 'batch_number', type: 'integer', nullable: true })
  batchNumber!: number | null;

  // Points to be credited when scanned/entered.
  @Column({ type: 'integer' })
  points!: number;

  // Display label like: "Scanned 50kg Cement"
  @Column({ type: 'text' })
  title!: string;

  @Column({ type: 'text', nullable: true })
  site!: string | null;

  @Column({ type: 'text', default: 'ACTIVE' })
  status!: CouponStatus;

  @Column({ name: 'expires_at', type: 'datetime', nullable: true })
  expiresAt!: Date | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  createdBy!: User | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  redeemedBy!: User | null;

  @Column({ name: 'redeemed_at', type: 'datetime', nullable: true })
  redeemedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
