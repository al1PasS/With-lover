import { useEffect, useState } from "react";
import { Bell, BellSlash } from "@phosphor-icons/react";
import { Link } from "react-router-dom";
import { ApiError, request } from "./api/client";

const demo = import.meta.env.VITE_DEMO !== "false";
const tag = "shiguang-updates";
let worker: Promise<ServiceWorkerRegistration> | undefined;
function registration() {
  if (!worker) {
    worker = navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        const pending = reg.installing || reg.waiting;
        if (reg.active || !pending) return reg;
        return new Promise<ServiceWorkerRegistration>((resolve, reject) => {
          const check = () => {
            if (pending.state === "activated") {
              pending.removeEventListener("statechange", check);
              resolve(reg);
            } else if (pending.state === "redundant") {
              pending.removeEventListener("statechange", check);
              reject(new Error("Notification worker failed to activate"));
            }
          };
          pending.addEventListener("statechange", check);
          check();
        });
      })
      .catch((error) => {
        worker = undefined;
        throw error;
      });
  }
  return worker;
}
function canRegisterWorker() {
  return !demo && window.isSecureContext && Boolean(navigator.serviceWorker);
}
function unsupportedHint() {
  const platform = navigator.userAgent;
  if (/Android/i.test(platform))
    return "当前浏览器无法接收系统通知。可以用支持网站通知的浏览器（如 Chrome）打开拾光，登录后开启。";
  if (
    /iPhone|iPad|iPod/i.test(platform) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  )
    return "请在 Safari 将拾光添加到主屏幕，再从图标打开并登录，在这里开启通知。";
  return "当前浏览器无法接收系统通知，可以用支持网站通知的浏览器打开拾光。";
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
  if (canRegisterWorker())
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
  const canRegister = canRegisterWorker();
  const [unsupported, setUnsupported] = useState(false);
  const [configuration, setConfiguration] = useState<{
    config: Config;
    registration: ServiceWorkerRegistration;
  }>();
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!canRegister) return;
    const controller = new AbortController();
    setError("");
    void registration()
      .then(async (reg) => {
        if (controller.signal.aborted) return;
        if (
          typeof reg.pushManager?.subscribe !== "function" ||
          typeof reg.pushManager?.getSubscription !== "function" ||
          typeof reg.showNotification !== "function"
        ) {
          setUnsupported(true);
          return;
        }
        const config = await request<Config>("/push", {
          signal: controller.signal,
        });
        const sub = await reg.pushManager.getSubscription();
        if (!controller.signal.aborted) {
          setConfiguration({ config, registration: reg });
          setEnabled(
            Boolean(
              config.enabled &&
              sub &&
              (!window.Notification || Notification.permission === "granted"),
            ),
          );
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("暂时无法连接通知服务");
      });
    return () => controller.abort();
  }, [canRegister, retry]);

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
      }
    } catch (e) {
      const name = e instanceof Error ? e.name : "";
      const denied = window.Notification?.permission === "denied";
      const incompatible =
        name === "NotSupportedError" ||
        (e instanceof ApiError && e.status === 400);
      if (incompatible) setUnsupported(true);
      else
        setError(
          denied
            ? "请在浏览器的网站权限中允许通知，也检查手机系统是否允许该浏览器发通知。"
            : name === "InvalidStateError"
              ? "订阅已失效，请重试。"
              : name === "NotAllowedError"
                ? "开启通知时请选择允许。也可以检查浏览器和系统的通知权限。"
                : "暂时无法连接推送服务，请检查网络后重试。",
        );
      if (name === "InvalidStateError")
        await reg.pushManager
          .getSubscription()
          .then((sub) => sub?.unsubscribe())
          .catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  if (demo) return null;
  const unavailable = !canRegister || unsupported;
  return (
    <section className="push-settings" aria-labelledby="push-heading">
      <div>
        <h2 id="push-heading">
          <Bell aria-hidden="true" />
          消息提醒
        </h2>
        {unavailable ? (
          <>
            <p>
              {window.isSecureContext
                ? unsupportedHint()
                : "系统通知需要通过 HTTPS 打开拾光。"}
            </p>
            <Link className="subtle-link" to="/?updates=1">
              查看最近更新
            </Link>
          </>
        ) : (
          <p>
            {enabled
              ? "此浏览器已开启系统通知。"
              : "开启后，即使没有打开拾光，也能收到对方的更新提醒。"}
          </p>
        )}
      </div>
      {!unavailable && (
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
          {busy
            ? "正在设置…"
            : !configuration && !error
              ? "正在检查通知支持…"
              : enabled
                ? "关闭此设备的通知"
                : "开启系统通知"}
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
    if (!canRegisterWorker()) return;
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
