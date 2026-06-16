// ─── Cloudinary (unsigned upload — safe client-side, no secret) ───────────────
// Matches the reference IMS app's Cloudinary config exactly.
export const IMS_CLD_CLOUD = "dy9wfqhry";
export const IMS_CLD_PRESET = "z3nlj6cx";
export const IMS_CLD_UPLOAD_URL = `https://api.cloudinary.com/v1_1/${IMS_CLD_CLOUD}/image/upload`;

// Downscale/compress large images client-side before upload (prevents huge payloads).
// Faithful copy of reference `compressImageForCloudinary`.
export function compressImageForCloudinary(file, maxW = 2000, quality = 0.8) {
  return new Promise((resolve) => {
    if (!file || !file.type?.startsWith("image/") || file.size < 200000) { resolve(file); return; }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.width, h = img.height;
      if (w <= maxW && file.size < 500000) { resolve(file); return; }
      if (w > maxW) { h = Math.round((h * maxW) / w); w = maxW; }
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      c.toBlob(
        (blob) => resolve(blob ? new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" }) : file),
        "image/jpeg",
        quality
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}
