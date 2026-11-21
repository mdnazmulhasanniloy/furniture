/**
 * Prisma on MongoDB: a `{ field: null }` WHERE-filter matches only an explicit null, NEVER a document
 * whose field is MISSING (unset). Any "field is empty" filter on an optional field must match both,
 * or rows written by code that omitted the field are silently excluded (this bit T-004 `consumedAt`
 * and T-028 `attachedAt`). Writers should still set optional fields to an explicit null (CLAUDE.md).
 */
export const notSet = <W>(field: keyof W & string): W =>
  ({ OR: [{ [field]: null }, { [field]: { isSet: false } }] }) as W;
