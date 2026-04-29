export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col">
      <nav className="px-6 py-4 flex items-center justify-between border-b border-slate-100">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-600 to-accent-500 flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
              <path d="M8 5L19 12L8 19V5Z" />
            </svg>
          </div>
          <span className="font-bold text-lg">OneClickCast</span>
        </div>
        <div className="flex items-center gap-3">
          <a href="/login" className="text-sm text-surface-muted hover:text-surface-dark transition">
            Sign in
          </a>
          <a href="#" className="btn-primary">Add to Chrome</a>
        </div>
      </nav>

      <section className="flex-1 flex flex-col items-center justify-center px-6 py-20 text-center">
        <span className="px-3 py-1 text-xs font-semibold rounded-full bg-brand-50 text-brand-700 mb-6">
          100% free · No install for viewers
        </span>
        <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight max-w-3xl">
          Share your screen.
          <br />
          <span className="bg-gradient-to-r from-brand-600 to-accent-500 bg-clip-text text-transparent">
            One click. Any device.
          </span>
        </h1>
        <p className="mt-6 text-lg text-surface-muted max-w-xl">
          Send a link. Your viewer sees your screen instantly — no download, no
          sign-up, even on mobile.
        </p>
        <div className="mt-8 flex gap-3">
          <a href="#" className="btn-primary">Add to Chrome — Free</a>
          <a href="#features" className="btn-ghost">See features</a>
        </div>
      </section>

      <section id="features" className="px-6 py-20 bg-slate-50 border-y border-slate-100">
        <div className="max-w-5xl mx-auto grid md:grid-cols-3 gap-6">
          <Feature title="Zero install for viewers" body="Your viewer just clicks a link. Works on phones, tablets, desktops." />
          <Feature title="Engagement tracking" body="See in real time if your viewer is watching or has tabbed away." />
          <Feature title="Record + share" body="Record your screen and webcam. Get a sharable link or download MP4." />
          <Feature title="Remote control" body="Let your viewer click and type in your shared tab." />
          <Feature title="Projector mode" body="Stream HD video without stutter using H.264 hardware encoding." />
          <Feature title="Cross-platform" body="Mac, Windows, Linux, ChromeOS. Viewers on iOS or Android." />
        </div>
      </section>

      <footer className="px-6 py-10 text-center text-sm text-surface-muted">
        © {new Date().getFullYear()} OneClickCast · <a className="hover:underline" href="/privacy">Privacy</a> · <a className="hover:underline" href="/terms">Terms</a>
      </footer>
    </main>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="bg-white rounded-xl p-6 border border-slate-100 shadow-sm">
      <h3 className="font-semibold text-surface-dark">{title}</h3>
      <p className="mt-2 text-sm text-surface-muted">{body}</p>
    </div>
  );
}
