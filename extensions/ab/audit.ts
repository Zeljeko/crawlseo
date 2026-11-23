/*
 * Writes one AbAuditLog row. Call it for every approve, reject and WordPress
 * write (docs/HANDOVER.md, section 6). Never put secrets into `details`.
 */
import type { Prisma, PrismaClient } from "@prisma/client";

export type AuditEntry = {
  /** User email, or "system". */
  actor: string;
  /** e.g. "suggestion.approve", "suggestion.reject", "wp.create_draft". */
  action: string;
  targetType: string;
  targetId: string;
  details?: Prisma.InputJsonValue;
};

export async function logAudit(db: Pick<PrismaClient, "abAuditLog">, entry: AuditEntry): Promise<void> {
  await db.abAuditLog.create({ data: entry });
}
