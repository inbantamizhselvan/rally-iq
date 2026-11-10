# 🎾 Rally IQ — realistic tennis strategy game

An original tennis game where you win by **thinking like a tennis player**. Free iPhone app (Progressive Web App): no App Store, no Apple developer account.

- **Realistic physics**: topspin dips and kicks, slice stays low, flat is fast but low over the net, lobs and drop shots behave like real ones. The net is higher at the sides. Players have real running speed, reaction time and reach.
- **You make every decision**: shot type, where to aim, when to come to the net, serve type and placement. Mistakes come from the real causes: aiming at lines, hitting flat, being stretched.
- **8 fictional opponents, 8 lessons**: consistency, finding the weakness, beating a pusher, absorbing pace, lefty patterns, passing a net rusher, handling moonballs, and a final boss.
- **Coach after every point** plus a **Strategy IQ** grade per match. **Learn mode** (the ball waits for you) or **Pro mode** (decide in real time).

## Put it on the iPhone (free)
1. Host this folder on any free HTTPS static host (GitHub Pages, Cloudflare Pages or Netlify).
2. On the iPhone open the link in **Safari**, then tap Share, then **Add to Home Screen**. It runs full-screen and offline.

## Run / test locally
```
python -m http.server 8766          # open http://localhost:8766
node tests/realism.test.js          # physics + AI-vs-AI realism checks
node tests/scoring.test.js          # tennis scoring rules
```
