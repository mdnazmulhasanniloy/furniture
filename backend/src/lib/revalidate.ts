/**
 * Web-cache revalidation hook (owner 2026-11-22). T-010 calls it after each committed product write with
 * tags like `products` and `product:{slug}` (old and new slug on a rename). It is a no-op until T-011
 * wires it to the web revalidation webhook; it must never throw or fail the request.
 */
export async function revalidateTags(_tags: string[]): Promise<void> {
  // T-011 implements the webhook call.
}
