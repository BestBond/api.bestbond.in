import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { RbacModule } from '../rbac/rbac.module';
import { PointsModule } from '../points/points.module';
import { PointsTransaction } from '../points/entities/points-transaction.entity';
import { Redemption } from '../rewards/entities/redemption.entity';
import { Reward } from '../rewards/entities/reward.entity';
import { User } from '../users/entities/user.entity';
import { Coupon } from '../coupons/entities/coupon.entity';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [
    UsersModule,
    RbacModule,
    PointsModule,
    TypeOrmModule.forFeature([
      PointsTransaction,
      Redemption,
      Reward,
      User,
      Coupon,
    ]),
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
