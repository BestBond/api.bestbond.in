import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
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
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Production often sets DATABASE_SYNCHRONIZE=false, so a new SQLite file has no tables.
   * Seeders run after TypeORM init; create schema once before touching RBAC rows.
   */
  private async ensureSqliteSchema(): Promise<void> {
    if (this.dataSource.options.type !== 'sqlite') return;
    const rows = (await this.dataSource.query(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'permissions'`,
    )) as { name: string }[];
    if (rows.length > 0) return;

    this.logger.warn(
      'SQLite has no RBAC tables yet (typical first boot with synchronize off). Running one-time schema sync from entities.',
    );
    await this.dataSource.synchronize();
  }

  async onModuleInit() {
    await this.ensureSqliteSchema();

    const permissions = [
      { key: 'rbac.manage', description: 'Manage roles and permissions' },
      {
        key: 'users.manage',
        description:
          'Superadmin: manage users, ledgers, and oversight of all redemption activity',
      },
      { key: 'coupons.manage', description: 'Generate and manage coupons (Superadmin only)' },
      { key: 'redemptions.deliver', description: 'Mark dispatched rewards as delivered' },
      {
        key: 'dealer.redemptions.manage',
        description:
          'Ops admin: record dealer store redemptions and approve/reject dealer redemption queue',
      },
      {
        key: 'rewards.manage',
        description: 'Superadmin: manage gift catalog and slab rewards',
      },
      {
        key: 'users.delete',
        description: 'Superadmin: permanently delete user accounts',
      },
      {
        key: 'points.manage',
        description: 'Superadmin: manually adjust a user\'s loyalty points balance',
      },
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
      description:
        'Store ops: dealer redemption queue (approve/reject/deliver) and record dealer redemptions',
      permissionKeys: ['dealer.redemptions.manage', 'redemptions.deliver'],
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

    await this.ensureDevPasscodeSuperadmin();
    this.logger.log('RBAC seed ensured (roles + permissions).');
  }

  /**
   * Non-production only: ensure a SUPERADMIN for dev (mobile + passcode login).
   *
   * Configure with `.env` (see `.env.example`):
   * - DEV_SUPERADMIN_PHONE — 10 digits, country +91 applied in seeder
   * - DEV_SUPERADMIN_EMAIL, DEV_SUPERADMIN_NAME
   * - DEV_SUPERADMIN_PASSCODE — 6 digits, synced on startup for that phone if SUPERADMIN
   */
  private async ensureDevPasscodeSuperadmin() {
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
    const devPasscode = (
      this.config.get<string>('DEV_SUPERADMIN_PASSCODE') ?? '111111'
    ).trim();
    const passcodeValid = /^\d{6}$/.test(devPasscode);

    const superadminRole = await this.rbac.getRoleByName('SUPERADMIN');
    if (!superadminRole) return;

    const existingSuperCount = await this.users.countUsersWithRole('SUPERADMIN');

    let user = await this.users.findByPhone(fullPhone);
    if (user && passcodeValid) {
      const loaded = await this.users.findById(user.id);
      const isSuper = (loaded?.roles ?? []).some(
        (r) => String(r.name).toUpperCase() === 'SUPERADMIN',
      );
      if (loaded && isSuper) {
        await this.users.setPinHash(
          loaded.id,
          await bcrypt.hash(devPasscode, 12),
        );
        this.logger.warn(
          `SUPERADMIN passcode synced from DEV_SUPERADMIN_PASSCODE for phone=${fullPhone}.`,
        );
      }
    }

    if (existingSuperCount > 0) return;

    if (!user) {
      const emailTaken = await this.users.findByEmail(email);
      if (emailTaken) {
        this.logger.warn(
          `Dev phone superadmin skipped: ${email} already registered.`,
        );
        return;
      }
      if (!passcodeValid) {
        this.logger.warn(
          'DEV_SUPERADMIN_PASSCODE must be exactly 6 digits. Dev Super Admin bootstrap skipped.',
        );
        return;
      }
      user = await this.users.createLocalUser({
        email,
        passwordHash: await bcrypt.hash(`${fullPhone}:${Date.now()}:dev`, 12),
        phone: fullPhone,
      });
      await this.users.setPinHash(
        user.id,
        await bcrypt.hash(devPasscode, 12),
      );
      this.logger.warn(
        `Bootstrapped dev SUPERADMIN. phone=${fullPhone} passcode from DEV_SUPERADMIN_PASSCODE.`,
      );
    } else if (passcodeValid) {
      await this.users.setPinHash(
        user.id,
        await bcrypt.hash(devPasscode, 12),
      );
      this.logger.warn(
        `Updated dev SUPERADMIN passcode from DEV_SUPERADMIN_PASSCODE for phone=${fullPhone}.`,
      );
    } else {
      this.logger.warn(
        `Dev user exists at ${fullPhone} but DEV_SUPERADMIN_PASSCODE is invalid. Set a 6-digit passcode and restart.`,
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
