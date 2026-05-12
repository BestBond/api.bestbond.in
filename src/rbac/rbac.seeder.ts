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

    await this.ensureDevOtpSuperadmin();
    this.logger.log('RBAC seed ensured (roles + permissions).');
  }

  /**
   * Non-production only: ensure a SUPERADMIN for dev (OTP + password login).
   *
   * Configure with `.env` (see `.env.example`):
   * - DEV_SUPERADMIN_PHONE — 10 digits, country +91 applied in seeder
   * - DEV_SUPERADMIN_EMAIL, DEV_SUPERADMIN_NAME
   * - DEV_SUPERADMIN_PASSWORD (min 8 chars) — synced on every startup for that phone if the user is SUPERADMIN
   *
   * If no SUPERADMIN exists yet, creates the dev user at DEV_SUPERADMIN_PHONE.
   * If SUPERADMIN row(s) already exist, still applies DEV_SUPERADMIN_PASSWORD to the user at
   * DEV_SUPERADMIN_PHONE when that account has the SUPERADMIN role (so local login works after pull).
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
    const devPw = (this.config.get<string>('DEV_SUPERADMIN_PASSWORD') ?? '').trim();

    const superadminRole = await this.rbac.getRoleByName('SUPERADMIN');
    if (!superadminRole) return;

    const existingSuperCount = await this.users.countUsersWithRole('SUPERADMIN');

    let user = await this.users.findByPhone(fullPhone);
    if (user && devPw.length >= 8) {
      const loaded = await this.users.findById(user.id);
      const isSuper = (loaded?.roles ?? []).some(
        (r) => String(r.name).toUpperCase() === 'SUPERADMIN',
      );
      if (loaded && isSuper) {
        await this.users.setPasswordHash(loaded.id, await bcrypt.hash(devPw, 12));
        this.logger.warn(
          `SUPERADMIN password synced from DEV_SUPERADMIN_PASSWORD for phone=${fullPhone}.`,
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
      const passwordHash =
        devPw.length >= 8
          ? await bcrypt.hash(devPw, 12)
          : await bcrypt.hash(`${fullPhone}:${Date.now()}:dev`, 12);
      if (devPw.length < 8) {
        this.logger.warn(
          'DEV_SUPERADMIN_PASSWORD unset or shorter than 8 characters; dev Super Admin password is random. Set DEV_SUPERADMIN_PASSWORD for OTP+password login, or bootstrap via POST /auth/superadmin/otp/signup.',
        );
      }
      user = await this.users.createLocalUser({
        email,
        passwordHash,
        phone: fullPhone,
      });
      this.logger.warn(
        `Bootstrapped dev SUPERADMIN. phone=${fullPhone} (OTP + password when DEV_SUPERADMIN_PASSWORD is set).`,
      );
    } else if (devPw.length >= 8) {
      await this.users.setPasswordHash(user.id, await bcrypt.hash(devPw, 12));
      this.logger.warn(
        `Updated dev SUPERADMIN password from DEV_SUPERADMIN_PASSWORD for phone=${fullPhone}.`,
      );
    } else {
      this.logger.warn(
        `Dev user exists at ${fullPhone} but DEV_SUPERADMIN_PASSWORD not set (min 8). Super Admin login needs a known password — set env and restart.`,
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
