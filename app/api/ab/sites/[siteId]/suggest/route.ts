import { db } from "@/lib/db";
import { dispatchJob } from "@/lib/jobs/dispatch";
import { requestSuggestFix } from "@/extensions/ab/service";
import { currentUser, errorResponse, readJson } from "../../../_shared";

// On Vercel the AI job runs after the response, within this limit.
export const maxDuration = 300;

/** Queues an AI title or meta description suggestion for one crawled page. */
export async function POST(req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  try {
    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const { siteId } = await params;
    const body = await readJson(req);
    const result = await requestSuggestFix(db, {
      siteId,
      userId: user.id,
      actor: user.actor,
      pageUrl: body.pageUrl,
      field: body.field,
      issueRef: body.issueRef,
    });
    if ("existingSuggestionId" in result) {
      return Response.json({ suggestionId: result.existingSuggestionId, alreadyPending: true });
    }
    dispatchJob(db, result.job);
    return Response.json({ jobId: result.job.id }, { status: 202 });
  } catch (error) {
    return errorResponse(error, "Suggest fix");
  }
}
