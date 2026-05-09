import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
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
    return this.usersRepo.findOne({
      where: { phone },
    });
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
      const existingPhone = await this.usersRepo.findOne({
        where: { phone: params.phone },
      });
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
    user: Pick<User, 'fullName' | 'deliveryAddress'> | null | undefined,
  ): boolean {
    if (!user) return false;
    return (
      Boolean(user.fullName?.trim()) && Boolean(user.deliveryAddress?.trim())
    );
  }

  private normalizeProfileText(
    value: string | null | undefined,
  ): string | null {
    if (value === undefined || value === null) return null;
    const t = value.trim();
    return t.length > 0 ? t : null;
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

    if (patch.fullName !== undefined) {
      user.fullName = this.normalizeProfileText(patch.fullName);
    }
    if (patch.profession !== undefined) {
      user.profession = this.normalizeProfileText(patch.profession);
    }
    if (patch.deliveryAddress !== undefined) {
      user.deliveryAddress = this.normalizeProfileText(patch.deliveryAddress);
    }

    return this.usersRepo.save(user);
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
}
