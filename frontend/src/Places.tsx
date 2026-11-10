import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowsOut,
  ArrowClockwise,
  ImageBroken,
  PencilSimple,
  Trash,
  X,
} from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import type { Place } from "./types";

export type PlaceCardProps = {
  place: Place;
  index: number;
  total: number;
  canManage: boolean;
  onMove: (id: string, direction: -1 | 1) => void;
  onEdit: (place: Place) => void;
  onDelete: (place: Place) => void;
};

type ImageVariant = { url: string; width: number; height: number };

function variantsFor(place: Place, maximum: number): ImageVariant[] {
  const widths = new Map<number, ImageVariant>();
  for (const variant of place.image?.variants ?? []) {
    if (
      variant.url &&
      Number.isFinite(variant.width) &&
      Number.isFinite(variant.height) &&
      variant.width > 0 &&
      variant.height > 0 &&
      variant.width <= maximum
    ) {
      widths.set(variant.width, variant);
    }
  }
  return [...widths.values()].sort((a, b) => a.width - b.width);
}

export function getPlaceImageSources(place: Place) {
  const variants = variantsFor(place, 1920);
  return {
    src: variants.at(-1)?.url || place.image?.url || place.panoramaImage || "",
    srcSet: variants.length
      ? variants.map(({ url, width }) => `${url} ${width}w`).join(", ")
      : undefined,
  };
}

export function getPlacePanoramaRatio(place: Place): number {
  const { width, height } = place.image ?? {};
  return width &&
    height &&
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0
    ? width / height
    : 7;
}

// Only the authenticated, same-origin place endpoint is allowed to acquire a new
// rendition. Demo data URLs and arbitrary URLs must never become proxy requests.
export function getPlaceReaderUrl(place: Place): string {
  const variants = variantsFor(place, 3200);
  const largest = variants.at(-1);
  const preview = getPlaceImageSources(place).src;
  if (
    largest &&
    (largest.width > 1920 ||
      (place.image?.width != null && largest.width >= place.image.width))
  )
    return largest.url;
  const url = place.image?.url;
  if (!url) return preview;
  try {
    const origin =
      typeof window === "undefined"
        ? "http://localhost"
        : window.location.origin;
    const parsed = new URL(url, origin);
    if (
      parsed.origin !== origin ||
      !/^\/api\/v1\/(?:public\/)?media\/places\/[^/]+$/.test(parsed.pathname)
    )
      return largest?.url || preview;
    parsed.searchParams.set("w", "3200");
    return url.startsWith("/")
      ? `${parsed.pathname}${parsed.search}`
      : parsed.href;
  } catch {
    return largest?.url || preview;
  }
}

export function getCenteredScrollLeft(
  scrollWidth: number,
  clientWidth: number,
) {
  return Math.max(0, (scrollWidth - clientWidth) / 2);
}

function useCenteredPanorama(identity: string) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const interacted = useRef(false);
  const frame = useRef<number | undefined>(undefined);
  const center = useCallback(() => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const viewport = viewportRef.current;
      if (viewport && !interacted.current)
        viewport.scrollLeft = getCenteredScrollLeft(
          viewport.scrollWidth,
          viewport.clientWidth,
        );
    });
  }, []);
  useLayoutEffect(() => {
    interacted.current = false;
    center();
    const observer = new ResizeObserver(center);
    if (viewportRef.current) observer.observe(viewportRef.current);
    if (contentRef.current) observer.observe(contentRef.current);
    return () => {
      observer.disconnect();
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    };
  }, [identity, center]);
  const markInteracted = useCallback(() => {
    interacted.current = true;
  }, []);
  return { viewportRef, contentRef, center, markInteracted };
}

function scrollWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
  if (event.target !== event.currentTarget) return;
  const viewport = event.currentTarget;
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    viewport.scrollBy({
      left: (event.key === "ArrowRight" ? 1 : -1) * viewport.clientWidth * 0.75,
    });
  } else if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    viewport.scrollTo({
      left: event.key === "Home" ? 0 : viewport.scrollWidth,
    });
  }
}

type PanoramaImageProps = {
  src: string;
  srcSet?: string;
  sizes?: string;
  alt: string;
  priority?: boolean;
  width?: number | null;
  height?: number | null;
  onReady?: (image: HTMLImageElement) => void;
};

function PanoramaImage({
  src,
  srcSet,
  sizes,
  alt,
  priority = false,
  width,
  height,
  onReady,
}: PanoramaImageProps) {
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const imageRef = useRef<HTMLImageElement>(null);
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  const loaded = useCallback((image: HTMLImageElement) => {
    if (!image.naturalWidth) return;
    setStatus("ready");
    // decode may reject even after a successful load; geometry is still usable.
    void image
      .decode()
      .catch(() => undefined)
      .then(() => {
        if (image === imageRef.current && image.isConnected)
          readyRef.current?.(image);
      });
  }, []);
  useEffect(() => {
    const image = imageRef.current;
    if (!src) setStatus("error");
    else if (image?.complete) {
      if (image.naturalWidth) loaded(image);
      else setStatus("error");
    }
  }, [src, srcSet, attempt, loaded]);
  return (
    <>
      {src && (
        <img
          key={attempt}
          ref={imageRef}
          className="place-panorama"
          src={src}
          srcSet={srcSet}
          sizes={srcSet ? sizes : undefined}
          alt={alt}
          width={width && width > 0 ? width : undefined}
          height={height && height > 0 ? height : undefined}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          decoding="async"
          data-ready={status === "ready"}
          onLoad={(event) => loaded(event.currentTarget)}
          onError={() => setStatus("error")}
        />
      )}
      {status === "loading" && (
        <div className="place-image-status" role="status">
          <span className="place-image-pulse" aria-hidden="true" />
          <span>长卷加载中…</span>
        </div>
      )}
      {status === "error" && (
        <div className="place-image-status place-image-error" role="status">
          <ImageBroken size={26} aria-hidden="true" />
          <span>这幅长卷暂时未能加载</span>
          {src && (
            <button
              type="button"
              onClick={() => {
                setStatus("loading");
                setAttempt((value) => value + 1);
              }}
            >
              <ArrowClockwise aria-hidden="true" />
              重新加载
            </button>
          )}
        </div>
      )}
    </>
  );
}

function PlaceViewer({ place }: { place: Place }) {
  const [mode, setMode] = useState<"fit" | "read">("fit");
  const [highResolutionRequested, setHighResolutionRequested] = useState(false);
  const [ratio, setRatio] = useState(() => getPlacePanoramaRatio(place));
  const preview = getPlaceImageSources(place);
  const src = highResolutionRequested ? getPlaceReaderUrl(place) : preview.src;
  const scroll = useCenteredPanorama(`${place.id}:${mode}`);
  const descriptionId = useId();
  const changeMode = (next: "fit" | "read") => {
    if (next === "read") setHighResolutionRequested(true);
    setMode(next);
  };
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="overlay" />
      <Dialog.Content
        className="modal place-viewer"
        aria-describedby={descriptionId}
      >
        <header className="place-viewer-header">
          <div>
            <Dialog.Title>{place.city} · 旅行长卷</Dialog.Title>
            {place.visitDate && (
              <time dateTime={place.visitDate}>
                {place.visitDate.replaceAll("-", ".")}
              </time>
            )}
          </div>
          <Dialog.Close className="place-viewer-close" aria-label="关闭长卷">
            <X size={22} />
          </Dialog.Close>
        </header>
        <div
          className="place-viewer-toolbar"
          role="group"
          aria-label="长卷阅读方式"
        >
          <button
            type="button"
            aria-pressed={mode === "fit"}
            onClick={() => changeMode("fit")}
          >
            <ArrowsOut aria-hidden="true" />
            完整适应
          </button>
          <button
            type="button"
            aria-pressed={mode === "read"}
            onClick={() => changeMode("read")}
          >
            <ArrowLeft aria-hidden="true" />
            <ArrowRight aria-hidden="true" />
            横向细读
          </button>
        </div>
        <div
          ref={scroll.viewportRef}
          className="place-viewer-scroll"
          data-mode={mode}
          tabIndex={0}
          role="region"
          aria-label={
            mode === "read"
              ? `${place.city}长卷细读，可左右滑动或使用方向键`
              : `${place.city}完整长卷`
          }
          style={{ "--place-ratio": ratio } as CSSProperties}
          onPointerDown={scroll.markInteracted}
          onWheel={scroll.markInteracted}
          onKeyDown={(event) => {
            scroll.markInteracted();
            scrollWithKeyboard(event);
          }}
        >
          <div ref={scroll.contentRef} className="place-image-frame">
            <PanoramaImage
              key={src}
              src={src}
              alt={`${place.city}的旅行长卷`}
              priority
              width={place.image?.width}
              height={place.image?.height}
              onReady={(image) => {
                setRatio(image.naturalWidth / image.naturalHeight);
                scroll.center();
              }}
            />
          </div>
        </div>
        <Dialog.Description
          id={descriptionId}
          className="place-viewer-description"
        >
          {place.description && <span>{place.description}</span>}
          <span className="place-viewer-help">
            {mode === "read"
              ? "左右滑动查看细节，也可聚焦图片后用 ← →、Home、End 浏览。"
              : "完整展示整幅长卷；切换“横向细读”时按需加载高清图片。"}{" "}
            按 Esc 关闭。
          </span>
        </Dialog.Description>
      </Dialog.Content>
    </Dialog.Portal>
  );
}

export function PlaceCard({
  place,
  index,
  total,
  canManage,
  onMove,
  onEdit,
  onDelete,
}: PlaceCardProps) {
  const [open, setOpen] = useState(false);
  const [naturalRatio, setNaturalRatio] = useState<number | null>(null);
  const source = getPlaceImageSources(place);
  const identity = `${place.id}:${place.image?.version ?? source.src}`;
  const metadataRatio = getPlacePanoramaRatio(place);
  const ratio = naturalRatio ?? metadataRatio;
  const titleId = useId();
  // Only a new image closes the expanded reader; caption and ordering changes do not.
  useLayoutEffect(() => {
    setNaturalRatio(null);
    setOpen(false);
  }, [identity]);
  const sizes =
    "(min-width: 1500px) 1204px, (min-width: 1200px) 1134px, calc(100vw - 66px)";
  return (
    <article
      className="custom-place"
      id={`activity-${place.id}`}
      aria-labelledby={titleId}
      style={
        {
          "--place-ratio": ratio,
          "--place-frame-ratio": ratio,
        } as CSSProperties
      }
    >
      <div className="place-panorama-scroll">
        <div className="place-image-frame">
          <PanoramaImage
            key={`${identity}:${source.src}:${source.srcSet ?? ""}`}
            {...source}
            sizes={sizes}
            alt={`${place.city}的旅行长卷`}
            priority={index === 0}
            width={place.image?.width}
            height={place.image?.height}
            onReady={(image) => {
              setNaturalRatio(image.naturalWidth / image.naturalHeight);
            }}
          />
        </div>
      </div>
      <div className="place-paper">
        <div className="place-caption">
          <h2 id={titleId}>{place.city}</h2>
          {place.visitDate && (
            <time dateTime={place.visitDate}>
              {place.visitDate.replaceAll("-", ".")}
            </time>
          )}
          {place.description && (
            <p title={place.description}>{place.description}</p>
          )}
        </div>
        <div className="place-card-footer">
          <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Trigger asChild>
              <button
                type="button"
                className="place-expand"
                aria-label={`展开${place.city}长卷`}
                disabled={!source.src}
              >
                <ArrowsOut aria-hidden="true" />
                展开长卷
              </button>
            </Dialog.Trigger>
            {open && <PlaceViewer key={identity} place={place} />}
          </Dialog.Root>
        </div>
        {canManage && (
          <div
            className="place-admin-actions"
            role="group"
            aria-label={`${place.city}的管理操作`}
          >
            <button
              type="button"
              onClick={() => onMove(place.id, -1)}
              disabled={index === 0}
              aria-label={`上移${place.city}`}
              title="上移"
            >
              <ArrowUp aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => onMove(place.id, 1)}
              disabled={index === total - 1}
              aria-label={`下移${place.city}`}
              title="下移"
            >
              <ArrowDown aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => onEdit(place)}
              aria-label={`编辑${place.city}`}
            >
              <PencilSimple aria-hidden="true" />
              <span>编辑</span>
            </button>
            <button
              type="button"
              onClick={() => onDelete(place)}
              aria-label={`删除${place.city}`}
            >
              <Trash aria-hidden="true" />
              <span>删除</span>
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
