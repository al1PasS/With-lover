import { useState, type CSSProperties } from "react";
import { Key, Pause, Play, Sparkle } from "@phosphor-icons/react";

const petals = [
  { position: 8, size: 9, drift: 24, duration: 17, delay: -8 },
  { position: 23, size: 12, drift: -34, duration: 21, delay: -17 },
  { position: 45, size: 10, drift: 35, duration: 16, delay: -4 },
  { position: 64, size: 13, drift: -46, duration: 19, delay: -9 },
  { position: 82, size: 11, drift: 39, duration: 15, delay: -12 },
  { position: 94, size: 8, drift: -24, duration: 20, delay: -3 },
  { position: 36, size: 8, drift: 28, duration: 22, delay: -15 },
  { position: 56, size: 9, drift: -36, duration: 18, delay: -13 },
  { position: 75, size: 7, drift: -27, duration: 16, delay: -6 },
];

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
        {petals.map(({ position, size, drift, duration, delay }) => (
          <span
            key={position}
            className="castle-petal"
            style={
              {
                left: `${position}%`,
                "--petal-size": `${size}px`,
                "--petal-drift": `${drift}px`,
                animationDuration: `${duration}s`,
                animationDelay: `${delay}s`,
              } as CSSProperties
            }
          />
        ))}
      </div>
      <button
        type="button"
        className="castle-motion"
        aria-label={paused ? "播放首页动效" : "暂停首页动效"}
        onClick={() => setPaused((value) => !value)}
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
