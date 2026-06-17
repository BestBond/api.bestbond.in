import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Reward, type GiftTier } from './entities/reward.entity';

const LEGACY_TITLES = [
  'Worker Slab Reward - 5,000',
  'Worker Slab Reward - 10,000',
  'Worker Slab Reward - 25,000',
  'Industrial Putty Mixer Machine',
];

const CATALOG: Array<{
  title: string;
  description: string;
  pointsCost: number;
  giftTier: GiftTier;
  imageFile: string;
  sortOrder: number;
}> = [
  {
    title: 'BestBond Steel Bottle',
    description: 'BestBond branded stainless steel water bottle.',
    pointsCost: 500,
    giftTier: 'WORKER',
    imageFile: 'best_bond_bottle.jpeg',
    sortOrder: 3,
  },
  {
    title: 'BestBond Umbrella',
    description: 'BestBond branded umbrella.',
    pointsCost: 500,
    giftTier: 'WORKER',
    imageFile: 'editable_umbrella_design.pdf.pdf',
    sortOrder: 6,
  },
  {
    title: 'Levelling system',
    description: 'Professional levelling system for construction work.',
    pointsCost: 1000,
    giftTier: 'WORKER',
    imageFile: 'levelling_system.png',
    sortOrder: 10,
  },
  {
    title: 'Lifting adjuster',
    description: 'Precision lifting tool for professional construction use.',
    pointsCost: 1000,
    giftTier: 'WORKER',
    imageFile: 'lifting_adjuster.png',
    sortOrder: 20,
  },
  {
    title: 'Rubber mallet',
    description: 'Durable rubber mallet for site work.',
    pointsCost: 1000,
    giftTier: 'WORKER',
    imageFile: 'rubber_mallet.png',
    sortOrder: 30,
  },
  {
    title: 'Three head vaccum puller',
    description: 'Three-head vacuum puller for tile and surface work.',
    pointsCost: 2000,
    giftTier: 'WORKER',
    imageFile: 'three_head_vaccum_puller.png',
    sortOrder: 40,
  },
  {
    title: 'Boat earpodes',
    description: 'Boat wireless earphones reward.',
    pointsCost: 2000,
    giftTier: 'WORKER',
    imageFile: 'boat_earpodes.png',
    sortOrder: 50,
  },
  {
    title: 'Putty Mixer Machine',
    description:
      'Heavy-duty putty mixer for professional finishing work.',
    pointsCost: 5000,
    giftTier: 'WORKER',
    imageFile: 'putty_mixer_machine.png',
    sortOrder: 60,
  },
  {
    title: 'Cutter Machine',
    description: 'Professional cutter machine for site applications.',
    pointsCost: 10000,
    giftTier: 'WORKER',
    imageFile: 'cutter_machine.png',
    sortOrder: 70,
  },
  {
    title: 'Samsung M06',
    description: 'Samsung M06 smartphone reward.',
    pointsCost: 20000,
    giftTier: 'WORKER',
    imageFile: 'samsung_m06.png',
    sortOrder: 80,
  },
  {
    title: 'Samsung Galaxy A35',
    description: 'Samsung Galaxy A35 smartphone reward.',
    pointsCost: 50000,
    giftTier: 'WORKER',
    imageFile: 'samsung_galaxy_a35.png',
    sortOrder: 90,
  },
  {
    title: 'Apple Iphone 15',
    description: 'Apple iPhone 15 reward.',
    pointsCost: 120000,
    giftTier: 'WORKER',
    imageFile: 'iphone_15.png',
    sortOrder: 100,
  },
  {
    title: 'Apple Iphone 17 PRO',
    description: 'Apple iPhone 17 Pro reward.',
    pointsCost: 200000,
    giftTier: 'CONTRACTOR',
    imageFile: 'iphone_17_pro.png',
    sortOrder: 200,
  },
  {
    title: 'Honda Activa 125',
    description: 'Honda Activa 125 scooter reward.',
    pointsCost: 300000,
    giftTier: 'CONTRACTOR',
    imageFile: 'honda_active_125.png',
    sortOrder: 210,
  },
  {
    title: 'Bullet 350 Millitary Black - Base',
    description: 'Royal Enfield Bullet 350 Military Black - Base model.',
    pointsCost: 500000,
    giftTier: 'CONTRACTOR',
    imageFile: 'bullet_350_military_black_1.png',
    sortOrder: 220,
  },
];

@Injectable()
export class RewardsSeeder implements OnModuleInit {
  constructor(
    @InjectRepository(Reward) private readonly repo: Repository<Reward>,
  ) {}

  async onModuleInit() {
    for (const item of CATALOG) {
      await this.upsert({
        title: item.title,
        description: item.description,
        pointsCost: item.pointsCost,
        giftTier: item.giftTier,
        imageUrl: `/gifts/${item.imageFile}`,
        sortOrder: item.sortOrder,
      });
    }

    for (const title of LEGACY_TITLES) {
      await this.deactivateByTitle(title);
    }

    await this.dedupeActiveByTitle();
  }

  /** Keep one active row per title (race-safe duplicate cleanup). */
  private async dedupeActiveByTitle() {
    const active = await this.repo.find({
      where: { isActive: true },
      order: { title: 'ASC', createdAt: 'ASC' },
    });
    const seen = new Set<string>();
    for (const row of active) {
      const key = row.title.trim().toLowerCase();
      if (seen.has(key)) {
        row.isActive = false;
        await this.repo.save(row);
        continue;
      }
      seen.add(key);
    }
  }

  private async upsert(params: {
    title: string;
    description: string | null;
    pointsCost: number;
    giftTier: GiftTier;
    imageUrl: string | null;
    sortOrder: number;
  }) {
    const existing = await this.repo.findOne({
      where: { title: params.title },
    });
    if (existing) {
      existing.description = params.description;
      existing.pointsCost = params.pointsCost;
      existing.giftTier = params.giftTier;
      existing.imageUrl = params.imageUrl;
      existing.sortOrder = params.sortOrder;
      existing.isActive = true;
      await this.repo.save(existing);
      return;
    }
    await this.repo.save(
      this.repo.create({
        title: params.title,
        description: params.description,
        pointsCost: params.pointsCost,
        giftTier: params.giftTier,
        imageUrl: params.imageUrl,
        sortOrder: params.sortOrder,
        isActive: true,
      }),
    );
  }

  private async deactivateByTitle(title: string) {
    const existing = await this.repo.findOne({ where: { title } });
    if (!existing) return;
    existing.isActive = false;
    await this.repo.save(existing);
  }
}
