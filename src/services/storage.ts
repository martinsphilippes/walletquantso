// Cloud Storage helpers for uploading source images / exported files.

import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
  listAll,
} from "firebase/storage";
import { storage } from "./firebase";

/** Upload a file to `path` and return its public download URL. */
export async function uploadFile(path: string, file: Blob | File): Promise<string> {
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file);
  return getDownloadURL(storageRef);
}

/** Get the download URL for an existing object. */
export function getFileUrl(path: string): Promise<string> {
  return getDownloadURL(ref(storage, path));
}

/** Delete an object by path. */
export function deleteFile(path: string): Promise<void> {
  return deleteObject(ref(storage, path));
}

/** List the full paths of every object under `prefix`. */
export async function listFiles(prefix: string): Promise<string[]> {
  const result = await listAll(ref(storage, prefix));
  return result.items.map((item) => item.fullPath);
}
