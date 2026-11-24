import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

/* AB fork: where login lands. Opens the AB Dashboard of the user's first site, or the site list when there is none. */
export default async function StartPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const site = await db.site.findFirst({
    where: { userId: session.user.id },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  redirect(site ? `/sites/${site.id}/ab/dashboard` : "/sites");
}
