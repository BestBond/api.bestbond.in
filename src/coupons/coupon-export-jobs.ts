import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type CouponExportJobStatus =
  | 'queued'
  | 'processing'
  | 'zipping'
  | 'ready'
  | 'failed';

export type CouponExportJobPhase = 'generating' | 'zipping' | 'ready' | 'failed';

export interface CouponExportJob {
  id: string;
  batchId: string;
  totalCoupons: number;
  processedCoupons: number;
  volumeCount: number;
  processedVolumes: number;
  status: CouponExportJobStatus;
  phase: CouponExportJobPhase;
  error?: string;
  zipPath?: string;
  workDir: string;
  createdAt: Date;
  completedAt?: Date;
}

const jobs = new Map<string, CouponExportJob>();
const batchActiveJobs = new Map<string, string>();
const JOB_FILE = 'job.json';

function jobFilePath(workDir: string): string {
  return path.join(workDir, JOB_FILE);
}

function batchExportRoot(batchId: string): string {
  return path.join(os.tmpdir(), 'coupon-export', batchId);
}

function hydrateJob(raw: Record<string, unknown>): CouponExportJob {
  return {
    id: String(raw.id),
    batchId: String(raw.batchId),
    totalCoupons: Number(raw.totalCoupons),
    processedCoupons: Number(raw.processedCoupons ?? 0),
    volumeCount: Number(raw.volumeCount),
    processedVolumes: Number(raw.processedVolumes ?? 0),
    status: raw.status as CouponExportJobStatus,
    phase: (raw.phase as CouponExportJobPhase) ?? 'generating',
    error: raw.error ? String(raw.error) : undefined,
    zipPath: raw.zipPath ? String(raw.zipPath) : undefined,
    workDir: String(raw.workDir),
    createdAt: new Date(String(raw.createdAt)),
    completedAt: raw.completedAt ? new Date(String(raw.completedAt)) : undefined,
  };
}

function registerJob(job: CouponExportJob): void {
  jobs.set(job.id, job);
  if (job.status === 'queued' || job.status === 'processing' || job.status === 'zipping') {
    batchActiveJobs.set(job.batchId, job.id);
  }
}

export function loadJobFromDisk(workDir: string): CouponExportJob | null {
  try {
    const p = jobFilePath(workDir);
    if (!fs.existsSync(p)) return null;
    return hydrateJob(JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>);
  } catch {
    return null;
  }
}

function persistJob(job: CouponExportJob): void {
  fs.mkdirSync(job.workDir, { recursive: true });
  fs.writeFileSync(
    jobFilePath(job.workDir),
    JSON.stringify({
      ...job,
      createdAt: job.createdAt.toISOString(),
      completedAt: job.completedAt?.toISOString() ?? null,
    }),
  );
}

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
  return 200;
}

export function findJobForBatch(batchId: string, jobId: string): CouponExportJob | undefined {
  const cached = jobs.get(jobId);
  if (cached && cached.batchId === batchId) return cached;

  const workDir = path.join(batchExportRoot(batchId), jobId);
  const fromDisk = loadJobFromDisk(workDir);
  if (fromDisk && fromDisk.batchId === batchId) {
    registerJob(fromDisk);
    return fromDisk;
  }
  return undefined;
}

export function findResumableJobForBatch(batchId: string): CouponExportJob | null {
  const root = batchExportRoot(batchId);
  if (!fs.existsSync(root)) return null;

  let best: CouponExportJob | null = null;
  for (const entry of fs.readdirSync(root)) {
    const workDir = path.join(root, entry);
    if (!fs.statSync(workDir).isDirectory()) continue;
    const job = loadJobFromDisk(workDir);
    if (!job) continue;
    registerJob(job);

    if (job.status === 'ready' && job.zipPath && fs.existsSync(job.zipPath)) {
      return job;
    }
    if (
      job.status === 'queued' ||
      job.status === 'processing' ||
      job.status === 'zipping' ||
      (job.status === 'failed' && job.processedVolumes > 0)
    ) {
      if (!best || job.processedVolumes > best.processedVolumes) {
        best = job;
      }
    }
  }
  return best;
}

export function listIncompleteJobs(): CouponExportJob[] {
  const root = path.join(os.tmpdir(), 'coupon-export');
  if (!fs.existsSync(root)) return [];

  const incomplete: CouponExportJob[] = [];
  for (const batchId of fs.readdirSync(root)) {
    const batchDir = path.join(root, batchId);
    if (!fs.statSync(batchDir).isDirectory()) continue;
    for (const jobId of fs.readdirSync(batchDir)) {
      const workDir = path.join(batchDir, jobId);
      if (!fs.statSync(workDir).isDirectory()) continue;
      const job = loadJobFromDisk(workDir);
      if (!job) continue;
      if (job.status === 'queued' || job.status === 'processing' || job.status === 'zipping') {
        registerJob(job);
        incomplete.push(job);
      }
    }
  }
  return incomplete;
}

export function createCouponExportJob(params: {
  batchId: string;
  totalCoupons: number;
}): CouponExportJob {
  const resumable = findResumableJobForBatch(params.batchId);
  if (resumable) {
    if (resumable.status === 'ready') return resumable;
    if (resumable.status === 'failed') {
      updateCouponExportJob(resumable.id, {
        status: 'processing',
        phase: 'generating',
        error: undefined,
      });
    }
    return resumable;
  }

  const existingId = batchActiveJobs.get(params.batchId);
  if (existingId) {
    const existing = jobs.get(existingId);
    if (
      existing &&
      (existing.status === 'queued' ||
        existing.status === 'processing' ||
        existing.status === 'zipping')
    ) {
      return existing;
    }
  }

  const id = randomUUID();
  const workDir = path.join(batchExportRoot(params.batchId), id);
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
    phase: 'generating',
    workDir,
    createdAt: new Date(),
  };

  registerJob(job);
  persistJob(job);
  return job;
}

export function getCouponExportJob(jobId: string): CouponExportJob | undefined {
  return jobs.get(jobId);
}

export function getCouponExportJobForBatch(
  batchId: string,
  jobId: string,
): CouponExportJob | undefined {
  return findJobForBatch(batchId, jobId);
}

export function updateCouponExportJob(
  jobId: string,
  patch: Partial<
    Pick<
      CouponExportJob,
      | 'status'
      | 'phase'
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
  persistJob(job);
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

  let fileSizeBytes: number | null = null;
  if (job.status === 'ready' && job.zipPath && fs.existsSync(job.zipPath)) {
    try {
      fileSizeBytes = fs.statSync(job.zipPath).size;
    } catch {
      fileSizeBytes = null;
    }
  }

  return {
    jobId: job.id,
    batchId: job.batchId,
    status: job.status,
    phase: job.phase,
    totalCoupons: job.totalCoupons,
    processedCoupons: job.processedCoupons,
    volumeCount: job.volumeCount,
    processedVolumes: job.processedVolumes,
    progressPct,
    fileSizeBytes,
    error: job.error ?? null,
    ready: job.status === 'ready',
    failed: job.status === 'failed',
    createdAt: job.createdAt.toISOString(),
    completedAt: job.completedAt?.toISOString() ?? null,
  };
}

const exportDownloadTokens = new Map<
  string,
  { batchId: string; jobId: string; expiresAt: number }
>();

/** Short-lived token so the browser can stream large ZIPs without loading into memory. */
export function issueExportDownloadToken(
  batchId: string,
  jobId: string,
): string {
  const token = randomUUID();
  exportDownloadTokens.set(token, {
    batchId,
    jobId,
    expiresAt: Date.now() + 30 * 60 * 1000,
  });
  return token;
}

export function resolveExportDownloadToken(
  token: string,
): { batchId: string; jobId: string } | null {
  const entry = exportDownloadTokens.get(token);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    exportDownloadTokens.delete(token);
    return null;
  }
  return { batchId: entry.batchId, jobId: entry.jobId };
}

export function volumePartName(vol: number, volumeCount: number): string {
  return `coupons-${String(vol + 1).padStart(3, '0')}-of-${String(volumeCount).padStart(3, '0')}.pdf`;
}
