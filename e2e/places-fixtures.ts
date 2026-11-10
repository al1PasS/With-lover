import type {
  Browser,
  Page,
  Route,
} from "../frontend/node_modules/@playwright/test/index";

// Entirely synthetic, generated in memory: no private photos, network images, or binary fixtures.
export type PlaceFixture = {
  id: string;
  city: string;
  visitDate: string | null;
  description: string;
  sortOrder: number;
  image: {
    url: string;
    version: string;
    width: number;
    height: number;
    variants: { url: string; width: number; height: number }[];
  };
};
export type PlaceImages = { jpeg: Map<number, Buffer>; replacementPng: Buffer };
const widths = [960, 1920, 3200];
export const initialVersion = "00000000-0000-4000-8000-000000000001";
export const replacementVersion = "00000000-0000-4000-8000-000000000002";

export function makePlaces(): PlaceFixture[] {
  return ["合成海湾", "合成山城", "合成原野"].map((city, index) => {
    const id = `synthetic-place-${index + 1}`;
    const url = (width: number) =>
      `/api/v1/media/places/${id}?w=${width}&v=${initialVersion}`;
    return {
      id,
      city,
      visitDate: index === 1 ? null : "2026-10-12",
      description: `验收专用合成长卷 ${index + 1}，没有私人照片或文字。`,
      sortOrder: index,
      image: {
        url: url(1920),
        version: initialVersion,
        width: 3200,
        height: 457,
        // Match the real contract: the reader rendition is acquired on demand, not in list srcset.
        variants: widths
          .filter((width) => width <= 1920)
          .map((width) => ({
            url: url(width),
            width,
            height: Math.round(width / 7),
          })),
      },
    };
  });
}

export async function createPlaceImages(
  browser: Browser,
): Promise<PlaceImages> {
  const page = await browser.newPage();
  try {
    const result = await page.evaluate(() => {
      function picture(
        width: number,
        height: number,
        type: "image/jpeg" | "image/png",
      ) {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d")!;
        const image = context.createImageData(width, height);
        let seed = 0x143729ab;
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            seed ^= seed << 13;
            seed ^= seed >>> 17;
            seed ^= seed << 5;
            const noise = (seed >>> 0) % 90;
            const horizon =
              height * (0.52 + Math.sin((x / width) * Math.PI * 8) * 0.12);
            const sky = y < horizon;
            const p = (y * width + x) * 4;
            image.data[p] = (sky ? 120 : 55) + noise;
            image.data[p + 1] = (sky ? 150 : 90) + noise;
            image.data[p + 2] = (sky ? 165 : 85) + noise;
            image.data[p + 3] = 255;
          }
        }
        context.putImageData(image, 0, 0);
        return canvas.toDataURL(type, 0.86).split(",")[1];
      }
      return {
        jpeg: [960, 1920, 3200].map(
          (width) =>
            [
              width,
              picture(width, Math.round(width / 7), "image/jpeg"),
            ] as const,
        ),
        png: picture(700, 100, "image/png"),
      };
    });
    return {
      jpeg: new Map(
        result.jpeg.map(([width, data]) => [
          width,
          Buffer.from(data, "base64"),
        ]),
      ),
      replacementPng: Buffer.from(result.png, "base64"),
    };
  } finally {
    await page.close();
  }
}

type ApiCall = {
  path: string;
  method: string;
  query: string;
  body?: Record<string, unknown>;
};
export async function mockPlacesApi(
  page: Page,
  images: PlaceImages,
  options: {
    listFailures?: number;
    imageFailures?: string[];
    holdList?: boolean;
    holdCreate?: boolean;
    publicPlaces?: boolean;
    holdPublicList?: boolean;
  } = {},
) {
  const state = {
    places: makePlaces(),
    signedIn: true,
    calls: [] as ApiCall[],
    unexpected: [] as string[],
    remainingListFailures: options.listFailures ?? 0,
    failedImages: new Set(options.imageFailures),
    releaseList: async () => {},
    releaseCreate: async () => {},
    releasePublicList: async () => {},
  };
  function responseGate() {
    let open: () => void = () => {},
      done: () => void = () => {};
    const wait = new Promise<void>((resolve) => {
      open = resolve;
    });
    const settled = new Promise<void>((resolve) => {
      done = resolve;
    });
    return {
      wait,
      done,
      release: async () => {
        open();
        await settled;
      },
    };
  }
  const listGate = responseGate(),
    createGate = responseGate(),
    publicGate = responseGate();
  state.releaseList = listGate.release;
  state.releaseCreate = createGate.release;
  state.releasePublicList = publicGate.release;
  let privateListNumber = 0;
  const json = (route: Route, value: unknown) =>
    route.fulfill({ json: value, headers: { "Cache-Control": "no-store" } });
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1/, ""),
      method = request.method();
    const call: ApiCall = { path, method, query: url.search };
    if (request.postData()) call.body = request.postDataJSON();
    state.calls.push(call);
    if (path === "/auth/me")
      return json(
        route,
        state.signedIn
          ? { name: "合成管理员", role: "ADMIN" }
          : { name: null, role: null },
      );
    if (path === "/auth/csrf")
      return json(route, {
        token: "places-test-csrf",
        headerName: "X-CSRF-TOKEN",
      });
    if (path === "/auth/logout") {
      state.signedIn = false;
      return route.fulfill({ status: 204 });
    }
    if (path === "/public/privacy")
      return json(route, {
        mode: options.publicPlaces ? "SELECTED" : "PRIVATE",
        home: false,
        timeline: false,
        anniversaries: false,
        albums: false,
        places: options.publicPlaces ?? false,
      });
    if (path === "/activities")
      return json(route, {
        items: [],
        unread: 0,
        latestId: 0,
        nextCursor: null,
      });
    if (/^\/activities\/(?:\d+\/read|read-all)$/.test(path))
      return route.fulfill({ status: 204 });
    if (path === "/music")
      return json(route, { revision: 0, selectedTrackId: null, tracks: [] });
    if (["/memories", "/trash", "/anniversaries"].includes(path))
      return json(route, []);
    if (path === "/media/cover")
      return route.fulfill({
        contentType: "image/jpeg",
        body: images.jpeg.get(1920)!,
      });
    if (/^\/(?:public\/)?media\/places\//.test(path)) {
      const id = path.split("/").at(-1)!;
      if (state.failedImages.delete(id))
        return route.fulfill({
          status: 503,
          body: "synthetic image unavailable",
          headers: { "Cache-Control": "no-store" },
        });
      const width = Number(url.searchParams.get("w"));
      const body = images.jpeg.get(width);
      if (body)
        return route.fulfill({
          contentType: "image/jpeg",
          body,
          headers: { "Cache-Control": "no-store" },
        });
    }
    if (path === "/public/places" && method === "GET" && options.publicPlaces) {
      const snapshot = structuredClone(state.places).map((place) => ({
        ...place,
        image: {
          ...place.image,
          url: place.image.url.replace(
            "/api/v1/media/",
            "/api/v1/public/media/",
          ),
          variants: place.image.variants.map((variant) => ({
            ...variant,
            url: variant.url.replace("/api/v1/media/", "/api/v1/public/media/"),
          })),
        },
      }));
      if (options.holdPublicList) await publicGate.wait;
      try {
        return await json(route, snapshot);
      } finally {
        publicGate.done();
      }
    }
    if (path === "/places" && method === "GET") {
      // Only hold the first snapshot: a write can abort it and re-fetch the full collection.
      const held = options.holdList && ++privateListNumber === 1;
      const snapshot = structuredClone(state.places);
      if (held) await listGate.wait;
      if (state.remainingListFailures-- > 0)
        return route.fulfill({
          status: 503,
          json: { message: "合成足迹列表暂时不可用" },
        });
      try {
        return await json(route, snapshot);
      } catch (error) {
        // An AbortController may cancel a held request when logout completes.
        if (!held) throw error;
        return;
      } finally {
        if (held) listGate.done();
      }
    }
    if (path === "/admin/places" && method === "POST") {
      const input = call.body!;
      const template = makePlaces()[0];
      const created: PlaceFixture = {
        ...template,
        id: "synthetic-place-created",
        city: String(input.city),
        visitDate: input.visitDate as string | null,
        description: String(input.description),
        sortOrder: state.places.length,
        image: {
          ...template.image,
          url: template.image.url.replace(
            template.id,
            "synthetic-place-created",
          ),
          variants: template.image.variants.map((variant) => ({
            ...variant,
            url: variant.url.replace(template.id, "synthetic-place-created"),
          })),
        },
      };
      // Commit immediately, but optionally keep the private mutation response in flight.
      state.places.push(created);
      if (options.holdCreate) await createGate.wait;
      try {
        return await json(route, created);
      } finally {
        createGate.done();
      }
    }
    if (path === "/admin/places/reorder" && method === "PATCH") {
      const ids = call.body!.ids as string[];
      state.places = ids.map((id, sortOrder) => ({
        ...state.places.find((place) => place.id === id)!,
        sortOrder,
      }));
      return route.fulfill({ status: 204 });
    }
    const edit = /^\/admin\/places\/([^/]+)$/.exec(path);
    if (edit && method === "PATCH") {
      const place = state.places.find((place) => place.id === edit[1])!;
      const input = call.body!;
      const updated = {
        ...place,
        city: String(input.city),
        visitDate: input.visitDate as string | null,
        description: String(input.description),
      };
      if (typeof input.panoramaImage === "string") {
        updated.image = {
          ...place.image,
          version: replacementVersion,
          url: place.image.url.replace(initialVersion, replacementVersion),
          variants: place.image.variants.map((variant) => ({
            ...variant,
            url: variant.url.replace(initialVersion, replacementVersion),
          })),
        };
      }
      state.places = state.places.map((item) =>
        item.id === place.id ? updated : item,
      );
      return json(route, updated);
    }
    if (edit && method === "DELETE") {
      state.places = state.places.filter((place) => place.id !== edit[1]);
      return route.fulfill({ status: 204 });
    }
    state.unexpected.push(`${method} ${path}${url.search}`);
    return route.fulfill({
      status: 501,
      json: { message: "Unexpected synthetic API request" },
    });
  });
  return state;
}

export function listCalls(
  state: Awaited<ReturnType<typeof mockPlacesApi>>,
  path = "/places",
) {
  return state.calls.filter(
    (call) => call.path === path && call.method === "GET",
  );
}
export function readerCalls(state: Awaited<ReturnType<typeof mockPlacesApi>>) {
  return state.calls.filter(
    (call) =>
      call.path.startsWith("/media/places/") &&
      new URLSearchParams(call.query).get("w") === "3200",
  );
}
