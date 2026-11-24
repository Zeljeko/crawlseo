import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { costInWords, ISSUE_TEXT, issueText, WHO_LABEL } from "./display";

describe("ISSUE_TEXT", () => {
  it("has plain words for every IssueType in the Prisma schema", () => {
    const schema = readFileSync(join(__dirname, "..", "..", "prisma", "schema.prisma"), "utf8");
    const block = schema.match(/enum IssueType \{([\s\S]*?)\}/)?.[1] ?? "";
    const types = block.split("\n").map((l) => l.trim().split(/\s/)[0]).filter((t) => /^[A-Z_]+$/.test(t));
    expect(types.length).toBeGreaterThan(10);
    for (const t of types) {
      expect(ISSUE_TEXT[t], t).toBeDefined();
      expect(WHO_LABEL[ISSUE_TEXT[t].who]).toBeTruthy();
    }
  });

  it("falls back to readable words for an unknown type", () => {
    expect(issueText("SOME_NEW_TYPE").title).toBe("some new type");
  });
});

describe("costInWords", () => {
  it("speaks plainly", () => {
    expect(costInWords(0)).toBe("free");
    expect(costInWords(0.004)).toBe("less than 1 cent");
    expect(costInWords(0.07)).toBe("about 7 cents");
    expect(costInWords(0.011)).toBe("about 1 cent");
    expect(costInWords(1.92)).toBe("about $1.92");
  });
});
