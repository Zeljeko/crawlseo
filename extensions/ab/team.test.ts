import { beforeEach, describe, expect, it, vi } from "vitest";
import { isAllowedEmail, isSharedGuest, teamConfig, workspaceUserId } from "./team";

const env = { AB_TEAM_OWNER_EMAIL: "Owner@ab.test", AB_TEAM_EMAILS: "boss@ab.test, owner@ab.test" };

beforeEach(() => {
  delete (globalThis as { abTeamOwnerId?: unknown }).abTeamOwnerId;
});

describe("team config", () => {
  it("is off without env, so sign-in works as upstream", () => {
    expect(teamConfig({})).toBeNull();
    expect(isAllowedEmail("anyone@x.test", {})).toBe(true);
    expect(isSharedGuest("anyone@x.test", {})).toBe(false);
  });

  it("allows only the listed emails, case-insensitive, owner included", () => {
    expect(isAllowedEmail("BOSS@ab.test", env)).toBe(true);
    expect(isAllowedEmail("owner@ab.test", env)).toBe(true);
    expect(isAllowedEmail("intern@ab.test", env)).toBe(false);
    expect(isAllowedEmail(null, env)).toBe(false);
  });

  it("treats teammates, not the owner, as guests", () => {
    expect(isSharedGuest("boss@ab.test", env)).toBe(true);
    expect(isSharedGuest("owner@ab.test", env)).toBe(false);
    expect(isSharedGuest("intern@ab.test", env)).toBe(false);
  });
});

describe("workspaceUserId", () => {
  const db = { user: { findUnique: vi.fn().mockResolvedValue({ id: "owner-id" }) } };

  it("gives a teammate the owner's id", async () => {
    expect(await workspaceUserId(db as never, "boss@ab.test", "boss-id", env)).toBe("owner-id");
    expect(db.user.findUnique).toHaveBeenCalledWith({ where: { email: "owner@ab.test" }, select: { id: true } });
  });

  it("keeps the owner's and outsiders' own ids", async () => {
    expect(await workspaceUserId(db as never, "owner@ab.test", "own", env)).toBe("own");
    expect(await workspaceUserId(db as never, "x@y.test", "own", {})).toBe("own");
  });

  it("falls back to the own id until the owner has signed in", async () => {
    const empty = { user: { findUnique: vi.fn().mockResolvedValue(null) } };
    expect(await workspaceUserId(empty as never, "boss@ab.test", "boss-id", env)).toBe("boss-id");
  });
});
