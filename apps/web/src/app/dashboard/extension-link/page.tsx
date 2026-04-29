import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ExtensionLinkClient } from "./client";

export default async function ExtensionLinkPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard/extension-link");

  const { data: keys } = await supabase
    .from("extension_api_keys")
    .select("id, key_preview, last_used_at, created_at")
    .order("created_at", { ascending: false });

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h1 className="text-2xl font-bold text-surface-dark">Connect extension</h1>
        <p className="text-sm text-surface-muted mt-1">
          Generate an API key, then paste it into the OneClickCast Chrome
          extension to link it to your account.
        </p>
      </section>

      <ExtensionLinkClient keys={keys ?? []} />
    </div>
  );
}
