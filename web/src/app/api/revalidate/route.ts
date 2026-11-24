import { handleRevalidate, methodNotAllowed } from "@/lib/revalidate-route";

export const dynamic = "force-dynamic";

export const POST = (req: Request) => handleRevalidate(req);
export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const HEAD = methodNotAllowed;
export const OPTIONS = methodNotAllowed;
