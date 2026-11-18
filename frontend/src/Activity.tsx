import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Bell,
  ArrowRight,
  X,
  Check,
  ArrowClockwise,
} from "@phosphor-icons/react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { request } from "./api/client";
import { usePushActivity } from "./push";
import { demoIdentity, demoMemberName } from "./members";

const demo = import.meta.env.VITE_DEMO !== "false";
export type Activity = import("./api/schema").components["schemas"]["Activity"];
type PhotoUpdate = NonNullable<Activity["photoUpdate"]>;
type Feed = import("./api/schema").components["schemas"]["ActivityFeed"];
const empty: Feed = { items: [], unread: 0, latestId: 0, nextCursor: null };
const labels: Record<string, string> = {
  accounts: "个人资料",
  memories: "时光",
  albums: "相册",
  messages: "记录盒",
  wishes: "愿望单",
  anniversaries: "纪念日",
  places: "足迹",
  cover: "首页",
  garden: "一起玩",
  music: "背景音乐",
};
let demoMusicActivities: Activity[] = [];
export function clearDemoMusicActivities() {
  demoMusicActivities = [];
  if (demo) activityChanged();
}
export const activityChanged = () =>
  window.dispatchEvent(new Event("shiguang:activity-changed"));
export function demoActivity(
  module: string,
  targetId: string,
  action: string,
  title: string,
  summary: string,
  route: string,
  photoUpdate?: PhotoUpdate,
) {
  if (!demo) return;
  const name = sessionStorage.getItem("shiguang:demo-user");
  if (!name) return;
  const actor = demoIdentity(name);
  const rows = demoRows();
  rows.unshift({
    id: Math.max(Date.now(), (rows[0]?.id || 0) + 1),
    actor,
    mine: false,
    module,
    targetId,
    action,
    title,
    summary,
    route,
    createdAt: new Date().toISOString(),
    read: false,
    deleted: false,
    photoUpdate,
  });
  if (module === "music") demoMusicActivities.unshift(rows[0]);
  else
    localStorage.setItem(
      "shiguang:activities",
      JSON.stringify(rows.filter((row) => row.module !== "music")),
    );
  activityChanged();
}
function demoRows(): Activity[] {
  let saved: Activity[] = [];
  try {
    const value = JSON.parse(
      localStorage.getItem("shiguang:activities") || "[]",
    );
    if (Array.isArray(value)) saved = value;
  } catch {
    /* A damaged demo history must not hide tab-memory music events. */
  }
  return [
    ...demoMusicActivities,
    ...saved.filter((row) => row.module !== "music"),
  ].sort((a, b) => b.id - a.id);
}
function demoRead(user: string): number[] {
  try {
    return JSON.parse(
      localStorage.getItem(`shiguang:activity-read:${user}`) || "[]",
    );
  } catch {
    return [];
  }
}
function demoFeed(user: string, all: boolean, before?: number): Feed {
  user = demoIdentity(user);
  const rows = demoRows(),
    read = new Set(demoRead(user));
  const visible = rows.filter(
    (x) => (all || x.actor !== user) && (!before || x.id < before),
  );
  return {
    items: visible.slice(0, 30).map((x) => ({
      ...x,
      actor: demoMemberName(x.actor),
      mine: x.actor === user,
      read: x.actor === user || read.has(x.id),
      deleted:
        rows.find(
          (y) =>
            y.module === x.module &&
            y.targetId === x.targetId &&
            !["liked", "commented"].includes(y.action),
        )?.action === "deleted",
    })),
    unread: rows.filter((x) => x.actor !== user && !read.has(x.id)).length,
    latestId: rows[0]?.id || 0,
    nextCursor: visible.length > 30 ? visible[29].id : null,
  };
}
export function demoSettingActivity(
  key: string,
  before: unknown,
  after: unknown,
) {
  if (!demo || JSON.stringify(before) === JSON.stringify(after)) return;
  if (key === "garden") {
    const a = after as { level: number; name: string },
      b = before as { level: number };
    if (a.level > b.level)
      demoActivity(
        key,
        key,
        "milestone",
        a.name,
        `成长到了第 ${a.level} 级`,
        "/play",
      );
    return;
  }
  if (!Array.isArray(after) || !["albums", "messages", "wishes"].includes(key))
    return;
  type Row = {
    id: string;
    title?: string;
    description?: string;
    text?: string;
    done?: boolean;
    coverId?: string | null;
    photos?: { id: string }[];
  };
  const previous = new Map<string, Row>(
    (Array.isArray(before) ? before : []).map((x: Row) => [x.id, x]),
  );
  const current = new Map<string, Row>(after.map((x: Row) => [x.id, x]));
  const route = (id: string) =>
    key === "albums"
      ? `/albums/${encodeURIComponent(id)}`
      : `/${key === "messages" ? "records" : "wishes"}?activity=${encodeURIComponent(id)}`;
  for (const [id, x] of current) {
    const old = previous.get(id);
    if (JSON.stringify(x) === JSON.stringify(old)) continue;
    let action = old ? "updated" : "created",
      summary = `${old ? "修改了" : "新增了"}${labels[key]}`;
    if (key === "wishes" && old && old.done !== x.done) {
      action = x.done ? "completed" : "reopened";
      summary = x.done ? "完成了愿望" : "重新开启了愿望";
    }
    let photoUpdate: PhotoUpdate | undefined;
    if (key === "albums" && old) {
      const added = (x.photos || []).filter(
          (p) => !old.photos?.some((y) => y.id === p.id),
        ),
        removed = (old.photos || []).filter(
          (p) => !x.photos?.some((y) => y.id === p.id),
        ).length;
      if (added.length) {
        summary = `添加了 ${added.length} 张照片`;
        photoUpdate = {
          kind: "added",
          photoIds: added.map((photo) => photo.id),
        };
      } else if (removed) summary = `移除了 ${removed} 张照片`;
      else if (x.coverId && x.coverId !== old.coverId) {
        summary = "更换了相册封面";
        photoUpdate = { kind: "cover", photoIds: [x.coverId] };
      } else if (
        x.photos?.some((photo, index) => photo.id !== old.photos?.[index]?.id)
      )
        summary = "调整了照片顺序";
      else if (old.title !== x.title || old.description !== x.description)
        summary = "修改了相册信息";
    }
    demoActivity(
      key,
      id,
      action,
      x.title || x.text || "未命名内容",
      summary,
      route(id),
      photoUpdate,
    );
  }
  for (const [id, x] of previous)
    if (!current.has(id))
      demoActivity(
        key,
        id,
        "deleted",
        x.title || x.text || "未命名内容",
        `删除了${labels[key]}`,
        route(id),
      );
}
let activityTime: Intl.DateTimeFormat | undefined;
function formatActivityTime(value: string) {
  activityTime ??= new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return activityTime.format(new Date(value));
}

function compatibleAlbumUpdates(a: Activity, b: Activity) {
  if (a.module !== "albums") return true;
  return (
    a.photoUpdate?.kind === "added" &&
    b.photoUpdate?.kind === "added" &&
    a.photoUpdate.photoIds.length + b.photoUpdate.photoIds.length <= 25
  );
}
function groups(items: Activity[]) {
  const result: { item: Activity; ids: number[]; read: boolean }[] = [];
  for (const item of items) {
    const last = result[result.length - 1];
    if (
      last &&
      item.action === "updated" &&
      last.item.action === "updated" &&
      last.read === item.read &&
      item.actor === last.item.actor &&
      item.mine === last.item.mine &&
      item.module === last.item.module &&
      item.targetId === last.item.targetId &&
      last.ids.length < 100 &&
      compatibleAlbumUpdates(last.item, item) &&
      Date.parse(last.item.createdAt) - Date.parse(item.createdAt) < 300000
    ) {
      last.ids.push(item.id);
      if (
        last.item.photoUpdate?.kind === "added" &&
        item.photoUpdate?.kind === "added"
      ) {
        // Read separate bursts as one update, with photos in upload order.
        const photoIds = [
          ...new Set([
            ...item.photoUpdate.photoIds,
            ...last.item.photoUpdate.photoIds,
          ]),
        ];
        last.item = {
          ...last.item,
          summary: `添加了 ${photoIds.length} 张照片`,
          photoUpdate: { kind: "added", photoIds },
        };
      }
    } else result.push({ item, ids: [item.id], read: item.read });
  }
  return result;
}

function destination(item: Activity) {
  if (!item.photoUpdate || item.module !== "albums") return item.route;
  const params = new URLSearchParams();
  params.set("photoChange", item.photoUpdate.kind);
  for (const photo of item.photoUpdate.photoIds) params.append("photo", photo);
  return `${item.route.split("?")[0]}?${params}`;
}
export function useActivities(user: string | null) {
  const [feed, setFeed] = useState<Feed>(empty),
    [all, setAll] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [fetchedFor, setFetchedFor] = useState<string | null>(null);
  const [preview, setPreview] = useState<Activity[]>([]);
  const [readFailure, setReadFailure] = useState<{
    ids?: number[];
    throughId: number;
  }>();
  const generation = useRef(0),
    currentUser = useRef(user);
  currentUser.current = user;
  const refresh = useCallback(
    async (before?: number) => {
      if (!user) return;
      const token = ++generation.current;
      setBusy(true);
      try {
        const next = demo
          ? demoFeed(user, all, before)
          : await request<Feed>(
              `/activities?all=${all}${before ? `&before=${before}` : ""}`,
            );
        const recent =
          all && !before
            ? demo
              ? demoFeed(user, false)
              : await request<Feed>("/activities")
            : next;
        if (token !== generation.current || currentUser.current !== user)
          return;
        if (!before) setPreview(recent.items.slice(0, 3));
        setFeed((prev) => ({
          ...next,
          items: before ? [...prev.items, ...next.items] : next.items,
        }));
        setError("");
        setFetchedFor(user);
      } catch (e) {
        if (token === generation.current && currentUser.current === user)
          setError((e as Error).message);
      } finally {
        if (token === generation.current && currentUser.current === user)
          setBusy(false);
      }
    },
    [user, all],
  );
  useEffect(() => {
    ++generation.current;
    setFeed(empty);
    setFetchedFor(null);
    setPreview([]);
    setError("");
    setReadFailure(undefined);
    setBusy(false);
    if (!user) return;
    const update = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    void refresh();
    const interval = window.setInterval(update, 60000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("shiguang:activity-changed", update);
    window.addEventListener("storage", update);
    return () => {
      ++generation.current;
      clearInterval(interval);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("shiguang:activity-changed", update);
      window.removeEventListener("storage", update);
    };
  }, [refresh, user]);
  async function mark(ids?: number[], throughId = feed.latestId) {
    if (!user) return false;
    const shouldRead = (item: Activity) =>
      ids ? ids.includes(item.id) : item.id <= throughId;
    try {
      if (demo)
        localStorage.setItem(
          `shiguang:activity-read:${demoIdentity(user)}`,
          JSON.stringify([
            ...new Set([
              ...demoRead(demoIdentity(user)),
              ...(ids ||
                demoRows()
                  .filter((x) => x.id <= throughId)
                  .map((x) => x.id)),
            ]),
          ]),
        );
      else if (ids)
        await request("/activities/read", {
          method: "POST",
          body: JSON.stringify({ ids }),
        });
      else
        await request("/activities/read-all", {
          method: "POST",
          body: JSON.stringify({ throughId }),
        });
      if (currentUser.current !== user) return false;
      setError("");
      setReadFailure(undefined);
      setFeed((prev) => ({
        ...prev,
        unread: Math.max(
          0,
          prev.unread -
            prev.items.filter((x) => !x.read && shouldRead(x)).length,
        ),
        items: prev.items.map((x) =>
          shouldRead(x) ? { ...x, read: true } : x,
        ),
      }));
      setPreview((prev) =>
        prev.map((x) => (shouldRead(x) ? { ...x, read: true } : x)),
      );
      // Refresh the server count so writes arriving during mark-all stay unread.
      activityChanged();
      return true;
    } catch (e) {
      if (currentUser.current === user) {
        setReadFailure({ ids, throughId });
      }
      return false;
    }
  }
  return {
    feed,
    preview,
    all,
    setAll,
    busy,
    error,
    refresh,
    mark,
    readFailure,
    ready: Boolean(user && fetchedFor === user),
  };
}
export function ActivityCenter({
  user,
  home,
  headerTarget,
  homeTarget,
}: {
  user: string | null;
  home: boolean;
  headerTarget: HTMLDivElement | null;
  homeTarget: HTMLDivElement | null;
}) {
  const state = useActivities(user),
    { feed, preview, all, setAll, busy, error, refresh, mark } = state;
  const [open, setOpen] = useState(false);
  const leaving = useRef(false);
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  usePushActivity(user, feed.unread, state.ready && !busy && !error);
  useEffect(() => {
    if (!user) setOpen(false);
    else if (params.get("updates") === "1") {
      setOpen(true);
      const next = new URLSearchParams(params);
      next.delete("updates");
      setParams(next, { replace: true });
    }
  }, [user, params, setParams]);
  if (!user) return null;
  function visit(item: Activity, ids: number[], read: boolean) {
    if (!item.deleted) {
      leaving.current = open;
      setOpen(false);
      const path = destination(item);
      if (path !== location.pathname + location.search || path.includes("?"))
        navigate(path);
      else if (item.module === "albums")
        window.scrollTo({ top: 0, behavior: "instant" });
    }
    if (!read) void mark(ids);
  }
  const failedRead = state.readFailure;
  const readFeedback = failedRead && (
    <p className="post-feedback" role="alert">
      暂时无法保存已读状态。{" "}
      <button
        type="button"
        onClick={() => void mark(failedRead.ids, failedRead.throughId)}
      >
        重试标记已读
      </button>
    </p>
  );
  const render = (items: Activity[]) =>
    groups(items).map(({ item, ids, read }) => (
      <button
        key={item.id}
        className={`activity-row ${read ? "" : "is-unread"}`}
        onClick={() => visit(item, ids, read)}
        aria-label={`${item.actor}，${item.summary}，${item.title}${read ? "" : "，未读"}`}
      >
        <span className="activity-avatar" aria-hidden="true">
          {item.actor.slice(0, 1)}
        </span>
        <span className="activity-copy">
          <span>
            <strong>{item.mine ? "你" : item.actor}</strong>
            <span className="activity-module">
              {labels[item.module] || "更新"}
            </span>
            {!read && <span className="activity-dot" aria-label="未读" />}
          </span>
          <b>
            {item.summary} · {item.title}
          </b>
          <small>
            <time dateTime={item.createdAt}>
              {formatActivityTime(item.createdAt)}
            </time>
            {ids.length > 1 &&
              item.photoUpdate?.kind !== "added" &&
              " · 已合并连续修改"}
            {item.deleted && " · 内容已删除"}
          </small>
        </span>
        {!item.deleted && <ArrowRight aria-hidden="true" />}
      </button>
    ));
  return (
    <>
      {headerTarget &&
        createPortal(
          <button
            className="icon-button activity-trigger"
            onClick={() => {
              setOpen(true);
              void refresh();
            }}
            aria-expanded={open}
            aria-haspopup="dialog"
            aria-label={`最近更新，${feed.unread} 条未读`}
          >
            <Bell />
            {feed.unread > 0 && (
              <span className="activity-badge">
                {feed.unread > 99 ? "99+" : feed.unread}
              </span>
            )}
          </button>,
          headerTarget,
        )}
      {home &&
        homeTarget &&
        createPortal(
          <section className="activity-preview" aria-label="最近更新">
            <div className="activity-heading">
              <div>
                <span className="small-caps">LITTLE THINGS, SHARED</span>
                <h2>
                  最近更新{" "}
                  <span>
                    {feed.unread ? `${feed.unread} 条未读` : "彼此的新鲜事"}
                  </span>
                </h2>
              </div>
              <button className="subtle-link" onClick={() => setOpen(true)}>
                查看全部 <ArrowRight />
              </button>
            </div>
            {readFeedback}
            {error ? (
              <p role="alert">
                {error} <button onClick={() => void refresh()}>重试</button>
              </p>
            ) : preview.length ? (
              render(preview)
            ) : (
              <p className="activity-empty">
                这里会收好对方的新动态。有新内容时，来这里就能看见。
              </p>
            )}
          </section>,
          homeTarget,
        )}
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="overlay" />
          <Dialog.Content
            className="activity-panel"
            onCloseAutoFocus={(event) => {
              if (leaving.current) event.preventDefault();
              leaving.current = false;
            }}
          >
            <div className="activity-panel-top">
              <div>
                <span className="small-caps">OUR LATEST MOMENTS</span>
                <Dialog.Title>最近更新</Dialog.Title>
              </div>
              <Dialog.Close className="icon-button" aria-label="关闭最近更新">
                <X />
              </Dialog.Close>
            </div>
            <Dialog.Description>
              看看彼此最近留下了什么，点一下就能接着看。
            </Dialog.Description>
            <div className="activity-toolbar">
              <div className="activity-tabs" aria-label="动态范围">
                <button aria-pressed={!all} onClick={() => setAll(false)}>
                  对方的更新
                </button>
                <button aria-pressed={all} onClick={() => setAll(true)}>
                  全部动态
                </button>
              </div>
              <button
                className="subtle-link"
                disabled={!feed.unread || busy}
                onClick={() => void mark()}
              >
                <Check />
                全部已读
              </button>
            </div>
            {error && (
              <div className="error" role="alert">
                {error}
                <button onClick={() => void refresh()}>重试</button>
              </div>
            )}
            {readFeedback}
            <div className="activity-list" aria-busy={busy}>
              {render(feed.items)}
              {!feed.items.length && (
                <div className="activity-empty">
                  <Bell size={32} />
                  <p>
                    {busy
                      ? "正在整理最近更新…"
                      : all
                        ? "还没有动态，从今天的新故事开始吧。"
                        : "暂时没有对方的更新，新的小事会在这里等你。"}
                  </p>
                </div>
              )}
              {feed.nextCursor && (
                <button
                  className="activity-more"
                  disabled={busy}
                  onClick={() => void refresh(feed.nextCursor!)}
                >
                  {busy ? "正在加载…" : "加载更早的更新"}
                </button>
              )}
            </div>
            <footer>
              <span aria-live="polite">
                {feed.unread ? `${feed.unread} 条未读` : "更新都收在这里了"}
              </span>
              <button
                className="icon-button"
                aria-label="刷新最近更新"
                disabled={busy}
                onClick={() => void refresh()}
              >
                <ArrowClockwise />
              </button>
            </footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
