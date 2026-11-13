import { useEffect, useState } from "react";
import { Bell, BellSlash } from "@phosphor-icons/react";
import { request } from "./api/client";

const demo = import.meta.env.VITE_DEMO !== "false";
const tag = "shiguang-updates";
let worker: Promise<ServiceWorkerRegistration> | undefined;
function registration() {
  if (!worker) {
    worker = navigator.serviceWorker
      .register("/sw.js")
      .then(() => navigator.serviceWorker.ready)
      .catch((error) => {
        worker = undefined;
        throw error;
      });
  }
  return worker;
}
function supported() {
  return (
    !demo &&
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}
function base64(value: string) {
  return Uint8Array.from(
    atob(value.replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0),
  );
}
export function syncAppBadge(unread: number) {
  if (demo) return;
  const result =
    unread > 0 ? navigator.setAppBadge?.(unread) : navigator.clearAppBadge?.();
  void result?.catch(() => {});
  if (!unread)
    void worker
      ?.then(async (reg) => {
        for (const notification of await reg.getNotifications({ tag }))
          notification.close();
      })
      .catch(() => {});
}
export function clearAppNotifications() {
  syncAppBadge(0);
  if (!demo && "serviceWorker" in navigator)
    void navigator.serviceWorker
      .getRegistration()
      .then(async (reg) => {
        for (const item of (await reg?.getNotifications({ tag })) || [])
          item.close();
      })
      .catch(() => {});
}

type Config = { publicKey: string; enabled: boolean };
export function PushSettings() {
  const canEnable = supported();
  const [configuration, setConfiguration] = useState<{
    config: Config;
    registration: ServiceWorkerRegistration;
  }>();
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!canEnable) return;
    const controller = new AbortController();
    setError("");
    void Promise.all([
      registration(),
      request<Config>("/push", { signal: controller.signal }),
    ])
      .then(async ([reg, config]) => {
        const sub = await reg.pushManager.getSubscription();
        if (!controller.signal.aborted) {
          setConfiguration({ config, registration: reg });
          setEnabled(
            Boolean(
              config.enabled && sub && Notification.permission === "granted",
            ),
          );
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("暂时无法连接通知服务");
      });
    return () => controller.abort();
  }, [canEnable, retry]);

  async function toggle() {
    if (!configuration || busy) return;
    setBusy(true);
    setError("");
    const { registration: reg, config } = configuration;
    try {
      if (enabled) {
        await request("/push", { method: "DELETE" });
        setEnabled(false);
        clearAppNotifications();
        const sub = await reg.pushManager.getSubscription();
        await sub?.unsubscribe().catch(() => {});
      } else {
        // Called directly in the click event; installed Safari requires a user gesture.
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64(config.publicKey),
        });
        const { keys } = sub.toJSON();
        await request("/push", {
          method: "PUT",
          body: JSON.stringify({
            endpoint: sub.endpoint,
            p256dh: keys?.p256dh,
            auth: keys?.auth,
          }),
        });
        setEnabled(true);
        window.dispatchEvent(new Event("shiguang:activity-changed"));
      }
    } catch (e) {
      setError(
        Notification.permission === "denied"
          ? "通知权限已关闭，可以在系统或浏览器的通知设置中重新允许。"
          : e instanceof Error && e.name === "InvalidStateError"
            ? "订阅已失效，请重试。"
            : "设置通知失败，请稍后再试。",
      );
      if (e instanceof Error && e.name === "InvalidStateError")
        await reg.pushManager
          .getSubscription()
          .then((sub) => sub?.unsubscribe())
          .catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  if (demo) return null;
  return (
    <section className="push-settings" aria-labelledby="push-heading">
      <div>
        <h2 id="push-heading">
          <Bell aria-hidden="true" />
          消息提醒
        </h2>
        <p>
          {enabled
            ? "此设备已开启提醒。对方有新动态时，系统会提示你。"
            : "开启后，即使没有打开拾光，也能收到对方的更新提醒。"}
        </p>
        {!canEnable && (
          <p>
            当前浏览器无法开启系统通知。iPhone 或 iPad 可先从 Safari
            将拾光添加到主屏幕，再从图标打开并登录。
          </p>
        )}
      </div>
      {canEnable && (
        <button
          className={enabled ? "subtle-link" : "primary"}
          disabled={busy || !configuration}
          onClick={() => void toggle()}
        >
          {enabled ? (
            <BellSlash aria-hidden="true" />
          ) : (
            <Bell aria-hidden="true" />
          )}
          {busy ? "正在设置…" : enabled ? "关闭此设备的通知" : "开启系统通知"}
        </button>
      )}
      {error && (
        <p className="post-feedback" role="alert">
          {error}{" "}
          {!configuration && (
            <button onClick={() => setRetry((x) => x + 1)}>重试</button>
          )}
        </p>
      )}
    </section>
  );
}

export function usePushActivity(
  user: string | null,
  unread: number,
  ready: boolean,
) {
  useEffect(() => {
    if (!user) {
      clearAppNotifications();
      return;
    }
    if (!supported()) return;
    void registration().catch(() => {});
    const refresh = (event: MessageEvent) => {
      if (event.data?.type === "shiguang:push")
        window.dispatchEvent(new Event("shiguang:activity-changed"));
    };
    navigator.serviceWorker.addEventListener("message", refresh);
    return () =>
      navigator.serviceWorker.removeEventListener("message", refresh);
  }, [user]);
  useEffect(() => {
    if (user && ready) syncAppBadge(unread);
  }, [user, unread, ready]);
}
