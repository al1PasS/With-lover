import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useNavigate } from "react-router-dom";
import * as Dialog from "@radix-ui/react-dialog";
import {
  MusicNote,
  MusicNotes,
  Prohibit,
  UploadSimple,
  Trash,
  Check,
  X,
  ArrowClockwise,
} from "@phosphor-icons/react";
import { ApiError, request } from "./api/client";
import { clearDemoMusicActivities, demoActivity } from "./Activity";
import {
  BackgroundPlayer,
  emptyMusic,
  newerMusic,
  musicUploadError,
  formatMusicBytes,
  type MusicSnapshot,
  type MusicTrack,
  type Playback,
} from "./musicState";

const demo = import.meta.env.VITE_DEMO !== "false";
const initialPlayback: Playback = { enabled: true, state: "empty" };

// Demo audio is tab-memory only: no file, URL, selection, or title enters browser storage.
class DemoMusic {
  snapshot = { ...emptyMusic(), revision: 0 };
  private urls = new Map<string, string>();
  source(id: string) {
    return this.urls.get(id) || "";
  }
  upload(file: File, title: string) {
    const error = musicUploadError(file, this.snapshot);
    if (error) throw new Error(error);
    const track: MusicTrack = {
      id: crypto.randomUUID(),
      title: title.trim() || file.name.replace(/\.(mp3|wav)$/i, ""),
      contentType: /\.mp3$/i.test(file.name) ? "audio/mpeg" : "audio/wav",
      byteSize: file.size,
      createdAt: new Date().toISOString(),
    };
    this.urls.set(track.id, URL.createObjectURL(file));
    this.snapshot = {
      ...this.snapshot,
      tracks: [...this.snapshot.tracks, track],
      revision: this.snapshot.revision + 1,
    };
    demoActivity(
      "music",
      track.id,
      "created",
      track.title,
      "上传了音乐",
      `/admin?activity=${encodeURIComponent(track.id)}`,
    );
    return this.snapshot;
  }
  select(id: string | null) {
    if (id === this.snapshot.selectedTrackId) return this.snapshot;
    const track = this.snapshot.tracks.find((track) => track.id === id);
    if (id && !track) throw new Error("这首音乐已经删除，请刷新曲库");
    const previous = this.snapshot.selectedTrackId;
    this.snapshot = {
      ...this.snapshot,
      selectedTrackId: id,
      revision: this.snapshot.revision + 1,
    };
    demoActivity(
      "music",
      id || previous || "music",
      "updated",
      track?.title || "背景音乐",
      id ? "设置了背景音乐" : "清空了背景音乐",
      `/admin?activity=${encodeURIComponent(id || previous || "music")}`,
    );
    return this.snapshot;
  }
  remove(id: string) {
    const track = this.snapshot.tracks.find((track) => track.id === id);
    if (!track) throw new Error("这首音乐已经删除，请刷新曲库");
    this.snapshot = {
      ...this.snapshot,
      tracks: this.snapshot.tracks.filter((track) => track.id !== id),
      selectedTrackId:
        this.snapshot.selectedTrackId === id
          ? null
          : this.snapshot.selectedTrackId,
      revision: this.snapshot.revision + 1,
    };
    // The controller clears a selected source before this URL is released.
    demoActivity(
      "music",
      id,
      "deleted",
      track.title,
      "删除了音乐",
      `/admin?activity=${encodeURIComponent(id)}`,
    );
    return this.snapshot;
  }
  release(id: string) {
    const url = this.urls.get(id);
    if (url) URL.revokeObjectURL(url);
    this.urls.delete(id);
  }
  dispose() {
    for (const id of this.urls.keys()) this.release(id);
    clearDemoMusicActivities();
  }
}

export function useBackgroundMusic(user: string | null, ready = true) {
  const signedIn = Boolean(user);
  const audioRef = useRef<HTMLAudioElement>(null);
  const controller = useRef<BackgroundPlayer | null>(null);
  const demoLibrary = useRef<DemoMusic | null>(null);
  const generation = useRef(0);
  const refreshSequence = useRef(0);
  const active = useRef(false);
  const pending = useRef(false);
  const snapshotRef = useRef<MusicSnapshot>(emptyMusic());
  const [snapshot, setSnapshot] = useState<MusicSnapshot>(emptyMusic);
  const [playback, setPlayback] = useState<Playback>(initialPlayback);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const apply = useCallback(
    (next: MusicSnapshot) => {
      const accepted = newerMusic(snapshotRef.current, next);
      if (accepted === snapshotRef.current) return;
      snapshotRef.current = accepted;
      setSnapshot(accepted);
      const id = accepted.selectedTrackId;
      controller.current?.setSource(
        id
          ? demo
            ? demoLibrary.current?.source(id) || ""
            : `/api/v1/${signedIn ? "music" : "public/music"}/tracks/${encodeURIComponent(id)}/content`
          : "",
      );
    },
    [signedIn],
  );
  const refresh = useCallback(async () => {
    if (!active.current) return;
    const token = generation.current;
    const sequence = ++refreshSequence.current;
    try {
      const next = demo
        ? demoLibrary.current!.snapshot
        : signedIn
          ? await request<MusicSnapshot>("/music")
          : {
              ...emptyMusic(),
              ...(await request<
                Pick<MusicSnapshot, "selectedTrackId" | "revision">
              >("/public/music")),
            };
      if (
        token !== generation.current ||
        sequence !== refreshSequence.current ||
        !active.current
      )
        return;
      apply(next);
      setError("");
    } catch (e) {
      if (
        token === generation.current &&
        sequence === refreshSequence.current &&
        active.current
      ) {
        if (e instanceof ApiError && [401, 403, 404].includes(e.status)) {
          // Permission changes need not increment the music revision.
          controller.current?.setSource("");
          snapshotRef.current = emptyMusic();
          setSnapshot(snapshotRef.current);
        }
        setError((e as Error).message);
      }
    } finally {
      if (
        token === generation.current &&
        sequence === refreshSequence.current &&
        active.current
      )
        setLoading(false);
    }
  }, [apply, signedIn]);
  const stop = useCallback(() => {
    active.current = false;
    ++generation.current;
    controller.current?.dispose();
    controller.current = null;
    demoLibrary.current?.dispose();
    demoLibrary.current = null;
    pending.current = false;
    snapshotRef.current = emptyMusic();
    setSnapshot(snapshotRef.current);
    setPlayback(initialPlayback);
    setLoading(false);
    setBusy(false);
    setError("");
    setMessage("");
  }, []);
  useEffect(() => {
    stop();
    if (!ready || !audioRef.current) return;
    active.current = true;
    const token = generation.current;
    controller.current = new BackgroundPlayer(audioRef.current, (value) => {
      if (active.current && token === generation.current) setPlayback(value);
    });
    if (demo) demoLibrary.current = new DemoMusic();
    setLoading(true);
    void refresh();
    const update = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = window.setInterval(update, 15000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("shiguang:music-changed", update);
    if (signedIn) window.addEventListener("shiguang:auth-expired", stop);
    // Media requests bypass request(); check auth even if a failed stream is in a hidden tab.
    const mediaError = () => void refresh();
    audioRef.current.addEventListener("error", mediaError);
    const audio = audioRef.current;
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("shiguang:music-changed", update);
      window.removeEventListener("shiguang:auth-expired", stop);
      audio.removeEventListener("error", mediaError);
      stop();
    };
  }, [signedIn, ready, refresh, stop]);

  async function mutate(
    action: "upload" | "select" | "delete",
    input: { file?: File; title?: string; id?: string | null },
  ) {
    if (!signedIn || !active.current || pending.current) return false;
    pending.current = true;
    const token = generation.current;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      let next: MusicSnapshot;
      if (demo) {
        const library = demoLibrary.current!;
        next =
          action === "upload"
            ? library.upload(input.file!, input.title || "")
            : action === "select"
              ? library.select(input.id || null)
              : library.remove(input.id!);
      } else if (action === "upload") {
        const form = new FormData();
        form.set("file", input.file!);
        if (input.title?.trim()) form.set("title", input.title.trim());
        next = await request<MusicSnapshot>("/music/tracks", {
          method: "POST",
          body: form,
        });
      } else if (action === "select") {
        next = await request<MusicSnapshot>("/music/selection", {
          method: "PUT",
          body: JSON.stringify({ trackId: input.id || null }),
        });
      } else {
        next = await request<MusicSnapshot>(
          `/music/tracks/${encodeURIComponent(input.id!)}`,
          { method: "DELETE" },
        );
      }
      if (token !== generation.current || !active.current) return false;
      apply(next);
      if (demo && action === "delete") demoLibrary.current!.release(input.id!);
      setMessage(
        action === "upload"
          ? "音乐已上传，点击“设为背景音乐”后才会播放。"
          : action === "delete"
            ? "音乐已删除。"
            : input.id
              ? "已更新两个人的背景音乐。"
              : "已清空背景音乐。",
      );
      window.dispatchEvent(new Event("shiguang:music-changed"));
      // Even while hidden, a completed write checks for a newer concurrent selection.
      void refresh();
      return true;
    } catch (e) {
      if (token === generation.current && active.current)
        setError((e as Error).message);
      return false;
    } finally {
      if (token === generation.current && active.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  }
  return {
    audioRef,
    canManage: signedIn,
    snapshot,
    playback,
    loading,
    busy,
    error,
    message,
    refresh,
    stop,
    toggle: () => controller.current?.toggle(),
    upload: (file: File, title: string) => mutate("upload", { file, title }),
    select: (id: string | null) => mutate("select", { id }),
    remove: (id: string) => mutate("delete", { id }),
  };
}
export type MusicModel = ReturnType<typeof useBackgroundMusic>;

const playbackText = {
  empty: "尚未选择歌曲，先上传并设置一首吧。",
  off: "此设备的音乐已关闭，不影响对方。",
  playing: "正在循环播放",
  blocked: "浏览器暂停了自动播放，点击右上角音符开启音乐。",
  loading: "正在准备播放…",
  error: "音乐暂时无法播放，请点击右上角音符重试。",
};
export function MusicToggle({ music }: { music: MusicModel }) {
  const navigate = useNavigate();
  const state = music.playback.state;
  const label =
    state === "empty"
      ? music.canManage
        ? "背景音乐：尚未选择歌曲，前往管理"
        : "背景音乐：暂无可播放的歌曲"
      : state === "off"
        ? "开启背景音乐"
        : state === "blocked"
          ? "点击开启音乐"
          : state === "error"
            ? "重试播放背景音乐"
            : "关闭背景音乐";
  const props = {
    className: `icon-button music-toggle ${state === "playing" ? "is-playing" : ""}`,
    "aria-label": label,
    title: label,
    "data-state": state,
    "data-testid": "background-music-toggle",
  };
  const icon = (
    <>
      <MusicNote className="music-note" aria-hidden="true" />
      {!music.playback.enabled && (
        <Prohibit className="music-slash" aria-hidden="true" />
      )}
    </>
  );
  return (
    <button
      {...props}
      type="button"
      aria-pressed={music.playback.enabled}
      disabled={state === "empty" && !music.canManage}
      onClick={() =>
        state === "empty" && music.canManage
          ? navigate("/admin")
          : music.toggle()
      }
    >
      {icon}
    </button>
  );
}

export function MusicPanel({ music }: { music: MusicModel }) {
  const { snapshot, playback, loading, busy, error, message } = music;
  const [deleting, setDeleting] = useState<MusicTrack | null>(null);
  const [uploadError, setUploadError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const selected = snapshot.tracks.find(
    (track) => track.id === snapshot.selectedTrackId,
  );
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setUploadError("请先选择一首音乐");
      return;
    }
    const error = musicUploadError(file, snapshot);
    setUploadError(error);
    if (error) return;
    if (await music.upload(file, String(new FormData(form).get("title") || "")))
      form.reset();
  }
  return (
    <section
      className="music-panel"
      aria-labelledby="music-title"
      aria-busy={loading || busy}
    >
      <div className="music-heading">
        <div className="music-panel-icon">
          <MusicNotes weight="duotone" aria-hidden="true" />
        </div>
        <div>
          <span className="small-caps">A SOUNDTRACK FOR US</span>
          <h2 id="music-title">背景音乐</h2>
          <p>两个人共用一份曲库与选曲，右上角开关只影响自己。</p>
        </div>
        <button
          className="icon-button"
          aria-label="刷新音乐曲库"
          disabled={busy || loading}
          onClick={() => void music.refresh()}
        >
          <ArrowClockwise />
        </button>
      </div>
      {demo && (
        <p className="music-demo">
          演示音乐仅保留在当前标签页内存中，刷新或退出即清空；不会上传到服务器。
        </p>
      )}
      <div className="music-current" aria-live="polite">
        <MusicNote aria-hidden="true" />
        <div>
          <strong>
            {selected ? `当前背景音乐：${selected.title}` : "还没有背景音乐"}
          </strong>
          <p>{playbackText[playback.state]}</p>
        </div>
        {selected && (
          <button
            className="subtle-link"
            disabled={busy}
            onClick={() => void music.select(null)}
          >
            清空选曲
          </button>
        )}
      </div>
      <form className="music-upload" onSubmit={upload}>
        <fieldset disabled={busy || loading}>
          <div className="music-field">
            <label htmlFor="music-file">选择音乐文件</label>
            <input
              ref={fileRef}
              id="music-file"
              name="file"
              type="file"
              accept=".mp3,.wav,audio/mpeg,audio/wav,audio/x-wav"
              onChange={() => setUploadError("")}
              aria-describedby="music-limits"
            />
          </div>
          <div className="music-field">
            <label htmlFor="music-track-title">歌曲名称（可选）</label>
            <input
              id="music-track-title"
              name="title"
              maxLength={120}
              placeholder="不填则使用文件名"
            />
          </div>
          <button className="primary" type="submit">
            <UploadSimple />
            {busy ? "正在处理…" : "上传音乐"}
          </button>
        </fieldset>
        <p id="music-limits" className="music-help">
          支持 MP3、PCM WAV；单首最多{" "}
          {formatMusicBytes(snapshot.limits.maxFileBytes)}，最多{" "}
          {snapshot.limits.maxTracks} 首，总容量{" "}
          {formatMusicBytes(snapshot.limits.maxTotalBytes)}
          。上传不会自动更换当前歌曲。
        </p>
        {uploadError && (
          <p className="music-error" role="alert">
            {uploadError}
          </p>
        )}
      </form>
      {error && (
        <p className="music-error" role="alert">
          {error}{" "}
          <button className="subtle-link" onClick={() => void music.refresh()}>
            重试
          </button>
        </p>
      )}
      {message && (
        <p className="music-message" role="status">
          {message}
        </p>
      )}
      {loading ? (
        <p className="music-empty" role="status">
          正在加载两个人的曲库…
        </p>
      ) : !snapshot.tracks.length ? (
        <p className="music-empty">曲库还是空的，上传一首属于你们的歌吧。</p>
      ) : (
        <ul className="music-list" aria-label="音乐曲库">
          {snapshot.tracks.map((track) => (
            <li
              id={`activity-${track.id}`}
              className="music-track"
              key={track.id}
            >
              <MusicNote className="music-track-icon" aria-hidden="true" />
              <div className="music-track-copy">
                <strong>{track.title}</strong>
                <small>
                  {track.contentType === "audio/mpeg" ? "MP3" : "WAV"} ·{" "}
                  {formatMusicBytes(track.byteSize)} ·{" "}
                  {new Date(track.createdAt).toLocaleDateString("zh-CN")}
                </small>
                {track.id === snapshot.selectedTrackId && (
                  <span className="music-selected">
                    <Check aria-hidden="true" />
                    当前背景音乐
                  </span>
                )}
              </div>
              <div className="music-track-actions">
                <button
                  className="music-select"
                  disabled={busy || track.id === snapshot.selectedTrackId}
                  onClick={() => void music.select(track.id)}
                >
                  {track.id === snapshot.selectedTrackId
                    ? "已设为背景音乐"
                    : "设为背景音乐"}
                </button>
                <button
                  className="icon-button"
                  aria-label={`删除音乐：${track.title}`}
                  disabled={busy}
                  onClick={() => setDeleting(track)}
                >
                  <Trash />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Dialog.Root
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleting(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="overlay" />
          <Dialog.Content className="modal music-confirm">
            <Dialog.Title>删除这首音乐？</Dialog.Title>
            <Dialog.Description>
              「{deleting?.title}」将从两个人的曲库中删除。
              {deleting?.id === snapshot.selectedTrackId
                ? "它是当前背景音乐，删除后两个人都会停止播放，不会自动切换到其他歌曲。"
                : "删除后无法恢复。"}
            </Dialog.Description>
            {error && (
              <p className="music-error" role="alert">
                {error}
              </p>
            )}
            <div className="music-confirm-actions">
              <Dialog.Close disabled={busy}>先留着</Dialog.Close>
              <button
                className="primary"
                disabled={busy}
                onClick={async () => {
                  if (deleting && (await music.remove(deleting.id)))
                    setDeleting(null);
                }}
              >
                {busy ? "正在删除…" : "确认删除"}
              </button>
            </div>
            <Dialog.Close
              className="close icon-button"
              aria-label="关闭删除确认"
              disabled={busy}
            >
              <X />
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
