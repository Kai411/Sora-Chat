const MAX_EDGE = 1080;
// Below this we hand the file through untouched. Base64 inflates ~33%, and the
// socket caps payloads at 3 MB, so keep some headroom under the server's 2 MB
// decoded limit.
const PASSTHROUGH_MAX_BYTES = 1_800_000;

function readAsDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

/**
 * Opens the system file picker and returns an image data URL, always in the
 * file's original format (PNG / JPEG / WebP).
 *
 * Small assets — shop frames, avatars, badges — are passed through byte-for-byte,
 * which preserves lossless encoding, alpha and WebP animation that a canvas
 * re-encode would flatten. Anything oversized is downscaled to fit MAX_EDGE and
 * re-encoded in its *own* format, never converted to a different one.
 */
export function pickImage(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = async () => {
        // Already small enough: keep the original bytes and format exactly.
        if (img.width <= MAX_EDGE && img.height <= MAX_EDGE && file.size <= PASSTHROUGH_MAX_BYTES) {
          URL.revokeObjectURL(url);
          return resolve(await readAsDataUrl(file));
        }
        const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        // Re-encode in the source's own format so transparency survives on
        // PNG/WebP and photos stay compact as JPEG. (Browsers without WebP
        // encoding fall back to PNG on their own — still alpha-safe.)
        if (file.type === "image/png") resolve(canvas.toDataURL("image/png"));
        else if (file.type === "image/webp") resolve(canvas.toDataURL("image/webp", 0.9));
        else resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    };
    // Cancelled pickers fire no event in some browsers; resolve on focus return.
    window.addEventListener("focus", () => setTimeout(() => resolve(null), 500), { once: true });
    input.click();
  });
}
