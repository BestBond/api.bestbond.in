import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Coupon } from './entities/coupon.entity';
import { CouponsService } from './coupons.service';
import { CouponsController } from './coupons.controller';
import { CouponLinkController } from './coupon-link.controller';
import { PointsModule } from '../points/points.module';
import { User } from '../users/entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Coupon, User]), PointsModule],
  providers: [CouponsService],
  controllers: [CouponsController, CouponLinkController],
})
export class CouponsModule {}
