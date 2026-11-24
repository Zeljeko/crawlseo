import type { PrismaClient } from "@prisma/client";

/*
 * AB fork: one shared workspace for the team.
 *
 * crawlseo gives every user their own sites. AB wants one workspace: the owner
 * (AB_TEAM_OWNER_EMAIL) holds the sites, and every teammate signs in with
 * their own Google account but works in the owner's workspace. The session
 * keeps each person's own email, so the audit log still records who did what.
 *
 * Who is a teammate:
 * - AB_TEAM_EMAILS set (comma-separated): only those people may sign in.
 * - Unset (the current choice): anyone with the owner's email domain
 *   (@ab-businesssupport.com). Other domains are refused, also if the Google
 *   consent screen is ever switched from Internal to External.
 * With neither variable set the app behaves like upstream crawlseo.
 */

type Env = Record<string, string | undefined>;
type Team = { owner: string; members: Set<string> | null; domain: string | null };

function norm(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

function domainOf(email: string): string | null {
  const at = email.lastIndexOf("@");
  return at > 0 ? email.slice(at + 1) : null;
}

export function teamConfig(env: Env = process.env): Team | null {
  const owner = norm(env.AB_TEAM_OWNER_EMAIL);
  const list = (env.AB_TEAM_EMAILS ?? "").split(/[,\s]+/).map(norm).filter(Boolean);
  if (!owner && list.length === 0) return null;
  if (list.length === 0) return { owner, members: null, domain: domainOf(owner) };
  const members = new Set(list);
  if (owner) members.add(owner);
  return { owner, members, domain: null };
}

function isMember(team: Team, email: string): boolean {
  if (!email) return false;
  if (team.members) return team.members.has(email);
  return team.domain !== null && domainOf(email) === team.domain;
}

/** May this Google account sign in? True when no team is configured. */
export function isAllowedEmail(email: string | null | undefined, env: Env = process.env): boolean {
  const team = teamConfig(env);
  if (!team) return true;
  return isMember(team, norm(email));
}

/** A teammate working in the owner's workspace (not the owner). */
export function isSharedGuest(email: string | null | undefined, env: Env = process.env): boolean {
  const team = teamConfig(env);
  if (!team?.owner) return false;
  const e = norm(email);
  return e !== team.owner && isMember(team, e);
}

const cache = globalThis as unknown as { abTeamOwnerId?: { email: string; id: string } };

/**
 * The user id a session works as: the owner's id for a teammate, the person's
 * own id otherwise (also while the owner has not signed in yet).
 */
export async function workspaceUserId(
  db: Pick<PrismaClient, "user">,
  email: string | null | undefined,
  ownId: string,
  env: Env = process.env
): Promise<string> {
  if (!isSharedGuest(email, env)) return ownId;
  const owner = teamConfig(env)!.owner;
  if (cache.abTeamOwnerId?.email === owner) return cache.abTeamOwnerId.id;
  const row = await db.user.findUnique({ where: { email: owner }, select: { id: true } });
  if (!row) return ownId;
  cache.abTeamOwnerId = { email: owner, id: row.id };
  return row.id;
}

export const OWNER_ONLY_MESSAGE = "Only the workspace owner can do this. The data here is shared by the team.";
