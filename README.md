# NYC Pulse

> A weekly generative art piece made from New York City's top rising Google searches.
> Mood named by a human. Constellation drawn by p5.js. Zero manual work after setup.

---

## How it works

```
GitHub Actions (every Monday 6am EST)
  → scripts/fetch_trends.py
      → pulls rising NYC searches via pytrends (geo: US-NY-501)
      → writes public/data.json + public/archive/issues.json
  → commits & pushes to GitHub
      → Cloudflare Pages auto-deploys in ~30 seconds
```

---

## Setup (one time)

### 1. Put files in a GitHub repo
Push this entire folder to a new GitHub repo.

### 2. Connect to Cloudflare Pages
- Go to pages.cloudflare.com → New Project → Connect Git
- Select your repo
- Build settings: Framework = None, Build command = blank, Output = `public`
- Deploy

### 3. That's it
GitHub Actions runs every Monday automatically using the built-in GITHUB_TOKEN.
No secrets, no API keys, no configuration needed.

### 4. Test locally
```bash
pip install -r requirements.txt
python scripts/fetch_trends.py      # populates real data.json
python -m http.server 8000 --directory public
# open http://localhost:8000
```

---

## Editing the color palette

**Category colors** → edit `CATEGORY_COLORS` in `scripts/fetch_trends.py`
Changes flow automatically into the legend, stars, edges, and tooltip via data.json.

| Category  | Default   |
|-----------|-----------|
| food      | `#5DCAA5` |
| fashion   | `#F0997B` |
| home      | `#AFA9EC` |
| wellness  | `#85B7EB` |
| beauty    | `#ED93B1` |
| travel    | `#EF9F27` |

**Canvas / sky colors** → edit constants at the top of `public/sketch.js`
Every constant is labeled. Sky background, star opacity, drift speed, glow rings — all tuneable.

---

## Editing keywords

Edit `CATEGORIES` in `scripts/fetch_trends.py`. Add or remove any search terms.
The script keeps the top 6 per category by score and drops anything below 5.

---

## File structure

```
nyc-pulse/
├── .github/workflows/weekly.yml   ← runs every Monday
├── public/
│   ├── index.html                 ← the site
│   ├── sketch.js                  ← p5.js constellation
│   ├── data.json                  ← this week's data (auto-generated)
│   └── archive/
│       └── issues.json            ← past mood names + dates
├── scripts/
│   └── fetch_trends.py            ← Google Trends → data.json
├── requirements.txt
└── README.md
```

---

## Cost

| Item | Cost |
|------|------|
| Cloudflare Pages | Free |
| GitHub Actions | Free |
| pytrends / Google Trends | Free |
| Custom domain (optional) | ~$10/yr |
| **Total** | **$0/mo** |
