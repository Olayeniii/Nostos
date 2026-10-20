"""Select the already-pinned Rustls ring provider for the isolated SDK example."""
import pathlib
import sys
import tomllib

root = pathlib.Path(sys.argv[1])
manifest = root / "zallet-core/Cargo.toml"
lock = root / "Cargo.lock"
before = tomllib.loads(lock.read_text())
versions = {p["name"]: p["version"] for p in before["package"]}
assert versions["rustls"] == "0.23.41"
assert versions["ring"] == "0.17.14"
text = manifest.read_text()
assert text.count("[dependencies]\n") == 1
manifest.write_text(text.replace(
    "[dependencies]\n",
    '[dependencies]\nrustls = { version = "=0.23.41", default-features = false, features = ["ring", "std"] }\n',
))
parts = lock.read_text().split("[[package]]")
for index, part in enumerate(parts):
    if part.startswith('\nname = "zallet-core"\n'):
        assert '\n "rustls",\n' not in part
        parts[index] = part.replace('\n "rust_decimal",\n', '\n "rust_decimal",\n "rustls",\n')
    if part.startswith('\nname = "rustls"\n'):
        assert '\n "ring",\n' not in part
        parts[index] = part.replace('dependencies = [\n', 'dependencies = [\n "ring",\n')
updated = "[[package]]".join(parts)
after = tomllib.loads(updated)
assert [(p["name"], p["version"], p.get("source"), p.get("checksum")) for p in before["package"]] == [
    (p["name"], p["version"], p.get("source"), p.get("checksum")) for p in after["package"]
]
lock.write_text(updated)
