// A tiny stand-in for the backend, used only by `npm run e2e`.
//
// The home page is rendered on the server, so Playwright's request interception cannot reach its data:
// without something answering `GET /api/v1/cms/home` there is no "Shop the look" section to measure. This
// serves exactly that one route (a look with three points on a 2:1 photo) and 404s everything else, which
// is what the e2e saw before - every other page keeps its no-backend behaviour.
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

/** Read the real home payload (if there is one) and put the known look in place of any look it has. */
function homeWithLook(upstream) {
  return new Promise((resolve) => {
    const target = new URL(HOME, upstream);
    const req = httpRequest(
      { hostname: target.hostname, port: target.port, path: target.pathname, method: "GET", headers: { Accept: "application/json" } },
      (up) => {
        let raw = "";
        up.setEncoding("utf8");
        up.on("data", (c) => (raw += c));
        up.on("end", () => {
          try {
            const data = up.statusCode === 200 ? JSON.parse(raw) : null;
            const others = Array.isArray(data?.sections)
              ? data.sections.filter((s) => s?.type !== "SHOP_THE_LOOK")
              : [];
            resolve({ ...(data ?? {}), banners: data?.banners ?? [], sections: [...others, LOOK_SECTION] });
          } catch {
            resolve({ banners: [], sections: [LOOK_SECTION] });
          }
        });
      },
    );
    req.on("error", () => resolve({ banners: [], sections: [LOOK_SECTION] }));
    req.end();
  });
}

export function startStub(port, upstream = process.env.API_ORIGIN ?? "http://localhost:1000") {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const path = (req.url ?? "").split("?")[0];
      if (path !== HOME || req.method !== "GET") return passThrough(upstream, req, res);
      // The home page keeps whatever this machine's API says, with one known look appended: the alignment
      // spec needs fixed coordinates, and the rest of the page must stay as it is or other specs would be
      // measuring a page that does not exist anywhere else.
      void homeWithLook(upstream).then((body) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
      });
    });
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
