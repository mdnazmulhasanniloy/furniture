import type { LocalizedText } from "@/lib/pick";

// Server-side reads of public endpoints for the layout shell (T-032). Runs on the
// Next server, so it calls the backend origin directly (the /api rewrite is for the
// browser). Tags let the backend's revalidate hook refresh them (`settings`, `home`).
// Any failure degrades to an empty shell instead of breaking every page.

const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:1000";

export type Category = {
  id: string;
  name: LocalizedText;
  slug: string;
  parentId: string | null;
  sortOrder: number;
  isActive: boolean;
  children?: Category[];
};

export type SiteSettings = {
  logo?: { url?: string } | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  address?: LocalizedText | null;
  socials?: {
    facebook?: string | null;
    instagram?: string | null;
    whatsapp?: string | null;
    tiktok?: string | null;
  } | null;
};

async function getJson<T>(path: string, tags: string[]): Promise<T | null> {
  try {
    const res = await fetch(`${API_ORIGIN}/api/v1${path}`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 60, tags },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function getCategories(): Promise<Category[]> {
  const data = await getJson<Category[]>("/categories", ["categories", "home"]);
  return Array.isArray(data) ? data : [];
}

export async function getSettings(): Promise<SiteSettings | null> {
  return getJson<SiteSettings>("/cms/settings", ["settings"]);
}
