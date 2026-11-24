import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export default async function Home() {
  const session = await auth();
  redirect(session ? "/start" : "/login"); // AB fork: /start opens the AI Optimizer
}
