export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const PHOTO_ACCEPT = "image/*,.heic,.heif";
export const PHOTO_SIZE_ERROR = "单张照片不能超过 10 MB";

const HEIF_BRANDS = /^(mif1|msf1|hei[cxms]|hev[cxms])$/;
const MAX_PIXELS = 50_000_000;
const MAX_COMPRESSED_BYTES = 1_500_000;

export class ImageReadError extends Error {}

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  return new Promise<HTMLImageElement>((resolve, reject) => {
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  }).finally(() => URL.revokeObjectURL(url));
}

async function decodePhoto(file: File) {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    try {
      return await loadImage(file);
    } catch {
      try {
        const header = await file.slice(0, 12).text();
        if (
          /\.hei[cf]$/i.test(file.name) ||
          /^image\/hei[cf](?:-sequence)?$/i.test(file.type) ||
          (header.slice(4, 8) === "ftyp" && HEIF_BRANDS.test(header.slice(8)))
        ) {
          const { heicTo } = await import("heic-to/csp");
          if (typeof createImageBitmap === "function")
            return await heicTo({ blob: file, type: "bitmap" });
          return await loadImage(
            await heicTo({ blob: file, type: "image/png" }),
          );
        }
      } catch {
        // Use the same actionable error for malformed and unsupported images.
      }
      throw new ImageReadError("无法读取这张照片，请换一张再试");
    }
  }
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("无法压缩这张照片"));
      },
      type,
      quality / 100,
    );
  });
}

async function encodePhoto(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  quality: number,
  preserveTransparency: boolean,
) {
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  if (preserveTransparency) {
    for (let i = 3; i < pixels.data.length; i += 4) {
      // Browsers without WebP encoding return PNG, which also preserves alpha.
      if (pixels.data[i] < 255)
        return canvasBlob(canvas, "image/webp", quality);
    }
  }
  try {
    const { default: encode } = await import("@jsquash/jpeg/encode.js");
    return new Blob([await encode(pixels, { quality })], {
      type: "image/jpeg",
    });
  } catch {
    return canvasBlob(canvas, "image/jpeg", quality);
  }
}

export async function preparePhoto(
  file: File,
  {
    maxSide = 1800,
    quality = 86,
    panorama = false,
    preserveTransparency = false,
  } = {},
): Promise<Blob> {
  if (!file.size) throw new ImageReadError("这张照片是空文件");
  if (file.size > MAX_IMAGE_BYTES) throw new Error(PHOTO_SIZE_ERROR);
  const source = await decodePhoto(file);
  const canvas = document.createElement("canvas");
  try {
    const width = "naturalWidth" in source ? source.naturalWidth : source.width;
    const height =
      "naturalHeight" in source ? source.naturalHeight : source.height;
    if (!width || !height || width * height > MAX_PIXELS)
      throw new Error("照片分辨率过大，请缩小后再试");
    const ratio = width / height;
    if (panorama && (ratio < 6 || ratio > 8))
      throw new Error("长卷比例需要在 6:1 至 8:1 之间，推荐使用 7:1");

    const context = canvas.getContext("2d", { alpha: preserveTransparency });
    if (!context) throw new Error("无法准备照片");
    let scale = Math.min(1, maxSide / Math.max(width, height));
    for (let attempt = 0; attempt < 5; attempt++) {
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      if (panorama)
        canvas.height = Math.min(
          Math.floor(canvas.width / 6),
          Math.max(Math.ceil(canvas.width / 8), canvas.height),
        );
      context.imageSmoothingQuality = "high";
      if (!preserveTransparency) {
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      const blob = await encodePhoto(
        canvas,
        context,
        quality,
        preserveTransparency,
      );
      if (blob.size > 0 && blob.size <= MAX_COMPRESSED_BYTES) return blob;
      scale *= 0.75;
    }
    throw new Error("无法将照片压缩到上传大小，请换一张再试");
  } finally {
    if ("close" in source) source.close();
    canvas.width = canvas.height = 1;
  }
}

export function photoDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("无法读取压缩后的照片"));
    reader.readAsDataURL(blob);
  });
}
