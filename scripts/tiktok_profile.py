#!/usr/bin/env python3
"""Best-effort TikTok profile fetcher using curl_cffi impersonation.

Prints the raw __UNIVERSAL_DATA_FOR_REHYDRATION__ scope object as JSON on
stdout (or "NO_DATA" when the page is not reachable). The Node server parses
it. curl_cffi is installed in the Docker image; when absent we fall back to
plain urllib. Never raises; always exits 0 unless arguments are missing.
"""
import json
import re
import sys

HDRS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
    ),
    "Referer": "https://www.tiktok.com/",
    "Accept-Language": "en-US,en;q=0.9",
}


def fetch(url):
    try:
        from curl_cffi import requests as cr  # type: ignore
        return cr.get(url, impersonate="chrome136", headers=HDRS, timeout=15).text
    except Exception:
        pass
    try:
        import urllib.request
        req = urllib.request.Request(url, headers=HDRS)
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.read().decode("utf-8", "replace")
    except Exception:
        return ""


def universal_scope(text):
    pattern = re.compile(
        r'<script[^>]*\bid=["\']__UNIVERSAL_DATA_FOR_REHYDRATION__["\'][^>]*>([\s\S]*?)</script>',
        re.IGNORECASE,
    )
    match = pattern.search(text)
    if not match:
        return None
    raw = match.group(1).strip()
    if not raw:
        return None
    first, last = raw.find("{"), raw.rfind("}")
    if first < 0 or last <= first:
        return None
    try:
        return json.loads(raw[first : last + 1])
    except Exception:
        return None


def main():
    if len(sys.argv) < 2:
        print("NO_DATA")
        return 0
    url = sys.argv[1]
    html = fetch(url)
    scope = universal_scope(html)
    if scope is None:
        print("NO_DATA")
        return 0
    print(json.dumps(scope, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())