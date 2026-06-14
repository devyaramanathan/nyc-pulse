"""
NYC Pulse — fetch script v9
Fully dynamic. Zero hardcoded keywords. Zero external feeds.

Discovery pipeline:
1. suggestions() with NYC-flavored prefixes → what people are typing right now
2. related_queries() on top suggestions → what they search alongside
3. interest_over_time() scored against NY state → real volume data
4. interest_by_region() for top stars → which borough searches it most
5. Fallback: yesterday's data.json if all else fails

trending_searches() is dead (404). This approach is more reliable.
"""

import json
import time
import random
import datetime
import os
from pytrends.request import TrendReq

NYC_GEO   = "US-NY"      # NY state — better coverage than DMA
NYC_DMA   = "US-NY-501"  # DMA — used only for borough data
TIMEFRAME_NOW  = "now 1-d"
TIMEFRAME_PREV = "now 7-d"

OUTPUT_DATA    = os.path.join(os.path.dirname(__file__), "../public/data.json")
OUTPUT_ARCHIVE = os.path.join(os.path.dirname(__file__), "../public/archive/issues.json")

# ── Blocklist ─────────────────────────────────────────────────────────────────
BLOCKLIST = [
    "shooting", "murder", "shot", "stabbing", "killed", "killing", "dead",
    "death", "died", "dies", "crash", "accident", "explosion", "bomb",
    "terror", "attack", "assault", "rape", "trafficking", "arrested",
    "charged", "indicted", "sentenced", "prison", "jail", "crime",
    "criminal", "suspect", "shooter", "gunman", "weapon", "gun",
    "drug", "overdose", "fentanyl", "heroin", "cocaine", "meth",
    "porn", "xxx", "nude", "naked", "sex tape", "onlyfans",
    "suicide", "self harm", "eating disorder", "scandal", "impeach",
]

def is_safe(kw):
    kw = kw.lower()
    return not any(b in kw for b in BLOCKLIST)

# ── Velocity colors ───────────────────────────────────────────────────────────
VELOCITY_COLORS = {
    "rocketing": "#FF2D78",
    "surging":   "#9B5DE5",
    "steady":    "#3A86FF",
    "slowing":   "#06D6A0",
    "fading":    "#4A4A6A",
    "ghost":     "#2A2A3A",
}

BOROUGH_MAP = {
    "New York":   "Manhattan",
    "Kings":      "Brooklyn",
    "Queens":     "Queens",
    "Bronx":      "The Bronx",
    "Richmond":   "Staten Island",
}

def velocity_to_tier(v):
    if v >= 2.0:  return "rocketing"
    if v >= 1.3:  return "surging"
    if v >= 0.8:  return "steady"
    if v >= 0.4:  return "slowing"
    return "fading"

def polite_sleep():
    time.sleep(random.uniform(12, 18))

def random_pos(margin=0.05):
    return {
        "x": round(random.uniform(margin, 1-margin), 3),
        "y": round(random.uniform(margin, 1-margin), 3),
    }

# ── Step 1: Discover keywords via suggestions() ───────────────────────────────

# Prefixes that surface what NYC is actually searching right now.
# suggestions() returns Google autocomplete — whatever is trending
# bubbles to the top of these lists automatically.
# No topic bias, no hardcoded subjects — just what people are typing.
PREFIXES = [
    # single letters — catches anything trending
    "a", "b", "c", "d", "e", "f", "g", "h", "i", "j",
    "k", "l", "m", "n", "o", "p", "q", "r", "s", "t",
    "u", "v", "w", "y", "z",
    # common NYC search starters
    "nyc", "new york", "best nyc", "where to", "how to",
    "what is", "why is", "who is", "when is",
    # local signals
    "brooklyn", "manhattan", "queens", "bronx",
    "near me", "this weekend", "tonight",
]

def fetch_via_suggestions():
    """
    Uses Google autocomplete suggestions to discover what people
    are searching right now — fully dynamic, zero hardcoding.
    Trending topics naturally rise to the top of autocomplete.
    """
    pytrends = TrendReq(hl="en-US", tz=300)
    discovered = {}  # keyword → suggestion rank score

    print(f"  Querying {len(PREFIXES)} prefixes via suggestions()...")
    for prefix in PREFIXES:
        try:
            results = pytrends.suggestions(prefix)
            for rank, item in enumerate(results[:5]):
                kw = item.get("title", "").strip().lower()
                if kw and is_safe(kw) and len(kw) > 2:
                    # Higher rank = lower index = more relevant
                    score = 5 - rank
                    discovered[kw] = discovered.get(kw, 0) + score
            time.sleep(random.uniform(1.5, 3))  # be polite even on suggestions
        except Exception as e:
            pass  # silently skip failed prefixes

    # Sort by how often they appeared across prefixes
    ranked = sorted(discovered.items(), key=lambda x: x[1], reverse=True)
    keywords = [kw for kw, _ in ranked[:60]]
    print(f"  → {len(keywords)} keywords discovered via suggestions")
    return keywords


def fetch_from_yesterday():
    """Fallback: reuse yesterday's keywords and rescore them."""
    try:
        with open(OUTPUT_DATA) as f:
            prev = json.load(f)
        keywords = [s["word"] for s in prev.get("stars", [])]
        keywords += [g["word"] for g in prev.get("ghost", [])]
        print(f"  Fallback: reusing {len(keywords)} keywords from last run")
        return keywords
    except Exception as e:
        print(f"  No previous data: {e}")
        return []

# ── Step 2: Expand via related_queries() ─────────────────────────────────────

def expand_with_related(keywords, geo, timeframe):
    """
    For top discovered keywords, fetch what people also searched.
    This finds NYC-specific variants and co-searched terms.
    E.g. "knicks" → "knicks game tonight", "knicks score", "knicks tickets"
    """
    pytrends = TrendReq(hl="en-US", tz=300)
    seen = set(k.lower() for k in keywords)
    expanded = list(keywords)

    print(f"  Expanding top {min(len(keywords), 25)} via related_queries()...")
    for i in range(0, min(len(keywords), 25), 5):
        batch = keywords[i:i+5]
        try:
            pytrends.build_payload(batch, geo=geo, timeframe=timeframe)
            rq = pytrends.related_queries()
            for kw in batch:
                for kind in ["top", "rising"]:
                    if kw in rq and rq[kw][kind] is not None:
                        for term in rq[kw][kind]["query"].str.lower():
                            term = term.strip()
                            if term not in seen and is_safe(term):
                                seen.add(term)
                                expanded.append(term)
        except Exception as e:
            print(f"  Warning related — {e}")
        polite_sleep()

    print(f"  → {len(expanded)} total after expansion")
    return expanded

# ── Step 3: Score all keywords ────────────────────────────────────────────────

def fetch_scores(keywords, geo, timeframe):
    pytrends = TrendReq(hl="en-US", tz=300)
    scores = {}
    for i in range(0, len(keywords), 5):
        batch = keywords[i:i+5]
        try:
            pytrends.build_payload(batch, geo=geo, timeframe=timeframe)
            df = pytrends.interest_over_time()
            if df.empty:
                for kw in batch: scores[kw] = 0
            else:
                for kw in batch:
                    scores[kw] = int(df[kw].mean()) if kw in df.columns else 0
        except Exception as e:
            print(f"  Warning scores — {e}")
            for kw in batch: scores[kw] = 0
        polite_sleep()
    return scores

# ── Step 4: Borough data ──────────────────────────────────────────────────────

def fetch_borough(keyword, timeframe):
    try:
        pytrends = TrendReq(hl="en-US", tz=300)
        pytrends.build_payload([keyword], geo=NYC_DMA, timeframe=timeframe)
        df = pytrends.interest_by_region(resolution="CITY", inc_low_vol=True)
        if df.empty: return None
        top_city = df[keyword].idxmax()
        for key, borough in BOROUGH_MAP.items():
            if key.lower() in str(top_city).lower():
                return borough
        return str(top_city).split(",")[0]
    except:
        return None
    finally:
        polite_sleep()

# ── Build stars ───────────────────────────────────────────────────────────────

def build_stars():
    random.seed(datetime.date.today().toordinal())

    print("\n  Step 1: Discovering keywords via Google suggestions...")
    keywords = fetch_via_suggestions()

    if not keywords:
        print("  Suggestions failed — using yesterday's data as fallback")
        keywords = fetch_from_yesterday()

    if not keywords:
        print("  ERROR: No keywords available")
        return [], []

    print("\n  Step 2: Expanding with related queries...")
    keywords = expand_with_related(keywords, NYC_GEO, TIMEFRAME_NOW)

    # Cap before scoring — fewer batches = fewer 429s
    keywords = keywords[:80]
    print(f"\n  Step 3: Scoring {len(keywords)} keywords against NY state...")
    scores_now  = fetch_scores(keywords, NYC_GEO, TIMEFRAME_NOW)
    scores_prev = fetch_scores(keywords, NYC_GEO, TIMEFRAME_PREV)

    active, ghost = [], []
    for kw in keywords:
        now  = scores_now.get(kw, 0)
        prev = scores_prev.get(kw, 1) or 1
        vel  = now / prev
        tier = velocity_to_tier(vel)
        pos  = random_pos()

        entry = {
            "word":     kw,
            "score":    now,
            "velocity": round(vel, 2),
            "tier":     tier,
            "color":    VELOCITY_COLORS[tier],
            "borough":  None,
            "x":        pos["x"],
            "y":        pos["y"],
        }

        if now >= 30:
            active.append(entry)
        else:
            entry["tier"]  = "ghost"
            entry["color"] = VELOCITY_COLORS["ghost"]
            entry["sz"]    = round(random.uniform(4, 6), 1)
            ghost.append(entry)

    active.sort(key=lambda s: s["score"], reverse=True)
    active = active[:50]
    ghost  = ghost[:80]

    print(f"\n  Step 4: Fetching borough data for top 20 stars...")
    for star in active[:20]:
        b = fetch_borough(star["word"], TIMEFRAME_NOW)
        star["borough"] = b
        if b: print(f"    {star['word']} → {b}")

    print(f"\n  → {len(active)} active · {len(ghost)} ghost")
    return active, ghost

# ── Build edges ───────────────────────────────────────────────────────────────

def build_edges(stars, ghost_stars):
    print("\n  Step 5: Building co-search edges...")
    all_stars = stars + ghost_stars
    n_active  = len(stars)

    word_to_idx = {}
    for i, star in enumerate(all_stars):
        word_to_idx[star["word"].lower()] = i
        for word in star["word"].lower().split():
            if len(word) > 4:
                word_to_idx.setdefault(word, i)

    pytrends = TrendReq(hl="en-US", tz=300)
    related_map = {}
    all_kws = [s["word"] for s in all_stars]

    for i in range(0, len(all_kws), 5):
        batch = all_kws[i:i+5]
        try:
            pytrends.build_payload(batch, geo=NYC_GEO, timeframe=TIMEFRAME_NOW)
            data = pytrends.related_queries()
            for kw in batch:
                queries = []
                for kind in ["top", "rising"]:
                    if kw in data and data[kw][kind] is not None:
                        queries += list(data[kw][kind]["query"].str.lower())
                related_map[kw] = [q for q in queries if is_safe(q)]
        except Exception as e:
            print(f"  Warning edges — {e}")
            for kw in batch: related_map[kw] = []
        polite_sleep()

    active_edges, ghost_edges = [], []
    seen = set()

    for i, star in enumerate(all_stars):
        is_ghost_i = i >= n_active
        for rq in related_map.get(star["word"], []):
            j = word_to_idx.get(rq.lower().strip())
            if j is None:
                for word, idx in word_to_idx.items():
                    if idx != i and len(word) > 5 and word in rq.lower():
                        j = idx
                        break
            if j is not None and j != i:
                pair = tuple(sorted([i, j]))
                if pair not in seen:
                    seen.add(pair)
                    is_ghost_j = j >= n_active
                    if not is_ghost_i and not is_ghost_j:
                        active_edges.append([i, j])
                        print(f"    ✓ {star['word']}  ↔  {all_stars[j]['word']}")
                    else:
                        ghost_edges.append({
                            "a": i, "b": j,
                            "a_ghost": is_ghost_i,
                            "b_ghost": is_ghost_j,
                        })

    # Fallback: connect isolated stars to nearest by score
    connected = set(i for e in active_edges for i in e)
    for i in range(n_active):
        if i not in connected:
            others = [j for j in range(n_active) if j != i]
            if others:
                j = max(others, key=lambda j: stars[j]["score"])
                pair = tuple(sorted([i, j]))
                if pair not in seen:
                    seen.add(pair)
                    active_edges.append([i, j])

    print(f"  → {len(active_edges)} active · {len(ghost_edges)} ghost edges")
    return active_edges, ghost_edges

# ── Archive ───────────────────────────────────────────────────────────────────

def next_issue(path):
    if not os.path.exists(path): return 1
    with open(path) as f: return len(json.load(f)) + 1

def save_archive(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    issues = []
    if os.path.exists(path):
        with open(path) as f: issues = json.load(f)
    issues.append({
        "issue":     data["issue"],
        "week":      data["week"],
        "generated": data["generated"],
    })
    with open(path, "w") as f: json.dump(issues, f, indent=2)

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    today    = datetime.date.today()
    week_str = today.strftime("Week of %B %-d, %Y")
    print(f"\nNYC Pulse — {week_str}")
    print(f"Source: Google suggestions + related queries (fully dynamic)\n")

    active, ghost = build_stars()
    if not active and not ghost:
        print("Nothing to write — exiting")
        return

    active_edges, ghost_edges = build_edges(active, ghost)
    issue = next_issue(OUTPUT_ARCHIVE)

    output = {
        "issue":           issue,
        "week":            week_str,
        "geo":             "New York City",
        "generated":       today.isoformat(),
        "velocity_colors": VELOCITY_COLORS,
        "stars":           active,
        "ghost":           ghost,
        "edges":           active_edges,
        "ghost_edges":     ghost_edges,
    }

    os.makedirs(os.path.dirname(OUTPUT_DATA), exist_ok=True)
    with open(OUTPUT_DATA, "w") as f: json.dump(output, f, indent=2)
    print(f"\nWritten → {OUTPUT_DATA}")
    save_archive(OUTPUT_ARCHIVE, output)
    print(f"Done — {len(active)} active · {len(ghost)} ghost · {len(active_edges)} edges\n")

if __name__ == "__main__":
    main()