import { db } from "@/lib/db";
import { decideSuggestion } from "@/extensions/ab/service";
import { currentUser, errorResponse, readJson } from "../../_shared";

// Approving a page draft waits for WordPress (30 s timeout in the client).
export const maxDuration = 60;

/** Approve or reject a suggestion. Approving a new page creates a WordPress draft. */
export async function POST(req: Request, { params }: { params: Promise<{ suggestionId: string }> }) {
  try {
    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const { suggestionId } = await params;
    const body = await readJson(req);
    const result = await decideSuggestion(db, { suggestionId, userId: user.id, actor: user.actor, decision: body.decision });
    return Response.json(result);
  } catch (error) {
    return errorResponse(error, "Decision");
  }
}
