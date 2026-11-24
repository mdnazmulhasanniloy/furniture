import { ImageOff, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/api/messages";
import { formatNumber, formatPrice, toLocale } from "@/lib/format";
import {
  LOW_STOCK,
  pickText,
  useDeleteProduct,
  useProducts,
  type AdminProduct,
  type ProductQuery,
} from "@/lib/products";
import { cn } from "@/lib/utils";

const selectCls = "h-10 rounded-md border border-input bg-card px-3 text-sm text-card-foreground";
// Status colours: DRAFT muted, PUBLISHED success, ARCHIVED warning (tokens only).
const STATUS_CLS: Record<string, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  PUBLISHED: "bg-success/15 text-success-foreground",
  ARCHIVED: "bg-warning/15 text-warning-foreground",
};

function DeleteDialog({ product, onClose }: { product: AdminProduct; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const del = useDeleteProduct();
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={t("products.deleteTitle")} onClose={onClose} testId="product-delete-dialog">
      <p className="mt-3 text-sm">{t("products.deleteBody", { name: pickText(product.title, locale) })}</p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive" data-testid="product-delete-error">
          {error}
        </p>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button
          variant="destructive"
          disabled={del.isPending}
          data-testid="product-delete-confirm"
          onClick={async () => {
            setError(null);
            try {
              await del.mutateAsync(product.id);
              onClose();
            } catch (e) {
              setError(errorMessage(t, locale, e));
            }
          }}
        >
          {t("common.delete")}
        </Button>
      </div>
    </Modal>
  );
}

export function ProductsPage() {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState<ProductQuery>({ q: "", status: "", type: "", page: 1 });
  const [deleting, setDeleting] = useState<AdminProduct | null>(null);
  const list = useProducts(query);
  const items = list.data?.items ?? [];
  const meta = list.data?.meta;
  const set = (p: Partial<ProductQuery>) => setQuery((q) => ({ ...q, page: 1, ...p }));

  return (
    <section aria-labelledby="prod-title">
      <div className="flex items-center justify-between gap-3">
        <h1 id="prod-title" className="font-display text-2xl font-semibold">
          {t("products.title")}
        </h1>
        <Link
          to="/products/new"
          data-testid="product-new"
          className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <Plus className="size-4" aria-hidden />
          {t("products.new")}
        </Link>
      </div>
      <form
        role="search"
        className="mt-4 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          set({ q: draft });
        }}
      >
        <div className="min-w-48 flex-1">
          <label htmlFor="prod-search" className="mb-1 block text-sm font-medium">
            {t("products.search")}
          </label>
          <Input
            id="prod-search"
            type="search"
            maxLength={100}
            placeholder={t("products.searchPlaceholder")}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="prod-f-status" className="mb-1 block text-sm font-medium">
            {t("products.filterStatus")}
          </label>
          <select id="prod-f-status" className={selectCls} value={query.status} onChange={(e) => set({ status: e.target.value as ProductQuery["status"] })}>
            <option value="">{t("products.all")}</option>
            {(["DRAFT", "PUBLISHED", "ARCHIVED"] as const).map((s) => (
              <option key={s} value={s}>
                {t(`products.status.${s}`)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="prod-f-type" className="mb-1 block text-sm font-medium">
            {t("products.filterType")}
          </label>
          <select id="prod-f-type" className={selectCls} value={query.type} onChange={(e) => set({ type: e.target.value as ProductQuery["type"] })}>
            <option value="">{t("products.all")}</option>
            {(["NEW", "RESALE"] as const).map((s) => (
              <option key={s} value={s}>
                {t(`products.type.${s}`)}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="outline">
          {t("products.searchButton")}
        </Button>
      </form>
      {list.isPending && (
        <p role="status" className="mt-4 text-muted-foreground">
          {t("products.loading")}
        </p>
      )}
      {list.isError && (
        <div className="mt-4 flex items-center gap-3" data-testid="products-error">
          <p role="alert" className="text-destructive">
            {errorMessage(t, locale, list.error)}
          </p>
          <Button variant="outline" size="sm" onClick={() => void list.refetch()}>
            {t("products.retry")}
          </Button>
        </div>
      )}
      {list.isSuccess && items.length === 0 && (
        <p className="mt-4 text-muted-foreground" data-testid="products-empty">
          {t("products.empty")}
        </p>
      )}
      {items.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm" data-testid="products-table">
            <thead className="text-xs text-muted-foreground">
              <tr>
                {(["thumb", "name", "type", "price", "stock", "status", "actions"] as const).map((k) => (
                  <th key={k} scope="col" className="px-3 py-2 text-start font-medium">
                    {t(`products.col.${k}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((p) => {
                const name = pickText(p.title, locale);
                const first = p.images[0];
                return (
                  <tr key={p.id} className="border-t border-border" data-testid="product-row">
                    <td className="px-3 py-2">
                      {first ? (
                        <img src={first.url} alt="" className="size-12 rounded-md border border-border object-cover" />
                      ) : (
                        <span
                          className="flex size-12 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground"
                          role="img"
                          aria-label={t("products.noImage")}
                          data-testid="product-placeholder"
                        >
                          <ImageOff className="size-5" aria-hidden />
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-start font-medium">
                      {name}
                      <span className="block text-xs font-normal text-muted-foreground">
                        <bdi dir="ltr">{p.slug}</bdi>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-start">{t(`products.type.${p.type}`)}</td>
                    <td className="px-3 py-2 text-start">
                      <span data-testid="product-price">{formatPrice(p.price, locale)}</span>
                      {p.compareAtPrice != null && (
                        <span className="block text-xs text-muted-foreground line-through">
                          {formatPrice(p.compareAtPrice, locale)}
                        </span>
                      )}
                    </td>
                    <td
                      className={cn("px-3 py-2 text-start", p.stock <= LOW_STOCK && "font-semibold text-destructive")}
                      data-testid="product-stock"
                      data-low={p.stock <= LOW_STOCK}
                    >
                      {formatNumber(p.stock, locale)}
                    </td>
                    <td className="px-3 py-2 text-start">
                      <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_CLS[p.status])}>
                        {t(`products.status.${p.status}`)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-start">
                      <div className="flex gap-1">
                        <Link
                          to={`/products/${encodeURIComponent(p.id)}`}
                          aria-label={t("products.editNamed", { name })}
                          className="inline-flex size-10 items-center justify-center rounded-md hover:bg-muted"
                        >
                          <Pencil className="size-4" aria-hidden />
                        </Link>
                        <Button variant="ghost" size="icon" aria-label={t("products.deleteNamed", { name })} onClick={() => setDeleting(p)}>
                          <Trash2 className="size-4" aria-hidden />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {meta && meta.totalPages > 0 && (
        <nav className="mt-3 flex items-center justify-between text-sm" aria-label={t("products.title")}>
          <span>{t("products.total", { n: formatNumber(meta.total, locale) })}</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={query.page <= 1} onClick={() => setQuery((q) => ({ ...q, page: q.page - 1 }))}>
              {t("products.prev")}
            </Button>
            <span data-testid="products-page">
              {t("products.pageOf", { page: formatNumber(meta.page, locale), total: formatNumber(meta.totalPages, locale) })}
            </span>
            <Button variant="outline" size="sm" disabled={query.page >= meta.totalPages} onClick={() => setQuery((q) => ({ ...q, page: q.page + 1 }))}>
              {t("products.next")}
            </Button>
          </div>
        </nav>
      )}
      {deleting && <DeleteDialog product={deleting} onClose={() => setDeleting(null)} />}
    </section>
  );
}
