import { Controller, Get, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../auth/auth-user';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PointsTransaction } from '../points/entities/points-transaction.entity';

type Period = 'THIS_MONTH' | 'ALL';

@Controller('transactions')
export class TransactionsController {
  constructor(
    @InjectRepository(PointsTransaction)
    private readonly txRepo: Repository<PointsTransaction>,
  ) {}

  @Get('me')
  async myTransactions(
    @Req() req: Request,
    @Query('period') period?: Period,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const user = req.user as AuthUser;
    const take = limit ? Math.max(1, Math.min(100, Number(limit))) : 20;
    const skip = offset ? Math.max(0, Math.min(10_000, Number(offset))) : 0;

    const p = period ?? 'THIS_MONTH';
    const { from, to } = this.periodRange(p);

    const applyDateFilter = (
      qb: ReturnType<typeof this.txRepo.createQueryBuilder>,
    ) => {
      if (from && to) {
        qb.andWhere('t.created_at >= :from AND t.created_at < :to', {
          from: from.toISOString(),
          to: to.toISOString(),
        });
      }
    };

    const aggQb = this.txRepo
      .createQueryBuilder('t')
      .select(
        'COALESCE(SUM(CASE WHEN t.pointsDelta > 0 THEN t.pointsDelta ELSE 0 END), 0)',
        'earned',
      )
      .addSelect(
        'COALESCE(SUM(CASE WHEN t.pointsDelta < 0 THEN ABS(t.pointsDelta) ELSE 0 END), 0)',
        'spent',
      )
      .where('t.userId = :userId', { userId: user.id });
    applyDateFilter(aggQb);

    const raw = await aggQb.getRawOne<{ earned: string; spent: string }>();
    const earned = Number(raw?.earned ?? 0);
    const spent = Number(raw?.spent ?? 0);

    const listQb = this.txRepo
      .createQueryBuilder('t')
      .where('t.userId = :userId', { userId: user.id })
      .orderBy('t.created_at', 'DESC')
      .skip(skip)
      .take(take);
    applyDateFilter(listQb);

    const transactions = await listQb.getMany();

    return {
      period: p,
      totalPointsEarned: earned,
      totalPointsSpent: spent,
      hasMore: transactions.length === take,
      transactions: transactions.map((t) => ({
        id: t.id,
        type: t.type,
        title: t.title,
        site: t.site,
        pointsDelta: t.pointsDelta,
        createdAt: t.createdAt,
      })),
    };
  }

  private periodRange(period: Period) {
    if (period === 'ALL')
      return { from: null as Date | null, to: null as Date | null };
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
    return { from, to };
  }
}
