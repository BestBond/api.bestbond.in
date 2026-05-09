import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../auth/auth-user';
import { PointsService } from '../points/points.service';
import { UsersService } from '../users/users.service';

@Controller('app')
export class AppControllerV1 {
  constructor(
    private readonly points: PointsService,
    private readonly users: UsersService,
  ) {}

  /**
   * Home screen data: balance + tier progress + recent activity.
   */
  @Get('home')
  async home(@Req() req: Request) {
    const user = req.user as AuthUser;
    const { balance, transactions } = await this.points.listForUser(
      user.id,
      10,
    );
    const u = await this.users.findById(user.id);

    // Simple tiering model to match UI; can be replaced by a real leveling system.
    const tier = 'Gold Member Tier';
    const pointsToNextReward = 500;

    return {
      user: { id: user.id, email: user.email },
      tier,
      balance,
      pointsToNextReward,
      memberSince: u?.createdAt ? u.createdAt.getFullYear() : null,
      recentActivity: transactions.map((t) => ({
        id: t.id,
        title: t.title,
        pointsDelta: t.pointsDelta,
        site: t.site,
        createdAt: t.createdAt,
      })),
    };
  }
}
