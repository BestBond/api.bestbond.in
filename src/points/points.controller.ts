import { Controller, Get, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../auth/auth-user';
import { PointsService } from './points.service';

@Controller('points')
export class PointsController {
  constructor(private readonly points: PointsService) {}

  @Get('me')
  me(@Req() req: Request, @Query('limit') limit?: string) {
    const user = req.user as AuthUser;
    const take = limit ? Math.max(1, Math.min(100, Number(limit))) : 20;
    return this.points.listForUser(user.id, take);
  }
}
