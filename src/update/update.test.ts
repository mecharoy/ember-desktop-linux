import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn() }));
vi.mock("../db/settings", () => ({ getSetting: vi.fn(), setSetting: vi.fn() }));

import { compareVersions, manifestUrlFor, parseManifest, parseRepo, platformKey } from "./update";

describe("sources", () => {
  it("turns a repository link into its latest release's manifest", () => {
    expect(manifestUrlFor("https://github.com/owner/ember")).toBe(
      "https://github.com/owner/ember/releases/latest/download/latest.json",
    );
    expect(manifestUrlFor("https://github.com/owner/ember.git/")).toBe(
      "https://github.com/owner/ember/releases/latest/download/latest.json",
    );
    expect(manifestUrlFor(" https://github.com/owner/ember/releases ")).toBe(
      "https://github.com/owner/ember/releases/latest/download/latest.json",
    );
  });

  it("uses a pasted GitHub manifest link as it is, and refuses anything else", () => {
    const direct = "https://github.com/owner/ember/releases/download/v1.0.0/latest.json";
    expect(manifestUrlFor(direct)).toBe(direct);
    expect(manifestUrlFor("http://github.com/owner/ember")).toBeNull();
    expect(manifestUrlFor("https://example.com/latest.json")).toBeNull();
    expect(manifestUrlFor("")).toBeNull();
  });

  it("reads owner and repository", () => {
    expect(parseRepo("https://github.com/mecha-roy/ember_app")).toEqual({ owner: "mecha-roy", repo: "ember_app" });
    expect(parseRepo("github.com/owner/ember")).toBeNull();
  });
});

describe("compareVersions", () => {
  it("compares numerically, ignoring a leading v and suffixes", () => {
    expect(compareVersions("0.10.0", "0.9.9")).toBe(1);
    expect(compareVersions("v0.3.0", "0.3.0")).toBe(0);
    expect(compareVersions("0.3", "0.3.1")).toBe(-1);
    expect(compareVersions("1.0.0-beta", "1.0.0")).toBe(0);
  });
});

describe("parseManifest", () => {
  const source = "https://github.com/owner/ember";
  const manifest = {
    version: "0.3.0",
    notes: "Wellbeing checks",
    platforms: {
      "windows-x86_64": { url: "https://github.com/owner/ember/releases/download/v0.3.0/Ember_0.3.0_x64-setup.exe" },
      "darwin-aarch64": { url: "https://github.com/owner/ember/releases/download/v0.3.0/Ember_0.3.0_aarch64.dmg" },
    },
  };

  it("gives Windows its installer and everyone else the release page", () => {
    expect(parseManifest(manifest, source, "windows-x86_64")?.downloadUrl).toMatch(/x64-setup\.exe$/);
    const mac = parseManifest(manifest, source, null)!;
    expect(mac.downloadUrl).toBe("https://github.com/owner/ember/releases/tag/v0.3.0");
    expect(mac.notes).toBe("Wellbeing checks");
  });

  it("prefers a platform's own version when the release bundles more than one app", () => {
    const shared = {
      ...manifest,
      version: "1.1.0",
      platforms: {
        "android-aarch64": { url: "https://github.com/owner/ember/releases/download/v1.1.0/Ember-1.1.0-arm64.apk", version: "1.1.0" },
        "windows-x86_64": { url: "https://github.com/owner/ember/releases/download/v1.1.0/Ember_0.1.0_x64-setup.exe", version: "0.1.0" },
      },
    };
    expect(parseManifest(shared, source, "windows-x86_64")?.version).toBe("0.1.0");
    expect(parseManifest(shared, source, "android-aarch64")?.version).toBe("1.1.0");
    // The release page always points at the shared tag, whichever platform asks.
    expect(parseManifest(shared, source, "windows-x86_64")?.releasePage).toBe("https://github.com/owner/ember/releases/tag/v1.1.0");
  });

  it("never hands over a link outside GitHub", () => {
    const evil = { ...manifest, platforms: { "windows-x86_64": { url: "https://evil.example/Ember.exe" } } };
    expect(parseManifest(evil, source, "windows-x86_64")?.downloadUrl).toBe(
      "https://github.com/owner/ember/releases/tag/v0.3.0",
    );
  });

  it("treats a malformed manifest as no update", () => {
    expect(parseManifest(null, source, null)).toBeNull();
    expect(parseManifest({ version: "latest" }, source, null)).toBeNull();
    expect(parseManifest({ version: "0.3.0" }, "https://github.com/owner/ember/releases/download/v0.3.0/latest.json", null)?.releasePage).toBe(
      "https://github.com/owner/ember/releases/tag/v0.3.0",
    );
  });
});

describe("platformKey", () => {
  it("knows Windows and Linux, and admits it can't tell a Mac's chip", () => {
    expect(platformKey("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("windows-x86_64");
    expect(platformKey("Mozilla/5.0 (X11; Linux x86_64)")).toBe("linux-x86_64");
    expect(platformKey("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBeNull();
    expect(platformKey("Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36")).toBe("android-aarch64");
  });
});
