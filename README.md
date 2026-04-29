# OneClickCast

> Instant browser-based screen sharing. No install needed for viewers — even on mobile.

A free, open-source alternative to CrankWheel. Share your screen via a single link. Your viewer just clicks and watches — no download, no sign-up, on any device.

## Features

- **Zero-install viewer** — works on iOS, Android, any modern browser
- **One-click share** — pick desktop / window / tab → copy link → done
- **Engagement tracking** — see in real time if your viewer is watching
- **Tab remote control** — let your viewer click and type in your shared tab
- **Projector mode** — HD video streaming without stutter
- **Screen + webcam recording** — local recording, MP4 export, animated previews
- **Cross-platform** — Mac, Windows, Linux, ChromeOS sender; any device viewer

## Tech Stack

| Layer | Tech | Hosting |
|---|---|---|
| Browser extension | Manifest V3, React, Vite | Chrome Web Store |
| Viewer + dashboard | Next.js 15, Tailwind, React | Cloudflare Pages |
| Signaling | Cloudflare Workers + Durable Objects | `*.workers.dev` |
| TURN | Metered.ca free tier (or self-hosted coturn) | — |
| Recording storage | Cloudflare R2 | — |
| Database + Auth | Supabase | — |
| Email | Resend | — |

**Total infra cost:** ~$15/year (domain + Chrome Web Store fee). Everything else fits in free tiers.

## Repo Layout

```
oneclickcast/
├── apps/
│   ├── extension/     # Chrome MV3 extension (popup, service worker)
│   ├── web/           # Next.js viewer + dashboard + landing
│   └── signaling/     # Cloudflare Worker (WebSocket signaling)
├── packages/
│   └── shared/        # Shared TS types & helpers
└── .github/workflows/ # CI
```

## Quick Start

```bash
# Prerequisites: Node 20+, pnpm 9+
pnpm install

# Run everything in dev
pnpm dev

# Or run each app separately
pnpm --filter @oneclickcast/extension dev
pnpm --filter @oneclickcast/web dev
pnpm --filter @oneclickcast/signaling dev
```

### Loading the extension in Chrome

1. `pnpm --filter @oneclickcast/extension build`
2. Open `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked" → select `apps/extension/dist`

### Deploying the signaling worker

```bash
cd apps/signaling
npx wrangler login
pnpm deploy
```

### Deploying the web app

```bash
cd apps/web
pnpm build
# Connect repo to Cloudflare Pages, set build command to `pnpm --filter @oneclickcast/web build`
```

## Branding

| Token | Value |
|---|---|
| Primary | `#4F46E5` (Indigo 600) |
| Accent | `#06B6D4` (Cyan 500) |
| Surface dark | `#0F172A` |
| Font | Inter (UI), JetBrains Mono (code) |

## Roadmap

- [x] Phase 0: Monorepo scaffold
- [ ] Phase 1: WebRTC screen-share MVP
- [ ] Phase 2: TURN + reliability
- [ ] Phase 3: Engagement tracking + audio
- [ ] Phase 4: Tab remote control
- [ ] Phase 5: Projector mode
- [ ] Phase 6: Recording + cloud storage
- [ ] Phase 7: Auth + dashboard
- [ ] Phase 8: Polish + Chrome Web Store launch

## License

MIT
