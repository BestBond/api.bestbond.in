import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { UsersService } from '../users/users.service';
import { User } from '../users/entities/user.entity';
import { RbacService } from '../rbac/rbac.service';
import { OtpCode } from './entities/otp-code.entity';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly rbac: RbacService,
    private readonly jwt: JwtService,
    @InjectRepository(OtpCode)
    private readonly otpRepo: Repository<OtpCode>,
  ) {}

  /**
   * Mobile flow: request OTP for a phone number. In production you'd integrate SMS provider.
   */
  async requestOtp(params: { phone: string; countryCode: string }) {
    const code = `${Math.floor(100000 + Math.random() * 900000)}`;
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    const rec = this.otpRepo.create({
      phone: `${params.countryCode}${params.phone}`,
      codeHash,
      expiresAt,
      consumedAt: null,
    });
    const saved = await this.otpRepo.save(rec);

    return {
      requestId: saved.id,
      otpSent: true,
      ...(process.env.NODE_ENV !== 'production' ? { devCode: code } : {}),
    };
  }


  async signupAdminWithOtp(params: {
    phone: string;
    countryCode: string;
    code: string;
    fullName?: string | null;
    email?: string | null;
  }) {
    const fullPhone = `${params.countryCode}${params.phone}`;
    await this.consumeOtp({ fullPhone, code: params.code });

    // OPS ADMIN self-registration: create / update profile but keep gated until SUPERADMIN approval.
    let user = await this.users.findByPhone(fullPhone);
    if (!user) {
      const email =
        (params.email?.trim() && params.email.trim().length
          ? params.email.trim()
          : `${fullPhone.replace(/\+/g, '')}@bestbonds.local`);
      user = await this.users.createLocalUser({
        email,
        phone: fullPhone,
        passwordHash: await bcrypt.hash(`${fullPhone}:${Date.now()}`, 8),
      });
    }

    const loaded = await this.users.findById(user.id);
    if (!this.hasAdminRole(loaded)) {
      const operationalRole = await this.rbac.getRoleByName('OPERATIONAL_ADMIN');
      if (!operationalRole) {
        throw new UnauthorizedException('Operational admin role not configured');
      }
      await this.users.setRoles(user.id, [operationalRole]);
    }

    // Capture basic onboarding details (stored in existing profile fields)
    const fullName = params.fullName?.trim() || null;
    const deliveryAddress = 'Management Office';
    if (fullName) {
      await this.users.updateProfile(user.id, { fullName, deliveryAddress });
    }

    return { pendingApproval: true };
  }

  async loginAdminWithOtp(params: {
    phone: string;
    countryCode: string;
    code: string;
  }) {
    const fullPhone = `${params.countryCode}${params.phone}`;
    await this.consumeOtp({ fullPhone, code: params.code });

    const user = await this.users.findByPhone(fullPhone);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Management account not found');
    }
    const loaded = await this.users.findById(user.id);
    if (!loaded) {
      throw new UnauthorizedException('Management account not found');
    }
    if (!this.hasAdminRole(loaded)) {
      throw new UnauthorizedException('Management account not found');
    }
    const isSuper = (loaded.roles ?? []).some(
      (r) => String(r.name).toUpperCase() === 'SUPERADMIN',
    );
    const isOps = (loaded.roles ?? []).some(
      (r) => String(r.name).toUpperCase() === 'OPERATIONAL_ADMIN',
    );
    if (isOps && !isSuper) {
      if (!loaded.staffApprovedAt) {
        throw new ForbiddenException('Waiting for Super Admin approval.');
      }
    }
    const snap = this.authSnapshot(loaded);
    return {
      accessToken: await this.jwt.signAsync({ sub: user.id, email: user.email }),
      roles: snap.roles,
      permissions: snap.permissions,
    };
  }

  async signupCustomerWithOtp(params: {
    phone: string;
    countryCode: string;
    code: string;
    fullName?: string | null;
    email?: string | null;
  }) {
    const fullPhone = `${params.countryCode}${params.phone}`;
    await this.consumeOtp({ fullPhone, code: params.code });

    let user = await this.users.findByPhone(fullPhone);
    if (!user) {
      const email =
        (params.email?.trim() && params.email.trim().length
          ? params.email.trim()
          : `${fullPhone.replace(/\+/g, '')}@bestbonds.local`);
      user = await this.users.createLocalUser({
        email,
        phone: fullPhone,
        passwordHash: await bcrypt.hash(`${fullPhone}:${Date.now()}`, 8),
      });
      await this.ensureDefaultMobileRole(user.id);
    } else {
      await this.ensureDefaultMobileRole(user.id);
    }

    const fullName = params.fullName?.trim() || null;
    if (fullName) {
      await this.users.updateProfile(user.id, {
        fullName,
        deliveryAddress: 'Customer Address',
      });
    }

    const loaded = await this.users.findById(user.id);
    const snap = this.authSnapshot(loaded);
    return {
      accessToken: await this.jwt.signAsync({ sub: user.id, email: user.email }),
      roles: snap.roles,
      permissions: snap.permissions,
    };
  }

  async loginCustomerWithOtp(params: {
    phone: string;
    countryCode: string;
    code: string;
  }) {
    const fullPhone = `${params.countryCode}${params.phone}`;
    await this.consumeOtp({ fullPhone, code: params.code });

    const user = await this.users.findByPhone(fullPhone);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Account not found');
    }
    const loaded = await this.users.findById(user.id);
    const isCustomer = (loaded?.roles ?? []).some(
      (r) => String(r.name).toUpperCase() === 'CUSTOMER',
    );
    if (!isCustomer) throw new UnauthorizedException('Account not found');

    const snap = this.authSnapshot(loaded);
    return {
      accessToken: await this.jwt.signAsync({ sub: user.id, email: user.email }),
      roles: snap.roles,
      permissions: snap.permissions,
    };
  }

  async signupSuperadminWithOtp(params: {
    phone: string;
    countryCode: string;
    code: string;
    fullName: string;
    email: string;
  }) {
    const fullPhone = `${params.countryCode}${params.phone}`;
    const superCount = await this.users.countUsersWithRole('SUPERADMIN');
    if (superCount > 0) {
      throw new UnauthorizedException('Super Admin already exists');
    }

    await this.consumeOtp({ fullPhone, code: params.code });

    const email = params.email.trim();
    const passwordHash = await bcrypt.hash(`${fullPhone}:${Date.now()}`, 8);
    let user = await this.users.findByPhone(fullPhone);
    if (!user) {
      user = await this.users.createLocalUser({
        email,
        phone: fullPhone,
        passwordHash,
      });
    }

    const role = await this.rbac.getRoleByName('SUPERADMIN');
    if (!role) throw new UnauthorizedException('SUPERADMIN role not configured');
    await this.users.setRoles(user.id, [role]);

    // Auto-approve superadmin
    await this.users.approveStaffUser({ userId: user.id, approvedBy: user.id });
    await this.users.updateProfile(user.id, {
      fullName: params.fullName.trim(),
      deliveryAddress: 'HQ',
      profession: 'Super Admin',
    });

    const snap = this.authSnapshot(await this.users.findById(user.id));
    return {
      accessToken: await this.jwt.signAsync({ sub: user.id, email }),
      roles: snap.roles,
      permissions: snap.permissions,
    };
  }

  private async consumeOtp(params: { fullPhone: string; code: string }) {
    const latest = await this.otpRepo.findOne({
      where: { phone: params.fullPhone, consumedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
    if (!latest) {
      throw new UnauthorizedException('OTP not found');
    }
    if (latest.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('OTP expired');
    }
    const ok = await bcrypt.compare(params.code, latest.codeHash);
    if (!ok) throw new UnauthorizedException('Invalid OTP');

    latest.consumedAt = new Date();
    await this.otpRepo.save(latest);
  }

  private async ensureDefaultMobileRole(userId: string) {
    const loaded = await this.users.findById(userId);
    if (!loaded) return;
    if ((loaded.roles ?? []).length > 0) return;
    const customerRole = await this.rbac.getRoleByName('CUSTOMER');
    if (customerRole) {
      await this.users.setRoles(userId, [customerRole]);
    }
  }

  private hasAdminRole(user: User | null | undefined): boolean {
    if (!user) return false;
    const roleNames = new Set(
      (user.roles ?? []).map((r) => String(r.name).toUpperCase()),
    );
    return (
      roleNames.has('SUPERADMIN') || roleNames.has('OPERATIONAL_ADMIN')
    );
  }

  private authSnapshot(user: User | null) {
    if (!user) {
      return { roles: [] as string[], permissions: [] as string[] };
    }
    const roles = (user.roles ?? []).map((r) => r.name);
    const permissions = Array.from(
      new Set(
        (user.roles ?? []).flatMap((r) =>
          (r.permissions ?? []).map((p) => p.key),
        ),
      ),
    );
    return { roles, permissions };
  }
}
