import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type CouponExportJobStatus =
  | 'queued'
  | 'processing'
  | 'ready'
  | 'failed';

export interface CouponExportJob {
  id: string;
  batchId: string;
  totalCoupons: number;
  processedCoupons: number;
  volumeCount: number;
  processedVolumes: number;
  status: CouponExportJobStatus;
  error?: string;
  zipPath?: string;
  workDir: string;
  createdAt: Date;
  completedAt?: Date;
}

const jobs = new Map<string, CouponExportJob>();
const batchActiveJobs = new Map<string, string>();

export function couponExportSyncMax(): number {
  const raw = process.env.COUPON_EXPORT_SYNC_MAX;
  if (raw) {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 300;
}

export function couponExportVolumeSize(): number {
  const raw = process.env.COUPON_EXPORT_VOLUME_SIZE;
  if (raw) {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 500;
}

export function createCouponExportJob(params: {
  batchId: string;
  totalCoupons: number;
}): CouponExportJob {
  const existingId = batchActiveJobs.get(params.batchId);
  if (existingId) {
    const existing = jobs.get(existingId);
    if (
      existing &&
      (existing.status === 'queued' || existing.status === 'processing')
    ) {
      return existing;
    }
  }

  const id = randomUUID();
  const workDir = path.join(os.tmpdir(), 'coupon-export', params.batchId, id);
  fs.mkdirSync(workDir, { recursive: true });

  const volumeCount = Math.ceil(
    params.totalCoupons / couponExportVolumeSize(),
  );

  const job: CouponExportJob = {
    id,
    batchId: params.batchId,
    totalCoupons: params.totalCoupons,
    processedCoupons: 0,
    volumeCount,
    processedVolumes: 0,
    status: 'queued',
    workDir,
    createdAt: new Date(),
  };

  jobs.set(id, job);
  batchActiveJobs.set(params.batchId, id);
  return job;
}

export function getCouponExportJob(jobId: string): CouponExportJob | undefined {
  return jobs.get(jobId);
}

export function getCouponExportJobForBatch(
  batchId: string,
  jobId: string,
): CouponExportJob | undefined {
  const job = jobs.get(jobId);
  if (!job || job.batchId !== batchId) return undefined;
  return job;
}

export function updateCouponExportJob(
  jobId: string,
  patch: Partial<
    Pick<
      CouponExportJob,
      | 'status'
      | 'processedCoupons'
      | 'processedVolumes'
      | 'error'
      | 'zipPath'
      | 'completedAt'
    >
  >,
): void {
  const job = jobs.get(jobId);
  if (!job) return;
  Object.assign(job, patch);
  if (patch.status === 'ready' || patch.status === 'failed') {
    if (batchActiveJobs.get(job.batchId) === jobId) {
      batchActiveJobs.delete(job.batchId);
    }
  }
}

export function couponExportJobToStatus(job: CouponExportJob) {
  const progressPct =
    job.totalCoupons > 0
      ? Math.min(
          100,
          Math.round((job.processedCoupons / job.totalCoupons) * 100),
        )
      : 0;
  return {
    jobId: job.id,
    batchId: job.batchId,
    status: job.status,
    totalCoupons: job.totalCoupons,
    processedCoupons: job.processedCoupons,
    volumeCount: job.volumeCount,
    processedVolumes: job.processedVolumes,
    progressPct,
    error: job.error ?? null,
    ready: job.status === 'ready',
    failed: job.status === 'failed',
    createdAt: job.createdAt.toISOString(),
    completedAt: job.completedAt?.toISOString() ?? null,
  };
}
