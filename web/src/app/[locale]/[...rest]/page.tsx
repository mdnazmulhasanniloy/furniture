import { notFound } from "next/navigation";

// Any unmatched path under a locale renders the styled 404 inside the site layout (header, footer, fonts).
export default function CatchAll() {
  notFound();
}
