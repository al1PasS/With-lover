import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type PointerEvent,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  Camera,
  CaretLeft,
  CaretRight,
  Check,
  FolderOpen,
  FolderPlus,
  ImageSquare,
  Images,
  PencilSimple,
  Trash,
  X,
} from "@phosphor-icons/react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ApiError, request } from "./api/client";
import AlbumPhotoGrid from "./AlbumPhotoGrid";
import type { components, paths } from "./api/schema";
import { PageTitle, VisitorGate } from "./LittleWorld";
import { demoSettingActivity } from "./Activity";
import { today } from "./dates";
import {
  ImageReadError,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_MB,
  PHOTO_ACCEPT,
  PHOTO_SIZE_ERROR,
  photoDataUrl,
  preparePhoto,
} from "./imageUpload";

const demo = import.meta.env.VITE_DEMO !== "false";
const MAX_PHOTO_BATCH_BYTES = 51 * 1024 * 1024;
type AlbumText = components["schemas"]["AlbumText"];
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
type PhotoOrder =
  paths["/albums/{id}/photos/order"]["put"]["requestBody"]["content"]["application/json"];
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
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState("");
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
  const editRequest = useRef<AbortController | null>(null);
  const orderRequest = useRef<AbortController | null>(null);
  const conflictReload = useRef(false);
  const photoOpener = useRef<HTMLButtonElement | null>(null);
  const swipeStart = useRef<{
    pointerId: number;
    x: number;
    y: number;
  } | null>(null);
  const allowed = Boolean(user) || publicAllowed;
  const albumPath = albumId
    ? `/albums/${encodeURIComponent(albumId)}`
    : "/albums";
  const params = new URLSearchParams(location.search);
  const photoChange = user && albumId ? params.get("photoChange") : null;
  const legacyPhoto = user && albumId ? params.get("activity") : null;
  const requestedPhotos = new Set(
    photoChange === "added" || photoChange === "cover"
      ? params.getAll("photo").filter(Boolean).slice(0, 25)
      : legacyPhoto
        ? [legacyPhoto]
        : [],
  );
  const inspectingUpdate = requestedPhotos.size > 0;
  const updateLabel =
    photoChange === "cover"
      ? "这次设置的封面"
      : legacyPhoto
        ? "这条更新的照片"
        : "这次添加的照片";
  const visiblePhotos = !detail
    ? []
    : inspectingUpdate
      ? detail.photos.filter((photo) => requestedPhotos.has(photo.id))
      : detail.photos;
  const selectedIndex = visiblePhotos.findIndex((p) => p.id === selection);
  const selected = visiblePhotos[selectedIndex];
  const refresh = () => setReload((x) => x + 1);

  function stepPhoto(direction: -1 | 1) {
    swipeStart.current = null;
    if (!detail || busy) return;
    setSelection((id) => {
      const index = visiblePhotos.findIndex((photo) => photo.id === id);
      return index < 0 ? id : (visiblePhotos[index + direction]?.id ?? id);
    });
  }

  function startSwipe(event: PointerEvent<HTMLDivElement>) {
    swipeStart.current =
      event.pointerType === "touch" &&
      event.isPrimary &&
      (event.target === event.currentTarget ||
        event.target instanceof HTMLImageElement)
        ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
        : null;
  }

  function finishSwipe(event: PointerEvent<HTMLDivElement>) {
    const start = swipeStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    swipeStart.current = null;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) >= 48 && Math.abs(dx) > Math.abs(dy) * 1.4)
      stepPhoto(dx < 0 ? 1 : -1);
  }

  useEffect(() => {
    swipeStart.current = null;
    setSelection(null);
  }, [albumId, user, location.search]);
  useEffect(() => {
    setError("");
    setNotice("");
    setBusy("");
    setEditing(false);
    setEditError("");
    return () => {
      upload.current?.abort();
      editRequest.current?.abort();
      orderRequest.current?.abort();
      orderRequest.current = null;
      conflictReload.current = false;
    };
  }, [albumId, user]);
  useEffect(() => {
    if (inspectingUpdate) window.scrollTo({ top: 0, behavior: "instant" });
  }, [inspectingUpdate, location.key]);
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
        if (!controller.signal.aborted) {
          setLoading(false);
          if (conflictReload.current) {
            conflictReload.current = false;
            setBusy("");
          }
        }
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

  async function saveAlbumText(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !albumId || busy || loading || editRequest.current) return;
    const data = new FormData(event.currentTarget);
    const input: AlbumText = {
      title: String(data.get("title")).trim(),
      description: String(data.get("description")).trim(),
    };
    if (!input.title) {
      setEditError("请填写相册名称");
      return;
    }
    const controller = new AbortController();
    editRequest.current = controller;
    setBusy("正在保存…");
    setEditError("");
    setError("");
    setNotice("");
    try {
      let saved = input;
      if (demo) {
        persistDemo((old) => {
          if (!old.some((row) => row.id === albumId))
            throw new ApiError("相册已删除", 404);
          return old.map((row) =>
            row.id === albumId ? { ...row, ...input } : row,
          );
        });
      } else {
        saved = await request<AlbumText>(albumPath, {
          method: "PATCH",
          body: JSON.stringify(input),
          signal: controller.signal,
        });
      }
      if (controller.signal.aborted) return;
      setDetail((current) =>
        current?.album.id === albumId
          ? { ...current, album: { ...current.album, ...saved } }
          : current,
      );
      setNotice("已保存相册信息");
      setEditing(false);
    } catch (e) {
      if (!controller.signal.aborted) setEditError((e as Error).message);
    } finally {
      if (editRequest.current === controller) editRequest.current = null;
      if (!controller.signal.aborted) setBusy("");
    }
  }

  async function add(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files || []);
    event.currentTarget.value = "";
    if (
      !user ||
      !albumId ||
      busy ||
      loading ||
      orderRequest.current ||
      !files.length
    )
      return;
    const controller = new AbortController();
    upload.current = controller;
    let added = 0,
      rejected = 0,
      oversized = 0;
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
          if (controller.signal.aborted) return;
          setBusy(`正在处理 ${offset + index + 1}/${files.length} 张…`);
          if (file.size > MAX_IMAGE_BYTES) {
            oversized++;
            continue;
          }
          let blob: Blob;
          try {
            blob = await preparePhoto(file, {
              maxSide: demo ? 800 : 1800,
              quality: demo ? 76 : 90,
            });
          } catch (error) {
            if (controller.signal.aborted) return;
            // The API can still decode and compress these formats on older browsers.
            if (
              !demo &&
              file.size &&
              error instanceof ImageReadError &&
              /\.(jpe?g|png|webp|gif)$/i.test(file.name)
            ) {
              blob = file;
            } else {
              rejected++;
              continue;
            }
          }
          if (controller.signal.aborted) return;
          if (demo) {
            const src = await photoDataUrl(blob);
            if (controller.signal.aborted) return;
            demoPhotos.push({
              id: crypto.randomUUID(),
              src,
              thumbnail: src,
              note: "",
              date: today(),
            });
          } else {
            if (bytes + blob.size > MAX_PHOTO_BATCH_BYTES) await flush();
            if (controller.signal.aborted) return;
            form.append("files", blob, "photo");
            bytes += blob.size;
            count++;
          }
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
      const errors = [];
      if (oversized)
        errors.push(`${oversized} 张照片过大。${PHOTO_SIZE_ERROR}。`);
      if (rejected)
        errors.push(`${rejected} 张照片未能读取。请检查文件是否完整后重试。`);
      if (problem)
        errors.push(
          `上传中断：${problem}${added ? "。已添加的照片已保留。" : ""}`,
        );
      setError(errors.join(" "));
      setBusy("");
    }
  }

  async function change(action: "cover" | "photo" | "album", photo?: Photo) {
    if (!user || !albumId || busy || loading || orderRequest.current) return;
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

  async function movePhoto(id: string, index: number) {
    if (
      !user ||
      !detail ||
      detail.album.id !== albumId ||
      busy ||
      loading ||
      orderRequest.current
    )
      return;
    const { album, photos } = detail;
    const from = photos.findIndex((photo) => photo.id === id);
    if (from < 0 || index < 0 || index >= photos.length || from === index)
      return;
    const next = photos.slice();
    next.splice(from, 1);
    next.splice(index, 0, photos[from]);
    const order: PhotoOrder = {
      previousPhotoIds: photos.map((photo) => photo.id),
      photoIds: next.map((photo) => photo.id),
    };
    const controller = new AbortController();
    orderRequest.current = controller;
    setBusy("正在保存顺序…");
    setError("");
    setNotice("");
    setDetail({
      album: {
        ...album,
        cover: next.find((photo) => photo.id === album.coverId) ?? next[0],
      },
      photos: next,
    });
    try {
      if (demo) {
        persistDemo((old) => {
          const row = old.find((item) => item.id === albumId);
          if (!row) throw new ApiError("相册已删除", 404);
          if (
            row.photos.length !== photos.length ||
            row.photos.some(
              (photo, position) =>
                photo.id !== order.previousPhotoIds[position],
            )
          )
            throw new ApiError("照片刚有变动，请按最新顺序重试", 409);
          const moved = { ...row, photos: next };
          setDetail({ album: summary(moved), photos: next });
          return old.map((item) => (item.id === albumId ? moved : item));
        });
      } else {
        const saved = await request<Detail>(`${albumPath}/photos/order`, {
          method: "PUT",
          body: JSON.stringify(order),
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setDetail(saved);
      }
      setNotice("已保存照片顺序");
    } catch (e) {
      if (controller.signal.aborted) return;
      setDetail(detail);
      setError((e as Error).message);
      if (e instanceof ApiError && [404, 409].includes(e.status)) {
        conflictReload.current = true;
        refresh();
      }
    } finally {
      if (orderRequest.current === controller) {
        orderRequest.current = null;
        if (!conflictReload.current) setBusy("");
      }
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
          {loading && inspectingUpdate && <p>正在载入{updateLabel}</p>}
          <Link to="/albums">返回照片墙</Link>
        </div>
      );
    const { album, photos } = detail;
    const sortable = Boolean(
      user && !inspectingUpdate && photos.length > 1 && !busy && !loading,
    );
    const updateHeading = inspectingUpdate && (
      <div className="album-update-heading">
        <div>
          <h2>{updateLabel}</h2>
          {legacyPhoto && <p>旧动态仅保留了第一张照片的位置。</p>}
          {requestedPhotos.size > visiblePhotos.length && (
            <p>
              {loading
                ? "正在核对照片…"
                : `${requestedPhotos.size - visiblePhotos.length} 张照片已移出相册。`}
            </p>
          )}
        </div>
        <Link className="subtle-link" to={albumPath} replace>
          查看全部照片
        </Link>
      </div>
    );
    return (
      <>
        <header className="album-hero">
          <Link to="/albums" className="album-back">
            <ArrowLeft />
            返回照片墙
          </Link>
          <div className="album-hero-info">
            <span>{album.category === "event" ? "事件相册" : "事物相册"}</span>
            <h1>{album.title}</h1>
            {!inspectingUpdate && (
              <>
                <p>{album.description || "把属于这一册的照片放在一起。"}</p>
                <small>
                  {album.photoCount} 张照片 · {album.date.replace(/-/g, ".")}
                </small>
              </>
            )}
          </div>
          {user && !inspectingUpdate && (
            <div className="album-hero-actions">
              <Dialog.Root
                open={editing}
                onOpenChange={(open) => {
                  if (busy) return;
                  if (open) setEditError("");
                  setEditing(open);
                }}
              >
                <Dialog.Trigger
                  className="subtle-link"
                  disabled={Boolean(busy) || loading}
                >
                  <PencilSimple aria-hidden="true" /> 编辑相册
                </Dialog.Trigger>
                <Dialog.Portal>
                  <Dialog.Overlay className="overlay" />
                  <Dialog.Content className="modal">
                    <Dialog.Close
                      className="close"
                      aria-label="关闭"
                      disabled={Boolean(busy)}
                    >
                      <X aria-hidden="true" />
                    </Dialog.Close>
                    <Dialog.Title>编辑相册</Dialog.Title>
                    <Dialog.Description>
                      修改这本相册的名称和说明。
                    </Dialog.Description>
                    <form onSubmit={saveAlbumText}>
                      <label>
                        相册名称
                        <input
                          name="title"
                          required
                          maxLength={80}
                          defaultValue={album.title}
                          disabled={Boolean(busy)}
                        />
                      </label>
                      <label>
                        相册说明
                        <textarea
                          name="description"
                          rows={3}
                          maxLength={300}
                          defaultValue={album.description}
                          disabled={Boolean(busy)}
                        />
                      </label>
                      {editError && (
                        <p className="post-feedback" role="alert">
                          {editError}
                        </p>
                      )}
                      <button className="primary" disabled={Boolean(busy)}>
                        {busy || "保存修改"}
                      </button>
                    </form>
                  </Dialog.Content>
                </Dialog.Portal>
              </Dialog.Root>
              <div className="album-upload">
                <label className="primary album-add">
                  <Camera aria-hidden="true" />
                  {busy || "批量添加照片"}
                  <input
                    type="file"
                    aria-label="批量添加照片"
                    aria-describedby="album-upload-limit"
                    accept={PHOTO_ACCEPT}
                    multiple
                    onChange={add}
                    disabled={Boolean(busy) || loading}
                  />
                </label>
                <small id="album-upload-limit">单张最多 {MAX_IMAGE_MB} MB</small>
              </div>
            </div>
          )}
        </header>
        {feedback}
        {updateHeading}
        {user && !inspectingUpdate && photos.length > 1 && (
          <p className="album-sort-help">
            长按照片拖动排序，也可在大图里点「前移」或「后移」。
          </p>
        )}
        {visiblePhotos.length ? (
          <AlbumPhotoGrid
            key={inspectingUpdate ? location.search : album.id}
            photos={visiblePhotos}
            coverId={album.coverId}
            sortable={sortable}
            move={(id, index) => void movePhoto(id, index)}
            open={(id, button) => {
              photoOpener.current = button;
              setSelection(id);
            }}
          />
        ) : (
          !inspectingUpdate && (
            <section className="album-photo-grid" aria-label="相册照片">
              <div className="soft-empty">
                <Images />
                <p>
                  {user
                    ? "这本相册还是空的，先添加几张照片吧。"
                    : "这本相册还没有照片。"}
                </p>
              </div>
            </section>
          )
        )}
        {user && !inspectingUpdate && (
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
          onOpenChange={(open) => {
            if (!open) {
              swipeStart.current = null;
              setSelection(null);
            }
          }}
        >
          <Dialog.Portal>
            <Dialog.Overlay className="overlay" />
            <Dialog.Content
              className="modal album-detail"
              onCloseAutoFocus={(event) => {
                if (photoOpener.current?.isConnected) {
                  event.preventDefault();
                  photoOpener.current.focus({ preventScroll: true });
                }
              }}
              onKeyDown={(event) => {
                if (
                  event.altKey ||
                  event.ctrlKey ||
                  event.metaKey ||
                  event.shiftKey
                )
                  return;
                if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                  event.preventDefault();
                  stepPhoto(event.key === "ArrowLeft" ? -1 : 1);
                }
              }}
            >
              <Dialog.Close className="close" aria-label="关闭照片">
                <X aria-hidden="true" />
              </Dialog.Close>
              {selected && (
                <>
                  <div
                    className="album-detail-image"
                    onPointerDown={startSwipe}
                    onPointerUp={finishSwipe}
                    onPointerCancel={() => {
                      swipeStart.current = null;
                    }}
                  >
                    <img
                      key={selected.id}
                      src={selected.src}
                      decoding="async"
                      draggable={false}
                      alt={`《${album.title}》中的第 ${selectedIndex + 1} 张照片`}
                    />
                    {visiblePhotos.length > 1 && (
                      <>
                        <button
                          type="button"
                          className="album-photo-nav album-photo-prev"
                          aria-label="上一张照片"
                          aria-disabled={Boolean(busy) || selectedIndex === 0}
                          onClick={() => stepPhoto(-1)}
                        >
                          <CaretLeft size={22} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="album-photo-nav album-photo-next"
                          aria-label="下一张照片"
                          aria-disabled={
                            Boolean(busy) ||
                            selectedIndex === visiblePhotos.length - 1
                          }
                          onClick={() => stepPhoto(1)}
                        >
                          <CaretRight size={22} aria-hidden="true" />
                        </button>
                      </>
                    )}
                  </div>
                  <div>
                    <span>{selected.date}</span>
                    <Dialog.Title aria-live="polite" aria-atomic="true">
                      照片 {selectedIndex + 1} / {visiblePhotos.length}
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
                    {user && !inspectingUpdate && photos.length > 1 && (
                      <div
                        className="album-order-actions"
                        aria-label="调整照片顺序"
                        role="group"
                      >
                        <button
                          type="button"
                          className="subtle-link"
                          disabled={!sortable || selectedIndex === 0}
                          onClick={() =>
                            void movePhoto(selected.id, selectedIndex - 1)
                          }
                        >
                          <ArrowUp aria-hidden="true" /> 前移
                        </button>
                        <button
                          type="button"
                          className="subtle-link"
                          disabled={
                            !sortable || selectedIndex === photos.length - 1
                          }
                          onClick={() =>
                            void movePhoto(selected.id, selectedIndex + 1)
                          }
                        >
                          <ArrowDown aria-hidden="true" /> 后移
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
  const firstCoverIndex = filtered.findIndex((album) => album.cover);
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
          >
            <div>
              {album.cover ? (
                <img
                  src={album.cover.src}
                  alt=""
                  loading={index === firstCoverIndex ? "eager" : "lazy"}
                  decoding="async"
                />
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
