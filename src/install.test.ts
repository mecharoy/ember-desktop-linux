import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  settings: {} as Record<string, string>,
  local: "",
  keys: { anthropic: "", cloud: "" },
}));

vi.mock("./db/settings", () => ({
  getSetting: async (key: string) => h.settings[key] ?? (key === "provider" ? "cloud" : ""),
  setSetting: async (key: string, value: string) => {
    h.settings[key] = value;
  },
}));

vi.mock("./secrets", () => ({
  getApiKey: async () => h.keys.anthropic,
  getCloudApiKey: async () => h.keys.cloud,
  getLocalInstallId: async () => h.local,
  setLocalInstallId: async (value: string) => {
    h.local = value;
  },
}));

import { decideFirstRun, firstRunScreen } from "./install";

beforeEach(() => {
  h.settings = {};
  h.local = "";
  h.keys = { anthropic: "", cloud: "" };
});

describe("decideFirstRun", () => {
  const base = { onboarded: true, journalId: "a", localId: "a", hasKey: true };

  it("shows setup until onboarding is done", () => {
    expect(decideFirstRun({ ...base, onboarded: false, journalId: "x", hasKey: false })).toBe("setup");
  });

  it("shows nothing for this phone's own journal, key or not", () => {
    expect(decideFirstRun(base)).toBe("none");
    expect(decideFirstRun({ ...base, hasKey: false })).toBe("none");
  });

  it("welcomes back a journal from another install when its key is missing", () => {
    expect(decideFirstRun({ ...base, localId: "b", hasKey: false })).toBe("welcome-back");
    // Android's own backup on a new phone: no local id yet.
    expect(decideFirstRun({ ...base, localId: "", hasKey: false })).toBe("welcome-back");
    // A backup made before ids existed, restored on a phone that has one.
    expect(decideFirstRun({ ...base, journalId: "", localId: "b", hasKey: false })).toBe("welcome-back");
  });

  it("doesn't ask when the key is already on this phone", () => {
    expect(decideFirstRun({ ...base, localId: "b" })).toBe("none");
  });

  it("leaves installs from before ids existed alone", () => {
    expect(decideFirstRun({ ...base, journalId: "", localId: "", hasKey: false })).toBe("none");
  });
});

describe("firstRunScreen", () => {
  it("gives an older install one shared id without showing anything", async () => {
    h.settings.onboarded = "1";
    expect(await firstRunScreen()).toBe("none");
    expect(h.settings.install_id).toMatch(/^[0-9a-f]{32}$/);
    expect(h.local).toBe(h.settings.install_id);
  });

  it("keeps the mismatch until the welcome-back screen is done", async () => {
    h.settings = { onboarded: "1", install_id: "journal" };
    h.local = "phone";
    expect(await firstRunScreen()).toBe("welcome-back");
    expect(h.local).toBe("phone");
  });

  it("adopts a restored journal's id when the key is already here", async () => {
    h.settings = { onboarded: "1", install_id: "journal", provider: "anthropic" };
    h.local = "phone";
    h.keys.anthropic = "sk-ant-x";
    expect(await firstRunScreen()).toBe("none");
    expect(h.local).toBe("journal");
  });
});
