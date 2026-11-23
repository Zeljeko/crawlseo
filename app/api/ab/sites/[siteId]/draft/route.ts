import { db } from "@/lib/db";
import { dispatchJob } from "@/lib/jobs/dispatch";
import { requestPageDraft } from "@/extensions/ab/service";
import { currentUser, errorResponse, readJson } from "../../../_shared";

// On Vercel the AI job runs after the response, within this limit.
export const maxDuration = 300;

/** Queues an AI service page draft. One at a time per site. */
export async function POST(req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  try {
    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const { siteId } = await params;
    const body = await readJson(req);
    const { job, created } = await requestPageDraft(db, { siteId, userId: user.id, actor: user.actor, topic: body.topic });
    dispatchJob(db, job);
    return Response.json({ jobId: job.id, alreadyRunning: !created }, { status: 202 });
  } catch (error) {
    return errorResponse(error, "Page draft");
  }
}
