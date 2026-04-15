/**
 * Cron job reconciliation and system event token matching utilities.
 *
 * Extracted from register() for testability. Token matching mirrors
 * memory-core's includesSystemEventToken() from dreaming-shared.ts.
 */

// -- Token matching --

export function normalizeTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function includesSystemEventToken(cleanedBody: string, eventText: string): boolean {
  const normalizedBody = normalizeTrimmedString(cleanedBody);
  const normalizedEventText = normalizeTrimmedString(eventText);
  if (!normalizedBody || !normalizedEventText) return false;
  if (normalizedBody === normalizedEventText) return true;
  return normalizedBody.split(/\r?\n/).some((line) => line.trim() === normalizedEventText);
}

// -- Cron reconciliation --

export interface DesiredCronJob {
  name: string;
  description: string;
  enabled: boolean;
  schedule: { kind: "cron"; expr: string };
  sessionTarget: string;
  wakeMode: string;
  payload: { kind: "systemEvent"; text: string };
}

export interface CronService {
  add(job: DesiredCronJob): Promise<void>;
  update(id: string, patch: Record<string, unknown>): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface CronLogger {
  info(msg: string): void;
  warn(msg: string): void;
}

/**
 * Reconcile a single managed cron job: create if missing, update if drifted, prune duplicates.
 * Identifies managed jobs by description tag OR matching name + payload text.
 * Sorts by createdAtMs for deterministic primary selection.
 */
export async function reconcileCronJob(
  cron: CronService,
  allJobs: any[],
  desired: DesiredCronJob,
  tag: string,
  logger: CronLogger,
): Promise<void> {
  const managed = allJobs
    .filter(
      (j: any) =>
        j.description?.includes(tag) ||
        (j.name === desired.name && j.payload?.text === desired.payload.text),
    )
    .sort((a: any, b: any) => (a.createdAtMs ?? Number.MAX_SAFE_INTEGER) - (b.createdAtMs ?? Number.MAX_SAFE_INTEGER));

  if (managed.length === 0) {
    await cron.add(desired);
    logger.info(`Registered cron job: ${desired.name}`);
    return;
  }

  const primary = managed[0];
  const needsUpdate =
    primary.name !== desired.name ||
    primary.description !== desired.description ||
    primary.schedule?.expr !== desired.schedule.expr ||
    primary.wakeMode !== desired.wakeMode ||
    primary.enabled !== desired.enabled ||
    primary.payload?.text !== desired.payload.text ||
    primary.payload?.kind !== desired.payload.kind ||
    primary.sessionTarget !== desired.sessionTarget;

  if (needsUpdate) {
    await cron.update(primary.id, {
      name: desired.name,
      description: desired.description,
      schedule: desired.schedule,
      wakeMode: desired.wakeMode,
      enabled: desired.enabled,
      payload: desired.payload,
      sessionTarget: desired.sessionTarget,
    });
    logger.info(`Updated cron job: ${desired.name}`);
  }

  // Prune duplicates (best-effort, one failure doesn't block the rest)
  for (let i = 1; i < managed.length; i++) {
    try {
      await cron.remove(managed[i].id);
    } catch (err) {
      logger.warn(`Failed to remove duplicate cron job ${managed[i].id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
