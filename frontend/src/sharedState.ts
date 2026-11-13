import { useEffect, useRef, useState } from "react";
import { demoSettingActivity } from "./Activity";
import { useLocation } from "react-router-dom";
import { ApiError, request } from "./api/client";

const demo = import.meta.env.VITE_DEMO !== "false";

export function useSharedState<T>(
  key: string,
  initial: T,
  enabled = true,
  publicRead = false,
) {
  const location = useLocation();
  const initialValue = useRef(initial);
  const [value, setValue] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const revision = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!enabled) {
      setValue(initialValue.current);
      setLoaded(false);
      return;
    }
    const controller = new AbortController();
    setLoaded(false);
    setError("");
    (async () => {
      try {
        const result = demo
          ? {
              value: localStorage.getItem(`shiguang:${key}`) || "",
              revision: undefined,
            }
          : await request<{ value: string; revision?: string }>(
              publicRead ? `/public/settings/${key}` : `/settings/${key}`,
              { signal: controller.signal },
            );
        if (!controller.signal.aborted) {
          revision.current = result.revision;
          setValue(
            result.value
              ? (JSON.parse(result.value) as T)
              : initialValue.current,
          );
        }
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      } finally {
        if (!controller.signal.aborted) setLoaded(true);
      }
    })();
    return () => controller.abort();
  }, [enabled, key, publicRead, location.key, retry]);

  async function save(next: T) {
    const raw = JSON.stringify(next);
    if (demo) {
      localStorage.setItem(`shiguang:${key}`, raw);
      demoSettingActivity(key, value, next);
      setValue(next);
    } else {
      try {
        const saved = await request<{ value: string; revision?: string }>(
          `/settings/${key}`,
          {
            method: "PUT",
            body: JSON.stringify({ value: raw, revision: revision.current }),
          },
        );
        revision.current = saved.revision;
        setValue(JSON.parse(saved.value) as T);
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) setRetry((x) => x + 1);
        throw e;
      }
    }
  }

  return { value, save, loaded, error, reload: () => setRetry((x) => x + 1) };
}
