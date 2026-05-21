import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import type { AuthUser } from '../auth/auth-user';
import { UsersService } from '../users/users.service';
import { RbacService } from '../rbac/rbac.service';
import { PointsService } from '../points/points.service';
import { PointsTransaction } from '../points/entities/points-transaction.entity';
import { Redemption } from '../rewards/entities/redemption.entity';
import { Reward } from '../rewards/entities/reward.entity';
import { User } from '../users/entities/user.entity';
import { Coupon } from '../coupons/entities/coupon.entity';

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function percentVsPriorPeriod(current: number, prior: number): number {
  if (prior <= 0) return current > 0 ? 100 : 0;
  return Math.round(((current - prior) / prior) * 1000) / 10;
}

function isFullAdminUser(auth: AuthUser): boolean {
  const p = new Set(auth.permissions ?? []);
  return p.has('rbac.manage') || p.has('users.manage');
}

function assertOpsCanAccessDealerRedemption(auth: AuthUser, r: Redemption) {
  if (isFullAdminUser(auth)) return;
  if (r.channel !== 'DEALER_STORE') {
    throw new ForbiddenException('Not allowed to access this redemption');
  }
}

@Injectable()
export class AdminService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly users: UsersService,
    private readonly rbac: RbacService,
    private readonly points: PointsService,
    @InjectRepository(PointsTransaction)
    private readonly txRepo: Repository<PointsTransaction>,
    @InjectRepository(Redemption)
    private readonly redemptionRepo: Repository<Redemption>,
    @InjectRepository(Reward)
    private readonly rewardRepo: Repository<Reward>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @InjectRepository(Coupon)
    private readonly couponRepo: Repository<Coupon>,
  ) {}

  async listRedemptionRequests(
    auth: AuthUser,
    params: {
      status?: string;
      take: number;
      offset: number;
      sort?: string;
      flaggedOnly?: boolean;
      flagMinPoints?: number;
      /** Superadmin only: filter by channel */
      channel?: 'DEALER_STORE' | 'CUSTOMER_APP' | 'ALL';
    },
  ) {
    const status = (params.status ?? 'PROCESSING').trim().toUpperCase();
    const allowed = new Set(['PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED']);
    const statusFilter = allowed.has(status) ? status : 'PROCESSING';

    const sortKey = (params.sort ?? 'HIGH_VALUE').trim().toUpperCase();

    // Design uses "Flagged Requests" toggle; backend does not yet persist flags.
    // Provide a computed flag based on points cost with an overrideable threshold.
    const flagMin = params.flagMinPoints ?? 50_000;

    const qb = this.redemptionRepo
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.reward', 'reward')
      .leftJoinAndSelect('r.user', 'user')
      .where('r.status = :status', { status: statusFilter });

    if (!isFullAdminUser(auth)) {
      qb.andWhere('r.channel = :dealerCh', { dealerCh: 'DEALER_STORE' });
    } else {
      const ch = (params.channel ?? 'ALL').toUpperCase();
      if (ch === 'DEALER_STORE' || ch === 'CUSTOMER_APP') {
        qb.andWhere('r.channel = :chFilter', { chFilter: ch });
      }
    }

    if (params.flaggedOnly) {
      qb.andWhere('r.pointsCost >= :minPts', { minPts: flagMin });
    }

    if (sortKey === 'NEWEST') {
      qb.orderBy('r.createdAt', 'DESC');
    } else {
      // Default matches Figma "Sort By: High Value"
      qb.orderBy('r.pointsCost', 'DESC').addOrderBy('r.createdAt', 'DESC');
    }

    qb.skip(params.offset).take(params.take);

    const [rows, total] = await qb.getManyAndCount();
    const hasMore = params.offset + rows.length < total;

    const items = rows.map((r) => {
      const trackingDigits = (r.trackingId ?? '').replace(/\D/g, '');
      const code = trackingDigits
        ? `REQ-${trackingDigits}`
        : `REQ-${String(r.id).slice(0, 4).toUpperCase()}`;
      const requester =
        (r.user?.fullName?.trim() ||
          r.user?.email?.split('@')[0] ||
          'User') ?? 'User';
      const flaggedComputed = r.pointsCost >= flagMin;

      return {
        id: r.id,
        code,
        points: r.pointsCost,
        itemName: r.reward?.title ?? 'Reward',
        requester,
        status: r.status,
        channel: r.channel,
        createdAt: r.createdAt,
        duplicate: false,
        flagged: flaggedComputed,
      };
    });

    return { total, hasMore, items };
  }

  async getRedemptionRequestById(
    auth: AuthUser,
    id: string,
    opts?: { flagMinPoints?: number },
  ) {
    const r = await this.redemptionRepo.findOne({
      where: { id },
      relations: { reward: true, user: true },
    });
    if (!r) throw new NotFoundException('Redemption not found');
    assertOpsCanAccessDealerRedemption(auth, r);

    const flagMin = opts?.flagMinPoints ?? 50_000;
    const trackingDigits = (r.trackingId ?? '').replace(/\D/g, '');
    const code = trackingDigits
      ? `REQ-${trackingDigits}`
      : `REQ-${String(r.id).slice(0, 4).toUpperCase()}`;

    const requesterName =
      (r.user?.fullName?.trim() ||
        r.user?.email?.split('@')[0] ||
        'User') ?? 'User';

    // Banner text aligned with product status labels.
    const isAppChannel = r.channel === 'CUSTOMER_APP';
    const statusLabel =
      r.status === 'PROCESSING'
        ? isAppChannel
          ? 'Pending approval'
          : 'Pending High-Ticket Review'
        : r.status === 'SHIPPED'
          ? 'Approved (In Dispatch)'
          : r.status === 'DELIVERED'
            ? isAppChannel
              ? 'Delivered'
              : 'Delivered to Dealer'
            : r.status === 'CANCELLED'
              ? 'Rejected / Cancelled'
              : r.status;

    const statusMessage =
      r.status === 'PROCESSING'
        ? isAppChannel
          ? 'Contractor / painter app request. Review and approve before dispatch.'
          : 'This request requires manual verification due to item value.'
        : r.status === 'SHIPPED'
          ? 'Approved and dispatched. Awaiting delivery confirmation.'
          : r.status === 'DELIVERED'
            ? isAppChannel
              ? 'The reward has been delivered to the recipient.'
              : 'The reward has been delivered to the dealer.'
            : r.status === 'CANCELLED'
              ? 'This request has been rejected or cancelled.'
              : null;

    return {
      id: r.id,
      code,
      status: r.status,
      channel: r.channel,
      statusLabel,
      statusMessage,
      flagged: r.pointsCost >= flagMin,
      duplicate: false,
      reward: {
        id: r.reward?.id ?? null,
        title: r.reward?.title ?? null,
        points: r.pointsCost,
        imageUrl: r.reward?.imageUrl ?? null,
      },
      requester: {
        id: r.user?.id ?? null,
        fullName: requesterName,
        phone: r.user?.phone ?? null,
        address: r.user?.deliveryAddress ?? null,
      },
      createdAt: r.createdAt,
    };
  }

  async approveRedemptionRequest(auth: AuthUser, id: string) {
    const r = await this.redemptionRepo.findOne({
      where: { id },
      relations: { user: true, reward: true },
    });
    if (!r) throw new NotFoundException('Redemption not found');
    assertOpsCanAccessDealerRedemption(auth, r);
    if (r.status !== 'PROCESSING') {
      throw new BadRequestException('Only PROCESSING requests can be approved');
    }
    r.status = 'SHIPPED';
    if (r.channel === 'CUSTOMER_APP') {
      r.etaText = '5-7 Business Days';
    }
    const saved = await this.redemptionRepo.save(r);

    const trackingDigits = (saved.trackingId ?? '').replace(/\D/g, '');
    const code = trackingDigits
      ? `REQ-${trackingDigits}`
      : `REQ-${String(saved.id).slice(0, 4).toUpperCase()}`;

    return { id: saved.id, code, status: saved.status };
  }

  async deliverRedemptionRequest(auth: AuthUser, id: string) {
    const r = await this.redemptionRepo.findOne({
      where: { id },
      relations: { user: true, reward: true },
    });
    if (!r) throw new NotFoundException('Redemption not found');
    assertOpsCanAccessDealerRedemption(auth, r);
    if (r.status !== 'SHIPPED') {
      throw new BadRequestException(
        'Only SHIPPED (approved) requests can be marked as delivered',
      );
    }
    r.status = 'DELIVERED';
    const saved = await this.redemptionRepo.save(r);
    const trackingDigits = (saved.trackingId ?? '').replace(/\D/g, '');
    const code = trackingDigits
      ? `REQ-${trackingDigits}`
      : `REQ-${String(saved.id).slice(0, 4).toUpperCase()}`;
    return { id: saved.id, code, status: saved.status };
  }

  async rejectRedemptionRequest(auth: AuthUser, id: string) {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Redemption);
      const r = await repo.findOne({
        where: { id },
        relations: { user: true, reward: true },
      });
      if (!r) throw new NotFoundException('Redemption not found');
      assertOpsCanAccessDealerRedemption(auth, r);
      if (r.status !== 'PROCESSING') {
        throw new BadRequestException('Only PROCESSING requests can be rejected');
      }
      r.status = 'CANCELLED';
      await repo.save(r);

      await this.points.creditWithManager(manager, {
        userId: r.user.id,
        points: r.pointsCost,
        title: `Refund: redemption rejected (${r.reward?.title ?? 'reward'})`,
        type: 'REDEMPTION_REFUND',
      });

      const trackingDigits = (r.trackingId ?? '').replace(/\D/g, '');
      const code = trackingDigits
        ? `REQ-${trackingDigits}`
        : `REQ-${String(r.id).slice(0, 4).toUpperCase()}`;

      return { id: r.id, code, status: r.status };
    });
  }

  /**
   * Ops/Superadmin: record a dealer’s in-store redemption (debited immediately; queued for approval).
   */
  async createDealerStoreRedemption(params: {
    dealerUserId: string;
    rewardId: string;
    deliveryLabel?: string | null;
    deliveryAddress?: string | null;
  }) {
    return this.dataSource.transaction(async (manager) => {
      const usersRepo = manager.getRepository(User);
      const rewardRepo = manager.getRepository(Reward);
      const redemptionsRepo = manager.getRepository(Redemption);

      const dealer = await usersRepo.findOne({
        where: { id: params.dealerUserId },
        relations: { roles: true },
      });
      if (!dealer) throw new NotFoundException('Dealer not found');
      const isDealer = (dealer.roles ?? []).some((role) => role.name === 'DEALER');
      if (!isDealer) {
        throw new BadRequestException('Selected user is not a dealer account');
      }
      if (!dealer.isActive) {
        throw new BadRequestException('Dealer account is suspended');
      }

      const reward = await rewardRepo.findOne({
        where: { id: params.rewardId, isActive: true },
      });
      if (!reward) throw new NotFoundException('Reward not found');

      if ((dealer.loyaltyPoints ?? 0) < reward.pointsCost) {
        throw new BadRequestException('Dealer has insufficient points');
      }

      await this.points.creditWithManager(manager, {
        userId: dealer.id,
        points: -reward.pointsCost,
        title: `Store redemption pending: ${reward.title}`,
        type: 'REWARD_REDEEM',
      });

      const redemption = redemptionsRepo.create({
        trackingId: this.generateCouponTrackingId(),
        user: dealer,
        reward,
        pointsCost: reward.pointsCost,
        deliveryLabel: params.deliveryLabel ?? null,
        deliveryAddress: params.deliveryAddress ?? null,
        channel: 'DEALER_STORE',
        status: 'PROCESSING',
        etaText: null,
      });
      const saved = await redemptionsRepo.save(redemption);

      return {
        id: saved.id,
        trackingId: saved.trackingId,
        status: saved.status,
        channel: saved.channel,
      };
    });
  }

  async searchDealers(params: {
    q?: string;
    take: number;
    offset: number;
  }) {
    const q = (params.q ?? '').trim();
    const qb = this.usersRepo
      .createQueryBuilder('u')
      .leftJoin('u.roles', 'r')
      .where('r.name = :role', { role: 'DEALER' })
      .andWhere('u.isActive = :active', { active: true });

    if (q.length) {
      const like = `%${q.toLowerCase()}%`;
      qb.andWhere(
        '(LOWER(COALESCE(u.fullName, \'\')) LIKE :like OR LOWER(u.email) LIKE :like OR REPLACE(COALESCE(u.phone, \'\'), \'+\', \'\') LIKE :phoneLike)',
        {
          like,
          phoneLike: `%${q.replace(/\D/g, '')}%`,
        },
      );
    }

    qb.orderBy('u.fullName', 'ASC').addOrderBy('u.email', 'ASC');

    const total = await qb.getCount();
    const rows = await qb.skip(params.offset).take(params.take).getMany();
    const hasMore = params.offset + rows.length < total;

    return {
      total,
      hasMore,
      items: rows.map((u) => ({
        id: u.id,
        fullName: u.fullName?.trim() || u.email.split('@')[0] || 'Dealer',
        email: u.email,
        phone: u.phone ?? null,
        loyaltyPoints: u.loyaltyPoints ?? 0,
      })),
    };
  }

  private generateCouponTrackingId(): string {
    const digits = (randomBytes(3).readUIntBE(0, 3) % 90000) + 10000;
    return `BB-${digits}`;
  }

  async listUsers(params: {
    q?: string;
    profession?: string;
    take: number;
    offset: number;
    /** When set (super-admin list), omit this user from results so they never see themselves. */
    excludeUserId?: string;
  }) {
    const q = (params.q ?? '').trim();
    const profession = (params.profession ?? '').trim();

    const qb = this.usersRepo.createQueryBuilder('u');

    if (params.excludeUserId) {
      qb.andWhere('u.id != :excludeUserId', { excludeUserId: params.excludeUserId });
    }

    if (q.length) {
      const like = `%${q.toLowerCase()}%`;
      qb.andWhere(
        '(LOWER(u.fullName) LIKE :like OR LOWER(u.email) LIKE :like OR REPLACE(COALESCE(u.phone, \'\'), \'+\', \'\') LIKE :phoneLike)',
        {
          like,
          phoneLike: `%${q.replace(/\D/g, '')}%`,
        },
      );
    }

    if (profession.length && profession.toLowerCase() !== 'all') {
      const p = profession.toLowerCase().replace(/\s+/g, '');
      const workerProfessions = [
        'contractor',
        'painter',
        'worker',
        'contractor/painter',
        'contractor/worker',
      ];
      if (p === 'contractor/painter' || p === 'contractor/worker') {
        qb.andWhere('LOWER(TRIM(COALESCE(u.profession, \'\'))) IN (:...w)', {
          w: workerProfessions,
        });
      } else {
        qb.andWhere('LOWER(TRIM(COALESCE(u.profession, \'\'))) = :p', {
          p: profession.toLowerCase(),
        });
      }
    }

    qb.orderBy('u.updatedAt', 'DESC').addOrderBy('u.createdAt', 'DESC');

    const total = await qb.getCount();
    const rows = await qb.skip(params.offset).take(params.take).getMany();
    const hasMore = params.offset + rows.length < total;

    return {
      total,
      hasMore,
      items: rows.map((u) => ({
        id: u.id,
        name: u.fullName?.trim() || u.email.split('@')[0] || 'User',
        profession: u.profession ?? null,
        walletBalance: u.loyaltyPoints ?? 0,
        status: u.isActive ? 'ACTIVE' : 'SUSPENDED',
        staffApprovedAt: (u as any).staffApprovedAt ?? null,
      })),
    };
  }

  async getUserById(userId: string) {
    const u = await this.usersRepo.findOne({ where: { id: userId } });
    if (!u) throw new NotFoundException('User not found');

    const name = u.fullName?.trim() || u.email.split('@')[0] || 'User';
    return {
      id: u.id,
      fullName: u.fullName ?? null,
      displayName: name,
      profession: u.profession ?? null,
      status: u.isActive ? 'ACTIVE' : 'SUSPENDED',
      loyaltyPoints: u.loyaltyPoints ?? 0,
      phone: u.phone ?? null,
      deliveryAddress: u.deliveryAddress ?? null,
      staffApprovedAt: (u as any).staffApprovedAt ?? null,
      staffApprovedBy: (u as any).staffApprovedBy ?? null,
      updatedAt: u.updatedAt,
      createdAt: u.createdAt,
    };
  }

  async approveOperationalAdmin(params: { userId: string; approvedBy: string }) {
    const u = await this.usersRepo.findOne({
      where: { id: params.userId },
      relations: { roles: true },
    });
    if (!u) throw new NotFoundException('User not found');
    const isOps = (u.roles ?? []).some(
      (r) => String(r.name).toUpperCase() === 'OPERATIONAL_ADMIN',
    );
    if (!isOps) throw new BadRequestException('User is not an Operational Admin');

    const saved = await this.users.approveStaffUser({
      userId: u.id,
      approvedBy: params.approvedBy,
    });
    return {
      id: saved.id,
      staffApprovedAt: saved.staffApprovedAt,
      staffApprovedBy: saved.staffApprovedBy,
    };
  }

  async suspendUserById(
    actorUserId: string,
    targetUserId: string,
    params?: { reason?: string | null },
  ) {
    if (actorUserId === targetUserId) {
      throw new ForbiddenException('You cannot suspend your own account.');
    }
    const u = await this.usersRepo.findOne({
      where: { id: targetUserId },
      relations: { roles: true },
    });
    if (!u) throw new NotFoundException('User not found');
    if (!u.isActive) {
      throw new BadRequestException('User is already suspended');
    }
    const roleNames = new Set((u.roles ?? []).map((r) => String(r.name).toUpperCase()));
    if (roleNames.has('SUPERADMIN') || roleNames.has('OPERATIONAL_ADMIN')) {
      throw new ForbiddenException('Staff admin accounts cannot be suspended.');
    }
    // Design captures a reason; persistence is not specified yet, so we don't store it.
    // Keep the input validated (dto) and available for future audit logging.
    void params?.reason;
    u.isActive = false;
    const saved = await this.usersRepo.save(u);
    return { id: saved.id, status: saved.isActive ? 'ACTIVE' : 'SUSPENDED' };
  }

  async getUserTransactions(params: {
    userId: string;
    period: 'THIS_MONTH' | 'ALL';
    take: number;
    skip: number;
  }) {
    const u = await this.usersRepo.findOne({ where: { id: params.userId } });
    if (!u) throw new NotFoundException('User not found');

    const now = new Date();
    const from =
      params.period === 'ALL'
        ? null
        : new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const to =
      params.period === 'ALL'
        ? null
        : new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);

    const applyDate = (
      qb: ReturnType<typeof this.txRepo.createQueryBuilder>,
    ) => {
      if (from && to) {
        qb.andWhere('t.created_at >= :from AND t.created_at < :to', {
          from: from.toISOString(),
          to: to.toISOString(),
        });
      }
    };

    const aggQb = this.txRepo
      .createQueryBuilder('t')
      .select(
        'COALESCE(SUM(CASE WHEN t.pointsDelta > 0 THEN t.pointsDelta ELSE 0 END), 0)',
        'earned',
      )
      .addSelect(
        'COALESCE(SUM(CASE WHEN t.pointsDelta < 0 THEN ABS(t.pointsDelta) ELSE 0 END), 0)',
        'spent',
      )
      .where('t.userId = :userId', { userId: params.userId });
    applyDate(aggQb);
    const agg = await aggQb.getRawOne<{ earned: string; spent: string }>();

    // Monthly scans count (COUPON_SCAN in current month regardless of period filter)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
    const scansRaw = await this.txRepo
      .createQueryBuilder('t')
      .select('COUNT(t.id)', 'cnt')
      .where('t.userId = :userId', { userId: params.userId })
      .andWhere('t.type = :type', { type: 'COUPON_SCAN' })
      .andWhere('t.created_at >= :from AND t.created_at < :to', {
        from: monthStart.toISOString(),
        to: monthEnd.toISOString(),
      })
      .getRawOne<{ cnt: string }>();

    const listQb = this.txRepo
      .createQueryBuilder('t')
      .where('t.userId = :userId', { userId: params.userId })
      .orderBy('t.created_at', 'DESC')
      .skip(params.skip)
      .take(params.take);
    applyDate(listQb);
    const txList = await listQb.getMany();

    return {
      user: {
        id: u.id,
        displayName: u.fullName?.trim() || u.email.split('@')[0] || 'User',
        profession: u.profession ?? null,
        status: u.isActive ? 'ACTIVE' : 'SUSPENDED',
      },
      period: params.period,
      totalBalance: u.loyaltyPoints ?? 0,
      totalPointsEarned: Number(agg?.earned ?? 0),
      totalPointsSpent: Number(agg?.spent ?? 0),
      monthlyScans: Number(scansRaw?.cnt ?? 0),
      hasMore: txList.length === params.take,
      transactions: txList.map((t) => ({
        id: t.id,
        type: t.type,
        title: t.title,
        site: t.site,
        pointsDelta: t.pointsDelta,
        createdAt: t.createdAt,
      })),
    };
  }

  async activateUserById(userId: string) {
    const u = await this.usersRepo.findOne({ where: { id: userId } });
    if (!u) throw new NotFoundException('User not found');
    if (u.isActive) {
      throw new BadRequestException('User is already active');
    }
    u.isActive = true;
    const saved = await this.usersRepo.save(u);
    return { id: saved.id, status: saved.isActive ? 'ACTIVE' : 'SUSPENDED' };
  }

  async createOperationalAdmin(params: {
    email: string;
    tempPassword?: string;
  }) {
    const tempPassword = params.tempPassword ?? this.generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    const user = await this.users.createLocalUser({
      email: params.email,
      passwordHash,
    });

    const role = await this.rbac.getRoleByName('OPERATIONAL_ADMIN');
    if (!role) throw new NotFoundException('OPERATIONAL_ADMIN role not found');

    await this.users.setRoles(user.id, [role]);

    return {
      userId: user.id,
      email: user.email,
      tempPassword,
      role: role.name,
    };
  }

  /**
   * Aggregates for superadmin / operational admin home dashboard.
   * Ops admins (dealer.redemptions.manage only) get the same shape; superadmin-only
   * onboarding counts are zeroed for them.
   * Windows use server local time.
   */
  async getDashboardSummary(auth: AuthUser) {
    const now = new Date();
    const todayStart = startOfDay(now);
    const last7Start = addDays(now, -7);
    const last14Start = addDays(now, -14);

    const pendingApprovalsWhere = isFullAdminUser(auth)
      ? { status: 'PROCESSING' as const }
      : { status: 'PROCESSING' as const, channel: 'DEALER_STORE' as const };
    const pendingApprovalsCount = await this.redemptionRepo.count({
      where: pendingApprovalsWhere,
    });

    const pendingOpsAdminApprovalsCount = await this.usersRepo
      .createQueryBuilder('u')
      .leftJoin('u.roles', 'r')
      .where('UPPER(r.name) = :role', { role: 'OPERATIONAL_ADMIN' })
      .andWhere('u.staffApprovedAt IS NULL')
      .andWhere('u.isActive = :active', { active: true })
      .getCount();

    const sumCouponIssued = async (from: Date, to: Date) => {
      const raw = await this.txRepo
        .createQueryBuilder('t')
        .select('COALESCE(SUM(t.pointsDelta), 0)', 'sum')
        .where('t.type = :type', { type: 'COUPON_SCAN' })
        .andWhere('t.pointsDelta > 0')
        .andWhere('t.createdAt >= :from AND t.createdAt < :to', { from, to })
        .getRawOne<{ sum: string }>();
      return Number(raw?.sum ?? 0);
    };

    const sumRedeemed = async (from: Date, to: Date) => {
      const raw = await this.txRepo
        .createQueryBuilder('t')
        .select('COALESCE(SUM(ABS(t.pointsDelta)), 0)', 'sum')
        .where('t.type = :type', { type: 'REWARD_REDEEM' })
        .andWhere('t.pointsDelta < 0')
        .andWhere('t.createdAt >= :from AND t.createdAt < :to', { from, to })
        .getRawOne<{ sum: string }>();
      return Number(raw?.sum ?? 0);
    };

    const issuedThis = await sumCouponIssued(last7Start, now);
    const issuedPrior = await sumCouponIssued(last14Start, last7Start);
    const redeemedThis = await sumRedeemed(last7Start, now);
    const redeemedPrior = await sumRedeemed(last14Start, last7Start);

    const distinctActiveUsers = async (from: Date, to: Date) => {
      const raw = await this.txRepo
        .createQueryBuilder('t')
        .leftJoin('t.user', 'u')
        .select('COUNT(DISTINCT u.id)', 'cnt')
        .where('t.createdAt >= :from AND t.createdAt < :to', { from, to })
        .getRawOne<{ cnt: string }>();
      return Number(raw?.cnt ?? 0);
    };

    const activeUsersLast7Days = await distinctActiveUsers(last7Start, now);

    const activeUsersDailySeries: number[] = [];
    for (let i = 4; i >= 0; i--) {
      const day = addDays(todayStart, -i);
      const next = addDays(day, 1);
      activeUsersDailySeries.push(await distinctActiveUsers(day, next));
    }

    const scansTodayRaw = await this.txRepo
      .createQueryBuilder('t')
      .select('COUNT(t.id)', 'cnt')
      .where('t.type = :type', { type: 'COUPON_SCAN' })
      .andWhere('t.createdAt >= :from', { from: todayStart })
      .getRawOne<{ cnt: string }>();
    const couponsScannedToday = Number(scansTodayRaw?.cnt ?? 0);

    const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);
    const scans5mRaw = await this.txRepo
      .createQueryBuilder('t')
      .select('COUNT(t.id)', 'cnt')
      .where('t.type = :type', { type: 'COUPON_SCAN' })
      .andWhere('t.createdAt >= :from', { from: fiveMinAgo })
      .getRawOne<{ cnt: string }>();
    const couponScansLast5Minutes = Number(scans5mRaw?.cnt ?? 0);

    const totalCouponsIssued = await this.couponRepo.count();
    const receivedRaw = await this.txRepo
      .createQueryBuilder('t')
      .select('COUNT(t.id)', 'cnt')
      .where('t.type = :type', { type: 'COUPON_SCAN' })
      .andWhere('t.pointsDelta > 0')
      .getRawOne<{ cnt: string }>();
    const totalCouponsReceived = Number(receivedRaw?.cnt ?? 0);

    const payload = {
      pendingApprovalsCount,
      pendingOpsAdminApprovalsCount,
      totalCouponsIssued,
      totalCouponsReceived,
      pointsIssued: {
        totalLast7Days: issuedThis,
        percentVsPriorWeek: percentVsPriorPeriod(issuedThis, issuedPrior),
      },
      pointsRedeemed: {
        totalLast7Days: redeemedThis,
        percentVsPriorWeek: percentVsPriorPeriod(redeemedThis, redeemedPrior),
      },
      activeUsers: {
        countLast7Days: activeUsersLast7Days,
        dailyActiveUsersLast5Days: activeUsersDailySeries,
      },
      couponsScannedToday: {
        count: couponsScannedToday,
        last5MinutesCount: couponScansLast5Minutes,
      },
    };

    if (!isFullAdminUser(auth)) {
      return { ...payload, pendingOpsAdminApprovalsCount: 0 };
    }
    return payload;
  }

  async listPendingOperationalAdmins(params?: { take?: number; offset?: number }) {
    const take = Math.max(1, Math.min(100, Number(params?.take ?? 20)));
    const offset = Math.max(0, Math.min(10_000, Number(params?.offset ?? 0)));

    const qb = this.usersRepo
      .createQueryBuilder('u')
      .leftJoin('u.roles', 'r')
      .where('UPPER(r.name) = :role', { role: 'OPERATIONAL_ADMIN' })
      .andWhere('u.staffApprovedAt IS NULL')
      .andWhere('u.isActive = :active', { active: true })
      .orderBy('u.createdAt', 'DESC');

    const total = await qb.getCount();
    const rows = await qb.skip(offset).take(take).getMany();
    const hasMore = offset + rows.length < total;

    return {
      total,
      hasMore,
      items: rows.map((u) => ({
        id: u.id,
        fullName: u.fullName ?? null,
        email: u.email,
        phone: u.phone ?? null,
        createdAt: u.createdAt,
      })),
    };
  }

  private generateTempPassword(): string {
    return randomBytes(16).toString('hex');
  }
}
