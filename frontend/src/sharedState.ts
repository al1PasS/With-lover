import { useEffect, useRef, useState } from "react";
import { request } from "./api/client";

const demo = import.meta.env.VITE_DEMO !== "false";

export function useSharedState<T>(
  key: string,
  initial: T,
  enabled = true,
  publicRead = false,
) {
  const initialValue = useRef(initial);
  const [value, setValue] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setValue(initialValue.current);
      setLoaded(false);
      return;
    }
    let active = true;
    (async () => {
      try {
        const raw = demo
          ? localStorage.getItem(`shiguang:${key}`) || ""
          : (await request<{ value: string }>(
              publicRead ? `/public/settings/${key}` : `/settings/${key}`,
            )).value;
        if (active && raw) setValue(JSON.parse(raw) as T);
      } catch {
        // An empty or older value should never make the private space unusable.
      } finally {
        if (active) setLoaded(true);
      }
    })();
    return () => { active = false; };
  }, [enabled, key, publicRead]);

  async function save(next: T) {
    setValue(next);
    const raw = JSON.stringify(next);
    if (demo) localStorage.setItem(`shiguang:${key}`, raw);
    else await request(`/settings/${key}`, { method: "PUT", body: JSON.stringify({ value: raw }) });
  }

  return { value, save, loaded };
}

export async function imageFileToData(file: File, maxSide = 1800) {
  if (!file.type.startsWith("image/")) throw new Error("请选择图片文件");
  if (file.size > 12 * 1024 * 1024) throw new Error("原图请控制在 12MB 以内");
  const source = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);
  canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
  source.close();
  return canvas.toDataURL("image/webp", .86);
}
