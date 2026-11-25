// A tiny stand-in for the backend, used only by `npm run e2e`.
//
// The pages are rendered on the server, so Playwright's request interception cannot reach their data:
// without something answering `GET /api/v1/cms/home` there is no "Shop the look" section to measure, and
// without `GET /api/v1/cms/settings` no known theme to measure either. This serves those two routes - the
// real payload with one known look, and the real settings with one known theme - and passes everything else
// through, so every other spec sees exactly the API it saw before.
import { createServer, request as httpRequest } from "node:http";

/** A 2:1 photo, inline so nothing is fetched over the network. */
const PHOTO =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600"><rect width="1200" height="600" fill="#cbb9a8"/><circle cx="240" cy="360" r="24" fill="#5b4a3f"/></svg>`,
  );

const product = (id, en, ar) => ({
  id,
  slug: id,
  title: { en, ar },
  price: 120000,
  compareAtPrice: null,
  stock: 5,
  type: "NEW",
  condition: "NEW",
  images: [{ url: PHOTO, alt: { en, ar }, width: 1200, height: 600 }],
  isFeatured: false,
});

export const LOOK_SECTION = {
  id: "look-1",
  type: "SHOP_THE_LOOK",
  title: { en: "Shop the look", ar: "تسوّق هذا التنسيق" },
  subtitle: null,
  sortOrder: 1,
  isVisible: true,
  look: {
    image: {
      url: PHOTO,
      alt: { en: "A living room", ar: "غرفة معيشة" },
      width: 1200,
      height: 600,
    },
    // The first point is on the dark circle painted into the photo at 20% / 60%.
    hotspots: [
      { x: 20, y: 60, product: product("armchair", "Armchair", "كرسي") },
      { x: 50, y: 30, product: product("lamp", "Floor lamp", "مصباح أرضي") },
      { x: 80, y: 75, product: product("sofa", "Sofa", "أريكة") },
    ],
  },
};

const HOME = "/api/v1/cms/home";
const SETTINGS = "/api/v1/cms/settings";

/**
 * UI-03: the walnut preset, exactly as backend/src/lib/themes.ts has it. The theme reaches the storefront
 * through the server-rendered settings fetch, which Playwright cannot intercept either, so the stub applies
 * it for the whole run: `theme.spec.ts` can then measure a real colour instead of trusting the mechanism.
 * Nothing else about the settings is touched, and paper and ink are the same in every preset, so the specs
 * that assert a white page or dark text are unaffected.
 */
export const WALNUT = {
  id: "walnut",
  tokens: {
    primary: "#6b3f2a",
    primaryForeground: "#ffffff",
    ring: "#6b3f2a",
    muted: "#f0e7dc",
    secondary: "#f0e7dc",
    mutedForeground: "#5e5249",
    stone: "#756a60",
    border: "#e6dcd0",
    input: "#85786c",
    gold: "#c58e4e",
    goldStrong: "#8f5f2a",
    price: "#77491b",
    blush: "#f8efe8",
    champagne: "#d2a977",
  },
};

/**
 * Everything except the one stubbed route is passed through to wherever the API really is, so a machine
 * with the backend running sees its own data (which is what the rest of the suite has always been built
 * against here) and a machine without one sees 502 - which the app treats like an unreachable API, the
 * same page it renders when nothing is listening. Answering 404 instead would be a different story: the
 * app tells a missing page apart from an unreachable API.
 */
function passThrough(upstream, req, res) {
  const target = new URL(req.url ?? "/", upstream);
  const proxied = httpRequest(
    { hostname: target.hostname, port: target.port, path: target.pathname + target.search, method: req.method, headers: { ...req.headers, host: target.host } },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  proxied.on("error", () => {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ code: "BAD_GATEWAY", message: "no backend" }));
  });
  req.pipe(proxied);
}

/** GET one route from the real API as JSON, or null when there is nothing (or nothing valid) there. */
function upstreamJson(upstream, path) {
  return new Promise((resolve) => {
    const target = new URL(path, upstream);
    const req = httpRequest(
      { hostname: target.hostname, port: target.port, path: target.pathname, method: "GET", headers: { Accept: "application/json" } },
      (up) => {
        let raw = "";
        up.setEncoding("utf8");
        up.on("data", (c) => (raw += c));
        up.on("end", () => {
          try {
            resolve(up.statusCode === 200 ? JSON.parse(raw) : null);
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on("error", () => resolve(null));
    req.end();
  });
}

/** Read the real home payload (if there is one) and put the known look in place of any look it has. */
async function homeWithLook(upstream) {
  const data = await upstreamJson(upstream, HOME);
  const others = Array.isArray(data?.sections)
    ? data.sections.filter((s) => s?.type !== "SHOP_THE_LOOK")
    : [];
  return { ...(data ?? {}), banners: data?.banners ?? [], sections: [...others, LOOK_SECTION] };
}

/** The real settings with one known theme applied, so a colour is a measurable claim (UI-03). */
async function settingsWithTheme(upstream) {
  const data = await upstreamJson(upstream, SETTINGS);
  return data ? { ...data, theme: WALNUT } : null;
}

export function startStub(port, upstream = process.env.API_ORIGIN ?? "http://localhost:1000") {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const path = (req.url ?? "").split("?")[0];
      const stubbed = req.method === "GET" && (path === HOME || path === SETTINGS);
      if (!stubbed) return passThrough(upstream, req, res);
      // Each stubbed route keeps whatever this machine's API says, with one known thing merged in: the
      // alignment spec needs fixed hotspot coordinates and the theme spec a fixed colour. Everything else
      // on those payloads stays as it is, or other specs would be measuring a page that exists nowhere.
      const body = path === HOME ? homeWithLook(upstream) : settingsWithTheme(upstream);
      void body.then((payload) => {
        if (payload === null) return passThrough(upstream, req, res); // no API here: keep the old behaviour
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      });
    });
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
