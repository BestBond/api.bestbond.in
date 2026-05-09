import { Body, Controller, Delete, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../auth/auth-user';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { CreateOperationalAdminDto } from './dto/create-operational-admin.dto';
import { SuspendUserDto } from './dto/suspend-user.dto';
import { AdminService } from './admin.service';

@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('dashboard')
  @RequirePermissions('users.manage')
  getDashboard() {
    return this.admin.getDashboardSummary();
  }

  /**
   * Superadmin / Ops Admin: approval request list (Redemption approvals screens).
   * UI needs: request code, points value, reward name, requester, duplicate/flag markers.
   */
  @Get('redemptions')
  @RequirePermissions('users.manage')
  listRedemptions(
    @Query('status') status?: string,
    @Query('take') take?: string,
    @Query('offset') offset?: string,
    @Query('sort') sort?: string,
    @Query('flagged') flagged?: string,
    @Query('flagMinPoints') flagMinPoints?: string,
  ) {
    const t = take ? Number(take) : 20;
    const o = offset ? Number(offset) : 0;
    const takeN = Number.isFinite(t) ? Math.max(1, Math.min(100, t)) : 20;
    const offsetN = Number.isFinite(o) ? Math.max(0, Math.min(10_000, o)) : 0;
    const flaggedOn = flagged === '1' || flagged === 'true';
    const minPtsRaw = flagMinPoints ? Number(flagMinPoints) : undefined;
    const minPts =
      minPtsRaw != null && Number.isFinite(minPtsRaw) && minPtsRaw > 0
        ? minPtsRaw
        : undefined;
    return this.admin.listRedemptionRequests({
      status,
      take: takeN,
      offset: offsetN,
      sort,
      flaggedOnly: flaggedOn,
      flagMinPoints: minPts,
    });
  }

  /**
   * Superadmin / Ops Admin: approval request detail (Approval Request Details screen).
   * UI needs: status banner, reward title + points, requester profile info, and a user id for "View Account".
   */
  @Get('redemptions/:id')
  @RequirePermissions('users.manage')
  getRedemption(@Param('id') id: string, @Query('flagMinPoints') flagMinPoints?: string) {
    const minPtsRaw = flagMinPoints ? Number(flagMinPoints) : undefined;
    const minPts =
      minPtsRaw != null && Number.isFinite(minPtsRaw) && minPtsRaw > 0
        ? minPtsRaw
        : undefined;
    return this.admin.getRedemptionRequestById(id, { flagMinPoints: minPts });
  }

  /** Detail screen primary action: "Approve & Dispatch" */
  @Post('redemptions/:id/approve')
  @RequirePermissions('users.manage')
  approveRedemption(@Param('id') id: string) {
    return this.admin.approveRedemptionRequest(id);
  }

  /** Detail screen secondary action: "Reject Request" */
  @Post('redemptions/:id/reject')
  @RequirePermissions('users.manage')
  rejectRedemption(@Param('id') id: string) {
    return this.admin.rejectRedemptionRequest(id);
  }

  /**
   * Operational Admin: mark a dispatched reward as physically delivered to the dealer.
   * Only available when status is SHIPPED.
   * Requires `redemptions.deliver` (OPERATIONAL_ADMIN + SUPERADMIN).
   */
  @Post('redemptions/:id/deliver')
  @RequirePermissions('redemptions.deliver')
  deliverRedemption(@Param('id') id: string) {
    return this.admin.deliverRedemptionRequest(id);
  }

  /**
   * Super Admin — Users list screen
   * UI needs: name, profession chip, wallet balance; plus search + filter + pagination.
   */
  @Get('users')
  @RequirePermissions('users.manage')
  listUsers(
    @Query('q') q?: string,
    @Query('profession') profession?: string,
    @Query('take') take?: string,
    @Query('offset') offset?: string,
  ) {
    const t = take ? Number(take) : 20;
    const o = offset ? Number(offset) : 0;
    const takeN = Number.isFinite(t) ? Math.max(1, Math.min(100, t)) : 20;
    const offsetN = Number.isFinite(o) ? Math.max(0, Math.min(10_000, o)) : 0;
    return this.admin.listUsers({ q, profession, take: takeN, offset: offsetN });
  }

  /** Super Admin — User profile screen */
  @Get('users/:id')
  @RequirePermissions('users.manage')
  getUser(@Param('id') id: string) {
    return this.admin.getUserById(id);
  }

  /** Super Admin — Suspend account (User Profile screen) */
  @Post('users/:id/suspend')
  @RequirePermissions('rbac.manage')
  suspendUser(@Param('id') id: string, @Body() dto: SuspendUserDto) {
    return this.admin.suspendUserById(id, { reason: dto.reason ?? null });
  }

  /** Super Admin — Reactivate account (not in Figma yet, but needed to undo suspend) */
  @Post('users/:id/activate')
  @RequirePermissions('rbac.manage')
  activateUser(@Param('id') id: string) {
    return this.admin.activateUserById(id);
  }

  /**
   * Super Admin — Transaction Ledger screen.
   * UI needs: user summary header, total balance, monthly scans count, transaction list.
   */
  @Get('users/:id/transactions')
  @RequirePermissions('users.manage')
  getUserTransactions(
    @Param('id') id: string,
    @Query('period') period?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const t = limit ? Number(limit) : 20;
    const o = offset ? Number(offset) : 0;
    return this.admin.getUserTransactions({
      userId: id,
      period: period === 'ALL' ? 'ALL' : 'THIS_MONTH',
      take: Number.isFinite(t) ? Math.max(1, Math.min(100, t)) : 20,
      skip: Number.isFinite(o) ? Math.max(0, Math.min(10_000, o)) : 0,
    });
  }

  /**
   * Superadmins will call this from their dashboard to onboard Operational Admins.
   * Requires `rbac.manage` permission (seeded for SUPERADMIN).
   */
  @Post('operational-admins')
  @RequirePermissions('rbac.manage')
  createOperationalAdmin(@Body() dto: CreateOperationalAdminDto) {
    return this.admin.createOperationalAdmin({
      email: dto.email,
      tempPassword: dto.tempPassword,
    });
  }

  /** Superadmin: list Ops Admin accounts waiting for approval. */
  @Get('operational-admins/pending')
  @RequirePermissions('rbac.manage')
  listPendingOperationalAdmins(
    @Query('take') take?: string,
    @Query('offset') offset?: string,
  ) {
    const t = take ? Number(take) : 20;
    const o = offset ? Number(offset) : 0;
    return this.admin.listPendingOperationalAdmins({
      take: Number.isFinite(t) ? t : 20,
      offset: Number.isFinite(o) ? o : 0,
    });
  }

  /** Superadmin: approve an Ops Admin self-registered account. */
  @Post('operational-admins/:id/approve')
  @RequirePermissions('rbac.manage')
  approveOperationalAdmin(@Param('id') id: string, @Req() req: Request) {
    const auth = req.user as AuthUser;
    return this.admin.approveOperationalAdmin({ userId: id, approvedBy: auth.id });
  }

  // NOTE: removed "operational-admin-whitelist" flow — ops admins are now gated by approval.
}
