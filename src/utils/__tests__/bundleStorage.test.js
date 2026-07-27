import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createBundleConfig,
  createOKFFile,
  saveBundle,
  loadBundle,
  importBundleFromZIP,
} from '../bundleStorage';
import { parseFrontMatter } from '../parseFrontMatter';
import { SAMPLE_BUNDLE_CONFIG, SAMPLE_OKF_FILES } from '../../constants';

describe('createBundleConfig', () => {
  it('generates sensible defaults', () => {
    const bundle = createBundleConfig({ name: 'My Bundle' });
    expect(bundle.name).toBe('My Bundle');
    expect(bundle.description).toBe('');
    expect(bundle.path).toBe('');
    expect(bundle.pdfs).toEqual([]);
    expect(bundle.id).toMatch(/^bundle-/);
    expect(new Date(bundle.createdAt).toString()).not.toBe('Invalid Date');
    expect(bundle.createdAt).toBe(bundle.updatedAt);
  });

  it('builds PDF references with default page ranges when none are given', () => {
    const bundle = createBundleConfig({
      name: 'Bundle',
      pdfs: [{ name: 'a.pdf' }, { name: 'b.pdf', pageRange: { start: 5, end: 9, raw: '5-9' } }],
    });
    expect(bundle.pdfs).toHaveLength(2);
    expect(bundle.pdfs[0]).toMatchObject({ name: 'a.pdf', path: 'a.pdf', pages: { start: 1, end: 100, raw: '1-100' } });
    expect(bundle.pdfs[1]).toMatchObject({ name: 'b.pdf', pages: { start: 5, end: 9, raw: '5-9' } });
    // ids must be unique
    expect(bundle.pdfs[0].id).not.toBe(bundle.pdfs[1].id);
  });
});

describe('createOKFFile', () => {
  it('defaults status to DRAFT and generates front-matter content', () => {
    const okf = createOKFFile({ title: 'My OKF' });
    expect(okf.status).toBe('DRAFT');
    expect(okf.id).toMatch(/^OKF-/);
    expect(okf.content).toContain('title: My OKF');
    expect(okf.content).toContain('status: DRAFT');
  });

  it('produces content whose front-matter round-trips through parseFrontMatter', () => {
    const okf = createOKFFile({
      title: 'Traceability',
      ref_document: 'doc.pdf',
      pages: { start: 1, end: 10 },
      status: 'IN_REVIEW',
      version: '2.0',
      author: 'Author X',
      tags: ['a', 'b'],
      related: ['OKF-1', 'OKF-2'],
    });
    const meta = parseFrontMatter(okf.content);
    expect(meta.id).toBe(okf.id);
    expect(meta.title).toBe('Traceability');
    expect(meta.ref_document).toBe('doc.pdf');
    expect(meta.pages).toEqual({ start: 1, end: 10, raw: '1-10' });
    expect(meta.status).toBe('IN_REVIEW');
    expect(meta.version).toBe('2.0');
    expect(meta.author).toBe('Author X');
    expect(meta.tags).toEqual(['a', 'b']);
    expect(meta.related).toEqual(['OKF-1', 'OKF-2']);
  });

  it('does not overwrite content that already starts with front-matter', () => {
    const existing = '---\nid: X\n---\n\n# Already has front matter';
    const okf = createOKFFile({ title: 'ignored', content: existing });
    expect(okf.content).toBe(existing);
  });
});

describe('saveBundle / loadBundle round trip', () => {
  const bundleConfig = {
    id: 'bundle-1',
    name: 'Test Bundle',
    description: 'desc',
    path: '/tmp',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    pdfs: [{ id: 'pdf-1', name: 'a.pdf', path: 'a.pdf', pages: { start: 1, end: 10, raw: '1-10' } }],
  };
  const okfFiles = [createOKFFile({ title: 'One' })];

  it('loadBundle resolves what saveBundle would have produced', async () => {
    // Build the exact JSON string saveBundle() would write to disk,
    // without needing to exercise the anchor/download DOM side-effect.
    const json = JSON.stringify({ version: '1.0', bundle: bundleConfig, files: okfFiles }, null, 2);
    const file = new File([json], 'bundle.json', { type: 'application/json' });

    const result = await loadBundle(file);
    expect(result.bundleConfig).toEqual(bundleConfig);
    expect(result.okfFiles).toEqual(okfFiles);
  });

  it('loadBundle rejects invalid bundle JSON missing required keys', async () => {
    const file = new File([JSON.stringify({ foo: 'bar' })], 'bad.json', { type: 'application/json' });
    await expect(loadBundle(file)).rejects.toThrow(/Invalid bundle format/);
  });

  it('loadBundle rejects unparsable content', async () => {
    const file = new File(['not json'], 'bad.json', { type: 'application/json' });
    await expect(loadBundle(file)).rejects.toThrow(/Failed to parse bundle/);
  });

  it('saveBundle warns and no-ops when bundleConfig is null', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => saveBundle(null, [])).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('round-trips the real generic sample data (SAMPLE_BUNDLE_CONFIG / SAMPLE_OKF_FILES)', async () => {
    const json = JSON.stringify({ version: '1.0', bundle: SAMPLE_BUNDLE_CONFIG, files: SAMPLE_OKF_FILES }, null, 2);
    const file = new File([json], 'bundle.json', { type: 'application/json' });

    const result = await loadBundle(file);
    expect(result.bundleConfig).toEqual(SAMPLE_BUNDLE_CONFIG);
    expect(result.okfFiles).toEqual(SAMPLE_OKF_FILES);
    // Sanity check the loaded OKF content still parses correctly post round-trip
    expect(parseFrontMatter(result.okfFiles[0].content).id).toBe(SAMPLE_OKF_FILES[0].id);
  });
});

describe('importBundleFromZIP', () => {
  it('rejects on invalid ZIP data', async () => {
    await expect(importBundleFromZIP(new File([''], 'x.zip'))).rejects.toThrow(/Corrupted zip/);
  });
});
