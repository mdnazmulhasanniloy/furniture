import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "@/components/modal";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/api/messages";
import { formatPrice, toLocale } from "@/lib/format";
import { useProducts, type AdminProduct } from "@/lib/products";

// T-085 step 5. Pick the product a point links to. Published only - the website drops a point whose product
// is not published, and the API refuses to save one (422 PRODUCT_NOT_PUBLISHED, backend T-110).

const DEBOUNCE_MS = 250;

export function ProductPicker({
  usedIds,
  onPick,
  onClose,
}: {
  usedIds: readonly string[];
  onPick: (p: AdminProduct) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setQ(text), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [text]);
  const query = useProducts({ q, status: "PUBLISHED", type: "", page: 1 });
  const items = query.data?.items ?? [];
  const anyUsed = items.some((p) => usedIds.includes(p.id));

  return (
    <Modal title={t("sections.looks.editor.choose")} onClose={onClose} testId="product-picker" wide>
      <Input
        autoFocus
        data-testid="product-picker-search"
        aria-label={t("common.search")}
        placeholder={t("common.search")}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="mt-3"
      />
      {anyUsed && (
        <p className="mt-2 text-xs text-muted-foreground">{t("sections.looks.editor.duplicateProduct")}</p>
      )}
      {query.isError && (
        <p role="alert" className="mt-3 text-sm text-destructive" data-testid="product-picker-error">
          {errorMessage(t, locale, query.error)}
        </p>
      )}
      {query.isSuccess && items.length === 0 && (
        <p className="mt-4 text-sm text-muted-foreground" data-testid="product-picker-empty">
          {t("sections.looks.editor.noProducts")}
        </p>
      )}
      <ul className="mt-3 max-h-80 overflow-y-auto" data-testid="product-picker-list">
        {items.map((p) => {
          const used = usedIds.includes(p.id);
          return (
            <li key={p.id}>
              <button
                type="button"
                disabled={used}
                data-testid="product-picker-item"
                data-id={p.id}
                onClick={() => onPick(p)}
                className="flex w-full items-center gap-3 rounded-md border-t border-border p-2 text-start first:border-t-0 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              >
                {p.images[0] ? (
                  <img src={p.images[0].url} alt="" className="size-12 rounded-sm border border-border object-cover" />
                ) : (
                  <span className="size-12 rounded-sm border border-border bg-muted" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.title[locale]}</span>
                  <span className="block text-xs text-muted-foreground">{formatPrice(p.price, locale)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          data-testid="product-picker-cancel"
          className="h-9 rounded-md border border-border px-3 text-sm hover:bg-muted"
        >
          {t("common.cancel")}
        </button>
      </div>
    </Modal>
  );
}
