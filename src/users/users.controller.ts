import { Body, Controller, Delete, Get, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../auth/auth-user';
import { RequireAnyPermissions } from '../auth/require-any-permissions.decorator';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateAdminPreferencesDto } from './dto/update-admin-preferences.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ChangePasscodeDto } from './dto/change-passcode.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  me(@Req() req: Request) {
    return { user: (req.user as AuthUser | undefined) ?? null };
  }

  @Get('me/profile')
  async myProfile(@Req() req: Request) {
    const auth = req.user as AuthUser;
    const user = await this.users.findById(auth.id);
    const profileComplete = this.users.isProfileComplete(user);
    return {
      id: auth.id,
      email: auth.email,
      phone: user?.phone ?? null,
      fullName: user?.fullName ?? null,
      profession: user?.profession ?? null,
      deliveryAddress: user?.deliveryAddress ?? null,
      loyaltyPoints: user?.loyaltyPoints ?? 0,
      memberSinceYear: user?.createdAt ? user.createdAt.getFullYear() : null,
      profileComplete,
      roles: auth.roles,
      permissions: auth.permissions,
    };
  }

  @Put('me/profile')
  async updateMyProfile(@Req() req: Request, @Body() dto: UpdateProfileDto) {
    const auth = req.user as AuthUser;
    const updated = await this.users.updateProfile(auth.id, {
      fullName: dto.fullName ?? undefined,
      profession: dto.profession ?? undefined,
      deliveryAddress: dto.deliveryAddress ?? undefined,
    });
    const roles = (updated.roles ?? []).map((r) => r.name);
    const permissions = Array.from(
      new Set(
        (updated.roles ?? []).flatMap((r) =>
          (r.permissions ?? []).map((p) => p.key),
        ),
      ),
    );
    return {
      id: updated.id,
      email: updated.email,
      phone: updated.phone,
      fullName: updated.fullName,
      profession: updated.profession,
      deliveryAddress: updated.deliveryAddress,
      loyaltyPoints: updated.loyaltyPoints,
      memberSinceYear: updated.createdAt.getFullYear(),
      profileComplete: this.users.isProfileComplete(updated),
      roles,
      permissions,
    };
  }

  /**
   * Own notification + quick-PIN settings. Ops admins do not have `users.manage`
   * but must complete onboarding like superadmins.
   */
  @Get('me/admin-preferences')
  @RequireAnyPermissions('users.manage', 'dealer.redemptions.manage')
  getAdminPreferences(@Req() req: Request) {
    const auth = req.user as AuthUser;
    return this.users.getAdminPreferences(auth.id);
  }

  @Put('me/admin-preferences')
  @RequireAnyPermissions('users.manage', 'dealer.redemptions.manage')
  updateAdminPreferences(
    @Req() req: Request,
    @Body() dto: UpdateAdminPreferencesDto,
  ) {
    const auth = req.user as AuthUser;
    return this.users.updateAdminPreferences(auth.id, {
      quickLoginPinEnabled: dto.quickLoginPinEnabled,
      highValueRedemptions: dto.highValueRedemptions,
      couponExportFailures: dto.couponExportFailures,
      suspiciousUserActivity: dto.suspiciousUserActivity,
    });
  }

  @Put('me/password')
  @RequireAnyPermissions('users.manage', 'dealer.redemptions.manage')
  changeMyPassword(@Req() req: Request, @Body() dto: ChangePasswordDto) {
    const auth = req.user as AuthUser;
    return this.users.changePassword({
      userId: auth.id,
      currentPassword: dto.currentPassword,
      newPassword: dto.newPassword,
    });
  }

  @Put('me/passcode')
  changeMyPasscode(@Req() req: Request, @Body() dto: ChangePasscodeDto) {
    const auth = req.user as AuthUser;
    return this.users.changePasscode({
      userId: auth.id,
      currentPasscode: dto.currentPasscode,
      newPasscode: dto.newPasscode,
      confirmNewPasscode: dto.confirmNewPasscode,
    });
  }

  /**
   * Customer/dealer self-service account deletion (mobile Profile → Delete Account).
   * Requires current 6-digit passcode. Staff accounts are rejected.
   */
  @Delete('me')
  deleteMyAccount(@Req() req: Request, @Body() dto: DeleteAccountDto) {
    const auth = req.user as AuthUser;
    return this.users.deleteMyAccount(auth.id, dto.passcode);
  }
}
