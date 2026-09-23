// Keeping Elytra current without anyone sending a file.
//
// Each GitHub release carries the installers plus a small latest.json saying
// which version it is (written by .github/workflows/release.yml, in the same
// shape Tauri's own updater uses, minus signatures). Elytra reads that file,
// compares versions, and only when the release is genuinely newer does it say
// anything. Nothing is downloaded or installed behind the user's back: the
// download opens in their browser and the installer's last click is theirs.
//
// Everything here fails silently. No network, a 404, a half-written JSON file
// — each one ends with Elytra simply not mentioning an update, because an
// evening conversation must never be interrupted by release plumbing.
//
// The only hosts this can reach are GitHub's, listed in the http allowlist in
// src-tauri/capabilities/default.json.

import { fetch } from "@tauri-apps/plugin-http";
import { getVersion } from "@tauri-apps/api/app";
import { getSetting, setSetting } from "../db/settings";

/** The repository releases are published from. A link pasted in Settings wins over this. */
export const DEFAULT_UPDATE_SOURCE = "https://github.com/mecharoy/ember-desktop-linux";

const GITHUB_REPO = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:\/.*)?$/;

/** "https://github.com/owner/repo[/anything]" → { owner, repo }. */
export function parseRepo(source: string): { owner: string; repo: string } | null {
  const m = GITHUB_REPO.exec(source.trim());
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

/**
 * Where to read latest.json from. A repository URL points at its newest
 * published release (drafts and pre-releases are skipped by GitHub, so
 * publishing the draft is what ships an update); a direct https://github.com
 * link to a .json file is used as it is.
 */
export function manifestUrlFor(source: string): string | null {
  const s = source.trim();
  if (/^https:\/\/github\.com\/.+\.json$/.test(s)) return s;
  const r = parseRepo(s);
  return r ? `https://github.com/${r.owner}/${r.repo}/releases/latest/download/latest.json` : null;
}

/** 1 when a is newer than b, -1 when older, 0 when the same. "v" and any
 *  "-suffix" are ignored; missing parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) =>
    v
      .trim()
      .replace(/^v/i, "")
      .split("-")[0]
      .split(".")
      .map((p) => Number.parseInt(p, 10) || 0);
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

export type PlatformKey = "android-aarch64" | "windows-x86_64" | "darwin-aarch64" | "darwin-x86_64" | "linux-x86_64" | null;

/** Best guess from the webview. macOS doesn't say which chip, so a Mac gets
 *  the release page rather than a possibly wrong installer. */
export function platformKey(userAgent: string): PlatformKey {
  if (/Android/.test(userAgent)) return "android-aarch64";
  if (/Windows/.test(userAgent)) return "windows-x86_64";
  if (/Linux/.test(userAgent) && !/Android/.test(userAgent)) return "linux-x86_64";
  return null;
}

export interface Release {
  version: string;
  notes: string;
  /** The installer for this computer when known, else the release page. */
  downloadUrl: string;
  releasePage: string;
}

const isGithubHttps = (u: unknown): u is string =>
  typeof u === "string" && /^https:\/\/(github\.com|objects\.githubusercontent\.com|release-assets\.githubusercontent\.com)\//.test(u);

/** Reads and whitelists a manifest. Anything malformed is no update. Pure. */
export function parseManifest(raw: unknown, source: string, platform: PlatformKey): Release | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const version = typeof m.version === "string" ? m.version.trim().replace(/^v/i, "") : "";
  if (!/^\d+(\.\d+){0,3}/.test(version)) return null;
  const repo = parseRepo(source);
  const releasePage = repo
    ? `https://github.com/${repo.owner}/${repo.repo}/releases/tag/v${version}`
    : typeof m.release_page === "string" && isGithubHttps(m.release_page)
      ? m.release_page
      : null;
  const platforms = (m.platforms ?? {}) as Record<string, { url?: unknown; version?: unknown } | undefined>;
  const entry = platform ? platforms[platform] : undefined;
  const direct = entry?.url;
  const downloadUrl = isGithubHttps(direct) ? direct : releasePage;
  if (!downloadUrl || !releasePage) return null;
  // The phone and the computer app ship as one release but keep separate
  // version numbers, so a platform can say which one it's actually at.
  const platformVersion = typeof entry?.version === "string" ? entry.version.trim().replace(/^v/i, "") : "";
  return {
    version: /^\d+(\.\d+){0,3}/.test(platformVersion) ? platformVersion : version,
    notes: typeof m.notes === "string" ? m.notes.slice(0, 600) : "",
    downloadUrl,
    releasePage,
  };
}

/** The source in use: pasted in Settings, else the built-in default. */
export async function updateSource(): Promise<string> {
  return (await getSetting("update_source")).trim() || DEFAULT_UPDATE_SOURCE;
}

export type CheckResult =
  | { status: "available"; current: string; release: Release }
  | { status: "current"; current: string }
  | { status: "unconfigured" }
  | { status: "unreachable" };

/** Never throws. `manual` is the Settings button, which deserves an answer
 *  even for a version the user already dismissed. */
export async function checkForUpdate(manual = false): Promise<CheckResult> {
  try {
    const source = await updateSource();
    const url = manifestUrlFor(source);
    if (!url) return { status: "unconfigured" };
    const current = await getVersion();

    const res = await fetch(`${url}?t=${Date.now()}`, { method: "GET", cache: "no-store" } as RequestInit);
    if (!res.ok) return { status: "unreachable" };
    const release = parseManifest(await res.json(), source, platformKey(navigator.userAgent));
    await setSetting("update_checked_at", new Date().toISOString());
    if (!release || compareVersions(release.version, current) <= 0) return { status: "current", current };
    if (!manual && (await getSetting("update_dismissed_version")) === release.version) {
      return { status: "current", current };
    }
    return { status: "available", current, release };
  } catch {
    return { status: "unreachable" };
  }
}
