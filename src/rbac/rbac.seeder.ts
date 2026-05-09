import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { RbacService } from './rbac.service';
import { UsersService } from '../users/users.service';

/**
 * Seeds initial roles + permissions so you can bootstrap the system
 * and still extend it later through RBAC APIs.
 */
@Injectable()
export class RbacSeeder implements OnModuleInit {
  private readonly logger = new Logger(RbacSeeder.name);

  constructor(
    private readonly rbac: RbacService,
    private readonly users: UsersService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    const permissions = [
      { key: 'rbac.manage', description: 'Manage roles and permissions' },
      { key: 'users.manage', description: 'Manage users and approve reward redemptions' },
      { key: 'coupons.manage', description: 'Generate and manage coupons (Superadmin only)' },
      { key: 'redemptions.deliver', description: 'Mark dispatched rewards as delivered to dealer' },
    ] as const;

    for (const p of permissions) {
      await this.rbac.upsertPermission(p.key, p.description);
    }

    await this.rbac.upsertRole({
      name: 'SUPERADMIN',
      description: 'Full system access',
      permissionKeys: permissions.map((p) => p.key),
    });
    await this.rbac.upsertRole({
      name: 'OPERATIONAL_ADMIN',
      description: 'Approve/reject redemptions and mark rewards as delivered to dealer',
      permissionKeys: ['users.manage', 'redemptions.deliver'],
    });
    await this.rbac.upsertRole({
      name: 'CUSTOMER',
      description: 'End user customer',
      permissionKeys: [],
    });
    await this.rbac.upsertRole({
      name: 'DEALER',
      description: 'End user dealer',
      permissionKeys: [],
    });

    await this.ensureDevOtpSuperadmin();
    this.logger.log('RBAC seed ensured (roles + permissions).');
  }

  /**
   * Non-production only: ensure a SUPERADMIN that can log in via OTP-only staff login.
   * This matches the new auth system (no password/PIN auth).
   *
   * Defaults (requested):
   * - name: Admin
   * - email: admin@admin.in
   * - phone: 9000000000 (+91)
   *
   * Optional overrides:
   * - DEV_SUPERADMIN_PHONE (10 digits)
   * - DEV_SUPERADMIN_EMAIL
   * - DEV_SUPERADMIN_NAME
   */
  private async ensureDevOtpSuperadmin() {
    if (this.config.get<string>('NODE_ENV') === 'production') return;

    const digits = (
      this.config.get<string>('DEV_SUPERADMIN_PHONE') ?? '9000000000'
    )
      .replace(/\D/g, '')
      .slice(0, 10);
    if (digits.length !== 10) return;

    const fullPhone = `+91${digits}`;
    const email =
      (this.config.get<string>('DEV_SUPERADMIN_EMAIL') ?? '').trim() ||
      'admin@admin.in';
    const name =
      (this.config.get<string>('DEV_SUPERADMIN_NAME') ?? '').trim() || 'Admin';

    const superadminRole = await this.rbac.getRoleByName('SUPERADMIN');
    if (!superadminRole) return;

    // Enforce "single superadmin" invariant even in dev.
    const existingCount = await this.users.countUsersWithRole('SUPERADMIN');
    if (existingCount > 0) return;

    let user = await this.users.findByPhone(fullPhone);
    if (!user) {
      const emailTaken = await this.users.findByEmail(email);
      if (emailTaken) {
        this.logger.warn(
          `Dev phone superadmin skipped: ${email} already registered.`,
        );
        return;
      }
      const passwordHash = await bcrypt.hash(`${fullPhone}:${Date.now()}:dev`, 12);
      user = await this.users.createLocalUser({
        email,
        passwordHash,
        phone: fullPhone,
      });
      this.logger.warn(
        `Bootstrapped dev phone SUPERADMIN (OTP login). phone=${fullPhone}`,
      );
    }

    await this.users.setRoles(user.id, [superadminRole]);
    await this.users.approveStaffUser({ userId: user.id, approvedBy: user.id });
    await this.users.updateProfile(user.id, {
      fullName: name,
      deliveryAddress: 'HQ',
      profession: 'Super Admin',
    });
  }
}
