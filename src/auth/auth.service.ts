import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { User } from '../users/entities/user.entity';
import { RbacService } from '../rbac/rbac.service';
import { normalizeAuthPhone } from './phone.util';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly rbac: RbacService,
    private readonly jwt: JwtService,
  ) {}

  private assertPasscodesMatch(passcode: string, confirmPasscode: string) {
    if (passcode !== confirmPasscode) {
      throw new BadRequestException('Passcode and confirmation do not match');
    }
  }

  private async hashPasscode(passcode: string): Promise<string> {
    return bcrypt.hash(passcode, 12);
  }

  private async verifyPasscode(
    passcode: string,
    pinHash: string | null | undefined,
  ): Promise<void> {
    if (!pinHash) {
      throw new UnauthorizedException('Passcode not configured for this account');
    }
    const ok = await bcrypt.compare(passcode, pinHash);
    if (!ok) {
      throw new UnauthorizedException('Invalid passcode');
    }
  }

  async signupAdminWithPasscode(params: {
    phone: string;
    countryCode: string;
    passcode: string;
    confirmPasscode: string;
    fullName?: string | null;
    email?: string | null;
  }) {
    this.assertPasscodesMatch(params.passcode, params.confirmPasscode);
    const fullPhone = normalizeAuthPhone(params.countryCode, params.phone);

    const existing = await this.users.findByPhone(fullPhone);
    if (existing) {
      throw new ConflictException(
        'This mobile number is already registered. Log in with your passcode instead.',
      );
    }

    const email =
      params.email?.trim() && params.email.trim().length
        ? params.email.trim()
        : `${fullPhone.replace(/\+/g, '')}@bestbonds.local`;
    const user = await this.users.createLocalUser({
      email,
      phone: fullPhone,
      passwordHash: await bcrypt.hash(`${fullPhone}:${Date.now()}`, 8),
    });
    await this.users.setPinHash(user.id, await this.hashPasscode(params.passcode));

    const loaded = await this.users.findById(user.id);
    if (!this.hasAdminRole(loaded)) {
      const operationalRole = await this.rbac.getRoleByName('OPERATIONAL_ADMIN');
      if (!operationalRole) {
        throw new UnauthorizedException('Operational admin role not configured');
      }
      await this.users.setRoles(user.id, [operationalRole]);
    }

    const fullName = params.fullName?.trim() || null;
    const deliveryAddress = 'Management Office';
    if (fullName) {
      await this.users.updateProfile(user.id, { fullName, deliveryAddress });
    }

    return { pendingApproval: true };
  }

  async loginAdminWithPasscode(params: {
    phone: string;
    countryCode: string;
    passcode: string;
  }) {
    const fullPhone = normalizeAuthPhone(params.countryCode, params.phone);

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
    await this.verifyPasscode(params.passcode, loaded.pinHash);

    const snap = this.authSnapshot(loaded);
    return {
      accessToken: await this.jwt.signAsync({ sub: user.id, email: user.email }),
      roles: snap.roles,
      permissions: snap.permissions,
    };
  }

  async signupCustomerWithPasscode(params: {
    phone: string;
    countryCode: string;
    passcode: string;
    confirmPasscode: string;
    fullName?: string | null;
    email?: string | null;
    profession?: string | null;
    deliveryAddress?: string | null;
  }) {
    this.assertPasscodesMatch(params.passcode, params.confirmPasscode);
    const fullPhone = normalizeAuthPhone(params.countryCode, params.phone);

    const existing = await this.users.findByPhone(fullPhone);
    if (existing) {
      throw new ConflictException(
        'This mobile number is already registered. Log in with your passcode instead.',
      );
    }

    const email =
      params.email?.trim() && params.email.trim().length
        ? params.email.trim()
        : `${fullPhone.replace(/\+/g, '')}@bestbonds.local`;
    const user = await this.users.createLocalUser({
      email,
      phone: fullPhone,
      passwordHash: await bcrypt.hash(`${fullPhone}:${Date.now()}`, 8),
    });
    await this.users.setPinHash(user.id, await this.hashPasscode(params.passcode));
    await this.ensureDefaultMobileRole(user.id);

    const fullName = params.fullName?.trim() || null;
    const profession = params.profession?.trim() || null;
    const deliveryAddress = params.deliveryAddress?.trim() || null;
    if (fullName || profession || deliveryAddress) {
      await this.users.updateProfile(user.id, {
        ...(fullName ? { fullName } : {}),
        ...(profession ? { profession } : {}),
        ...(deliveryAddress ? { deliveryAddress } : {}),
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

  async loginCustomerWithPasscode(params: {
    phone: string;
    countryCode: string;
    passcode: string;
  }) {
    const fullPhone = normalizeAuthPhone(params.countryCode, params.phone);

    const user = await this.users.findByPhone(fullPhone);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Account not found');
    }
    const loaded = await this.users.findById(user.id);
    const roleNames = new Set(
      (loaded?.roles ?? []).map((r) => String(r.name).toUpperCase()),
    );
    if (!roleNames.has('CUSTOMER') && !roleNames.has('DEALER')) {
      throw new UnauthorizedException('Account not found');
    }
    await this.verifyPasscode(params.passcode, loaded?.pinHash);
    await this.users.syncTradeRoleFromProfession(user.id);

    const snap = this.authSnapshot(await this.users.findById(user.id));
    return {
      accessToken: await this.jwt.signAsync({ sub: user.id, email: user.email }),
      roles: snap.roles,
      permissions: snap.permissions,
    };
  }

  async signupSuperadminWithPasscode(params: {
    phone: string;
    countryCode: string;
    passcode: string;
    confirmPasscode: string;
    fullName: string;
    email: string;
  }) {
    this.assertPasscodesMatch(params.passcode, params.confirmPasscode);
    const fullPhone = normalizeAuthPhone(params.countryCode, params.phone);
    const superCount = await this.users.countUsersWithRole('SUPERADMIN');
    if (superCount > 0) {
      throw new UnauthorizedException('Super Admin already exists');
    }

    const existing = await this.users.findByPhone(fullPhone);
    if (existing) {
      throw new ConflictException(
        'This mobile number is already registered. Use a different number for the first Super Admin.',
      );
    }

    const email = params.email.trim();
    const user = await this.users.createLocalUser({
      email,
      phone: fullPhone,
      passwordHash: await bcrypt.hash(`${fullPhone}:${Date.now()}`, 8),
    });
    await this.users.setPinHash(user.id, await this.hashPasscode(params.passcode));

    const role = await this.rbac.getRoleByName('SUPERADMIN');
    if (!role) throw new UnauthorizedException('SUPERADMIN role not configured');
    await this.users.setRoles(user.id, [role]);

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

  async isSuperadminBootstrapAvailable(): Promise<{ allowed: boolean }> {
    const superCount = await this.users.countUsersWithRole('SUPERADMIN');
    return { allowed: superCount === 0 };
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
