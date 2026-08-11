import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { User } from '../users/entities/user.entity';
import {
  PointsTransaction,
  PointsTransactionType,
} from './entities/points-transaction.entity';
import {
  initialWalletPointsExpiresAt,
  serializeWalletExpiry,
  WALLET_POINTS_VALIDITY_MS,
} from './points-expiry.util';

@Injectable()
export class PointsService {
  /** Serialize wallet-expiry writes per user (SQLite cannot overlap TypeORM savepoints). */
  private readonly walletFreshLocks = new Map<string, Promise<User>>();

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    @InjectRepository(PointsTransaction)
    private readonly txRepo: Repository<PointsTransaction>,
  ) {}

  walletExpiryFields(user: Pick<User, 'walletPointsExpiresAt'>) {
    return serializeWalletExpiry(user.walletPointsExpiresAt);
  }

  async ensureWalletFresh(userId: string): Promise<User> {
    const inflight = this.walletFreshLocks.get(userId);
    if (inflight) return inflight;

    const run = this.ensureWalletFreshUnlocked(userId).finally(() => {
      this.walletFreshLocks.delete(userId);
    });
    this.walletFreshLocks.set(userId, run);
    return run;
  }

  private async ensureWalletFreshUnlocked(userId: string): Promise<User> {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const now = Date.now();
    const needsInit = !user.walletPointsExpiresAt;
    const needsExpire = Boolean(
      user.walletPointsExpiresAt &&
        user.walletPointsExpiresAt.getTime() <= now,
    );

    // Hot path: Home fires profile + transactions in parallel — avoid opening
    // a SQLite transaction when there is nothing to write.
    if (!needsInit && !needsExpire) {
      return user;
    }

    return this.dataSource.transaction(async (manager) => {
      const userRepo = manager.getRepository(User);
      const fresh = await userRepo.findOne({ where: { id: userId } });
      if (!fresh) throw new NotFoundException('User not found');
      return this.expireWalletIfDueWithManager(manager, fresh);
    });
  }

  private async expireWalletIfDueWithManager(
    manager: EntityManager,
    user: User,
  ): Promise<User> {
    const userRepo = manager.getRepository(User);
    const txRepo = manager.getRepository(PointsTransaction);
    const now = Date.now();
    let changed = false;

    if (!user.walletPointsExpiresAt) {
      user.walletPointsExpiresAt = initialWalletPointsExpiresAt(user.createdAt);
      changed = true;
    }

    while (
      user.walletPointsExpiresAt &&
      user.walletPointsExpiresAt.getTime() <= now
    ) {
      const balance = user.loyaltyPoints ?? 0;
      if (balance > 0) {
        const tx = txRepo.create({
          user,
          type: 'POINTS_EXPIRE',
          pointsDelta: -balance,
          title: 'Annual wallet reset — unused points expired',
          site: null,
        });
        await txRepo.save(tx);
        user.loyaltyPoints = 0;
      }
      user.walletPointsExpiresAt = new Date(
        user.walletPointsExpiresAt.getTime() + WALLET_POINTS_VALIDITY_MS,
      );
      changed = true;
    }

    if (changed) {
      return userRepo.save(user);
    }
    return user;
  }

  async creditWithManager(
    manager: EntityManager,
    params: {
      userId: string;
      points: number;
      title: string;
      site?: string | null;
      type: PointsTransactionType;
      performedByUserId?: string | null;
      reason?: string | null;
    },
  ) {
    if (!Number.isFinite(params.points) || params.points === 0) {
      throw new BadRequestException('Invalid points');
    }

    const userRepo = manager.getRepository(User);
    const txRepo = manager.getRepository(PointsTransaction);

    let user = await userRepo.findOne({ where: { id: params.userId } });
    if (!user) throw new NotFoundException('User not found');

    user = await this.expireWalletIfDueWithManager(manager, user);

    user.loyaltyPoints = (user.loyaltyPoints ?? 0) + params.points;
    if (user.loyaltyPoints < 0) {
      throw new BadRequestException('Insufficient points');
    }
    await userRepo.save(user);

    const tx = txRepo.create({
      user,
      type: params.type,
      pointsDelta: params.points,
      title: params.title,
      site: params.site ?? null,
      performedById: params.performedByUserId ?? null,
      reason: params.reason ?? null,
    });
    await txRepo.save(tx);

    return { user, tx };
  }

  async credit(params: {
    userId: string;
    points: number;
    title: string;
    site?: string | null;
    type: PointsTransactionType;
    performedByUserId?: string | null;
    reason?: string | null;
  }) {
    if (!Number.isFinite(params.points) || params.points === 0) {
      throw new BadRequestException('Invalid points');
    }
    return this.dataSource.transaction(async (manager) => {
      return this.creditWithManager(manager, params);
    });
  }

  async listForUser(userId: string, limit = 20) {
    const user = await this.ensureWalletFresh(userId);
    const txs = await this.txRepo.find({
      where: { user: { id: userId } },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    return {
      balance: user.loyaltyPoints,
      ...this.walletExpiryFields(user),
      transactions: txs,
    };
  }
}
