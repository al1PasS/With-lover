import { describe, expect, it, vi } from "vitest";
import {
  BackgroundPlayer,
  emptyMusic,
  musicLimits,
  musicUploadError,
  newerMusic,
  type MusicSnapshot,
  type Playback,
} from "./musicState";

class FakeAudio extends EventTarget {
  loop = false;
  volume = 1;
  preload = "auto";
  paused = true;
  muted = false;
  attributes = new Map<string, string>();
  play = vi.fn((): Promise<void> => {
    this.paused = false;
    return Promise.resolve();
  });
  pause = vi.fn(() => {
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  });
  load = vi.fn();
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
}
function setup() {
  const audio = new FakeAudio();
  const states: Playback[] = [];
  const player = new BackgroundPlayer(
    audio as unknown as HTMLAudioElement,
    (state) => states.push(state),
  );
  return { audio, states, player, state: () => states.at(-1)! };
}
const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe("background music playback intent and actual media state", () => {
  it("defaults on with gentle volume and loop, but rotates only after playing", async () => {
    const { audio, player, state } = setup();
    expect(state()).toEqual({ enabled: true, state: "empty" });
    player.setSource("/song-a");
    await settle();
    expect(audio.loop).toBe(true);
    expect(audio.volume).toBe(0.35);
    expect(state().state).toBe("loading");
    audio.dispatchEvent(new Event("playing"));
    expect(state().state).toBe("playing");
    audio.dispatchEvent(new Event("waiting"));
    expect(state().state).toBe("loading");
    audio.dispatchEvent(new Event("playing"));
    expect(state().state).toBe("playing");
    audio.pause();
    expect(state().state).toBe("loading");
  });
  it("keeps local off across remote selection changes, without restarting unchanged tracks", () => {
    const { audio, player, state } = setup();
    player.setSource("/song-a");
    audio.dispatchEvent(new Event("playing"));
    player.toggle();
    expect(state()).toEqual({ enabled: false, state: "off" });
    expect(audio.paused).toBe(true);
    audio.play.mockClear();
    player.setSource("/song-b");
    player.setSource("/song-b");
    expect(audio.getAttribute("src")).toBe("/song-b");
    expect(audio.play).not.toHaveBeenCalled();
    expect(state()).toEqual({ enabled: false, state: "off" });
    player.toggle();
    expect(audio.play).toHaveBeenCalledOnce();
  });
  it("does not rotate while muted and restores rotation only during actual playback", () => {
    const { audio, player, state } = setup();
    player.setSource("/song-a");
    audio.dispatchEvent(new Event("playing"));
    audio.muted = true;
    audio.dispatchEvent(new Event("volumechange"));
    expect(state().state).toBe("loading");
    audio.muted = false;
    audio.dispatchEvent(new Event("volumechange"));
    expect(state().state).toBe("playing");
    audio.volume = 0;
    audio.dispatchEvent(new Event("volumechange"));
    expect(state().state).toBe("loading");
    audio.dispatchEvent(new Event("waiting"));
    audio.volume = 0.35;
    audio.dispatchEvent(new Event("volumechange"));
    expect(state().state).toBe("loading");
  });
  it("keeps local off even when the current song is cleared before another is selected", () => {
    const { audio, player, state } = setup();
    player.setSource("/song-a");
    player.toggle();
    player.setSource("");
    expect(state()).toEqual({ enabled: false, state: "empty" });
    audio.play.mockClear();
    player.setSource("/song-b");
    expect(state()).toEqual({ enabled: false, state: "off" });
    expect(audio.play).not.toHaveBeenCalled();
  });
  it("does not restart a currently playing track for a newer library revision", () => {
    const { audio, player, state } = setup();
    player.setSource("/song-a");
    audio.dispatchEvent(new Event("playing"));
    audio.play.mockClear();
    audio.pause.mockClear();
    player.setSource("/song-a");
    expect(state().state).toBe("playing");
    expect(audio.play).not.toHaveBeenCalled();
    expect(audio.pause).not.toHaveBeenCalled();
  });
  it("shows autoplay blocked honestly and retries synchronously from the click", async () => {
    const { audio, player, state } = setup();
    audio.play.mockRejectedValueOnce(
      new DOMException("Blocked", "NotAllowedError"),
    );
    player.setSource("/song-a");
    await settle();
    expect(state()).toEqual({ enabled: true, state: "blocked" });
    player.toggle();
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(state().state).toBe("loading");
    audio.dispatchEvent(new Event("playing"));
    expect(state().state).toBe("playing");
  });
  it("ignores an older play promise rejected after switching songs", async () => {
    const { audio, player, state } = setup();
    let reject!: (error: Error) => void;
    audio.play.mockImplementationOnce(
      () =>
        new Promise<void>((_, fail) => {
          reject = fail;
        }),
    );
    player.setSource("/song-a");
    player.setSource("/song-b");
    audio.dispatchEvent(new Event("playing"));
    reject(new DOMException("Old song", "NotAllowedError"));
    await settle();
    expect(state().state).toBe("playing");
  });
  it("preserves local off against a late play failure or late playing event", async () => {
    const { audio, player, state } = setup();
    let reject!: (error: Error) => void;
    audio.play.mockImplementationOnce(
      () =>
        new Promise<void>((_, fail) => {
          reject = fail;
        }),
    );
    player.setSource("/song-a");
    player.toggle();
    audio.paused = false;
    audio.dispatchEvent(new Event("playing"));
    reject(new Error("Interrupted"));
    await settle();
    expect(state()).toEqual({ enabled: false, state: "off" });
    expect(audio.paused).toBe(true);
  });
  it("clears selection without falling back to another song", () => {
    const { audio, player, state } = setup();
    player.setSource("/song-a");
    player.setSource("");
    expect(audio.paused).toBe(true);
    expect(audio.getAttribute("src")).toBeNull();
    expect(state().state).toBe("empty");
  });
  it("logout disposes source and guards pending plays and subsequent callbacks", async () => {
    const { audio, player, state, states } = setup();
    let reject!: (error: Error) => void;
    audio.play.mockImplementationOnce(
      () =>
        new Promise<void>((_, fail) => {
          reject = fail;
        }),
    );
    player.setSource("/song-a");
    player.dispose();
    const count = states.length;
    reject(new Error("Old session"));
    audio.dispatchEvent(new Event("error"));
    player.toggle();
    player.setSource("/song-b");
    await settle();
    expect(audio.paused).toBe(true);
    expect(audio.getAttribute("src")).toBeNull();
    expect(state().state).toBe("empty");
    expect(states).toHaveLength(count);
  });
  it("offers retry for media errors rather than pretending to play", () => {
    const { audio, player, state } = setup();
    player.setSource("/song-a");
    audio.dispatchEvent(new Event("error"));
    expect(state().state).toBe("error");
    player.toggle();
    expect(state().state).toBe("loading");
  });
});

describe("shared music snapshot and upload boundaries", () => {
  const snapshot = (): MusicSnapshot => ({ ...emptyMusic(), revision: 5 });
  it("never applies an older or duplicate revision", () => {
    const current = snapshot();
    expect(newerMusic(current, { ...snapshot(), revision: 4 })).toBe(current);
    expect(newerMusic(current, snapshot())).toBe(current);
    const next = { ...snapshot(), revision: 6 };
    expect(newerMusic(current, next)).toBe(next);
  });
  it("accepts MP3/WAV at the file size limit and rejects unsupported, empty, oversized files", () => {
    expect(
      musicUploadError(
        { name: "song.MP3", size: musicLimits.maxFileBytes },
        snapshot(),
      ),
    ).toBe("");
    expect(musicUploadError({ name: "song.wav", size: 1 }, snapshot())).toBe(
      "",
    );
    expect(
      musicUploadError({ name: "song.ogg", size: 1 }, snapshot()),
    ).toContain("MP3");
    expect(
      musicUploadError({ name: "song.wav", size: 0 }, snapshot()),
    ).toContain("空文件");
    expect(
      musicUploadError(
        { name: "song.wav", size: musicLimits.maxFileBytes + 1 },
        snapshot(),
      ),
    ).toContain("20 MiB");
  });
  it("enforces server supplied track and aggregate limits", () => {
    const track = {
      id: "a",
      title: "Song",
      contentType: "audio/wav" as const,
      byteSize: 100,
      createdAt: "2026-11-10T00:00:00Z",
    };
    const value = {
      ...snapshot(),
      tracks: [track],
      limits: { maxFileBytes: 200, maxTracks: 1, maxTotalBytes: 200 },
    };
    expect(musicUploadError({ name: "song.wav", size: 1 }, value)).toContain(
      "1 首",
    );
    value.limits.maxTracks = 2;
    expect(musicUploadError({ name: "song.wav", size: 101 }, value)).toContain(
      "总容量",
    );
  });
});
