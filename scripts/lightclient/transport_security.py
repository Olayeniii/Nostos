"""Exact transport-only lock updates for the pinned SDK, never a wallet install.

Checksums are from crates.io and were checked against the downloaded crate bytes.
All other package fields, including wallet/consensus sources, must stay identical.
"""
import copy
import hashlib
from pathlib import Path
import sys
import tomllib

PINS = {
    "h2": ("0.4.15", "0.4.16",
           "6cb093c84e8bd9b188d4c4a8cb6579fc016968d14c99882163cd3ff402a4f155",
           "a9f37a958b41b3b19ee2707c06439c0e9e547e847223eb791ecb0cb821c65e27"),
    "rustls": ("0.23.41", "0.23.46",
               "6b92b125634d9b795e7beca796cc790df15a7fb38323bf3196fda83292d06b1f",
               "48e13bd8c0e9365c43cfa5c9e8f9ad49d3c8444926c9aac819e0e4dc503c8fdf"),
    "rustls-webpki": ("0.103.13", "0.103.16",
                      "61c429a8649f110dddef65e2a5ad240f747e85f7758a6bccc7e5777bd33f756e",
                      "4443b1b6d39d7c663139942cc4558262562d2c84123bb6282ef177009ca8b281"),
    "webpki-roots": ("1.0.8", "1.0.10",
                     "bf85cb06032201fa7c6f829d7db5a7e5aa45bcc0655327713065f6f0576731bf",
                     "1c1c8e20c8a38fc7d65abfe74eb7280e4aa667e8eec8bc84996d2874810748d9"),
}


def update_lock(text):
    before = tomllib.loads(text)
    expected = copy.deepcopy(before)
    parts = text.split("[[package]]")
    for name, (old, new, old_hash, new_hash) in PINS.items():
        matches = [p for p in expected["package"] if p["name"] == name]
        if len(matches) != 1:
            raise ValueError("Unexpected transport package count")
        package = matches[0]
        if package.get("source") != "registry+https://github.com/rust-lang/crates.io-index":
            raise ValueError("Unexpected transport source")
        if (package["version"], package.get("checksum")) == (new, new_hash):
            continue
        if (package["version"], package.get("checksum")) != (old, old_hash):
            raise ValueError("Unexpected transport version/checksum")
        package["version"], package["checksum"] = new, new_hash
        for index, part in enumerate(parts):
            if part.startswith('\nname = "' + name + '"\n'):
                parts[index] = part.replace('version = "' + old + '"\n',
                                            'version = "' + new + '"\n', 1).replace(
                    'checksum = "' + old_hash + '"\n', 'checksum = "' + new_hash + '"\n', 1)
    updated = "[[package]]".join(parts)
    if tomllib.loads(updated) != expected:
        raise ValueError("Non-transport dependency changed")
    return updated


def prepare(root):
    # Validate both files before writing either one. No services or wallet paths.
    locks = [root / "Cargo.lock", root / "backends/zaino/Cargo.lock"]
    updates = [(path, update_lock(path.read_text())) for path in locks]
    for path, text in updates:
        path.write_text(text)


def provenance(lock):
    packages = tomllib.loads(lock.read_text())["package"]
    resolved = {p["name"]: p["version"] for p in packages if p["name"] in PINS}
    for name, (_, version, _, checksum) in PINS.items():
        matches = [p for p in packages if p["name"] == name]
        if len(matches) != 1:
            raise ValueError("Unexpected transport package count")
        package = matches[0]
        if (package.get("version") != version or package.get("checksum") != checksum
                or package.get("source") != "registry+https://github.com/rust-lang/crates.io-index"):
            raise ValueError("Transport security policy not applied")
    return {"transport_security_policy_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            "transport_versions": resolved,
            "prepared_lock_sha256": hashlib.sha256(lock.read_bytes()).hexdigest()}


if __name__ == "__main__":
    prepare(Path(sys.argv[1]).resolve())
