import { useState } from "react";
import { Key, Pause, Play, Sparkle } from "@phosphor-icons/react";

export default function CastleScene() {
  const [paused, setPaused] = useState(false);
  return (
    <>
      <picture className="castle-art" aria-hidden="true">
        <source
          media="(max-width: 767px)"
          srcSet="/images/strawberry-castle-mobile.webp"
        />
        <img
          src="/images/strawberry-castle.webp"
          width={1536}
          height={1024}
          alt=""
          decoding="async"
        />
      </picture>
      <div
        className={`castle-magic${paused ? " is-paused" : ""}`}
        aria-hidden="true"
      >
        <div className="castle-orbit" />
        <div className="castle-lantern castle-lantern-near">
          <i />
        </div>
        <div className="castle-lantern castle-lantern-far">
          <i />
        </div>
        <Key weight="duotone" className="castle-key" />
        <Sparkle weight="fill" className="castle-sparkle" />
        <Sparkle weight="fill" className="castle-sparkle-small" />
        <div className="castle-stardust" />
      </div>
      <button
        type="button"
        className="castle-motion"
        aria-label={paused ? "播放城堡动画" : "暂停城堡动画"}
        onClick={() => setPaused(!paused)}
      >
        {paused ? (
          <Play weight="fill" aria-hidden="true" />
        ) : (
          <Pause weight="fill" aria-hidden="true" />
        )}
      </button>
    </>
  );
}
