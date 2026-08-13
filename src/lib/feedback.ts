// src/lib/feedback.ts
//
// Screenshot handling for bug reports (migration 0123). The bucket is private,
// so viewing a screenshot needs a short-lived signed URL.

import { supabase } from "@/lib/supabase";

export const FEEDBACK_BUCKET = "feedback-screenshots";
export const MAX_FILES = 3;
export const MAX_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_MIME = ["image/png", "image/jpeg", "image/webp"];
export const ACCEPT_ATTR = ACCEPTED_MIME.join(",");

/** An actionable message, or null when the selection is fine. */
export function validateScreenshots(files: File[]): string | null {
  if (files.length > MAX_FILES) return `Attach up to ${MAX_FILES} screenshots.`;
  for (const f of files) {
    if (!ACCEPTED_MIME.includes(f.type)) return `${f.name} isn't a PNG, JPG or WebP image.`;
    if (f.size > MAX_BYTES) return `${f.name} is over 5 MB — attach a smaller image.`;
  }
  return null;
}

/** `{auth uid}/{uuid}-{name}` — the first segment is load-bearing: the storage
 *  policy only lets you write into your own folder, so anything else 403s. */
export function screenshotPath(userId: string, filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  return `${userId}/${crypto.randomUUID()}-${safe}`;
}

export async function uploadScreenshot(userId: string, file: File): Promise<string> {
  const path = screenshotPath(userId, file.name);
  const { error } = await supabase.storage
    .from(FEEDBACK_BUCKET)
    .upload(path, file, { contentType: file.type });
  if (error) throw error;
  return path;
}

export async function signScreenshot(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from(FEEDBACK_BUCKET).createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}
