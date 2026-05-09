import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Reward } from './entities/reward.entity';

@Injectable()
export class RewardsSeeder implements OnModuleInit {
  constructor(
    @InjectRepository(Reward) private readonly repo: Repository<Reward>,
  ) {}

  async onModuleInit() {
    // Slab rewards for worker redemption flow.
    await this.upsert({
      title: 'Worker Slab Reward - 5,000',
      description:
        'Standard redemption slab for workers.',
      pointsCost: 5000,
      imageUrl: null,
    });
    await this.upsert({
      title: 'Worker Slab Reward - 10,000',
      description: 'Mid-tier redemption slab for workers.',
      pointsCost: 10000,
      imageUrl: null,
    });
    await this.upsert({
      title: 'Worker Slab Reward - 25,000',
      description: 'High-tier redemption slab for workers.',
      pointsCost: 25000,
      imageUrl: null,
    });
    // Additional catalog entries (kept for admin previews/testing).
    await this.upsert({
      title: 'Industrial Putty Mixer Machine',
      description:
        'Heavy-duty 50L capacity professional grade motor with variable speed control and stainless steel construction.',
      pointsCost: 8500,
      imageUrl: null,
    });
  }

  private async upsert(params: {
    title: string;
    description: string | null;
    pointsCost: number;
    imageUrl: string | null;
  }) {
    const existing = await this.repo.findOne({
      where: { title: params.title },
    });
    if (existing) {
      existing.description = params.description;
      existing.pointsCost = params.pointsCost;
      existing.imageUrl = params.imageUrl;
      existing.isActive = true;
      await this.repo.save(existing);
      return;
    }
    await this.repo.save(
      this.repo.create({
        title: params.title,
        description: params.description,
        pointsCost: params.pointsCost,
        imageUrl: params.imageUrl,
        isActive: true,
      }),
    );
  }
}
