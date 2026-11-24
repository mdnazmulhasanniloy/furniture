import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { configureApiClient } from "@/lib/api/client";
import { loadCart, resetCartStore, useCartStore } from "@/lib/cart/store";

const cartFor = (id: string) =>
  new Response(JSON.stringify({ items: [], subtotal: 0, deliveryFee: 0, total: 0, address: { id } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("CART-01 · loadCart keeps the newest request", () => {
  beforeEach(() => resetCartStore());
  afterEach(() => configureApiClient(null));

  it("a slow response for an earlier address does not overwrite the later one", async () => {
    const resolvers: Record<string, () => void> = {};
    configureApiClient({
      getLocale: () => "en",
      fetch: ((url: string) =>
        new Promise<Response>((resolve) => {
          const id = new URL(url, "http://x").searchParams.get("addressId")!;
          resolvers[id] = () => resolve(cartFor(id));
        })) as typeof fetch,
    });
    const a = loadCart("A");
    const b = loadCart("B");
    resolvers.B();
    await b;
    resolvers.A();
    await a;
    expect(useCartStore.getState().cart?.address?.id).toBe("B");
    expect(useCartStore.getState().loading).toBe(false);
  });
});
