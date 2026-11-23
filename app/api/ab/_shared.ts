import { auth } from "@/lib/auth";
import { AbRequestError } from "@/extensions/ab/service";

/** The signed-in user, or null. Actor = email for the audit log. */
export async function currentUser(): Promise<{ id: string; actor: string } | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return { id: session.user.id, actor: session.user.email ?? session.user.id };
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await req.json()) as unknown;
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function errorResponse(error: unknown, what: string): Response {
  if (error instanceof AbRequestError) return Response.json({ error: error.message }, { status: error.status });
  console.error(`[ab] ${what} failed:`, error);
  return Response.json({ error: `${what} failed` }, { status: 500 });
}
