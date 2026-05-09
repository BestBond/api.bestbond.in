import { Body, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request } from 'express';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth-user';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { CouponsService } from './coupons.service';
import { GenerateCouponsDto } from './dto/generate-coupons.dto';
import { RedeemCouponDto } from './dto/redeem-coupon.dto';

@Controller('coupons')
export class CouponsController {
  constructor(private readonly coupons: CouponsService) {}

  /**
   * Ops Admin/Superadmin: generate coupons in bulk.
   */
  @Post('generate')
  @RequirePermissions('coupons.manage')
  generate(@Req() req: Request, @Body() dto: GenerateCouponsDto) {
    const user = req.user as AuthUser;
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    return this.coupons.generate({
      createdByUserId: user.id,
      title: dto.title,
      points: dto.points,
      quantity: dto.quantity,
      site: dto.site ?? null,
      expiresAt:
        expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null,
    });
  }

  /**
   * Ops Admin/Superadmin: list coupons.
   */
  @Get()
  @RequirePermissions('coupons.manage')
  list(@Query('status') status?: string, @Query('take') take?: string) {
    const n = take ? Number(take) : 50;
    return this.coupons.list({ status, take: Number.isFinite(n) ? n : 50 });
  }

  /**
   * Ops Admin/Superadmin: list coupon batches (for management/export history).
   */
  @Get('batches')
  @RequirePermissions('coupons.manage')
  listBatches(@Query('take') take?: string, @Query('offset') offset?: string) {
    const t = take ? Number(take) : 20;
    const o = offset ? Number(offset) : 0;
    return this.coupons.listBatches({
      take: Number.isFinite(t) ? t : 20,
      offset: Number.isFinite(o) ? o : 0,
    });
  }

  /**
   * Ops Admin/Superadmin: list coupons belonging to a batch.
   */
  @Get('batches/:batchId')
  @RequirePermissions('coupons.manage')
  listBatchCoupons(
    @Param('batchId') batchId: string,
    @Query('take') take?: string,
    @Query('offset') offset?: string,
    @Query('status') status?: string,
  ) {
    const t = take ? Number(take) : 50;
    const o = offset ? Number(offset) : 0;
    return this.coupons.listBatchCoupons({
      batchId,
      status,
      take: Number.isFinite(t) ? t : 50,
      offset: Number.isFinite(o) ? o : 0,
    });
  }

  /**
   * Customer/Dealer: redeem a coupon by scanned/manual code entry.
   */
  @Post('redeem')
  redeem(@Req() req: Request, @Body() dto: RedeemCouponDto) {
    const user = req.user as AuthUser;
    return this.coupons.redeem({
      userId: user.id,
      userRoles: user.roles ?? [],
      code: dto.code,
    });
  }

  /**
   * Ops Admin/Superadmin: export a coupon batch as print-ready PDF.
   * 3 coupons per page, stacked vertically.
   */
  @Get('batches/:batchId/export.pdf')
  @RequirePermissions('coupons.manage')
  async exportBatchPdf(
    @Param('batchId') batchId: string,
    @Res() res: Response,
  ) {
    const pdf = await this.coupons.exportBatchPdf({ batchId });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader(
      'Content-Disposition',
      `inline; filename=\"coupon-batch-${batchId}.pdf\"`,
    );
    res.status(200).send(pdf);
  }
}
