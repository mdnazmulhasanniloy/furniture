import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Minus,
  Quote,
  Strikethrough,
  Underline as UnderlineIcon,
  Unlink,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { isSafePageHref } from "@/lib/pages";
import { cn } from "@/lib/utils";

/**
 * Tiptap editor limited to the ADR-013 allowlist: p, h2-h4, strong, em, u, s, ul/ol/li, a, blockquote, br, hr
 * (img is only preserved when already stored, never inserted). Nodes/marks outside it (code, h1/h5/h6, ...) are
 * disabled so the schema drops them on paste or load. Links: https or same-site path only. The backend
 * sanitiser stays the authority; HTML is only handed to Tiptap's own parser, never dangerouslySetInnerHTML.
 */
export const editorExtensions = [
  StarterKit.configure({
    heading: { levels: [2, 3, 4] },
    code: false,
    codeBlock: false,
  }),
  Underline,
  Link.configure({
    openOnClick: false,
    autolink: false,
    linkOnPaste: false,
    HTMLAttributes: { rel: "noopener noreferrer", target: null },
    isAllowedUri: (url) => isSafePageHref(url),
  }),
  Image.configure({ inline: false, allowBase64: false }),
];

function Toolbar({ editor, id }: { editor: Editor; id: string }) {
  const { t } = useTranslation();
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState("");
  const [linkError, setLinkError] = useState(false);
  const chain = () => editor.chain().focus();
  const btn = (key: string, active: boolean, run: () => void, icon: ReactNode, disabled = false) => (
    <button
      key={key}
      type="button"
      aria-label={t(`pages.editor.${key}`)}
      aria-pressed={active}
      disabled={disabled}
      data-testid={`${id}-${key}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-md text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50",
        active && "bg-primary/15 text-primary",
      )}
    >
      {icon}
    </button>
  );
  const applyLink = () => {
    const v = href.trim();
    if (!isSafePageHref(v)) return setLinkError(true);
    chain().extendMarkRange("link").setLink({ href: v }).run();
    setLinkOpen(false);
    setHref("");
    setLinkError(false);
  };
  const block = editor.isActive("heading", { level: 2 })
    ? "h2"
    : editor.isActive("heading", { level: 3 })
      ? "h3"
      : editor.isActive("heading", { level: 4 })
        ? "h4"
        : "p";
  const ic = "size-4";
  return (
    <div className="border-b border-border p-1">
      <div role="toolbar" aria-label={t("pages.editor.toolbar")} className="flex flex-wrap items-center gap-0.5">
        <select
          aria-label={t("pages.editor.block")}
          data-testid={`${id}-block`}
          value={block}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "p") chain().setParagraph().run();
            else chain().setHeading({ level: Number(v[1]) as 2 | 3 | 4 }).run();
          }}
          className="h-8 rounded-md border border-input bg-background px-1 text-sm"
        >
          <option value="p">{t("pages.editor.paragraph")}</option>
          <option value="h2">{t("pages.editor.h2")}</option>
          <option value="h3">{t("pages.editor.h3")}</option>
          <option value="h4">{t("pages.editor.h4")}</option>
        </select>
        {btn("bold", editor.isActive("bold"), () => chain().toggleBold().run(), <Bold className={ic} aria-hidden />)}
        {btn("italic", editor.isActive("italic"), () => chain().toggleItalic().run(), <Italic className={ic} aria-hidden />)}
        {btn("underline", editor.isActive("underline"), () => chain().toggleUnderline().run(), <UnderlineIcon className={ic} aria-hidden />)}
        {btn("strike", editor.isActive("strike"), () => chain().toggleStrike().run(), <Strikethrough className={ic} aria-hidden />)}
        {btn("bulletList", editor.isActive("bulletList"), () => chain().toggleBulletList().run(), <List className={ic} aria-hidden />)}
        {btn("orderedList", editor.isActive("orderedList"), () => chain().toggleOrderedList().run(), <ListOrdered className={ic} aria-hidden />)}
        {btn("blockquote", editor.isActive("blockquote"), () => chain().toggleBlockquote().run(), <Quote className={ic} aria-hidden />)}
        {btn("rule", false, () => chain().setHorizontalRule().run(), <Minus className={ic} aria-hidden />)}
        {btn("link", editor.isActive("link"), () => setLinkOpen((o) => !o), <LinkIcon className={ic} aria-hidden />)}
        {btn("unlink", false, () => chain().extendMarkRange("link").unsetLink().run(), <Unlink className={ic} aria-hidden />, !editor.isActive("link"))}
      </div>
      {linkOpen && (
        <div className="mt-1 flex flex-wrap items-center gap-2 p-1">
          <input
            aria-label={t("pages.editor.linkUrl")}
            data-testid={`${id}-link-input`}
            dir="ltr"
            value={href}
            placeholder="https://example.com or /about"
            onChange={(e) => {
              setHref(e.target.value);
              setLinkError(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyLink();
              }
            }}
            className="h-8 min-w-48 flex-1 rounded-md border border-input bg-background px-2 text-sm"
          />
          <button
            type="button"
            data-testid={`${id}-link-apply`}
            onClick={applyLink}
            className="h-8 rounded-md bg-primary px-3 text-sm text-primary-foreground"
          >
            {t("pages.editor.linkApply")}
          </button>
          {linkError && (
            <p role="alert" className="w-full text-xs text-destructive" data-testid={`${id}-link-error`}>
              {t("pages.editor.linkInvalid")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function RichTextEditor({
  id,
  label,
  value,
  onChange,
  dir,
  lang,
  invalid,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (html: string) => void;
  dir: "ltr" | "rtl";
  lang: string;
  invalid?: boolean;
}) {
  const editor = useEditor({
    extensions: editorExtensions,
    content: value,
    editorProps: {
      attributes: {
        id,
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": label,
        dir,
        lang,
        class:
          "min-h-48 px-3 py-2 text-sm outline-none [&_h2]:mt-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:text-lg [&_h3]:font-semibold [&_h4]:mt-2 [&_h4]:font-semibold [&_ul]:list-disc [&_ul]:ps-6 [&_ol]:list-decimal [&_ol]:ps-6 [&_blockquote]:border-s-4 [&_blockquote]:border-border [&_blockquote]:ps-3 [&_a]:text-primary [&_a]:underline [&_hr]:my-3 [&_hr]:border-border [&_img]:max-w-full",
      },
    },
    onUpdate: ({ editor: e }) => onChange(e.isEmpty ? "" : e.getHTML()),
  });
  return (
    <div
      className={cn("rounded-md border bg-background", invalid ? "border-destructive" : "border-input")}
      data-testid={`${id}-editor`}
    >
      {editor && <Toolbar editor={editor} id={id} />}
      <EditorContent editor={editor} />
    </div>
  );
}
