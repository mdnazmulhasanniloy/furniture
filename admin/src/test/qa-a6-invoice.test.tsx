import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "@/app";
import { QrCode } from "@/components/qr-code";
import { configureApiClient } from "@/lib/api/client";
import { authStore } from "@/lib/auth/store";
import { initI18n, setLocale, type Locale } from "@/lib/i18n";
import type { AdminOrder } from "@/lib/orders";
import { THEME_KEY, ThemeProvider } from "@/lib/theme";
import { clampToBytes, phase1QrPayload, phase1Tlv, zatcaAmount, zatcaTimestamp } from "@/lib/zatca";
import ar from "@/locales/ar.json";
import en from "@/locales/en.json";

/**
 * QA 2026-11-24 (A6, owner decision). The seller is the store name from settings; the VAT registration
 * number on the order snapshot decides whether the sheet is a plain invoice or a simplified tax invoice
 * with the VAT amount, the total including VAT and the ZATCA Phase 1 QR.
 */
const VAT_NO = "300000000000003";
const STORE = { en: "Furnixa Home", ar: "فرنيكسا للمنازل" };
const adminUser = {
  id: "u1", firstName: "Sara", lastName: "Admin", email: "sara@furnixa.test",
  role: "ADMIN", isVerified: true, isBlocked: false, preferredLocale: "ar",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

const order = (o: Partial<AdminOrder> = {}): AdminOrder =>
  ({
    id: "o1",
    orderNo: "FX-20261120-0042",
    user: { id: "c1", firstName: "Lina", lastName: "Customer", email: "lina@example.test" },
    items: [
      { productId: "p1", titleSnapshot: { en: "Walnut sofa", ar: "أريكة جوز" }, sku: "SOFA-1", imageSnapshot: null, unitPrice: 123450, qty: 2, lineTotal: 246900 },
    ],
    address: { fullName: "Lina C", phone: "+966551234567", city: { en: "Riyadh", ar: "الرياض" }, area: "Olaya", street: "Main st 1", notes: null },
    subtotal: 246900, deliveryFee: 2500, total: 249400,
    vat: { vatRate: 15, vatAmount: 32530, applyToDelivery: true, pricesIncludeVat: true, registrationNumber: VAT_NO },
    currency: "SAR", paymentMethod: "COD", paymentStatus: "UNPAID", status: "PENDING",
    statusHistory: [{ status: "PENDING", at: "2026-11-20T09:00:00.000Z", byUserId: "c1", note: null }],
    customerNote: null, adminNote: null, createdAt: "2026-11-20T09:00:00.000Z",
    ...o,
  }) as AdminOrder;

let current: AdminOrder = order();
let settingsFails = false;
function stubApi() {
  settingsFails = false;
  configureApiClient({
    getLocale: () => document.documentElement.lang,
    fetch: (async (url: string) => {
      const path = url.replace(/^.*\/api\/v1/, "");
      if (path === "/auth/csrf") return json({ csrfToken: "csrf-1" });
      if (path === "/auth/refresh") return json({ accessToken: "at-1", user: adminUser });
      if (path === "/admin/settings") {
        return settingsFails
          ? json({ code: "INTERNAL_ERROR" }, 500)
          : json({
              storeName: STORE, logo: null, contactEmail: "", contactPhone: "", address: null, socials: null,
              deliveryFee: 2500, freeDeliveryThreshold: null,
              vat: { vatRate: 15, applyToDelivery: true, pricesIncludeVat: true, registrationNumber: VAT_NO },
              currency: "SAR", deliveryCities: [], defaultLocale: "ar", seo: null,
              updatedAt: "2026-11-20T09:00:00.000Z",
            });
      }
      if (path === "/admin/orders/o1") return json(current);
      return json({ code: "NOT_FOUND" }, 404);
    }) as unknown as typeof fetch,
  });
}

function mount(path: string) {
  const i18n = initI18n();
  return render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <MemoryRouter initialEntries={[path]}>
          <App queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />
        </MemoryRouter>
      </ThemeProvider>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  authStore.clear();
  localStorage.clear();
  localStorage.removeItem(THEME_KEY);
  document.documentElement.classList.remove("dark");
  current = order();
  stubApi();
});
afterEach(() => configureApiClient(null));

describe("A6 · ZATCA Phase 1 TLV payload", () => {
  /**
   * The worked example of the ZATCA Phase 1 specification: seller "Bobs Records", VAT number
   * 310122393500003, 2022-04-25T15:30:00Z, total 1000.00, VAT 150.00. The expected bytes are spelled
   * out as hex so the tag/length/value structure can be checked by eye without trusting the base64:
   * 01 0c "Bobs Records" · 02 0f <15 digits> · 03 14 <20 chars> · 04 07 "1000.00" · 05 06 "150.00".
   */
  const EXAMPLE_HEX =
    "010c426f6273205265636f726473" +
    "020f333130313232333933353030303033" +
    "0314323032322d30342d32355431353a33303a30305a" +
    "0407313030302e3030" +
    "05063135302e3030";
  const EXAMPLE_B64 =
    "AQxCb2JzIFJlY29yZHMCDzMxMDEyMjM5MzUwMDAwMwMUMjAyMi0wNC0yNVQxNTozMDowMFoEBzEwMDAuMDAFBjE1MC4wMA==";
  const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  const example = {
    sellerName: "Bobs Records",
    vatNumber: "310122393500003",
    issuedAt: "2022-04-25T15:30:00Z",
    totalWithVat: 100000,
    vatTotal: 15000,
  };

  it("A6 · encodes the specification's worked example byte for byte", () => {
    expect(hex(phase1Tlv(example))).toBe(EXAMPLE_HEX);
    expect(phase1QrPayload(example)).toBe(EXAMPLE_B64);
  });

  /** Walks the payload back: tag, one length byte, that many UTF-8 bytes. */
  const decodeTlv = (bytes: Uint8Array): Record<number, string> => {
    const out: Record<number, string> = {};
    const text = new TextDecoder();
    for (let at = 0; at < bytes.length; ) {
      const tag = bytes[at]!;
      const len = bytes[at + 1]!;
      out[tag] = text.decode(bytes.subarray(at + 2, at + 2 + len));
      at += 2 + len;
    }
    return out;
  };

  it("A6 · the five fields decode back to exactly what went in", () => {
    expect(decodeTlv(phase1Tlv(example))).toEqual({
      1: "Bobs Records",
      2: "310122393500003",
      3: "2022-04-25T15:30:00Z",
      4: "1000.00",
      5: "150.00",
    });
  });

  // Owner 2026-11-24: confirm tags 4 and 5 are SAR strings with two decimals, like the worked example.
  it("A6 · tags 4 and 5 are SAR strings with two decimals, derived from integer halalas", () => {
    const fields = decodeTlv(phase1Tlv({ ...example, totalWithVat: 115_000, vatTotal: 15_000 }));
    expect(fields[4]).toBe("1150.00");
    expect(fields[5]).toBe("150.00");
    for (const [halalas, text] of [
      [0, "0.00"],
      [1, "0.01"],
      [70, "0.70"],
      [999, "9.99"],
      [100_000, "1000.00"],
      [24_940_000, "249400.00"],
    ] as const) {
      expect(decodeTlv(phase1Tlv({ ...example, totalWithVat: halalas }))[4], String(halalas)).toBe(text);
      expect(Number(text) * 100).toBe(halalas); // and the string really is that many halalas
    }
  });

  it("A6 · amounts and timestamps are exact (no float cents, second precision, UTC)", () => {
    expect(zatcaAmount(100000)).toBe("1000.00");
    expect(zatcaAmount(1)).toBe("0.01");
    expect(zatcaAmount(0)).toBe("0.00");
    expect(zatcaAmount(32530)).toBe("325.30");
    expect(zatcaAmount(829)).toBe("8.29");
    expect(zatcaTimestamp("2026-11-20T09:00:00.000Z")).toBe("2026-11-20T09:00:00Z");
    expect(zatcaTimestamp("2026-11-20T12:00:00+03:00")).toBe("2026-11-20T09:00:00Z");
  });

  it("A6 · an Arabic seller name is counted in UTF-8 bytes and clamped to one TLV field", () => {
    const bytes = phase1Tlv({ ...example, sellerName: "فرنيكسا" });
    expect(bytes[0]).toBe(1);
    expect(bytes[1]).toBe(new TextEncoder().encode("فرنيكسا").length); // 14, not 7
    const long = "ف".repeat(200); // 400 bytes
    expect(new TextEncoder().encode(clampToBytes(long)).length).toBeLessThanOrEqual(255);
    expect(clampToBytes(long).endsWith("ف")).toBe(true); // never cut mid-character
    expect(phase1Tlv({ ...example, sellerName: long })[1]).toBeLessThanOrEqual(255);
  });
});

describe("A6 · the QR renders as SVG", () => {
  it("A6 · the same payload always renders the same module matrix", () => {
    const { container, unmount } = render(<QrCode value="AQxCb2JzIFJlY29yZHM=" label="qr" testId="qr" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("qr");
    const modules = Number(svg.getAttribute("data-modules"));
    expect(modules).toBe(25); // version 2 at EC level M for this payload
    expect(svg.getAttribute("viewBox")).toBe(`0 0 ${modules + 8} ${modules + 8}`); // 4-module quiet zone
    const path = svg.querySelector("path")!.getAttribute("d")!;
    // The three finder patterns: a dark module at each of the three corners, inside the quiet zone.
    expect(path).toContain("M4 4h1v1h-1z");
    expect(path).toContain(`M${modules + 3} 4h1v1h-1z`);
    expect(path).toContain(`M4 ${modules + 3}h1v1h-1z`);
    const first = path;
    unmount();
    const again = render(<QrCode value="AQxCb2JzIFJlY29yZHM=" label="qr" />);
    expect(again.container.querySelector("path")!.getAttribute("d")).toBe(first);
  });
});

describe.each([
  ["en", en],
  ["ar", ar],
] as const)("ADM-04 · invoice kind follows the VAT registration number (%s) (A6)", (locale, msgs) => {
  beforeEach(async () => {
    initI18n(locale as Locale);
    await setLocale(locale as Locale);
  });
  const inv = msgs.orders.invoice;

  it("ADM-04 · with a VAT number: simplified tax invoice, seller from settings, VAT amount, total including VAT, QR (A6)", async () => {
    mount("/orders/o1/invoice");
    const sheet = await screen.findByTestId("invoice");
    expect(within(sheet).getByTestId("invoice-title").textContent).toBe(inv.titleTax);
    expect(within(sheet).getByTestId("invoice-seller").textContent).toContain(STORE[locale]);
    expect(within(sheet).getByTestId("invoice-vat-reg").textContent).toContain(VAT_NO);
    expect(within(sheet).getByTestId("invoice-date").textContent).toMatch(/\d{1,2}:\d{2}/); // date AND time
    expect(within(sheet).getByTestId("invoice-vat").textContent).toContain("325.30");
    expect(within(sheet).getByTestId("invoice-totals").textContent).toContain(inv.totalInclVat);
    expect(within(sheet).getByTestId("invoice-items").textContent).toContain("2,469"); // line total
    const qr = within(sheet).getByTestId("invoice-qr-svg");
    expect(qr.getAttribute("aria-label")).toBe(inv.qr);
    // The QR encodes exactly the five fields of this invoice.
    const expected = phase1QrPayload({
      sellerName: STORE[locale],
      vatNumber: VAT_NO,
      issuedAt: "2026-11-20T09:00:00.000Z",
      totalWithVat: 249400,
      vatTotal: 32530,
    });
    const control = render(<QrCode value={expected} label="control" />);
    expect(qr.querySelector("path")!.getAttribute("d")).toBe(control.container.querySelector("path")!.getAttribute("d"));
    control.unmount();
  });

  it("ADM-04 · without a VAT number: plain invoice, no VAT line, no QR (A6)", async () => {
    current = order({
      vat: { vatRate: 0, vatAmount: 0, applyToDelivery: true, pricesIncludeVat: true, registrationNumber: null },
      deliveryFee: 0,
      total: 246900,
    });
    mount("/orders/o1/invoice");
    const sheet = await screen.findByTestId("invoice");
    expect(within(sheet).getByTestId("invoice-title").textContent).toBe(inv.title);
    expect(within(sheet).getByTestId("invoice-seller").textContent).toContain(STORE[locale]);
    expect(within(sheet).queryByTestId("invoice-vat")).toBeNull();
    expect(within(sheet).queryByTestId("invoice-vat-reg")).toBeNull();
    expect(within(sheet).queryByTestId("invoice-qr")).toBeNull();
    expect(within(sheet).getByTestId("invoice-totals").textContent).toContain(msgs.orders.totalLabel);
  });

  it("ADM-04 · a charged VAT is never hidden, even without a registration number (A6)", async () => {
    current = order({ vat: { vatRate: 15, vatAmount: 32530, applyToDelivery: true, pricesIncludeVat: true, registrationNumber: null } });
    mount("/orders/o1/invoice");
    const sheet = await screen.findByTestId("invoice");
    expect(within(sheet).getByTestId("invoice-title").textContent).toBe(inv.title);
    expect(within(sheet).getByTestId("invoice-vat").textContent).toContain("325.30");
    expect(within(sheet).queryByTestId("invoice-qr")).toBeNull();
  });

  it("ADM-04 · switching the print language switches the title and the QR's seller name (A6)", async () => {
    mount("/orders/o1/invoice");
    await screen.findByTestId("invoice");
    const other = locale === "en" ? "ar" : "en";
    const otherMsgs = other === "en" ? en : ar;
    fireEvent.change(screen.getByLabelText(inv.language), { target: { value: other } });
    await waitFor(() =>
      expect(screen.getByTestId("invoice-title").textContent).toBe(otherMsgs.orders.invoice.titleTax),
    );
    expect(screen.getByTestId("invoice-seller").textContent).toContain(STORE[other]);
  });

  it("ADM-04 · settings that cannot be loaded show an error instead of an invoice without a seller (A6)", async () => {
    settingsFails = true;
    mount("/orders/o1/invoice");
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByTestId("invoice")).toBeNull();
    expect(document.body.textContent).not.toContain("Raw English API text");
  });
});
