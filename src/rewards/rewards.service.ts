import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Reward, type GiftTier } from './entities/reward.entity';
import { Redemption } from './entities/redemption.entity';
import { User } from '../users/entities/user.entity';
import { PointsService } from '../points/points.service';
import { randomBytes } from 'crypto';

/** Lifetime points required to unlock Contractor tier (Worker → Contractor). */
export const CONTRACTOR_TIER_THRESHOLD = 120_000;

@Injectable()
export class RewardsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Reward) private readonly rewardsRepo: Repository<Reward>,
    @InjectRepository(Redemption)
    private readonly redemptionsRepo: Repository<Redemption>,
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    private readonly points: PointsService,
  ) {}

  static resolveGiftTier(loyaltyPoints: number): GiftTier {
    const pts = Number(loyaltyPoints ?? 0);
    return pts >= CONTRACTOR_TIER_THRESHOLD ? 'CONTRACTOR' : 'WORKER';
  }

  async getMyGiftTier(userId: string) {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const loyaltyPoints = user.loyaltyPoints ?? 0;
    return {
      giftTier: RewardsService.resolveGiftTier(loyaltyPoints),
      loyaltyPoints,
      contractorThreshold: CONTRACTOR_TIER_THRESHOLD,
    };
  }

  async list(params: { maxPoints?: number; userId?: string } = {}) {
    const where = { isActive: true } as const;
    let rewards = await this.rewardsRepo.find({
      where,
      order: { sortOrder: 'ASC', pointsCost: 'ASC', title: 'ASC' },
      take: 200,
    });

    let balance = 0;
    let includeEligibility = false;
    let userGiftTier: GiftTier | null = null;

    if (params.userId) {
      const user = await this.usersRepo.findOne({
        where: { id: params.userId },
        relations: { roles: true },
      });
      if (user) {
        balance = user.loyaltyPoints ?? 0;
        if (!this.isDealerUser(user)) {
          includeEligibility = true;
          userGiftTier = RewardsService.resolveGiftTier(balance);
        }
      }
    }

    if (params.maxPoints != null && Number.isFinite(params.maxPoints)) {
      rewards = rewards.filter(
        (r) => r.pointsCost <= (params.maxPoints as number),
      );
    }

    return rewards.map((r) =>
      this.serializeReward(r, balance, includeEligibility, userGiftTier),
    );
  }

  async getSlabs(userId: string) {
    const user = await this.usersRepo.findOne({
      where: { id: userId },
      relations: { roles: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const balance = user.loyaltyPoints ?? 0;
    const tier = this.isDealerUser(user)
      ? null
      : RewardsService.resolveGiftTier(balance);

    return {
      tiers: ['WORKER', 'CONTRACTOR'] as GiftTier[],
      giftTier: tier,
      slabs: [] as number[],
    };
  }

  async getById(id: string, userId?: string) {
    const reward = await this.rewardsRepo.findOne({
      where: { id, isActive: true },
    });
    if (!reward) throw new NotFoundException('Reward not found');

    let balance = 0;
    let includeEligibility = false;
    let userGiftTier: GiftTier | null = null;
    if (userId) {
      const user = await this.usersRepo.findOne({
        where: { id: userId },
        relations: { roles: true },
      });
      if (user) {
        balance = user.loyaltyPoints ?? 0;
        if (!this.isDealerUser(user)) {
          includeEligibility = true;
          userGiftTier = RewardsService.resolveGiftTier(balance);
        }
      }
    }

    return this.serializeReward(
      reward,
      balance,
      includeEligibility,
      userGiftTier,
    );
  }

  async redeem(params: {
    userId: string;
    rewardId: string;
    deliveryLabel?: string | null;
    deliveryAddress?: string | null;
  }) {
    return this.dataSource.transaction(async (manager) => {
      const rewardsRepo = manager.getRepository(Reward);
      const usersRepo = manager.getRepository(User);
      const redemptionsRepo = manager.getRepository(Redemption);

      const user = await usersRepo.findOne({ where: { id: params.userId } });
      if (!user) throw new NotFoundException('User not found');
      const roleAwareUser = await usersRepo.findOne({
        where: { id: user.id },
        relations: { roles: true },
      });
      if (!roleAwareUser) throw new NotFoundException('User not found');

      const reward = await rewardsRepo.findOne({
        where: { id: params.rewardId, isActive: true },
      });
      if (!reward) throw new NotFoundException('Reward not found');

      const balance = user.loyaltyPoints ?? 0;

      if (!this.isDealerUser(roleAwareUser)) {
        const userTier = RewardsService.resolveGiftTier(balance);
        if (reward.giftTier !== userTier) {
          throw new BadRequestException(
            userTier === 'WORKER'
              ? `This gift is available only at Contractor tier (${CONTRACTOR_TIER_THRESHOLD.toLocaleString()}+ points balance).`
              : `This gift is available only at Worker tier (balance below ${CONTRACTOR_TIER_THRESHOLD.toLocaleString()} points).`,
          );
        }
      }

      if (balance < reward.pointsCost) {
        throw new BadRequestException('Insufficient points');
      }

      if (this.isDealerUser(roleAwareUser)) {
        await this.points.credit({
          userId: user.id,
          points: -reward.pointsCost,
          title: `Reward redemption pending: ${reward.title}`,
          site: null,
          type: 'REWARD_REDEEM',
        });
        const redemption = redemptionsRepo.create({
          trackingId: this.generateTrackingId(),
          user,
          reward,
          pointsCost: reward.pointsCost,
          deliveryLabel: 'In-store pickup',
          deliveryAddress: null,
          channel: 'DEALER_STORE',
          status: 'PROCESSING',
          etaText:
            'Pending ops approval. Visit your nearest authorized Best Bond store once approved.',
        });
        const saved = await redemptionsRepo.save(redemption);
        return {
          status: saved.status,
          trackingId: saved.trackingId,
          eta: saved.etaText,
        };
      }

      await this.points.credit({
        userId: user.id,
        points: -reward.pointsCost,
        title: `Reward redemption pending: ${reward.title}`,
        site: null,
        type: 'REWARD_REDEEM',
      });

      const redemption = redemptionsRepo.create({
        trackingId: this.generateTrackingId(),
        user,
        reward,
        pointsCost: reward.pointsCost,
        deliveryLabel: params.deliveryLabel ?? null,
        deliveryAddress: params.deliveryAddress ?? null,
        channel: 'CUSTOMER_APP',
        status: 'PROCESSING',
        etaText:
          'Pending admin approval. You will be notified when your request is approved.',
      });
      const saved = await redemptionsRepo.save(redemption);

      return {
        status: saved.status,
        trackingId: saved.trackingId,
        eta: saved.etaText,
      };
    });
  }

  async listMyRedemptions(userId: string) {
    const rows = await this.redemptionsRepo.find({
      where: { user: { id: userId } },
      relations: { reward: true },
      order: { createdAt: 'DESC' },
      take: 100,
    });
    return rows.map((r) => ({
      id: r.id,
      trackingId: r.trackingId,
      pointsCost: r.pointsCost,
      deliveryLabel: r.deliveryLabel,
      deliveryAddress: r.deliveryAddress,
      channel: r.channel,
      status: r.status,
      etaText: r.etaText,
      createdAt: r.createdAt,
      reward: {
        id: r.reward?.id ?? null,
        title: r.reward?.title ?? null,
        description: r.reward?.description ?? null,
        pointsCost: r.reward?.pointsCost ?? 0,
        giftTier: r.reward?.giftTier ?? null,
        imageUrl: r.reward?.imageUrl ?? null,
      },
    }));
  }

  async cancelRedemption(params: { userId: string; redemptionId: string }) {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Redemption);
      const r = await repo.findOne({
        where: { id: params.redemptionId, user: { id: params.userId } },
        relations: { user: true, reward: true },
      });
      if (!r) throw new NotFoundException('Redemption not found');
      if (r.status === 'CANCELLED') {
        throw new BadRequestException('Already cancelled');
      }
      if (r.status === 'DELIVERED') {
        throw new BadRequestException('Cannot cancel a delivered order');
      }
      if (r.status === 'PROCESSING') {
        await this.points.creditWithManager(manager, {
          userId: r.user.id,
          points: r.pointsCost,
          title: `Refund: cancelled pending redemption (${r.reward?.title ?? 'reward'})`,
          type: 'REDEMPTION_REFUND',
        });
      }
      r.status = 'CANCELLED';
      const saved = await repo.save(r);
      return { id: saved.id, status: saved.status };
    });
  }

  private serializeReward(
    reward: Reward,
    balance: number,
    includeEligibility: boolean,
    userGiftTier: GiftTier | null,
  ) {
    const tierRedeemable =
      userGiftTier != null && reward.giftTier === userGiftTier;
    const canAfford = balance >= reward.pointsCost;

    return {
      id: reward.id,
      title: reward.title,
      description: reward.description,
      pointsCost: reward.pointsCost,
      giftTier: reward.giftTier,
      sortOrder: reward.sortOrder,
      imageUrl: reward.imageUrl,
      isActive: reward.isActive,
      createdAt: reward.createdAt,
      updatedAt: reward.updatedAt,
      ...(includeEligibility
        ? {
            tierRedeemable: tierRedeemable,
            eligible: canAfford && tierRedeemable,
          }
        : {}),
    };
  }

  private generateTrackingId(): string {
    const digits = (randomBytes(3).readUIntBE(0, 3) % 90000) + 10000;
    return `BB-${digits}`;
  }

  private isDealerUser(user: User): boolean {
    return (user.roles ?? []).some((r) => r.name === 'DEALER');
  }
}
