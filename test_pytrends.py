"""
Run this from inside your venv:
  source venv/bin/activate
  python test_pytrends.py
"""
import time

print("Testing pytrends endpoints...\n")

try:
    from pytrends.request import TrendReq
    p = TrendReq(hl="en-US", tz=300)

    # Test 1: interest_over_time (most important)
    print("1. interest_over_time...")
    try:
        p.build_payload(["knicks", "taylor swift", "nyc"], geo="US-NY", timeframe="now 1-d")
        time.sleep(3)
        df = p.interest_over_time()
        if not df.empty:
            print(f"   ✓ Works! Shape: {df.shape}")
            print(f"   Scores: {dict(df.iloc[-1].drop('isPartial', errors='ignore'))}")
        else:
            print("   ✗ Empty dataframe")
    except Exception as e:
        print(f"   ✗ {e}")

    time.sleep(5)

    # Test 2: related_queries
    print("\n2. related_queries...")
    try:
        p.build_payload(["knicks"], geo="US-NY", timeframe="now 1-d")
        time.sleep(3)
        rq = p.related_queries()
        if "knicks" in rq and rq["knicks"]["top"] is not None:
            print(f"   ✓ Works! Top related: {list(rq['knicks']['top']['query'])[:5]}")
        else:
            print("   ✗ No related queries returned")
    except Exception as e:
        print(f"   ✗ {e}")

    time.sleep(5)

    # Test 3: trending_searches (known broken)
    print("\n3. trending_searches (expected to fail)...")
    try:
        df = p.trending_searches(pn="united_states")
        print(f"   ✓ Works! {len(df)} results: {list(df[0])[:5]}")
    except Exception as e:
        print(f"   ✗ {e}")

    time.sleep(5)

    # Test 4: suggestions
    print("\n4. suggestions...")
    try:
        s = p.suggestions("nyc food")
        print(f"   ✓ Works! {[x['title'] for x in s[:3]]}")
    except Exception as e:
        print(f"   ✗ {e}")

except ImportError:
    print("pytrends not installed — run: pip install pytrends")
