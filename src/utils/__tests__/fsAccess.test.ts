import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isFileSystemAccessSupported,
  pickDirectory,
  verifyPermission,
  getOrCreateFileHandle,
  readFileText,
  writeFileAtomic,
  listMarkdownFiles,
} from '../fsAccess';

// ---------------------------------------------------------------------------
// Lightweight fakes for the File System Access API (not implemented by jsdom)
// ---------------------------------------------------------------------------

function makeFileHandle(name, { content = '', queryState = 'granted', requestState = 'granted' } = {}) {
  return {
    kind: 'file',
    name,
    _content: content,
    queryPermission: vi.fn().mockResolvedValue(queryState),
    requestPermission: vi.fn().mockResolvedValue(requestState),
    getFile: vi.fn(async () => ({
      text: async () => content,
    })),
    createWritable: vi.fn(),
  };
}

function makeDirHandle(name, entries = [], { queryState = 'granted', requestState = 'granted' } = {}) {
  return {
    kind: 'directory',
    name,
    _entries: entries,
    queryPermission: vi.fn().mockResolvedValue(queryState),
    requestPermission: vi.fn().mockResolvedValue(requestState),
    getFileHandle: vi.fn(async (fileName, opts) => {
      const existing = entries.find(e => e.kind === 'file' && e.name === fileName);
      if (existing) return existing;
      if (opts?.create) {
        const created = makeFileHandle(fileName);
        entries.push(created);
        return created;
      }
      throw new Error(`File not found: ${fileName}`);
    }),
    values: async function* () {
      for (const entry of entries) yield entry;
    },
  };
}

describe('isFileSystemAccessSupported', () => {
  const originalPicker = window.showDirectoryPicker;

  afterEach(() => {
    if (originalPicker === undefined) {
      delete window.showDirectoryPicker;
    } else {
      window.showDirectoryPicker = originalPicker;
    }
  });

  it('returns true when window.showDirectoryPicker exists', () => {
    window.showDirectoryPicker = vi.fn();
    expect(isFileSystemAccessSupported()).toBe(true);
  });

  it('returns false when window.showDirectoryPicker is absent', () => {
    delete window.showDirectoryPicker;
    expect(isFileSystemAccessSupported()).toBe(false);
  });
});

describe('pickDirectory', () => {
  const originalPicker = window.showDirectoryPicker;

  afterEach(() => {
    if (originalPicker === undefined) {
      delete window.showDirectoryPicker;
    } else {
      window.showDirectoryPicker = originalPicker;
    }
  });

  it('delegates to window.showDirectoryPicker and returns its result', async () => {
    const fakeDir = makeDirHandle('root');
    window.showDirectoryPicker = vi.fn().mockResolvedValue(fakeDir);
    const result = await pickDirectory();
    expect(result).toBe(fakeDir);
  });

  it('propagates errors (e.g. the user cancelling the picker)', async () => {
    const abortErr = new DOMException('The user aborted a request.', 'AbortError');
    window.showDirectoryPicker = vi.fn().mockRejectedValue(abortErr);
    await expect(pickDirectory()).rejects.toBe(abortErr);
  });

  it('throws a clear error when unsupported', async () => {
    delete window.showDirectoryPicker;
    await expect(pickDirectory()).rejects.toThrow(/not supported/i);
  });
});

describe('verifyPermission', () => {
  it('returns true immediately when permission is already granted', async () => {
    const handle = makeFileHandle('index.md', { queryState: 'granted' });
    const result = await verifyPermission(handle, 'readwrite');
    expect(result).toBe(true);
    expect(handle.requestPermission).not.toHaveBeenCalled();
  });

  it('requests permission when not already granted, and returns true if granted', async () => {
    const handle = makeFileHandle('index.md', { queryState: 'prompt', requestState: 'granted' });
    const result = await verifyPermission(handle, 'readwrite');
    expect(result).toBe(true);
    expect(handle.requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' });
  });

  it('returns false when the user denies the permission request', async () => {
    const handle = makeFileHandle('index.md', { queryState: 'prompt', requestState: 'denied' });
    const result = await verifyPermission(handle, 'readwrite');
    expect(result).toBe(false);
  });
});

describe('getOrCreateFileHandle', () => {
  it('returns an existing file handle by name', async () => {
    const existing = makeFileHandle('log.md');
    const dir = makeDirHandle('root', [existing]);
    const result = await getOrCreateFileHandle(dir, 'log.md');
    expect(result).toBe(existing);
  });

  it('creates the file when it does not exist', async () => {
    const dir = makeDirHandle('root', []);
    const result = await getOrCreateFileHandle(dir, 'new.md');
    expect(result.name).toBe('new.md');
    expect(dir.getFileHandle).toHaveBeenCalledWith('new.md', { create: true });
  });
});

describe('readFileText', () => {
  it('reads the current text content of a file handle', async () => {
    const handle = makeFileHandle('index.md', { content: '# hello' });
    const text = await readFileText(handle);
    expect(text).toBe('# hello');
  });
});

describe('writeFileAtomic', () => {
  it('writes then closes the stream in order on success', async () => {
    const calls = [];
    const writable = {
      write: vi.fn(async (data) => { calls.push(['write', data]); }),
      close: vi.fn(async () => { calls.push(['close']); }),
      abort: vi.fn(async () => { calls.push(['abort']); }),
    };
    const fileHandle = makeFileHandle('fiche.md');
    fileHandle.createWritable.mockResolvedValue(writable);
    const dir = makeDirHandle('root', [fileHandle]);

    await writeFileAtomic(dir, 'fiche.md', 'new content');

    expect(calls).toEqual([['write', 'new content'], ['close']]);
    expect(writable.abort).not.toHaveBeenCalled();
  });

  it('aborts (not closes) the writable and rethrows when the write fails', async () => {
    const writeErr = new Error('disk full');
    const writable = {
      write: vi.fn().mockRejectedValue(writeErr),
      close: vi.fn(),
      abort: vi.fn().mockResolvedValue(undefined),
    };
    const fileHandle = makeFileHandle('fiche.md');
    fileHandle.createWritable.mockResolvedValue(writable);
    const dir = makeDirHandle('root', [fileHandle]);

    await expect(writeFileAtomic(dir, 'fiche.md', 'new content')).rejects.toBe(writeErr);
    expect(writable.abort).toHaveBeenCalledWith(writeErr);
    expect(writable.close).not.toHaveBeenCalled();
  });

  it('creates the file first if it does not already exist', async () => {
    const writable = {
      write: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn(),
    };
    const dir = makeDirHandle('root', []);
    // Patch getFileHandle to attach createWritable to newly-created handles
    const originalGetFileHandle = dir.getFileHandle;
    dir.getFileHandle = vi.fn(async (name, opts) => {
      const handle = await originalGetFileHandle(name, opts);
      handle.createWritable = vi.fn().mockResolvedValue(writable);
      return handle;
    });

    await writeFileAtomic(dir, 'brand-new.md', 'hello');
    expect(dir.getFileHandle).toHaveBeenCalledWith('brand-new.md', { create: true });
    expect(writable.write).toHaveBeenCalledWith('hello');
  });
});

describe('listMarkdownFiles', () => {
  it('returns only top-level .md file entries with their handles', async () => {
    const mdFile = makeFileHandle('index.md');
    const otherFile = makeFileHandle('bundle.json');
    const subDir = makeDirHandle('fiches');
    const dir = makeDirHandle('root', [mdFile, otherFile, subDir]);

    const result = await listMarkdownFiles(dir);

    expect(result).toEqual([{ name: 'index.md', handle: mdFile }]);
  });

  it('returns an empty array when there are no markdown files', async () => {
    const dir = makeDirHandle('root', [makeFileHandle('bundle.json')]);
    const result = await listMarkdownFiles(dir);
    expect(result).toEqual([]);
  });

  it('is case-insensitive on the .md extension', async () => {
    const mdFile = makeFileHandle('README.MD');
    const dir = makeDirHandle('root', [mdFile]);
    const result = await listMarkdownFiles(dir);
    expect(result).toEqual([{ name: 'README.MD', handle: mdFile }]);
  });
});
