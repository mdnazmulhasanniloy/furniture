# ADR-004: shadcn/ui as base, Magic UI for showcase, daisyUI not default

Status: Accepted · Source: SRC-001.7

shadcn/ui and daisyUI both define a theme layer over Tailwind; mixing them causes conflicting tokens and inconsistent components. shadcn/ui (Radix) gives accessible primitives with RTL support and is copy-in source code. Magic UI is built on the same Tailwind/shadcn conventions and is used only for showcase effects on the website. daisyUI may be added later only if a specific need appears and its theme is mapped to the same tokens.
