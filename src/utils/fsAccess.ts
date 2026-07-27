// OKF Workspace Generic - File System Access utilities
// Thin wrapper around the browser File System Access API (Chromium-based
// browsers) used to read/write .md files directly on disk, atomically.
// Co-Authored-By: Mistral Vibe <vibe@mistral.ai>

// Minimal local typings for the File System Access API: no @types package
// for it is installed, and this project has no tsc type-check build step
// (Vite/esbuild only transpiles), so these just document the shapes used
// here rather than being enforced anywhere.
export type FSPermissionMode = 'read' | 'readwrite';

export interface FSPermissionStatus {
  queryPermission(opts: { mode: FSPermissionMode }): Promise<PermissionState>;
  requestPermission(opts: { mode: FSPermissionMode }): Promise<PermissionState>;
}

export interface FSWritableFileStream {
  write(data: string): Promise<void>;
  close(): Promise<void>;
  abort(reason?: any): Promise<void>;
}

export interface FSFileHandle extends FSPermissionStatus {
  kind: 'file';
  name: string;
  getFile(): Promise<Blob & { text(): Promise<string> }>;
  createWritable(): Promise<FSWritableFileStream>;
}

export interface FSDirectoryHandle extends FSPermissionStatus {
  kind: 'directory';
  name: string;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FSFileHandle>;
  values(): AsyncIterable<FSFileHandle | FSDirectoryHandle>;
}

declare global {
  interface Window {
    showDirectoryPicker?: () => Promise<FSDirectoryHandle>;
  }
}

/**
 * Feature-detects support for the File System Access API.
 */
export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

/**
 * Opens the browser's directory picker and returns the chosen directory handle.
 * Errors (e.g. the user cancels the picker, which throws an AbortError)
 * propagate to the caller.
 */
export async function pickDirectory(): Promise<FSDirectoryHandle> {
  if (!window.showDirectoryPicker) {
    throw new Error('File System Access API is not supported in this browser');
  }
  return window.showDirectoryPicker();
}

/**
 * Ensures the given handle has the requested permission, requesting it
 * from the user if it isn't already granted.
 * @returns true only if the end permission state is 'granted'
 */
export async function verifyPermission(
  handle: FSPermissionStatus,
  mode: FSPermissionMode
): Promise<boolean> {
  const opts = { mode };
  if ((await handle.queryPermission(opts)) === 'granted') {
    return true;
  }
  return (await handle.requestPermission(opts)) === 'granted';
}

/**
 * Gets an existing file handle in the directory, creating the file if
 * it doesn't already exist.
 */
export async function getOrCreateFileHandle(
  dirHandle: FSDirectoryHandle,
  fileName: string
): Promise<FSFileHandle> {
  return dirHandle.getFileHandle(fileName, { create: true });
}

/**
 * Reads the current text content of a file handle from disk.
 */
export async function readFileText(fileHandle: FSFileHandle): Promise<string> {
  const file = await fileHandle.getFile();
  return file.text();
}

/**
 * Writes content to a file atomically: opens a writable stream, writes the
 * full content, then closes it. Closing the stream is what performs the
 * atomic swap-in on disk. If the write itself fails, the writable is
 * aborted (not closed) so no partially-written file is ever swapped in.
 */
export async function writeFileAtomic(
  dirHandle: FSDirectoryHandle,
  fileName: string,
  content: string
): Promise<void> {
  const fileHandle = await getOrCreateFileHandle(dirHandle, fileName);
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(content);
  } catch (err) {
    await writable.abort(err);
    throw err;
  }
  await writable.close();
}

/**
 * Lists the top-level .md files directly inside a directory, along with
 * their file handles.
 */
export async function listMarkdownFiles(
  dirHandle: FSDirectoryHandle
): Promise<Array<{ name: string; handle: FSFileHandle }>> {
  const results: Array<{ name: string; handle: FSFileHandle }> = [];
  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.md')) {
      results.push({ name: entry.name, handle: entry as FSFileHandle });
    }
  }
  return results;
}
