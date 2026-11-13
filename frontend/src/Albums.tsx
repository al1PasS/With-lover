import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowLeft,
  Camera,
  Check,
  FolderOpen,
  FolderPlus,
  ImageSquare,
  Images,
  Trash,
  X,
} from "@phosphor-icons/react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { request } from "./api/client";
import { PageTitle, VisitorGate } from "./LittleWorld";
import { demoSettingActivity } from "./Activity";
import { today } from "./dates";

const demo = import.meta.env.VITE_DEMO !== "false";
type Photo = {
  id: string;
  src: string;
  thumbnail: string;
  note: string;
  date: string;
};
type Album = {
  id: string;
  title: string;
  description: string;
  category: "event" | "thing";
  date: string;
  coverId: string | null;
  cover: Photo | null;
  photoCount: number;
};
type Detail = { album: Album; photos: Photo[] };
type Upload = { photos: Photo[]; rejected: number[] };
type Stored = Omit<Album, "cover" | "photoCount"> & { photos: Photo[] };
type OldPhoto = Photo & { category: Album["category"] };

function getDemoAlbums(): Stored[] {
  let rows = JSON.parse(localStorage.getItem("shiguang:albums") || "[]") as
    Stored[] | OldPhoto[];
  if (!Array.isArray(rows) || !rows.length) return [];
  if (!("photos" in rows[0])) {
    const photos = rows as OldPhoto[];
    rows = (["event", "thing"] as const)
      .map((category) => ({
        id: `migrated-${category}`,
        title: category === "event" ? "旧事件照片" : "旧事物照片",
        description: "从旧版照片墙自动整理而来。",
        category,
        date: photos.find((p) => p.category === category)?.date || today(),
        coverId: null,
        photos: photos.filter((p) => p.category === category),
      }))
      .filter((album) => album.photos.length);
  }
  return (rows as Stored[])
    .map((album) => ({
      ...album,
      photos: album.photos
        .filter((p) => !p.id.startsWith("memory-"))
        .map((p) => ({
          id: p.id,
          src: p.src,
          thumbnail: p.thumbnail || p.src,
          note: p.note,
          date: p.date,
        })),
    }))
    .filter(
      (album) =>
        album.photos.length ||
        !["our-trips", "little-favorites"].includes(album.id),
    );
}

function persistDemo(update: (old: Stored[]) => Stored[]) {
  const old = getDemoAlbums(),
    next = update(old);
  localStorage.setItem("shiguang:albums", JSON.stringify(next));
  demoSettingActivity("albums", old, next);
}

function summary(album: Stored): Album {
  const { photos, ...rest } = album;
  return {
    ...rest,
    cover: photos.find((p) => p.id === album.coverId) || photos[0] || null,
    photoCount: photos.length,
  };
}

// Sequential conversion limits peak memory on a phone. Native decoding also
// accepts iPhone formats when the browser can display them and applies orientation.
async function prepare(file: File): Promise<Blob> {
  if (!file.size || file.size > 20 * 1024 * 1024)
    throw new Error("图片大小不受支持");
  let url = "";
  let bitmap: ImageBitmap | undefined;
  try {
    let source: ImageBitmap | HTMLImageElement;
    try {
      bitmap = await createImageBitmap(file);
      source = bitmap;
    } catch {
      const image = new Image();
      url = URL.createObjectURL(file);
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("浏览器无法读取这张照片"));
        image.src = url;
      });
      source = image;
    }
    const width =
      source instanceof HTMLImageElement ? source.naturalWidth : source.width;
    const height =
      source instanceof HTMLImageElement ? source.naturalHeight : source.height;
    const scale = Math.min(1, (demo ? 800 : 1800) / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("无法准备照片");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error("无法压缩这张照片")),
        "image/jpeg",
        demo ? 0.76 : 0.88,
      ),
    );
  } catch (error) {
    // A browser decode failure on an otherwise supported format can still succeed on the server.
    if (
      !demo &&
      /\.(jpe?g|png|webp|gif)$/i.test(file.name) &&
      file.size <= 20 * 1024 * 1024
    )
      return file;
    throw error;
  } finally {
    bitmap?.close();
    if (url) URL.revokeObjectURL(url);
  }
}

function dataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export default function AlbumsPage({
  user,
  onLogin,
  albumId,
  publicAllowed,
}: {
  user: string | null;
  onLogin: () => void;
  albumId?: string | null;
  publicAllowed: boolean;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [category, setCategory] = useState<Album["category"]>("event");
  const [creating, setCreating] = useState(false);
  const [selection, setSelection] = useState<string | null>(null);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [reload, setReload] = useState(0);
  const upload = useRef<AbortController | null>(null);
  const allowed = Boolean(user) || publicAllowed;
  const albumPath = albumId
    ? `/albums/${encodeURIComponent(albumId)}`
    : "/albums";
  const selected = detail?.photos.find((p) => p.id === selection);
  const selectedIndex =
    detail?.photos.findIndex((p) => p.id === selection) ?? -1;
  const refresh = () => setReload((x) => x + 1);

  useEffect(() => {
    setSelection(null);
    setError("");
    setNotice("");
    setBusy("");
    return () => upload.current?.abort();
  }, [albumId, user]);
  useEffect(() => {
    if (!allowed) {
      setAlbums([]);
      setDetail(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setLoadError("");
    const path = (user ? "" : "/public") + albumPath;
    async function read() {
      try {
        if (albumId) {
          const found = demo
            ? getDemoAlbums().find((row) => row.id === albumId)
            : null;
          const row = demo
            ? found && { album: summary(found), photos: found.photos }
            : await request<Detail>(path, { signal: controller.signal });
          if (!controller.signal.aborted) setDetail(row || null);
        } else {
          const rows = demo
            ? getDemoAlbums().map(summary)
            : await request<Album[]>(path, { signal: controller.signal });
          if (!controller.signal.aborted) setAlbums(rows);
        }
      } catch (e) {
        if (!controller.signal.aborted) setLoadError((e as Error).message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void read();
    return () => controller.abort();
  }, [albumPath, albumId, user, allowed, reload, location.key]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || busy) return;
    const data = new FormData(event.currentTarget);
    const input = {
      title: String(data.get("title")).trim(),
      description: String(data.get("description")).trim(),
      category: String(data.get("category")) as Album["category"],
      date: String(data.get("date")),
    };
    if (!input.title) {
      setError("请填写相册名称");
      return;
    }
    setBusy("正在创建…");
    setError("");
    try {
      const id = demo
        ? crypto.randomUUID()
        : (
            await request<Album>("/albums", {
              method: "POST",
              body: JSON.stringify(input),
            })
          ).id;
      if (demo)
        persistDemo((old) => [
          { ...input, id, photos: [], coverId: null },
          ...old,
        ]);
      setCreating(false);
      navigate(`/albums/${encodeURIComponent(id)}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function add(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files || []);
    event.currentTarget.value = "";
    if (!user || !albumId || busy || !files.length) return;
    const controller = new AbortController();
    upload.current = controller;
    let added = 0,
      rejected = 0;
    let problem = "";
    setNotice("");
    setError("");
    setBusy(`正在处理 0/${files.length} 张…`);
    try {
      for (let offset = 0; offset < files.length; offset += 5) {
        const form = new FormData();
        const demoPhotos: Photo[] = [];
        let bytes = 0,
          count = 0;
        const flush = async () => {
          if (!count) return;
          const result = await request<Upload>(`${albumPath}/photos`, {
            method: "POST",
            body: form,
            signal: controller.signal,
          });
          added += result.photos.length;
          rejected += result.rejected.length;
          form.delete("files");
          bytes = 0;
          count = 0;
        };
        for (const [index, file] of files.slice(offset, offset + 5).entries()) {
          let blob: Blob;
          try {
            blob = await prepare(file);
          } catch {
            if (controller.signal.aborted) return;
            rejected++;
            continue;
          }
          if (controller.signal.aborted) return;
          if (demo) {
            const src = await dataUrl(blob);
            demoPhotos.push({
              id: crypto.randomUUID(),
              src,
              thumbnail: src,
              note: "",
              date: today(),
            });
          } else {
            if (bytes + blob.size > 21 * 1024 * 1024) await flush();
            form.append("files", blob, "photo");
            bytes += blob.size;
            count++;
          }
          setBusy(`正在处理 ${offset + index + 1}/${files.length} 张…`);
        }
        if (demo && demoPhotos.length) {
          persistDemo((old) =>
            old.map((row) =>
              row.id === albumId
                ? { ...row, photos: [...row.photos, ...demoPhotos] }
                : row,
            ),
          );
          added += demoPhotos.length;
        } else if (!demo) await flush();
      }
    } catch (e) {
      problem = (e as Error).message;
    } finally {
      if (upload.current === controller) upload.current = null;
      if (controller.signal.aborted) return;
      if (added) {
        setNotice(`已添加 ${added} 张照片`);
        refresh();
      }
      if (rejected)
        setError(
          `${rejected} 张照片未能读取。请选择 20 MB 以内的 JPEG、PNG、WebP 或 GIF 后重试。`,
        );
      if (problem)
        setError(
          `上传中断：${problem}${added ? "。已添加的照片已保留。" : ""}`,
        );
      setBusy("");
    }
  }

  async function change(action: "cover" | "photo" | "album", photo?: Photo) {
    if (!user || !albumId || busy) return;
    if (action === "photo" && !window.confirm("确定将这张照片移出相册吗？"))
      return;
    if (
      action === "album" &&
      !window.confirm(`确定删除相册“${detail?.album.title}”及其中的照片吗？`)
    )
      return;
    setBusy("正在保存…");
    setError("");
    setNotice("");
    try {
      if (demo)
        persistDemo((old) =>
          action === "album"
            ? old.filter((row) => row.id !== albumId)
            : old.map((row) =>
                row.id !== albumId
                  ? row
                  : action === "cover"
                    ? { ...row, coverId: photo!.id }
                    : {
                        ...row,
                        photos: row.photos.filter((p) => p.id !== photo!.id),
                        coverId: row.coverId === photo!.id ? null : row.coverId,
                      },
              ),
        );
      else if (action === "cover")
        await request(`${albumPath}/cover`, {
          method: "PUT",
          body: JSON.stringify({ photoId: photo!.id }),
        });
      else
        await request(
          action === "album"
            ? albumPath
            : `${albumPath}/photos/${encodeURIComponent(photo!.id)}`,
          { method: "DELETE" },
        );
      if (action === "album") navigate("/albums");
      else {
        if (action === "photo") setSelection(null);
        if (action === "cover") setNotice("已设为相册封面");
        refresh();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  const feedback = (
    <>
      {notice && (
        <p className="album-feedback" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="post-feedback album-feedback" role="alert">
          {error}
        </p>
      )}
    </>
  );
  if (!allowed)
    return (
      <>
        <PageTitle
          title="我们的相册。"
          copy="每一本都是一个合集，照片墙只展示封面，点进去再慢慢翻看。"
        />
        <VisitorGate title="相册暂时只为彼此打开" onLogin={onLogin} />
      </>
    );
  if (loadError)
    return (
      <div className="album-not-found">
        <FolderOpen />
        <p role="alert">{loadError}</p>
        <button className="primary" onClick={refresh}>
          重试
        </button>
        <Link to="/albums">返回照片墙</Link>
      </div>
    );
  if (albumId) {
    if (!detail || detail.album.id !== albumId)
      return (
        <div className="album-not-found">
          <FolderOpen />
          <h1>{loading ? "正在打开相册…" : "没有找到这本相册"}</h1>
          <Link to="/albums">返回照片墙</Link>
        </div>
      );
    const { album, photos } = detail;
    return (
      <>
        <header className="album-hero">
          <Link to="/albums" className="album-back">
            <ArrowLeft />
            返回照片墙
          </Link>
          <div>
            <span>{album.category === "event" ? "事件相册" : "事物相册"}</span>
            <h1>{album.title}</h1>
            <p>{album.description || "把属于这一册的照片放在一起。"}</p>
            <small>
              {album.photoCount} 张照片 · {album.date.replace(/-/g, ".")}
            </small>
          </div>
          {user && (
            <label className="primary album-add">
              <Camera />
              {busy || "批量添加照片"}
              <input
                type="file"
                aria-label="批量添加照片"
                accept="image/*,.heic,.heif"
                multiple
                onChange={add}
                disabled={Boolean(busy)}
              />
            </label>
          )}
        </header>
        {feedback}
        <section className="album-photo-grid" aria-label="相册照片">
          {photos.map((photo, index) => (
            <button
              className={index % 7 === 0 ? "album-photo-featured" : ""}
              key={photo.id}
              id={`activity-${photo.id}`}
              aria-label={`查看第 ${index + 1} 张照片${album.coverId === photo.id ? "，封面" : ""}`}
              onClick={() => {
                setSelection(photo.id);
                setError("");
              }}
            >
              <img src={photo.thumbnail} alt="" loading="lazy" />
              {album.coverId === photo.id && (
                <span className="album-cover-tag">
                  <ImageSquare aria-hidden="true" /> 封面
                </span>
              )}
            </button>
          ))}
          {!photos.length && (
            <div className="soft-empty">
              <Images />
              <p>
                {user
                  ? "这本相册还是空的，先添加几张照片吧。"
                  : "这本相册还没有照片。"}
              </p>
            </div>
          )}
        </section>
        {user && (
          <button
            className="album-delete"
            disabled={Boolean(busy)}
            onClick={() => void change("album")}
          >
            <Trash />
            删除这本相册
          </button>
        )}
        <Dialog.Root
          open={Boolean(selected)}
          onOpenChange={(open) => !open && setSelection(null)}
        >
          <Dialog.Portal>
            <Dialog.Overlay className="overlay" />
            <Dialog.Content className="modal album-detail">
              <Dialog.Close className="close" aria-label="关闭照片">
                <X />
              </Dialog.Close>
              {selected && (
                <>
                  <div className="album-detail-image">
                    <img
                      src={selected.src}
                      alt={`《${album.title}》中的第 ${selectedIndex + 1} 张照片`}
                    />
                  </div>
                  <div>
                    <span>{selected.date}</span>
                    <Dialog.Title>
                      照片 {selectedIndex + 1} / {album.photoCount}
                    </Dialog.Title>
                    <Dialog.Description>
                      {selected.note || `收录在《${album.title}》`}
                    </Dialog.Description>
                    {user && (
                      <div className="album-photo-actions">
                        <button
                          className="primary"
                          disabled={
                            Boolean(busy) || album.coverId === selected.id
                          }
                          onClick={() => void change("cover", selected)}
                        >
                          {album.coverId === selected.id ? (
                            <>
                              <Check />
                              当前封面
                            </>
                          ) : (
                            <>
                              <ImageSquare />
                              设为相册封面
                            </>
                          )}
                        </button>
                        <button
                          className="album-photo-delete"
                          disabled={Boolean(busy)}
                          onClick={() => void change("photo", selected)}
                        >
                          <Trash />
                          移出相册
                        </button>
                      </div>
                    )}
                    {feedback}
                  </div>
                </>
              )}
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </>
    );
  }
  const filtered = albums.filter((album) => album.category === category);
  return (
    <>
      <PageTitle
        title="我们的相册。"
        copy="每一本都是一个合集，照片墙只展示封面，点进去再慢慢翻看。"
        action={
          user ? (
            <button
              className="primary"
              onClick={() => {
                setError("");
                setCreating(true);
              }}
            >
              <FolderPlus />
              新建相册
            </button>
          ) : undefined
        }
      />
      <div className="album-switch">
        <button
          aria-pressed={category === "event"}
          className={category === "event" ? "active" : ""}
          onClick={() => setCategory("event")}
        >
          事件相册
        </button>
        <button
          aria-pressed={category === "thing"}
          className={category === "thing" ? "active" : ""}
          onClick={() => setCategory("thing")}
        >
          事物相册
        </button>
      </div>
      <section className="album-collection-wall" aria-busy={loading}>
        {filtered.map((album, index) => (
          <Link
            to={`/albums/${encodeURIComponent(album.id)}`}
            key={album.id}
            className={index % 4 === 0 ? "album-collection-wide" : ""}
          >
            <div>
              {album.cover ? (
                <img src={album.cover.thumbnail} alt="" loading="lazy" />
              ) : (
                <span className="album-empty-cover">
                  <FolderOpen />
                </span>
              )}
              <span className="album-count-badge">{album.photoCount} 张</span>
            </div>
            <section>
              <span>
                {album.category === "event" ? "事件相册" : "事物相册"}
              </span>
              <h2>{album.title}</h2>
              <p>{album.description || "等待放进更多照片。"}</p>
            </section>
          </Link>
        ))}
        {!filtered.length && (
          <div className="soft-empty">
            <FolderOpen />
            <p>
              {loading
                ? "正在整理相册…"
                : user
                  ? "这一类还没有相册，先新建一本吧。"
                  : "这一类还没有相册。"}
            </p>
          </div>
        )}
      </section>
      <Dialog.Root
        open={creating}
        onOpenChange={(open) => !busy && setCreating(open)}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="overlay" />
          <Dialog.Content className="modal">
            <Dialog.Close className="close" aria-label="关闭">
              <X />
            </Dialog.Close>
            <Dialog.Title>新建一本相册</Dialog.Title>
            <Dialog.Description>
              先建立合集，再进入相册批量添加照片。
            </Dialog.Description>
            <form onSubmit={create}>
              <label>
                相册名称
                <input
                  name="title"
                  required
                  maxLength={80}
                  placeholder="例如：第一次去海边"
                />
              </label>
              <label>
                相册分类
                <select name="category" defaultValue={category}>
                  <option value="event">事件相册</option>
                  <option value="thing">事物相册</option>
                </select>
              </label>
              <label>
                日期
                <input
                  name="date"
                  type="date"
                  required
                  defaultValue={today()}
                />
              </label>
              <label>
                相册说明
                <textarea
                  name="description"
                  rows={3}
                  maxLength={300}
                  placeholder="这本相册收集了什么？"
                />
              </label>
              {error && (
                <p className="post-feedback" role="alert">
                  {error}
                </p>
              )}
              <button className="primary" disabled={Boolean(busy)}>
                {busy || "创建并进入相册"}
              </button>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
