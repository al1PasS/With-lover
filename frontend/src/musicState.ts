export type MusicTrack =
  import("./api/schema").components["schemas"]["MusicTrack"];
export type MusicSnapshot =
  import("./api/schema").components["schemas"]["MusicSnapshot"];
export const musicLimits = {
  maxFileBytes: 20 * 1024 * 1024,
  maxTracks: 20,
  maxTotalBytes: 200 * 1024 * 1024,
};
export const emptyMusic = (): MusicSnapshot => ({
  tracks: [],
  selectedTrackId: null,
  revision: -1,
  limits: { ...musicLimits },
});
export function newerMusic(current: MusicSnapshot, next: MusicSnapshot) {
  return next.revision > current.revision ? next : current;
}
export function musicUploadError(
  file: Pick<File, "name" | "size">,
  snapshot: MusicSnapshot,
) {
  if (!/\.(mp3|wav)$/i.test(file.name)) return "请选择 MP3 或 PCM WAV 文件";
  if (!file.size) return "不能上传空文件";
  if (file.size > snapshot.limits.maxFileBytes)
    return `单首音乐不能超过 ${formatMusicBytes(snapshot.limits.maxFileBytes)}`;
  if (snapshot.tracks.length >= snapshot.limits.maxTracks)
    return `曲库最多保存 ${snapshot.limits.maxTracks} 首音乐`;
  if (
    snapshot.tracks.reduce((sum, track) => sum + track.byteSize, 0) +
      file.size >
    snapshot.limits.maxTotalBytes
  )
    return `曲库总容量不能超过 ${formatMusicBytes(snapshot.limits.maxTotalBytes)}`;
  return "";
}
export function formatMusicBytes(bytes: number) {
  return `${(bytes / 1024 / 1024).toLocaleString("zh-CN", { maximumFractionDigits: 1 })} MiB`;
}
export type PlaybackState =
  "empty" | "off" | "loading" | "playing" | "blocked" | "error";
export type Playback = { enabled: boolean; state: PlaybackState };

/** Owns playback intent separately from media events. Never treats play() as proof of sound. */
export class BackgroundPlayer {
  private source = "";
  private enabled = true;
  private state: PlaybackState = "empty";
  private generation = 0;
  private disposed = false;
  private actualPlayback = false;
  private listeners: [string, EventListener][] = [];

  constructor(
    private audio: HTMLAudioElement,
    private changed: (value: Playback) => void,
  ) {
    audio.loop = true;
    audio.volume = 0.35;
    audio.preload = "none";
    const listen = (event: string, handler: () => void) => {
      this.listeners.push([event, handler]);
      audio.addEventListener(event, handler);
    };
    listen("playing", () => {
      if (this.live() && !audio.paused) {
        this.actualPlayback = true;
        this.publish(audio.muted || audio.volume === 0 ? "loading" : "playing");
      } else if (!this.enabled || !this.source) audio.pause();
    });
    listen("volumechange", () => {
      if (this.live() && this.actualPlayback && !audio.paused)
        this.publish(audio.muted || audio.volume === 0 ? "loading" : "playing");
    });
    for (const event of ["pause", "waiting", "stalled", "ended"])
      listen(event, () => {
        this.actualPlayback = false;
        if (this.live() && this.state !== "blocked" && this.state !== "error")
          this.publish("loading");
      });
    listen("error", () => {
      this.actualPlayback = false;
      if (this.live()) this.publish("error");
    });
    this.publish("empty");
  }
  private live() {
    return (
      !this.disposed &&
      this.enabled &&
      Boolean(this.source) &&
      this.audio.getAttribute("src") === this.source
    );
  }
  private publish(state: PlaybackState) {
    this.state = state;
    this.changed({ enabled: this.enabled, state });
  }
  setSource(source: string) {
    if (this.disposed || source === this.source) return;
    ++this.generation;
    this.actualPlayback = false;
    this.source = "";
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
    this.source = source;
    if (source) this.audio.setAttribute("src", source);
    this.publish(!source ? "empty" : this.enabled ? "loading" : "off");
    if (source && this.enabled) this.play();
  }
  toggle() {
    if (this.disposed || !this.source) return;
    // A blocked/buffering/failed player is retried directly inside the user gesture.
    if (this.enabled && this.state === "playing") {
      this.enabled = false;
      ++this.generation;
      this.audio.pause();
      this.publish("off");
    } else if (
      !this.enabled ||
      this.state === "blocked" ||
      this.state === "error"
    ) {
      this.enabled = true;
      this.play();
    } else {
      this.enabled = false;
      ++this.generation;
      this.audio.pause();
      this.publish("off");
    }
  }
  private play() {
    const generation = ++this.generation;
    this.publish("loading");
    try {
      void this.audio.play().catch((error: unknown) => {
        if (generation !== this.generation || !this.live()) return;
        this.publish(
          error instanceof Error && error.name === "NotAllowedError"
            ? "blocked"
            : "error",
        );
      });
    } catch (error) {
      if (generation === this.generation && this.live())
        this.publish(
          error instanceof Error && error.name === "NotAllowedError"
            ? "blocked"
            : "error",
        );
    }
  }
  dispose() {
    this.disposed = true;
    ++this.generation;
    this.source = "";
    for (const [event, listener] of this.listeners)
      this.audio.removeEventListener(event, listener);
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
    this.publish("empty");
  }
}
