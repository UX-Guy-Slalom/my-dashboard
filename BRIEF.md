# My Links - Project Brief
A personal link-in-bio page. One page, clean design, mobile first.
I want to send people here from my social profiles.

## Tech
- Pure HTML, CSS and JavaScript - no frameworks, no build tools
- Single index.html file (CSS and JS can be in separate files)
- Deploys to Vercel as a static site

## Design
- Centered card layout, max-width 480px
- My name as a heading, short bio underneath
- Profile photo placeholder (circle, 120px)
- Dark mode by default with a light/dark toggle
- Smooth hover animations on the link buttons
- Google Font: Inter
- Use orange and yellow gradients in light mode, purple and blue in dark

## Links
Display these as stacked buttons, full-width within the card:
- Portfolio
- LinkedIn (https://linkedin.com/in/jasonvail)
- Ko-Fi (https://ko-fi.com/theuxguy)
- Discord (@theuxguy)
- Email (mailto:jason.vail@gmail.com)

## Nice to have
- Subtle gradient or animated background 
- Link buttons have icons (use simple SVG or emoji)
- Footer with "Made with Ko-Fi and Copilot"

## Background Animation
The background has two layers:
1. **Gradient** — slow-moving animated gradient (dark: purple/blue; light: orange/yellow). The gradient position drifts diagonally through a 4-point loop on a 30s cycle, with a gentle hue-rotate overlay on a 60s cycle, giving the colours a subtle breathing quality.
2. **Physics blobs** — three soft, blurred colour blobs driven by a JavaScript physics simulation (no CSS keyframes):
   - Blobs have a small hard-core collision radius (~60–80 px) representing actual mass. The visual blob is much larger (300–500 px), so the halos overlap softly before cores bounce.
   - Movement is slow and weighty (18–28 px/s), with no friction — blobs drift indefinitely.
   - Elastic collisions: blobs bounce off screen edges, off each other, and off the content card.
   - **Squash & stretch**: blobs elongate slightly (~8%) along their direction of travel and squash (~15%) on impact, recovering smoothly over ~450 ms — perceptible but not distracting.
   - Respects `prefers-reduced-motion`: physics loop does not start if the user has reduced motion enabled.