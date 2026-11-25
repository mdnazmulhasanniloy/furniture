// ZATCA (Fatoora) Phase 1 QR payload for a simplified tax invoice (owner 2026-11-24, A6; closes the
// Phase 1 half of B-013). Five TLV fields in this order - tag, one length byte, UTF-8 value - base64
// encoded; the QR carries that base64 string:
//   1 seller name · 2 VAT registration number · 3 invoice timestamp (ISO 8601) · 4 invoice total
//   including VAT · 5 VAT total
// Lengths are BYTE lengths, so an Arabic letter counts 2 bytes and an emoji 4. Phase 2 (e-invoicing
// integration: UUID, cryptographic stamp, hash chain, clearance/reporting) is launch blocker B-041.

export type Phase1Invoice = {
  /** Seller name as registered - the store name from settings (ADM-09). */
  sellerName: string;
  /** 15 digits, starts and ends with 3 (api-spec VatSetting.registrationNumber). */
  vatNumber: string;
  /** The invoice instant, any parsable ISO string; encoded with second precision in UTC. */
  issuedAt: string;
  /** Integer halalas, including VAT. */
  totalWithVat: number;
  /** Integer halalas. */
  vatTotal: number;
};

/** One TLV field may carry at most 255 bytes, because the length is a single byte. */
export const MAX_TLV_VALUE_BYTES = 255;

const encoder = new TextEncoder();

/**
 * The value cut to at most `max` UTF-8 bytes, never mid-character (a store name may be 120 Arabic
 * letters = 240 bytes, and nothing stops a longer one from being configured later).
 */
export function clampToBytes(value: string, max = MAX_TLV_VALUE_BYTES): string {
  if (encoder.encode(value).length <= max) return value;
  let out = "";
  for (const char of value) {
    if (encoder.encode(out + char).length > max) break;
    out += char;
  }
  return out;
}

/** Halalas as the plain decimal string ZATCA expects ("1000.00"); integer arithmetic only. */
export function zatcaAmount(halalas: number): string {
  const h = Math.max(0, Math.round(halalas));
  return `${Math.floor(h / 100)}.${String(h % 100).padStart(2, "0")}`;
}

/** The instant with second precision in UTC, e.g. `2022-04-25T15:30:00Z`. */
export function zatcaTimestamp(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "" : `${at.toISOString().slice(0, 19)}Z`;
}

function tlv(tag: number, value: string): Uint8Array {
  const bytes = encoder.encode(clampToBytes(value));
  const field = new Uint8Array(bytes.length + 2);
  field[0] = tag;
  field[1] = bytes.length;
  field.set(bytes, 2);
  return field;
}

export function phase1Tlv(invoice: Phase1Invoice): Uint8Array {
  const fields = [
    tlv(1, invoice.sellerName),
    tlv(2, invoice.vatNumber),
    tlv(3, zatcaTimestamp(invoice.issuedAt)),
    tlv(4, zatcaAmount(invoice.totalWithVat)),
    tlv(5, zatcaAmount(invoice.vatTotal)),
  ];
  const out = new Uint8Array(fields.reduce((n, f) => n + f.length, 0));
  let at = 0;
  for (const field of fields) {
    out.set(field, at);
    at += field.length;
  }
  return out;
}

/** What the QR encodes: the TLV bytes, base64. */
export function phase1QrPayload(invoice: Phase1Invoice): string {
  const bytes = phase1Tlv(invoice);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
