import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBundle, generateId, getPDFRefByName, getOKFById } from '../useBundle';

// Mock pdfIndexer for all tests to avoid actual Qdrant API calls
vi.mock('../../utils/pdfIndexer', () => ({
  indexPDFInQdrant: vi.fn().mockResolvedValue(undefined),
  removePDFFromQdrant: vi.fn().mockResolvedValue(undefined),
  pdfExistsInQdrant: vi.fn().mockResolvedValue(false),
  extractTextFromPDF: vi.fn().mockResolvedValue('extracted text'),
  splitTextIntoChunks: vi.fn().mockReturnValue(['chunk1', 'chunk2']),
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
