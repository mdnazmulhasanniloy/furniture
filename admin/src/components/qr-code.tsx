import qrcode from "qrcode-generator";

/**
 * A QR code as inline SVG (A6). The payload never leaves the browser: `qrcode-generator` (zero
 * dependencies, pinned) only computes the module matrix, and the squares below are our own markup, so
 * the code scales and prints with the invoice sheet and needs no innerHTML.
 *
 * Type 0 picks the smallest version that fits; error-correction level M is the usual default and leaves
 * room for the print to be a little dirty. Byte mode is exact for the base64 payload (ASCII only).
 */
export function QrCode({
  value,
  size = 128,
  label,
  testId,
}: {
  value: string;
  /** Rendered edge length in px; the SVG itself is a viewBox, so print CSS may scale it. */
  size?: number;
  label: string;
  testId?: string;
}) {
  const qr = qrcode(0, "M");
  qr.addData(value, "Byte");
  qr.make();
  const count = qr.getModuleCount();
  const quiet = 4; // the QR standard's quiet zone, in modules
  const span = count + quiet * 2;

  const rows: string[] = [];
  for (let row = 0; row < count; row++) {
    let path = "";
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) path += `M${col + quiet} ${row + quiet}h1v1h-1z`;
    }
    if (path) rows.push(path);
  }

  return (
    <svg
      role="img"
      aria-label={label}
      data-testid={testId}
      data-modules={count}
      width={size}
      height={size}
      viewBox={`0 0 ${span} ${span}`}
      shapeRendering="crispEdges"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width={span} height={span} fill="#ffffff" />
      <path d={rows.join("")} fill="#000000" />
    </svg>
  );
}
