import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppControllerV1 } from './app/app.controller';
import { AppService } from './app.service';
import { User } from './users/entities/user.entity';
import { Role } from './rbac/entities/role.entity';
import { Permission } from './rbac/entities/permission.entity';
import { Coupon } from './coupons/entities/coupon.entity';
import { PointsTransaction } from './points/entities/points-transaction.entity';
import { Reward } from './rewards/entities/reward.entity';
import { Redemption } from './rewards/entities/redemption.entity';
import { OtpCode } from './auth/entities/otp-code.entity';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { RbacModule } from './rbac/rbac.module';
import { AdminModule } from './admin/admin.module';
import { PointsModule } from './points/points.module';
import { CouponsModule } from './coupons/coupons.module';
import { RewardsModule } from './rewards/rewards.module';
import { TransactionsModule } from './transactions/transactions.module';
import { SupportModule } from './support/support.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'sqlite' as const,
        database: config.get<string>('DB_PATH') ?? 'data.sqlite',
        entities: [
          User,
          Role,
          Permission,
          Coupon,
          PointsTransaction,
          Reward,
          Redemption,
          OtpCode,
        ],
        synchronize: true,
      }),
    }),
    AuthModule,
    UsersModule,
    RbacModule,
    AdminModule,
    PointsModule,
    CouponsModule,
    RewardsModule,
    TransactionsModule,
    SupportModule,
  ],
  controllers: [AppController, AppControllerV1],
  providers: [AppService],
})
export class AppModule {}
