import {
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { Msg91Service } from './msg91.service';
import { UsersService } from '../users/users.service';
import { RbacService } from '../rbac/rbac.service';
import type { User } from '../users/entities/user.entity';

export type Msg91AuthPayload = {
  accessToken: string;
  roles: string[];
  permissions: string[];
  isNewUser: boolean;
};

@Injectable()
export class OtpService {
  private readonly log = new Logger(OtpService.name);
  /** In-process cooldown (per instance). Use Redis when running multiple API replicas. */
  private readonly lastSendAt = new Map<string, number>();

  constructor(
    private readonly msg91: Msg91Service,
    private readonly users: UsersService,
    private readonly rbac: RbacService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async sendOtp(mobile: string): Promise<{ sent: true }> {
    this.assertMsg91Enabled();
    this.enforceCooldown(mobile);
    await this.msg91.sendOtp(mobile);
    this.lastSendAt.set(mobile, Date.now());
    return { sent: true };
  }

  async verifyAndSignIn(
    mobile: string,
    otp: string,
  ): Promise<Msg91AuthPayload> {
    this.assertMsg91Enabled();
    const ok = await this.msg91.verifyOtp(mobile, otp);
    if (!ok) {
      throw new UnauthorizedException('Invalid or expired OTP');
    }

    const fullPhone = `+${mobile}`;
    let user = await this.users.findByPhone(fullPhone);
    let isNewUser = false;

    if (user) {
      if (!user.isActive) {
        throw new UnauthorizedException('Account is disabled');
      }
      this.assertCustomerAppEligible(user);
    } else {
      user = await this.createCustomerForPhone(fullPhone);
      isNewUser = true;
    }

    const loaded = await this.users.findById(user.id);
    if (!loaded) throw new UnauthorizedException('User not found');
    const snap = this.authSnapshot(loaded);
    const accessToken = await this.jwt.signAsync({
      sub: loaded.id,
      email: loaded.email,
    });
    return {
      accessToken,
      roles: snap.roles,
      permissions: snap.permissions,
      isNewUser,
    };
  }

  private assertMsg91Enabled(): void {
    const on = String(this.config.get('MSG91_OTP_ENABLED') ?? '1').trim();
    if (on === '0' || on.toLowerCase() === 'false') {
      throw new ForbiddenException(
        'MSG91 OTP login is disabled on this server',
      );
    }
  }

  private enforceCooldown(mobile: string): void {
    const sec = Math.max(
      15,
      Math.min(
        600,
        Number(this.config.get('MSG91_SEND_COOLDOWN_SEC') ?? 45) || 45,
      ),
    );
    const last = this.lastSendAt.get(mobile);
    if (last != null) {
      const elapsed = (Date.now() - last) / 1000;
      if (elapsed < sec) {
        const retryAfter = Math.ceil(sec - elapsed);
        throw new ForbiddenException(
          `Please wait ${retryAfter}s before requesting another OTP`,
        );
      }
    }
  }

  private assertCustomerAppEligible(user: User): void {
    const roleNames = new Set(
      (user.roles ?? []).map((r) => String(r.name).toUpperCase()),
    );
    if (roleNames.has('SUPERADMIN') || roleNames.has('OPERATIONAL_ADMIN')) {
      throw new ForbiddenException(
        'This number is registered for management. Use the management login flow in the app.',
      );
    }
    if (!roleNames.has('CUSTOMER') && !roleNames.has('DEALER')) {
      throw new ForbiddenException(
        'This account is not eligible for customer OTP login. Contact support.',
      );
    }
  }

  private async createCustomerForPhone(fullPhone: string): Promise<User> {
    const email = `${fullPhone.replace(/\+/g, '')}@bestbonds.local`;
    const passwordHash = await bcrypt.hash(`${fullPhone}:${Date.now()}`, 10);
    const created = await this.users.createLocalUser({
      email,
      phone: fullPhone,
      passwordHash,
    });
    const customerRole = await this.rbac.getRoleByName('CUSTOMER');
    if (!customerRole) {
      this.log.error('CUSTOMER role missing — cannot complete MSG91 signup');
      throw new ForbiddenException('Server role configuration incomplete');
    }
    await this.users.setRoles(created.id, [customerRole]);
    const reloaded = await this.users.findById(created.id);
    if (!reloaded) throw new UnauthorizedException('User not found');
    return reloaded;
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
