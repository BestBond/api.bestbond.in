import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PointsModule } from '../points/points.module';
import { PointsTransaction } from '../points/entities/points-transaction.entity';
import { TransactionsController } from './transactions.controller';

@Module({
  imports: [TypeOrmModule.forFeature([PointsTransaction]), PointsModule],
  controllers: [TransactionsController],
})
export class TransactionsModule {}
