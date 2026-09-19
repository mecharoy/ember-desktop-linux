// Writes latest.json for the in-app update check (src/update/update.ts).
// Run by .github/workflows/release.yml after the installers are uploaded:
//
//   VERSION=0.3.0 REPO=owner/ember ASSETS="$(gh release view v0.3.0 --json assets --jq '.assets[].name')" \
//     node scripts/write-latest-json.mjs > latest.json
//
// Same shape as Tauri's updater manifest (version, notes, pub_date,
// platforms.<target>.url) minus the signatures, so moving to the signed
// updater later needs no change on the app's side.

const version = process.env.VERSION;
const repo = process.env.REPO;
const assets = (process.env.ASSETS ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
if (!version || !repo) {
  console.error("VERSION and REPO are required");
  process.exit(1);
}

const base = `https://github.com/${repo}/releases/download/v${version}`;
const pick = (pattern) => assets.find((a) => pattern.test(a));
const platforms = {};
const add = (key, name) => {
  if (name) platforms[key] = { url: `${base}/${encodeURIComponent(name)}` };
};
add("windows-x86_64", pick(/x64-setup\.exe$/) ?? pick(/x64.*\.msi$/));
add("darwin-aarch64", pick(/aarch64\.dmg$/));
add("darwin-x86_64", pick(/x64\.dmg$/));
add("linux-x86_64", pick(/amd64\.AppImage$/) ?? pick(/amd64\.deb$/) ?? pick(/x86_64\.pkg\.tar\.zst$/));

process.stdout.write(
  JSON.stringify(
    {
      version,
      notes: process.env.NOTES ?? "",
      pub_date: new Date().toISOString(),
      platforms,
    },
    null,
    2,
  ) + "\n",
);
