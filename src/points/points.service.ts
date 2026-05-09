import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { User } from '../users/entities/user.entity';
import {
  PointsTransaction,
  PointsTransactionType,
} from './entities/points-transaction.entity';

@Injectable()
export class PointsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    @InjectRepository(PointsTransaction)
    private readonly txRepo: Repository<PointsTransaction>,
  ) {}

  async creditWithManager(
    manager: EntityManager,
    params: {
      userId: string;
      points: number;
      title: string;
      site?: string | null;
      type: PointsTransactionType;
    },
  ) {
    if (!Number.isFinite(params.points) || params.points === 0) {
      throw new BadRequestException('Invalid points');
    }

    const userRepo = manager.getRepository(User);
    const txRepo = manager.getRepository(PointsTransaction);

    const user = await userRepo.findOne({ where: { id: params.userId } });
    if (!user) throw new NotFoundException('User not found');

    user.loyaltyPoints = (user.loyaltyPoints ?? 0) + params.points;
    if (user.loyaltyPoints < 0) {
      throw new BadRequestException('Insufficient points');
    }
    await userRepo.save(user);

    const tx = txRepo.create({
      user,
      type: params.type,
      pointsDelta: params.points,
      title: params.title,
      site: params.site ?? null,
    });
    await txRepo.save(tx);

    return { user, tx };
  }

  async credit(params: {
    userId: string;
    points: number;
    title: string;
    site?: string | null;
    type: PointsTransactionType;
  }) {
    if (!Number.isFinite(params.points) || params.points === 0) {
      throw new BadRequestException('Invalid points');
    }
    return this.dataSource.transaction(async (manager) => {
      return this.creditWithManager(manager, params);
    });
  }

  async listForUser(userId: string, limit = 20) {
    const txs = await this.txRepo.find({
      where: { user: { id: userId } },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    return { balance: user.loyaltyPoints, transactions: txs };
  }
}
