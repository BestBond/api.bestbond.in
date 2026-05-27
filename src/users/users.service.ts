import { randomBytes } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { RbacService } from '../rbac/rbac.service';
import { User } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @Inject(forwardRef(() => RbacService))
    private readonly rbac: RbacService,
  ) {}

  async findById(id: string): Promise<User | null> {
    return this.usersRepo.findOne({
      where: { id },
      relations: { roles: { permissions: true } },
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.usersRepo.findOne({
      where: { email },
      relations: { roles: { permissions: true } },
    });
  }

  async findByPhone(phone: string): Promise<User | null> {
    const trimmed = phone.trim();
    const digits = trimmed.replace(/\D/g, '');
    const candidates = new Set<string>();
    candidates.add(trimmed);
    if (digits.length > 0) {
      candidates.add(`+${digits}`);
      candidates.add(digits);
    }
    const list = [...candidates];
    if (list.length <= 1) {
      return this.usersRepo.findOne({ where: { phone: list[0] ?? trimmed } });
    }
    return this.usersRepo
      .createQueryBuilder('u')
      .where('u.phone IN (:...list)', { list })
      .getOne();
  }

  async countUsersWithRole(roleName: string): Promise<number> {
    const name = roleName.trim().toUpperCase();
    return this.usersRepo
      .createQueryBuilder('u')
      .leftJoin('u.roles', 'r')
      .where('UPPER(r.name) = :name', { name })
      .getCount();
  }

  async createLocalUser(params: {
    email: string;
    passwordHash: string;
    phone?: string | null;
    roleIds?: string[];
  }): Promise<User> {
    const existing = await this.usersRepo.findOne({
      where: { email: params.email },
    });
    if (existing) throw new ConflictException('Email already exists');

    if (params.phone) {
      const existingPhone = await this.findByPhone(params.phone);
      if (existingPhone) throw new ConflictException('Phone already exists');
    }

    const user = this.usersRepo.create({
      email: params.email,
      phone: params.phone ?? null,
      passwordHash: params.passwordHash,
      roles: [],
    });

    // roles are assigned by caller (usually via RBAC service) after creation,
    // so keep this minimal to avoid circular dependency.
    return this.usersRepo.save(user);
  }

  async setRoles(userId: string, roles: User['roles']): Promise<User> {
    const user = await this.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    user.roles = roles;
    return this.usersRepo.save(user);
  }

  /**
   * Same rules as the mobile app: required fields for a finished onboarding profile.
   * Used by GET /users/me/profile and can be mirrored on the client via `profileComplete`.
   */
  isProfileComplete(
    user: Pick<User, 'fullName' | 'deliveryAddress' | 'profession'> | null | undefined,
  ): boolean {
    if (!user) return false;
    return (
      Boolean(user.fullName?.trim()) &&
      Boolean(user.deliveryAddress?.trim()) &&
      Boolean(user.profession?.trim())
    );
  }

  private normalizeProfileText(
    value: string | null | undefined,
  ): string | null {
    if (value === undefined || value === null) return null;
    const t = value.trim();
    return t.length > 0 ? t : null;
  }

  private isStaffUser(user: User): boolean {
    return (user.roles ?? []).some((r) => {
      const n = String(r.name).toUpperCase();
      return n === 'SUPERADMIN' || n === 'OPERATIONAL_ADMIN';
    });
  }

  /**
   * End-user trade: CUSTOMER vs DEALER follows profile profession (mobile sends "Dealer" for dealers).
   * Staff roles are left unchanged.
   */
  async syncTradeRoleFromProfession(userId: string): Promise<void> {
    const user = await this.findById(userId);
    if (!user || this.isStaffUser(user)) return;

    const dealerRole = await this.rbac.getRoleByName('DEALER');
    const customerRole = await this.rbac.getRoleByName('CUSTOMER');
    if (!dealerRole || !customerRole) return;

    const isDealer =
      (user.profession ?? '').trim().toLowerCase() === 'dealer';
    await this.setRoles(userId, [isDealer ? dealerRole : customerRole]);
  }

  async updateProfile(
    userId: string,
    patch: {
      fullName?: string | null;
      profession?: string | null;
      deliveryAddress?: string | null;
    },
  ): Promise<User> {
    const user = await this.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    const staff = this.isStaffUser(user);

    if (patch.fullName !== undefined) {
      user.fullName = this.normalizeProfileText(patch.fullName);
    }
    if (patch.profession !== undefined) {
      user.profession = this.normalizeProfileText(patch.profession);
    }
    if (patch.deliveryAddress !== undefined) {
      user.deliveryAddress = this.normalizeProfileText(patch.deliveryAddress);
    }

    const saved = await this.usersRepo.save(user);
    if (patch.profession !== undefined && !staff) {
      await this.syncTradeRoleFromProfession(saved.id);
    }
    return this.findById(saved.id).then((u) => u ?? saved);
  }

  async approveStaffUser(params: {
    userId: string;
    approvedBy: string;
    approvedAt?: Date;
  }): Promise<User> {
    const user = await this.findById(params.userId);
    if (!user) throw new NotFoundException('User not found');
    user.staffApprovedAt = params.approvedAt ?? new Date();
    user.staffApprovedBy = params.approvedBy;
    return this.usersRepo.save(user);
  }

  async setPinHash(userId: string, pinHash: string): Promise<void> {
    const res = await this.usersRepo.update({ id: userId }, { pinHash });
    if (!res.affected) throw new NotFoundException('User not found');
  }

  async setPasswordHash(userId: string, passwordHash: string): Promise<void> {
    const res = await this.usersRepo.update({ id: userId }, { passwordHash });
    if (!res.affected) throw new NotFoundException('User not found');
  }

  async changePassword(params: {
    userId: string;
    currentPassword: string;
    newPassword: string;
  }) {
    const user = await this.findById(params.userId);
    if (!user) throw new NotFoundException('User not found');
    const ok = await bcrypt.compare(params.currentPassword, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Current password is incorrect');
    if (params.currentPassword === params.newPassword) {
      throw new BadRequestException(
        'New password must be different from current password',
      );
    }
    user.passwordHash = await bcrypt.hash(params.newPassword, 12);
    await this.usersRepo.save(user);
    return { ok: true };
  }

  async changePasscode(params: {
    userId: string;
    currentPasscode: string;
    newPasscode: string;
    confirmNewPasscode: string;
  }) {
    if (params.newPasscode !== params.confirmNewPasscode) {
      throw new BadRequestException('Passcode and confirmation do not match');
    }
    if (params.currentPasscode === params.newPasscode) {
      throw new BadRequestException(
        'New passcode must be different from current passcode',
      );
    }
    const user = await this.findById(params.userId);
    if (!user) throw new NotFoundException('User not found');
    if (!user.pinHash) {
      throw new BadRequestException('Passcode not configured for this account');
    }
    const ok = await bcrypt.compare(params.currentPasscode, user.pinHash);
    if (!ok) throw new UnauthorizedException('Current passcode is incorrect');
    await this.setPinHash(user.id, await bcrypt.hash(params.newPasscode, 12));
    return { ok: true };
  }

  async getAdminPreferences(userId: string) {
    const user = await this.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    return {
      quickLoginPinEnabled: user.quickLoginPinEnabled ?? true,
      notifications: {
        highValueRedemptions: user.notifHighValueRedemptions ?? true,
        couponExportFailures: user.notifCouponExportFailures ?? true,
        suspiciousUserActivity: user.notifSuspiciousUserActivity ?? false,
      },
    };
  }

  async updateAdminPreferences(
    userId: string,
    patch: {
      quickLoginPinEnabled?: boolean;
      highValueRedemptions?: boolean;
      couponExportFailures?: boolean;
      suspiciousUserActivity?: boolean;
    },
  ) {
    const user = await this.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    if (patch.quickLoginPinEnabled !== undefined) {
      user.quickLoginPinEnabled = patch.quickLoginPinEnabled;
    }
    if (patch.highValueRedemptions !== undefined) {
      user.notifHighValueRedemptions = patch.highValueRedemptions;
    }
    if (patch.couponExportFailures !== undefined) {
      user.notifCouponExportFailures = patch.couponExportFailures;
    }
    if (patch.suspiciousUserActivity !== undefined) {
      user.notifSuspiciousUserActivity = patch.suspiciousUserActivity;
    }

    await this.usersRepo.save(user);
    return this.getAdminPreferences(userId);
  }

  /**
   * Permanent customer/dealer account deletion (Apple 5.1.1(v)).
   * Deactivates login and removes personal data; keeps the user row for redemption audit FKs.
   */
  async deleteMyAccount(userId: string, passcode: string): Promise<{ ok: true }> {
    const user = await this.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    if (!user.isActive) {
      throw new BadRequestException('This account has already been deleted');
    }
    if (this.isStaffUser(user)) {
      throw new ForbiddenException(
        'Management accounts cannot be deleted from the app. Contact your administrator.',
      );
    }
    if (!user.pinHash) {
      throw new BadRequestException('Passcode not configured for this account');
    }
    const ok = await bcrypt.compare(passcode, user.pinHash);
    if (!ok) throw new UnauthorizedException('Passcode is incorrect');

    user.email = `deleted.${user.id}@account.removed`;
    user.phone = null;
    user.fullName = null;
    user.profession = null;
    user.deliveryAddress = null;
    user.pinHash = null;
    user.passwordHash = await bcrypt.hash(randomBytes(32).toString('hex'), 12);
    user.loyaltyPoints = 0;
    user.isActive = false;
    await this.usersRepo.save(user);
    return { ok: true };
  }
}
