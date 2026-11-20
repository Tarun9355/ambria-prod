import { describe, it, expect, vi, afterEach } from "vitest";

// Owner report 2026-11-20 (inventory "Edit" photo upload): the Edge Function refuses HEIC / untyped files with "Type not allowed: ...",
// and a dead connection reached the alert as "Failed to fetch". The helper now gives an untyped image its type from the extension,
// re-encodes a format the server refuses where the browser can decode it, and words every failure so the person can act on it.
vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon");
const { uploadToStorage, compressImageForUpload, STORAGE_FOLDERS } = await import("./storage.js");

const reply = (status, body) => vi.fn(async () => ({ ok: status < 400, status, json: async () => body }));
afterEach(() => { vi.unstubAllGlobals(); });

describe("uploadToStorage - what a failed upload says", () => {
  it("an iPhone HEIC photo is explained, not 'Type not allowed: image/heic'", async () => {
    vi.stubGlobal("fetch", reply(400, { error: "Type not allowed: image/heic" }));
    await expect(uploadToStorage(new File(["x"], "IMG_1.HEIC", { type: "image/heic" }), STORAGE_FOLDERS.INVENTORY)).rejects.toThrow(/HEIC.*JPG or PNG.*Most Compatible/);
  });
  it("another refused type is named; an unknown one says unknown", async () => {
    vi.stubGlobal("fetch", reply(400, { error: "Type not allowed: image/tiff" }));
    await expect(uploadToStorage(new File(["x"], "a.tif", { type: "image/tiff" }))).rejects.toThrow(/image\/tiff.*cannot be uploaded/);
    vi.stubGlobal("fetch", reply(400, { error: "Type not allowed: application/octet-stream" }));
    await expect(uploadToStorage(new File(["x"], "a.xyz", { type: "application/octet-stream" }))).rejects.toThrow(/\(unknown\) cannot be uploaded/);
  });
  it("a file over the limit, a dead connection and a server error each get plain words", async () => {
    vi.stubGlobal("fetch", reply(400, { error: "Too large: 99999999 bytes" }));
    await expect(uploadToStorage(new File(["x"], "a.jpg", { type: "image/jpeg" }))).rejects.toThrow(/too large.*50 MB/);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(uploadToStorage(new File(["x"], "a.jpg", { type: "image/jpeg" }))).rejects.toThrow(/Could not reach the server/);
    vi.stubGlobal("fetch", reply(522, {}));
    await expect(uploadToStorage(new File(["x"], "a.jpg", { type: "image/jpeg" }))).rejects.toThrow(/did not answer properly \(522\)/);
  });
  it("an error the function words itself (folder not allowed...) passes through", async () => {
    vi.stubGlobal("fetch", reply(400, { error: "Folder not allowed: nope" }));
    await expect(uploadToStorage(new File(["x"], "a.jpg", { type: "image/jpeg" }))).rejects.toThrow("Folder not allowed: nope");
  });
});

describe("uploadToStorage - a file with no type", () => {
  it("takes its type from the extension before it is sent (.jfif / .jpg with an empty type), and still sends one it cannot place as it is", async () => {
    const sent = [];
    vi.stubGlobal("fetch", vi.fn(async (_u, init) => { sent.push(init.body.get("file")); return { ok: true, status: 200, json: async () => ({ url: "https://x/y.jpg" }) }; }));
    await uploadToStorage(new File(["x"], "photo.jfif", { type: "" }), STORAGE_FOLDERS.INVENTORY);
    await uploadToStorage(new File(["x"], "IMG.JPG", { type: "" }), STORAGE_FOLDERS.INVENTORY);
    await uploadToStorage(new File(["x"], "mystery.zzz", { type: "" }), STORAGE_FOLDERS.INVENTORY);
    expect(sent[0].type).toBe("image/jpeg");
    expect(sent[1].type).toBe("image/jpeg");
    expect(sent[2].type).not.toMatch(/^image\//);
  });
});

describe("compressImageForUpload", () => {
  it("hands back a file that is not an image as it is, and a small ordinary image as it is", async () => {
    const pdf = new File(["x"], "a.pdf", { type: "application/pdf" });
    expect(await compressImageForUpload(pdf)).toBe(pdf);
    const small = new File(["x"], "a.png", { type: "image/png" });
    expect(await compressImageForUpload(small)).toBe(small);
  });
  it("an untyped .jfif / .jpg is given its type even when it is not re-encoded", async () => {
    const out = await compressImageForUpload(new File(["x"], "p.jfif", { type: "" }));
    expect(out.type).toBe("image/jpeg");
  });
  it("source: a format the server refuses (HEIC, BMP...) skips the 'small file, send as is' shortcuts", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./storage.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    expect(src).toContain("const convert = !!file && !!file.type?.startsWith(\"image/\") && !SERVER_IMAGE.test(file.type);");
    expect(src).toContain("(!convert && file.size < 200000)");
    expect(src).toContain("if (!convert && w <= maxW && file.size < 500000)");
  });
});
