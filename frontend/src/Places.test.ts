import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  getCenteredScrollLeft,
  getPlaceImageSources,
  getPlacePanoramaRatio,
  getPlaceReaderUrl,
  PlaceCard,
} from "./Places";
import type { Place } from "./types";

const place: Place = {
  id: "sample-place",
  city: "示例城市",
  visitDate: "2026-06-19",
  description: "一幅共同的旅行长卷。",
  sortOrder: 0,
  image: {
    url: "/api/v1/media/places/sample-place?w=1920&v=revision",
    width: 7000,
    height: 1000,
    version: "revision",
    variants: [
      { url: "/media/large", width: 3200, height: 457 },
      { url: "/media/small", width: 960, height: 137 },
      { url: "/media/preview", width: 1920, height: 274 },
    ],
  },
};

describe("place image sources", () => {
  it("uses actual variant widths, sorted, with no reader rendition in the list", () => {
    expect(getPlaceImageSources(place)).toEqual({
      src: "/media/preview",
      srcSet: "/media/small 960w, /media/preview 1920w",
    });
    expect(getPlaceReaderUrl(place)).toBe("/media/large");
  });

  it("does not invent a source width from original metadata or enlarge small images", () => {
    const small: Place = {
      ...place,
      image: {
        ...place.image!,
        width: 700,
        height: 100,
        variants: [{ url: "/small", width: 700, height: 100 }],
      },
    };
    expect(getPlaceImageSources(small)).toEqual({
      src: "/small",
      srcSet: "/small 700w",
    });
    expect(getPlaceReaderUrl(small)).toBe("/small");
    const legacy: Place = {
      ...place,
      image: { ...place.image!, width: null, height: null, variants: [] },
    };
    expect(getPlaceImageSources(legacy)).toEqual({
      src: legacy.image!.url,
      srcSet: undefined,
    });
    expect(getPlaceReaderUrl(legacy)).toBe(
      "/api/v1/media/places/sample-place?w=3200&v=revision",
    );
  });

  it("supports the public place endpoint and preserves the image version", () => {
    const legacy: Place = {
      ...place,
      image: {
        ...place.image!,
        url: "/api/v1/public/media/places/sample-place?w=1920&v=revision",
        variants: [],
      },
    };
    expect(getPlaceReaderUrl(legacy)).toBe(
      "/api/v1/public/media/places/sample-place?w=3200&v=revision",
    );
  });

  it("never synthesizes reader requests for external, unrelated or demo URLs", () => {
    for (const url of [
      "https://outside.example/api/v1/media/places/sample-place?w=1920",
      "/api/v1/music/tracks/example/content",
      "data:image/png;base64,c2FtcGxl",
    ]) {
      const other: Place = {
        ...place,
        image: { ...place.image!, url, variants: [] },
      };
      expect(getPlaceReaderUrl(other)).toBe(url);
    }
    const demo: Place = {
      ...place,
      image: undefined,
      panoramaImage: "data:image/png;base64,c2FtcGxl",
    };
    expect(getPlaceImageSources(demo)).toEqual({
      src: demo.panoramaImage,
      srcSet: undefined,
    });
    expect(getPlaceReaderUrl(demo)).toBe(demo.panoramaImage);
  });

  it("filters invalid and out-of-budget candidates", () => {
    const invalid: Place = {
      ...place,
      image: {
        ...place.image!,
        variants: [
          { url: "/invalid", width: 0, height: 1 },
          { url: "/invalid", width: 960, height: NaN },
          { url: "/too-large", width: 7000, height: 1000 },
        ],
      },
    };
    expect(getPlaceImageSources(invalid)).toEqual({
      src: place.image!.url,
      srcSet: undefined,
    });
  });

  it("reserves a safe ratio while legacy metadata is unknown", () => {
    expect(getPlacePanoramaRatio(place)).toBe(7);
    expect(
      getPlacePanoramaRatio({
        ...place,
        image: { ...place.image!, width: 1500, height: 500 },
      }),
    ).toBe(3);
    expect(getPlacePanoramaRatio({ ...place, image: null })).toBe(7);
    expect(
      getPlacePanoramaRatio({
        ...place,
        image: { ...place.image!, height: 0 },
      }),
    ).toBe(7);
  });
});

describe("place card markup", () => {
  const props = {
    place,
    index: 0,
    total: 2,
    canManage: true,
    onMove: () => {},
    onEdit: () => {},
    onDelete: () => {},
  };
  it("prioritizes only the first image and does not mount the reader before opening", () => {
    const first = renderToStaticMarkup(createElement(PlaceCard, props));
    expect(first).toContain('loading="eager"');
    expect(first).toContain('fetchPriority="high"');
    expect(first).toContain('decoding="async"');
    expect(first).toContain("calc(100vw - 66px)");
    expect(first).not.toContain("980px");
    expect(first).not.toContain("左右滑动查看长卷");
    expect(first).not.toContain("/media/large");
    expect(first).not.toContain('role="dialog"');
    expect(first).toContain('id="activity-sample-place"');
    const later = renderToStaticMarkup(
      createElement(PlaceCard, { ...props, index: 1 }),
    );
    expect(later).toContain('loading="lazy"');
    expect(later).toContain('fetchPriority="auto"');
  });

  it("keeps metadata visible outside the image and omits visitor management controls", () => {
    const markup = renderToStaticMarkup(
      createElement(PlaceCard, { ...props, canManage: false }),
    );
    expect(markup).toContain("示例城市</h2>");
    expect(markup).toContain('dateTime="2026-06-19"');
    expect(markup).toContain(place.description);
    expect(markup).toContain('aria-label="展开示例城市长卷"');
    expect(markup).not.toContain('class="place-admin-actions"');
  });
});

describe("initial panorama centering", () => {
  it("starts at the center of the overflow, clamped for narrow images", () => {
    expect(getCenteredScrollLeft(980, 329)).toBe(325.5);
    expect(getCenteredScrollLeft(980, 344)).toBe(318);
    expect(getCenteredScrollLeft(300, 329)).toBe(0);
  });
});
