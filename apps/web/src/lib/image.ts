const MAX_EDGE = 1080;
// Below this we hand a still image through untouched. Base64 inflates ~33%, and
// the socket caps payloads at 3 MB, so keep headroom under the server's 2 MB
// decoded limit.
const PASSTHROUGH_MAX_BYTES = 1_800_000;
// Animated files can't be resized without destroying the animation, so they're
// passed through right up to the server's own limit and rejected there if over.
const SERVER_MAX_BYTES = 2_000_000;

function readAsDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

/**
 * True for animated WebP (an ANIM/ANMF chunk) or APNG (an acTL chunk). Both
 * markers live in the container header, so only the first KB is inspected —
 * scanning further risks false positives inside compressed pixel data.
 */
async function isAnimated(file: File): Promise<boolean> {
  if (file.type !== "image/webp" && file.type !== "image/png") return false;
  try {
    const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
    const marker = file.type === "image/webp" ? "ANIM" : "acTL";
    const codes = [...marker].map((c) => c.charCodeAt(0));
    outer: for (let i = 0; i <= head.length - codes.length; i++) {
      for (let k = 0; k < codes.length; k++) if (head[i + k] !== codes[k]) continue outer;
      return true;
    }
  } catch {
    /* unreadable — treat as still and let the normal path handle it */
  }
  return false;
}

/**
 * Opens the system file picker and returns an image data URL, always in the
 * file's original format (PNG / JPEG / WebP).
 *
 * Animated WebP/APNG is never touched — a canvas re-encode would flatten it to
 * a single frame, so it's passed through byte-for-byte. Small still images are
 * passed through too (preserving lossless encoding and alpha). Only oversized
 * stills are downscaled to MAX_EDGE, re-encoded in their *own* format.
 */
export function pickImage(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);

      // Animation check first: it decides the path regardless of dimensions.
      if (await isAnimated(file)) {
        if (file.size <= SERVER_MAX_BYTES) return resolve(await readAsDataUrl(file));
        // Too large to send intact; the only alternative is flattening it, so
        // fall through to the canvas path rather than failing the upload.
      }

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
