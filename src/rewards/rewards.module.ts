import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Reward } from './entities/reward.entity';
import { Redemption } from './entities/redemption.entity';
import { RewardsController } from './rewards.controller';
import { RewardsService } from './rewards.service';
import { RewardsSeeder } from './rewards.seed';
import { PointsModule } from '../points/points.module';
import { User } from '../users/entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Reward, Redemption, User]), PointsModule],
  controllers: [RewardsController],
  providers: [RewardsService, RewardsSeeder],
  exports: [RewardsService],
})
export class RewardsModule {}
