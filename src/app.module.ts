import { Logger, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
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
import { OtpModule } from './otp/otp.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Load secrets from `.env` only — never from `.env.example` (that file is a template).
      envFilePath: '.env',
    }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 300 }]),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isProd = config.get<string>('NODE_ENV') === 'production';
        const syncExplicit = config
          .get<string>('DATABASE_SYNCHRONIZE')
          ?.toLowerCase();
        /** Production default: off. Dev default: on. Override with DATABASE_SYNCHRONIZE=true|false */
        const synchronize =
          syncExplicit === 'true' || (!isProd && syncExplicit !== 'false');
        if (isProd && synchronize) {
          Logger.warn(
            '[TypeORM] DATABASE_SYNCHRONIZE=true in production — schema auto-sync is ON. Set to false after bootstrap and use migrations for ongoing changes.',
          );
        }
        return {
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
          synchronize,
        };
      },
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
    OtpModule,
  ],
  controllers: [AppController, AppControllerV1],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
