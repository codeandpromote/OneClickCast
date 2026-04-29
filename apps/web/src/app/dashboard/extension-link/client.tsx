"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface KeyRow {
  id: string;
  key_preview: string;
  last_used_at: string | null;
  created_at: string;
}

export function ExtensionLinkClient({ keys: initialKeys }: { keys: KeyRow[] }) {
  const supabase = createClient();
  const [keys, setKeys] = useState<KeyRow[]>(initialKeys);
  const [generating, setGenerating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const generate = async () => {
    setGenerating(true);
    setError(null);
    setNewKey(null);
    const { data, error } = await supabase.rpc("create_extension_api_key");
    setGenerating(false);
    if (error) {
      setError(error.message);
      return;
    }
    if (typeof data === "string") {
      setNewKey(data);
      const { data: refreshed } = await supabase
        .from("extension_api_keys")
        .select("id, key_preview, last_used_at, created_at")
        .order("created_at", { ascending: false });
      setKeys(refreshed ?? []);
    }
  };

  const revoke = async (id: string) => {
    setDeleting(id);
    const { error } = await supabase
      .from("extension_api_keys")
      .delete()
      .eq("id", id);
    setDeleting(null);
    if (error) {
      setError(error.message);
      return;
    }
    setKeys((prev) => prev.filter((k) => k.id !== id));
  };

  const copyKey = async () => {
    if (!newKey) return;
    await navigator.clipboard.writeText(newKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="bg-white border border-slate-200 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-surface-dark">
          Generate a new key
        </h2>
        <p className="text-sm text-surface-muted mt-1 mb-4">
          You'll see the full key once. After that we only store its hash —
          revoke and regenerate if you lose it.
        </p>

        {newKey ? (
          <div className="flex flex-col gap-3">
            <div className="bg-slate-900 text-white font-mono text-sm rounded-lg px-4 py-3 break-all">
              {newKey}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={copyKey}
                className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
              >
                {copied ? "Copied!" : "Copy key"}
              </button>
              <button
                onClick={() => setNewKey(null)}
                className="text-sm text-surface-muted hover:text-surface-dark px-3 py-2"
              >
                Dismiss
              </button>
            </div>
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              Paste this into the OneClickCast extension popup → "Sign in" →
              "Paste your key". You won't see this key again after you leave
              this page.
            </p>
          </div>
        ) : (
          <button
            onClick={generate}
            disabled={generating}
            className="bg-gradient-to-r from-brand-600 to-accent-500 hover:from-brand-700 hover:to-accent-600 text-white font-semibold px-5 py-2.5 rounded-lg transition disabled:opacity-60"
          >
            {generating ? "Generating…" : "Generate new key"}
          </button>
        )}

        {error && (
          <p className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold text-surface-dark mb-3">
          Existing keys
        </h2>
        {keys.length === 0 ? (
          <div className="bg-white border border-dashed border-slate-300 rounded-xl p-8 text-center text-sm text-surface-muted">
            No keys yet. Generate one above to connect your extension.
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-left text-xs uppercase tracking-wide text-surface-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Preview</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3 font-medium">Last used</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr
                    key={k.id}
                    className="border-b border-slate-100 last:border-0"
                  >
                    <td className="px-4 py-3 font-mono text-surface-dark">
                      {k.key_preview}…
                    </td>
                    <td className="px-4 py-3 text-surface-muted">
                      {formatDate(k.created_at)}
                    </td>
                    <td className="px-4 py-3 text-surface-muted">
                      {k.last_used_at ? formatDate(k.last_used_at) : "Never"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => revoke(k.id)}
                        disabled={deleting === k.id}
                        className="text-sm text-red-600 hover:text-red-700 disabled:opacity-60"
                      >
                        {deleting === k.id ? "Revoking…" : "Revoke"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
