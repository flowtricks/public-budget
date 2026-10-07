"""Refresh locally hosted payee favicons from the curated domain list."""

import concurrent.futures
import hashlib
import json
import pathlib
import subprocess
import urllib.error
import urllib.request


ROOT = pathlib.Path(__file__).resolve().parents[1]
ALIASES = json.loads((ROOT / "src/lib/payee-logos.json").read_text())
OUTPUT = ROOT / "public/payee-logos"
OUTPUT.mkdir(parents=True, exist_ok=True)
OFFICIAL_LOGOS = {
    "southwest.com": "https://www.southwest.com/swa-resources/images/trademarks/sw-heart.png",
}


def fetch(domain):
    url = OFFICIAL_LOGOS.get(
        domain, f"https://www.google.com/s2/favicons?domain={domain}&sz=128"
    )
    request = urllib.request.Request(url, headers={"User-Agent": "PublicBudgetLogoUpdater/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            data = response.read()
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
        data = error.read()
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("Response was not a PNG")
    return data


generic = hashlib.sha256(fetch("no-such-budget-merchant.invalid")).digest()


def save(domain):
    if "." not in domain:
        return domain, "kept custom"
    if (OUTPUT / f"{domain.lower()}.svg").exists():
        return domain, "kept SVG"
    try:
        data = fetch(domain)
        if hashlib.sha256(data).digest() == generic:
            return domain, "generic"
        (OUTPUT / f"{domain.lower()}.png").write_bytes(data)
        return domain, "saved"
    except Exception as error:
        return domain, f"failed: {error}"


with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    results = list(pool.map(save, ALIASES))

for domain, status in results:
    print(f"{status:8} {domain}")
subprocess.run(["node", str(ROOT / "scripts/build-payee-logo-catalog.mjs")], check=True)
print(f"Saved {sum(status == 'saved' for _, status in results)} of {len(results)} logos")
