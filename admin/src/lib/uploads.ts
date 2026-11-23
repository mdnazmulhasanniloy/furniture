import { api } from "@/lib/api/client";

// Direct-to-R2 uploads (ADR-010, api-spec POST /admin/uploads/presign): validate -> presign ->
// PUT the bytes to `uploadUrl` with the same Content-Type. The presigned URL is a credential: it is
// never logged, stored, or shown, and the PUT carries no Authorization header or cookies.

export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_IMAGE_BYTES = 5_242_880; // 5 MB, ADR-010

export type UploadRejection = "type" | "size" | "empty";

/** Client-side pre-check; the API repeats it (422 UPLOAD_NOT_ALLOWED). */
export function validateImageFile(file: { type: string; size: number }): UploadRejection | null {
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) return "type";
  if (file.size < 1) return "empty";
  if (file.size > MAX_IMAGE_BYTES) return "size";
  return null;
}

export type Presign = { uploadUrl: string; key: string; publicUrl: string; expiresIn: number };

export function presignUpload(file: { name: string; type: string; size: number }, signal?: AbortSignal) {
  return api.post<Presign>(
    "/admin/uploads/presign",
    { fileName: file.name.slice(0, 255), contentType: file.type, size: file.size },
    { signal },
  );
}

/** PUT with progress (fetch has no upload progress). Rejects with Error("UPLOAD_FAILED"). */
export function putToR2(uploadUrl: string, file: File, onProgress: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(Math.min(1, e.loaded / e.total));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("UPLOAD_FAILED")));
    xhr.onerror = () => reject(new Error("UPLOAD_FAILED"));
    xhr.onabort = () => reject(new Error("UPLOAD_FAILED"));
    xhr.send(file);
  });
}

/** Best-effort pixel size of the picked file (null when the browser cannot decode it). */
export async function readImageSize(file: Blob): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap !== "function") return null;
  try {
    const bmp = await createImageBitmap(file);
    const size = { width: bmp.width, height: bmp.height };
    bmp.close();
    return size;
  } catch {
    return null;
  }
}
