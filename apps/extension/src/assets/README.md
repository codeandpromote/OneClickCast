# Extension Icons

Place the following PNG icons here before building:

- `icon-16.png` — 16×16
- `icon-32.png` — 32×32
- `icon-48.png` — 48×48
- `icon-128.png` — 128×128

Logo concept: rounded square with indigo→cyan gradient (#4F46E5 → #06B6D4) and a white play triangle centered. Generate from the SVG below or use a tool like https://realfavicongenerator.net/.

```svg
<svg width="128" height="128" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#4F46E5"/>
      <stop offset="100%" stop-color="#06B6D4"/>
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="28" fill="url(#g)"/>
  <path d="M48 38L92 64L48 90V38Z" fill="white"/>
</svg>
```
