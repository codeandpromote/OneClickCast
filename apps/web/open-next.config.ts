import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({
  // Defaults are good for our app: Cache API for ISR, in-memory queue,
  // KV-less mode (we don't need server-side cache yet).
});
