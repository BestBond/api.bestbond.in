import { Body, Controller, Delete, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../auth/auth-user';
import { RequireAnyPermissions } from '../auth/require-any-permissions.decorator';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { CreateDealerRedemptionDto } from './dto/create-dealer-redemption.dto';
import { CreateOperationalAdminDto } from './dto/create-operational-admin.dto';
import { SuspendUserDto } from './dto/suspend-user.dto';
import { AdminService } from './admin.service';

@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('dashboard')
  @RequireAnyPermissions('users.manage', 'dealer.redemptions.manage', 'rbac.manage')
  getDashboard(@Req() req: Request) {
    return this.admin.getDashboardSummary(req.user as AuthUser);
  }

  /**
   * Superadmin / Ops Admin: approval request list (Redemption approvals screens).
   * UI needs: request code, points value, reward name, requester, duplicate/flag markers.
   */
  @Get('redemptions')
  @RequirePermissions('dealer.redemptions.manage')
  listRedemptions(
    @Req() req: Request,
    @Query('status') status?: string,
    @Query('take') take?: string,
    @Query('offset') offset?: string,
    @Query('sort') sort?: string,
    @Query('flagged') flagged?: string,
    @Query('flagMinPoints') flagMinPoints?: string,
    @Query('channel') channel?: string,
  ) {
    const auth = req.user as AuthUser;
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
    const ch = (channel ?? 'ALL').toUpperCase();
    const channelFilter =
      ch === 'DEALER_STORE' || ch === 'CUSTOMER_APP'
        ? ch
        : ('ALL' as const);
    return this.admin.listRedemptionRequests(auth, {
      status,
      take: takeN,
      offset: offsetN,
      sort,
      flaggedOnly: flaggedOn,
      flagMinPoints: minPts,
      channel: channelFilter,
    });
  }

  /**
   * Superadmin / Ops Admin: approval request detail (Approval Request Details screen).
   * UI needs: status banner, reward title + points, requester profile info, and a user id for "View Account".
   */
  @Get('redemptions/:id')
  @RequirePermissions('dealer.redemptions.manage')
  getRedemption(
    @Req() req: Request,
    @Param('id') id: string,
    @Query('flagMinPoints') flagMinPoints?: string,
  ) {
    const auth = req.user as AuthUser;
    const minPtsRaw = flagMinPoints ? Number(flagMinPoints) : undefined;
    const minPts =
      minPtsRaw != null && Number.isFinite(minPtsRaw) && minPtsRaw > 0
        ? minPtsRaw
        : undefined;
    return this.admin.getRedemptionRequestById(auth, id, { flagMinPoints: minPts });
  }

  /** Record a dealer in-store redemption (points debited; appears in approval queue). */
  @Post('dealer-redemptions')
  @RequirePermissions('dealer.redemptions.manage')
  createDealerRedemption(@Body() dto: CreateDealerRedemptionDto) {
    return this.admin.createDealerStoreRedemption({
      dealerUserId: dto.dealerUserId,
      rewardId: dto.rewardId,
      deliveryLabel: dto.deliveryLabel ?? null,
      deliveryAddress: dto.deliveryAddress ?? null,
    });
  }

  /** Search dealer accounts (for recording store redemptions). */
  @Get('dealers')
  @RequirePermissions('dealer.redemptions.manage')
  searchDealers(
    @Query('q') q?: string,
    @Query('take') take?: string,
    @Query('offset') offset?: string,
  ) {
    const t = take ? Number(take) : 20;
    const o = offset ? Number(offset) : 0;
    const takeN = Number.isFinite(t) ? Math.max(1, Math.min(100, t)) : 20;
    const offsetN = Number.isFinite(o) ? Math.max(0, Math.min(10_000, o)) : 0;
    return this.admin.searchDealers({ q, take: takeN, offset: offsetN });
  }

  /** Detail screen primary action: "Approve & Dispatch" */
  @Post('redemptions/:id/approve')
  @RequirePermissions('dealer.redemptions.manage')
  approveRedemption(@Req() req: Request, @Param('id') id: string) {
    const auth = req.user as AuthUser;
    return this.admin.approveRedemptionRequest(auth, id);
  }

  /** Detail screen secondary action: "Reject Request" */
  @Post('redemptions/:id/reject')
  @RequirePermissions('dealer.redemptions.manage')
  rejectRedemption(@Req() req: Request, @Param('id') id: string) {
    const auth = req.user as AuthUser;
    return this.admin.rejectRedemptionRequest(auth, id);
  }

  /**
   * Operational Admin: mark a dispatched reward as physically delivered to the dealer.
   * Only available when status is SHIPPED.
   * Requires `redemptions.deliver` (OPERATIONAL_ADMIN + SUPERADMIN).
   */
  @Post('redemptions/:id/deliver')
  @RequirePermissions('redemptions.deliver')
  deliverRedemption(@Req() req: Request, @Param('id') id: string) {
    const auth = req.user as AuthUser;
    return this.admin.deliverRedemptionRequest(auth, id);
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
