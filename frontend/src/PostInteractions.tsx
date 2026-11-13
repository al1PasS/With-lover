import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ChatCircle, Heart } from "@phosphor-icons/react";
import { request } from "./api/client";
import { demoActivity } from "./Activity";
import { demoIdentity, usePostAuthor } from "./members";
import { postTime } from "./dates";

const demo = import.meta.env.VITE_DEMO !== "false";
type Module = "memories" | "messages";
type Comment = {
  id: number;
  authorId: number | string;
  body: string;
  createdAt: string;
};
type State = {
  liked: boolean;
  likes: number;
  commentCount: number;
  comments: Comment[];
  nextBefore: number | null;
};
const empty: State = {
  liked: false,
  likes: 0,
  commentCount: 0,
  comments: [],
  nextBefore: null,
};

export default function PostInteractions({
  module,
  id,
  title,
  user,
  expanded = false,
}: {
  module: Module;
  id: string;
  title: string;
  user: string;
  expanded?: boolean;
}) {
  const [open, setOpen] = useState(expanded);
  const [state, setState] = useState<State>(empty);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState<"like" | "comment" | "page" | "">("");
  const [loading, setLoading] = useState(true);
  const [visible, setVisible] = useState(expanded);
  const region = useRef<HTMLElement>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const controlsId = useId();
  const author = usePostAuthor();
  const path = `/interactions/${module}/${encodeURIComponent(id)}`;
  const key = `shiguang:${path}`;
  const identity = demo ? demoIdentity(user) : user;
  const route = `/${module === "messages" ? "records" : "timeline"}?activity=${encodeURIComponent(id)}`;

  function demoData(): { likes: string[]; comments: Comment[] } {
    try {
      return JSON.parse(
        localStorage.getItem(key) || '{"likes":[],"comments":[]}',
      );
    } catch {
      return { likes: [], comments: [] };
    }
  }
  function demoView(before?: number): State {
    const data = demoData();
    const rows = before
      ? data.comments.filter((c) => c.id < before)
      : data.comments;
    return {
      liked: data.likes.includes(identity),
      likes: data.likes.length,
      commentCount: data.comments.length,
      comments: rows.slice(0, 20),
      nextBefore: rows.length > 20 ? rows[19].id : null,
    };
  }
  useEffect(() => {
    if (visible) return;
    if (typeof IntersectionObserver === "undefined" || !region.current) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "100px" },
    );
    observer.observe(region.current);
    return () => observer.disconnect();
  }, [visible]);
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const refresh = async () => {
      try {
        const next = demo
          ? demoView()
          : await request<State>(path, { signal: controller.signal });
        if (!controller.signal.aborted) {
          setState(next);
          setError("");
        }
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void refresh();
    return () => controller.abort();
  }, [path, identity, retry, visible]);

  async function toggleLike() {
    setBusy("like");
    setError("");
    const liked = !state.liked;
    try {
      if (demo) {
        const data = demoData();
        data.likes = liked
          ? [...new Set([...data.likes, identity])]
          : data.likes.filter((x) => x !== identity);
        localStorage.setItem(key, JSON.stringify(data));
        if (liked) demoActivity(module, id, "liked", title, "点了赞", route);
        setState(demoView());
      } else
        setState(
          await request<State>(`${path}/like`, {
            method: "PUT",
            body: JSON.stringify({ liked }),
          }),
        );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function comment(event: FormEvent) {
    event.preventDefault();
    if (busy || !body.trim()) return;
    setBusy("comment");
    setError("");
    try {
      if (demo) {
        const data = demoData();
        data.comments.unshift({
          id: Math.max(Date.now(), (data.comments[0]?.id || 0) + 1),
          authorId: identity,
          body: body.trim(),
          createdAt: new Date().toISOString(),
        });
        localStorage.setItem(key, JSON.stringify(data));
        demoActivity(module, id, "commented", title, "发表了评论", route);
        setState(demoView());
      } else
        setState(
          await request<State>(`${path}/comments`, {
            method: "POST",
            body: JSON.stringify({ body: body.trim() }),
          }),
        );
      setBody("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function earlier() {
    if (state.nextBefore === null) return;
    setBusy("page");
    setError("");
    try {
      const next = demo
        ? demoView(state.nextBefore)
        : await request<State>(`${path}?before=${state.nextBefore}`);
      setState((previous) => ({
        ...next,
        comments: [...previous.comments, ...next.comments],
      }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  return (
    <section
      ref={region}
      className="post-interactions"
      aria-label={`${title}的点赞和评论`}
    >
      <div className="post-actions">
        <button
          type="button"
          aria-pressed={state.liked}
          onClick={() => void toggleLike()}
          disabled={loading || Boolean(busy)}
          aria-label={
            state.liked
              ? `取消赞，${state.likes} 个赞`
              : `点赞，${state.likes} 个赞`
          }
        >
          <Heart aria-hidden="true" weight={state.liked ? "fill" : "regular"} />
          <span>
            {state.liked ? "已赞" : "赞"}
            {state.likes > 0 && ` · ${state.likes}`}
          </span>
        </button>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={controlsId}
          onClick={() => {
            setVisible(true);
            setOpen(!open);
            if (!open && !loading && !busy) setRetry((n) => n + 1);
          }}
        >
          <ChatCircle aria-hidden="true" />
          <span>
            评论{state.commentCount > 0 && ` · ${state.commentCount}`}
          </span>
        </button>
      </div>
      {error && (
        <div className="post-feedback" role="alert">
          {error}{" "}
          <button type="button" onClick={() => setRetry((n) => n + 1)}>
            刷新
          </button>
        </div>
      )}
      <div id={controlsId} className="post-comments" hidden={!open}>
        <form onSubmit={comment}>
          <label htmlFor={`${controlsId}-text`}>写评论</label>
          <textarea
            id={`${controlsId}-text`}
            rows={2}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={1000}
            required
            placeholder="留一句话给对方…"
          />
          <button
            className="primary"
            disabled={loading || Boolean(busy) || !body.trim()}
          >
            {busy === "comment" ? "发送中…" : "发送评论"}
          </button>
        </form>
        {state.comments.length > 0 ? (
          <ul>
            {state.comments.map((c) => (
              <li key={c.id}>
                <div>
                  <strong>{author(c.authorId)}</strong>
                  <time dateTime={c.createdAt}>{postTime(c.createdAt)}</time>
                </div>
                <p>{c.body}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p>{loading ? "正在加载评论…" : "还没有评论。"}</p>
        )}
        {state.nextBefore !== null && (
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void earlier()}
          >
            加载更早的评论
          </button>
        )}
      </div>
    </section>
  );
}
