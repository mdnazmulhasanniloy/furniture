import { notFound } from "next/navigation";

// QA B7: this route exports no metadata on purpose. Next drops the metadata of a segment that calls
// notFound(), so the title of every 404 comes from the layout's `title.default`, which is the
// not-found title (see app/[locale]/layout.tsx). Measured: a hard-coded title here never reaches the
// head.

// Any unmatched path under a locale renders the styled 404 inside the site layout (header, footer, fonts).
export default function CatchAll() {
  notFound();
}
