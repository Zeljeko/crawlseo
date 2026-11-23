"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { waitForJob } from "@/lib/jobs/client";

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, data };
}

/** Waits for a queued AI job, then reloads the page data. Returns an error message or null. */
async function runJob(jobId: string): Promise<string | null> {
  const job = await waitForJob(jobId);
  if (job.status === "SUCCEEDED") return null;
  return job.lastError ?? "The AI job did not finish. Try again.";
}

function ErrorText({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="alert" className="mt-1.5 text-[12px] text-danger">
      {text}
    </p>
  );
}

export function SuggestButton({ siteId, pageUrl, field, label }: { siteId: string; pageUrl: string; field: "title" | "meta_description"; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setBusy(true);
    setError(null);
    try {
      const { ok, data } = await postJson(`/api/ab/sites/${siteId}/suggest`, { pageUrl, field });
      if (!ok) throw new Error(String(data.error ?? "Request failed"));
      if (typeof data.jobId === "string") {
        const failed = await runJob(data.jobId);
        if (failed) throw new Error(failed);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Button size="xs" variant="outline" onClick={onClick} disabled={busy}>
        <Sparkles />
        {busy ? "Writing..." : label}
      </Button>
      <ErrorText text={error} />
    </div>
  );
}

export function DraftForm({ siteId, topics }: { siteId: string; topics: readonly string[] }) {
  const router = useRouter();
  const [topic, setTopic] = useState<string>(topics[0] ?? "");
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = topic === "custom" ? custom.trim() : topic;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { ok, data } = await postJson(`/api/ab/sites/${siteId}/draft`, { topic: chosen });
      if (!ok) throw new Error(String(data.error ?? "Request failed"));
      const failed = await runJob(String(data.jobId));
      if (failed) throw new Error(failed);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {[...topics, "custom"].map((t) => (
          <label
            key={t}
            className={`cursor-pointer rounded-md border px-3 py-2 text-[13px] ${topic === t ? "border-text-strong bg-bg-section text-text-strong" : "border-border text-text"}`}
          >
            <input type="radio" name="topic" value={t} checked={topic === t} onChange={() => setTopic(t)} className="sr-only" />
            {t === "custom" ? "Other topic" : t}
          </label>
        ))}
      </div>
      {topic === "custom" && (
        <input
          type="text"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          maxLength={80}
          placeholder="For example: Back-office Support for Retail"
          className="h-[38px] max-w-[420px] rounded-md border border-border bg-bg px-3 text-[14px]"
        />
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy || !chosen}>
          <Sparkles />
          {busy ? "Writing the page..." : "Write page draft"}
        </Button>
        {busy && <span className="text-[13px] text-muted-foreground">Takes about 1 to 2 minutes. Keep this tab open.</span>}
      </div>
      <ErrorText text={error} />
    </form>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="xs"
      variant="outline"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      <Copy />
      {copied ? "Copied" : label}
    </Button>
  );
}

export function DecisionButtons({ suggestionId, isNewPage }: { suggestionId: string; isNewPage: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "approve" | "reject") {
    setBusy(decision);
    setError(null);
    try {
      const { ok, data } = await postJson(`/api/ab/suggestions/${suggestionId}`, { decision });
      if (!ok) throw new Error(String(data.error ?? "Request failed"));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <Button size="lg" onClick={() => decide("approve")} disabled={busy !== null}>
          <Check />
          {busy === "approve" ? (isNewPage ? "Sending to WordPress..." : "Approving...") : isNewPage ? "Approve: save as WordPress draft" : "Approve"}
        </Button>
        <Button size="lg" variant="outline" onClick={() => decide("reject")} disabled={busy !== null}>
          <X />
          Reject
        </Button>
      </div>
      <ErrorText text={error} />
    </div>
  );
}
