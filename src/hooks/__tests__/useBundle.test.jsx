import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBundle, generateId, getPDFRefByName, getOKFById } from '../useBundle';
import * as fsAccess from '../../utils/fsAccess';

// Mock pdfIndexer for all tests to avoid actual Qdrant API calls
vi.mock('../../utils/pdfIndexer', () => ({
  indexPDFInQdrant: vi.fn().mockResolvedValue(undefined),
  removePDFFromQdrant: vi.fn().mockResolvedValue(undefined),
  pdfExistsInQdrant: vi.fn().mockResolvedValue(false),
  extractTextFromPDF: vi.fn().mockResolvedValue('extracted text'),
  splitTextIntoChunks: vi.fn().mockReturnValue(['chunk1', 'chunk2']),
}));

// Mock fsAccess for all disk-related tests; individual tests configure
// the specific behavior of each function they need.
vi.mock('../../utils/fsAccess', () => ({
  isFileSystemAccessSupported: vi.fn(),
  pickDirectory: vi.fn(),
  verifyPermission: vi.fn(),
  getOrCreateFileHandle: vi.fn(),
  readFileText: vi.fn(),
  writeFileAtomic: vi.fn(),
  listMarkdownFiles: vi.fn(),
}));

describe('generateId', () => {
  it('produces unique ids with the given prefix', () => {
    const a = generateId('pdf');
    const b = generateId('pdf');
    expect(a).not.toBe(b);
    expect(a.startsWith('pdf-')).toBe(true);
  });
});

describe('getPDFRefByName / getOKFById', () => {
  const bundleConfig = { pdfs: [{ id: 'pdf-1', name: 'a.pdf' }, { id: 'pdf-2', name: 'b.pdf' }] };
  const okfFiles = [{ id: 'OKF-1', title: 'One' }, { id: 'OKF-2', title: 'Two' }];

  it('finds a PDF reference by name', () => {
    expect(getPDFRefByName(bundleConfig, 'b.pdf')).toEqual({ id: 'pdf-2', name: 'b.pdf' });
  });

  it('returns null when the PDF name or bundleConfig is missing', () => {
    expect(getPDFRefByName(bundleConfig, 'missing.pdf')).toBeNull();
    expect(getPDFRefByName(null, 'a.pdf')).toBeNull();
  });

  it('finds an OKF file by id', () => {
    expect(getOKFById(okfFiles, 'OKF-2')).toEqual({ id: 'OKF-2', title: 'Two' });
  });

  it('returns null when the OKF id is not found', () => {
    expect(getOKFById(okfFiles, 'missing')).toBeNull();
  });
});

describe('useBundle', () => {
  it('starts with no active bundle/OKF/PDF', () => {
    const { result } = renderHook(() => useBundle());
    expect(result.current.bundleConfig).toBeNull();
    expect(result.current.activeOKF).toBeNull();
    expect(result.current.activePDF).toBeNull();
    expect(result.current.meta).toEqual({});
  });

  it('initWithSampleData populates bundleConfig and okfFiles, activating the first OKF', () => {
    const { result } = renderHook(() => useBundle());
    act(() => {
      result.current.initWithSampleData();
    });
    expect(result.current.bundleConfig).not.toBeNull();
    expect(result.current.okfFiles.length).toBeGreaterThan(0);
    expect(result.current.activeOKFId).toBe(result.current.okfFiles[0].id);
    expect(result.current.activeOKF).toEqual(result.current.okfFiles[0]);
  });

  it('derives parsed metadata from the active OKF content', () => {
    const { result } = renderHook(() => useBundle());
    act(() => {
      result.current.initWithSampleData();
    });
    expect(result.current.meta.title).toBe(result.current.activeOKF.title);
  });

  it('createBundle resets OKF/PDF state and closes the initializer', () => {
    const { result } = renderHook(() => useBundle());
    act(() => {
      result.current.setShowInitializer(true);
      result.current.initWithSampleData();
    });
    act(() => {
      result.current.createBundle({ id: 'b2', name: 'Fresh', pdfs: [] });
    });
    expect(result.current.bundleConfig).toEqual({ id: 'b2', name: 'Fresh', pdfs: [] });
    expect(result.current.okfFiles).toEqual([]);
    expect(result.current.activeOKFId).toBeNull();
    expect(result.current.showInitializer).toBe(false);
  });

  it('addPDF registers the file, adds a PDF reference to the bundle, and makes it active', async () => {
    const { result } = renderHook(() => useBundle());
    act(() => {
      result.current.createBundle({ id: 'b1', name: 'Bundle', pdfs: [] });
    });
    const file = new File(['%PDF-1.4'], 'doc.pdf', { type: 'application/pdf' });
    let pdfId;
    await act(async () => {
      pdfId = await result.current.addPDF(file, { start: 1, end: 20, raw: '1-20' });
    });
    expect(result.current.pdfFiles[pdfId].file).toBe(file);
    expect(result.current.bundleConfig.pdfs).toHaveLength(1);
    expect(result.current.bundleConfig.pdfs[0]).toMatchObject({ id: pdfId, name: 'doc.pdf' });
    expect(result.current.activePDFId).toBe(pdfId);
    expect(result.current.activePDF).toBe(file);
    expect(result.current.currentPage).toBe(1);
  });

  it('removePDF drops the file and, when it was active, falls back to the first remaining PDF', async () => {
    const { result } = renderHook(() => useBundle());
    act(() => {
      result.current.createBundle({ id: 'b1', name: 'Bundle', pdfs: [] });
    });
    const fileA = new File(['a'], 'a.pdf', { type: 'application/pdf' });
    const fileB = new File(['b'], 'b.pdf', { type: 'application/pdf' });
    let idA, idB;
    await act(async () => {
      idA = await result.current.addPDF(fileA);
    });
    await act(async () => {
      idB = await result.current.addPDF(fileB);
    });
    // idB is active (most recently added)
    expect(result.current.activePDFId).toBe(idB);

    await act(async () => {
      await result.current.removePDF(idB);
    });

    expect(result.current.pdfFiles[idB]).toBeUndefined();
    expect(result.current.bundleConfig.pdfs.map(p => p.id)).toEqual([idA]);
    expect(result.current.activePDFId).toBe(idA);
  });

  it('removePDF leaves activePDFId untouched when removing a non-active PDF', async () => {
    const { result } = renderHook(() => useBundle());
    act(() => {
      result.current.createBundle({ id: 'b1', name: 'Bundle', pdfs: [] });
    });
    const fileA = new File(['a'], 'a.pdf', { type: 'application/pdf' });
    const fileB = new File(['b'], 'b.pdf', { type: 'application/pdf' });
    let idA, idB;
    await act(async () => {
      idA = await result.current.addPDF(fileA);
    });
    await act(async () => {
      idB = await result.current.addPDF(fileB);
    });
    await act(async () => {
      await result.current.removePDF(idA);
    });
    expect(result.current.activePDFId).toBe(idB);
  });

  it('saveOKFFile adds a new file and updates an existing one by id', () => {
    const { result } = renderHook(() => useBundle());
    act(() => {
      result.current.saveOKFFile({ id: 'OKF-1', title: 'First', content: '---\ntitle: First\n---\n' });
    });
    expect(result.current.okfFiles).toHaveLength(1);
    expect(result.current.activeOKFId).toBe('OKF-1');

    act(() => {
      result.current.saveOKFFile({ id: 'OKF-1', title: 'Updated', content: '---\ntitle: Updated\n---\n' });
    });
    expect(result.current.okfFiles).toHaveLength(1);
    expect(result.current.okfFiles[0].title).toBe('Updated');
  });

  it('removeOKFFile removes the file and clears activeOKFId if it was active', () => {
    const { result } = renderHook(() => useBundle());
    act(() => {
      result.current.saveOKFFile({ id: 'OKF-1', title: 'First', content: '' });
    });
    act(() => {
      result.current.removeOKFFile('OKF-1');
    });
    expect(result.current.okfFiles).toEqual([]);
    expect(result.current.activeOKFId).toBeNull();
  });

  it('applyEdits updates the active OKF content, index, and log', () => {
    const { result } = renderHook(() => useBundle());
    act(() => {
      result.current.saveOKFFile({ id: 'OKF-1', title: 'First', content: 'old content' });
    });
    act(() => {
      result.current.applyEdits({ fiche: 'new content', index: 'new index', log: 'new log' });
    });
    expect(result.current.activeOKF.content).toBe('new content');
    expect(result.current.indexContent).toBe('new index');
    expect(result.current.logContent).toBe('new log');
  });

  it('loadBundle rejects on invalid JSON and does not mutate state', async () => {
    const { result } = renderHook(() => useBundle());
    const file = new File(['not json'], 'bundle.json', { type: 'application/json' });
    await expect(
      act(async () => {
        await result.current.loadBundle(file);
      })
    ).rejects.toThrow();
    expect(result.current.bundleConfig).toBeNull();
  });

  it('loadBundle applies bundle/files from a valid bundle.json', async () => {
    const { result } = renderHook(() => useBundle());
    const bundle = { id: 'b1', name: 'Loaded', pdfs: [] };
    const files = [{ id: 'OKF-9', title: 'Loaded OKF', content: '---\ntitle: Loaded OKF\n---\n' }];
    const file = new File([JSON.stringify({ version: '1.0', bundle, files })], 'bundle.json', {
      type: 'application/json',
    });
    await act(async () => {
      await result.current.loadBundle(file);
    });
    expect(result.current.bundleConfig).toEqual(bundle);
    expect(result.current.okfFiles).toEqual(files);
    expect(result.current.activeOKFId).toBe('OKF-9');
  });

  it('loadBundle clears stale pdfFiles/activePDFId left over from a previously loaded bundle', async () => {
    const { result } = renderHook(() => useBundle());

    // Simulate a previous bundle with an actively loaded PDF blob
    act(() => {
      result.current.createBundle({ id: 'old', name: 'Old Bundle', pdfs: [] });
    });
    const oldFile = new File(['a'], 'old.pdf', { type: 'application/pdf' });
    await act(async () => {
      await result.current.addPDF(oldFile);
    });
    expect(Object.keys(result.current.pdfFiles)).toHaveLength(1);
    expect(result.current.activePDFId).not.toBeNull();

    // A bundle.json only carries PDF *references*, never the actual blobs
    const newBundle = { id: 'new', name: 'New Bundle', pdfs: [{ id: 'pdf-x', name: 'x.pdf', path: 'x.pdf', pages: { start: 1, end: 1, raw: '1-1' } }] };
    const file = new File([JSON.stringify({ version: '1.0', bundle: newBundle, files: [] })], 'bundle.json', {
      type: 'application/json',
    });
    await act(async () => {
      await result.current.loadBundle(file);
    });

    expect(result.current.bundleConfig).toEqual(newBundle);
    expect(result.current.pdfFiles).toEqual({});
    expect(result.current.activePDFId).toBeNull();
  });
});

describe('openBundleFromDisk', () => {
  function makeFakeDir({ hasBundleJson = false } = {}) {
    const indexHandle = { kind: 'file', name: 'index.md' };
    const logHandle = { kind: 'file', name: 'log.md' };
    const okfHandle = { kind: 'file', name: 'OKF-1.md' };

    const dirHandle = {
      kind: 'directory',
      name: 'my-folder',
      getFileHandle: vi.fn(async (name, opts) => {
        if (name === 'bundle.json' && hasBundleJson) {
          return { kind: 'file', name: 'bundle.json' };
        }
        throw new Error(`File not found: ${name}`);
      }),
    };

    return { dirHandle, indexHandle, logHandle, okfHandle };
  }

  it('reads index.md, log.md, and OKF fiches from disk and synthesizes a bundle config when there is no bundle.json', async () => {
    const { dirHandle, indexHandle, logHandle, okfHandle } = makeFakeDir();

    fsAccess.pickDirectory.mockResolvedValue(dirHandle);
    fsAccess.verifyPermission.mockResolvedValue(true);
    fsAccess.listMarkdownFiles.mockResolvedValue([
      { name: 'index.md', handle: indexHandle },
      { name: 'log.md', handle: logHandle },
      { name: 'OKF-1.md', handle: okfHandle },
    ]);
    fsAccess.readFileText.mockImplementation(async (handle) => {
      if (handle === indexHandle) return '# index content';
      if (handle === logHandle) return '# log content';
      if (handle === okfHandle) return '---\nid: OKF-1\ntitle: My Fiche\n---\n\nBody';
      throw new Error('unexpected handle');
    });

    const { result } = renderHook(() => useBundle());

    await act(async () => {
      await result.current.openBundleFromDisk();
    });

    expect(result.current.diskConnected).toBe(true);
    expect(result.current.diskDirHandle).toBe(dirHandle);
    expect(result.current.fileHandles).toEqual({
      'index.md': indexHandle,
      'log.md': logHandle,
      'OKF-1.md': okfHandle,
    });
    expect(result.current.indexContent).toBe('# index content');
    expect(result.current.logContent).toBe('# log content');
    expect(result.current.okfFiles).toHaveLength(1);
    expect(result.current.okfFiles[0]).toMatchObject({
      id: 'OKF-1',
      title: 'My Fiche',
      content: '---\nid: OKF-1\ntitle: My Fiche\n---\n\nBody',
    });
    expect(result.current.activeOKFId).toBe('OKF-1');
    expect(result.current.bundleConfig).toMatchObject({ name: 'my-folder', pdfs: [] });
  });

  it('derives the OKF id from the filename when the front-matter has none', async () => {
    const { dirHandle, okfHandle } = makeFakeDir();
    fsAccess.pickDirectory.mockResolvedValue(dirHandle);
    fsAccess.verifyPermission.mockResolvedValue(true);
    fsAccess.listMarkdownFiles.mockResolvedValue([{ name: 'OKF-1.md', handle: okfHandle }]);
    fsAccess.readFileText.mockResolvedValue('no front matter here');

    const { result } = renderHook(() => useBundle());
    await act(async () => {
      await result.current.openBundleFromDisk();
    });

    expect(result.current.okfFiles[0].id).toBe('OKF-1');
  });

  it('uses bundle.json for the bundle config when present', async () => {
    const { dirHandle } = makeFakeDir({ hasBundleJson: true });
    const bundleFromDisk = { id: 'b-disk', name: 'Disk Bundle', pdfs: [] };
    fsAccess.pickDirectory.mockResolvedValue(dirHandle);
    fsAccess.verifyPermission.mockResolvedValue(true);
    fsAccess.listMarkdownFiles.mockResolvedValue([]);
    fsAccess.readFileText.mockResolvedValue(
      JSON.stringify({ version: '1.0', bundle: bundleFromDisk, files: [] })
    );

    const { result } = renderHook(() => useBundle());
    await act(async () => {
      await result.current.openBundleFromDisk();
    });

    expect(result.current.bundleConfig).toEqual(bundleFromDisk);
  });

  it('leaves diskConnected false and rethrows when read-write permission is not granted', async () => {
    const { dirHandle } = makeFakeDir();
    fsAccess.pickDirectory.mockResolvedValue(dirHandle);
    fsAccess.verifyPermission.mockResolvedValue(false);

    const { result } = renderHook(() => useBundle());
    const previousBundleConfig = result.current.bundleConfig;

    await expect(
      act(async () => {
        await result.current.openBundleFromDisk();
      })
    ).rejects.toThrow();

    expect(result.current.diskConnected).toBe(false);
    expect(result.current.bundleConfig).toBe(previousBundleConfig);
  });

  it('reverts diskConnected to false and rethrows when the picker is cancelled', async () => {
    const abortErr = new DOMException('The user aborted a request.', 'AbortError');
    fsAccess.pickDirectory.mockRejectedValue(abortErr);

    const { result } = renderHook(() => useBundle());
    act(() => {
      result.current.initWithSampleData();
    });
    const bundleConfigBefore = result.current.bundleConfig;

    await expect(
      act(async () => {
        await result.current.openBundleFromDisk();
      })
    ).rejects.toThrow();

    expect(result.current.diskConnected).toBe(false);
    expect(result.current.bundleConfig).toBe(bundleConfigBefore);
  });
});

describe('live disk autosave (saveStatus)', () => {
  async function connectToDisk(result) {
    const dirHandle = { kind: 'directory', name: 'my-folder' };
    fsAccess.pickDirectory.mockResolvedValue(dirHandle);
    fsAccess.verifyPermission.mockResolvedValue(true);
    fsAccess.listMarkdownFiles.mockResolvedValue([]);
    await act(async () => {
      await result.current.openBundleFromDisk();
    });
    return dirHandle;
  }

  it('does not write to disk or touch saveStatus when no folder is connected', () => {
    const { result } = renderHook(() => useBundle());
    act(() => {
      result.current.saveOKFFile({ id: 'OKF-1', title: 'T', content: 'content' });
    });
    expect(result.current.saveStatus['OKF-1']).toBeUndefined();
    expect(fsAccess.getOrCreateFileHandle).not.toHaveBeenCalled();
    expect(fsAccess.writeFileAtomic).not.toHaveBeenCalled();
  });

  it('transitions saveStatus idle -> saving -> saved and writes the fiche atomically on a successful debounced write', async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useBundle());
      const dirHandle = await connectToDisk(result);
      fsAccess.getOrCreateFileHandle.mockResolvedValue({ kind: 'file', name: 'OKF-1.md' });
      fsAccess.writeFileAtomic.mockResolvedValue(undefined);

      expect(result.current.saveStatus['OKF-1']).toBeUndefined();

      await act(async () => {
        result.current.saveOKFFile({ id: 'OKF-1', title: 'T', content: 'content v1' });
        // Let the internal async file-handle lookup settle before proceeding.
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.saveStatus['OKF-1']).toBe('saving');
      expect(fsAccess.writeFileAtomic).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });

      expect(fsAccess.writeFileAtomic).toHaveBeenCalledWith(dirHandle, 'OKF-1.md', 'content v1');
      expect(result.current.saveStatus['OKF-1']).toBe('saved');
    } finally {
      vi.useRealTimers();
    }
  });

  it('transitions saveStatus to error when the debounced write rejects', async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useBundle());
      await connectToDisk(result);
      fsAccess.getOrCreateFileHandle.mockResolvedValue({ kind: 'file', name: 'OKF-1.md' });
      fsAccess.writeFileAtomic.mockRejectedValue(new Error('disk full'));

      await act(async () => {
        result.current.saveOKFFile({ id: 'OKF-1', title: 'T', content: 'content' });
        await Promise.resolve();
        await Promise.resolve();
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });

      expect(result.current.saveStatus['OKF-1']).toBe('error');
    } finally {
      vi.useRealTimers();
    }
  });

  it('writes index.md through when setIndexContent is called while connected', async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useBundle());
      const dirHandle = await connectToDisk(result);
      fsAccess.getOrCreateFileHandle.mockResolvedValue({ kind: 'file', name: 'index.md' });
      fsAccess.writeFileAtomic.mockResolvedValue(undefined);

      await act(async () => {
        result.current.setIndexContent('new index content');
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.indexContent).toBe('new index content');
      expect(result.current.saveStatus.index).toBe('saving');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });

      expect(fsAccess.writeFileAtomic).toHaveBeenCalledWith(dirHandle, 'index.md', 'new index content');
      expect(result.current.saveStatus.index).toBe('saved');
    } finally {
      vi.useRealTimers();
    }
  });
});
