import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildRagQuery,
  fetchRagChunks,
  formatChunksForPrompt,
  buildSystemPrompt,
  getRagStatus,
  getRagIndicatorLabel,
} from '../ragUtils';

const bundleConfig = {
  pdfs: [
    { id: 'pdf-1', name: 'ISO_9001_2015.pdf' },
    { id: 'pdf-2', name: 'ISO_9000_2015.pdf' },
  ],
};

describe('buildRagQuery', () => {
  it('combines refs, title, and the user message', () => {
    const meta = { ref_document: 'ISO_9001_2015.pdf', title: 'Traceability' };
    const query = buildRagQuery(meta, 'What is required?', bundleConfig);
    expect(query).toBe('ISO_9001_2015.pdf Traceability What is required?');
  });

  it('resolves multiple comma-separated refs against bundleConfig.pdfs', () => {
    const meta = { ref_document: 'ISO_9001_2015.pdf, ISO_9000_2015.pdf' };
    const query = buildRagQuery(meta, 'msg', bundleConfig);
    expect(query.startsWith('ISO_9001_2015.pdf, ISO_9000_2015.pdf')).toBe(true);
  });

  it('falls back to legacy ref_rccm field', () => {
    const meta = { ref_rccm: 'B5300' };
    expect(buildRagQuery(meta, 'msg', null)).toBe('B5300 msg');
  });

  it('handles null metadata and bundleConfig gracefully', () => {
    expect(buildRagQuery(null, 'hello', null)).toBe('hello');
  });

  it('returns an empty string when nothing is provided', () => {
    expect(buildRagQuery(null, '', null)).toBe('');
  });
});

describe('fetchRagChunks', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.doUnmock('../../constants');
    vi.resetModules();
  });

  it('returns [] without calling fetch when RAG_API_URL is empty (RAG disabled)', async () => {
    global.fetch = vi.fn();
    const chunks = await fetchRagChunks({ ref_document: 'a.pdf' }, 'hello', bundleConfig);
    expect(chunks).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns [] and does not throw when the RAG API call fails', async () => {
    vi.doMock('../../constants', () => ({
      RAG_API_URL: 'https://rag.example.com/retrieve',
      RAG_TOP_K: 5,
      RAG_API_KEY: '',
    }));
    vi.resetModules();
    const { fetchRagChunks: fetchWithMockedConstants } = await import('../ragUtils');
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'));
    const chunks = await fetchWithMockedConstants({ ref_document: 'a.pdf' }, 'hello', bundleConfig);
    expect(chunks).toEqual([]);
  });

  it('posts the expected request body and returns chunks on success', async () => {
    vi.doMock('../../constants', () => ({
      RAG_API_URL: 'https://rag.example.com/retrieve',
      RAG_TOP_K: 3,
      RAG_API_KEY: 'secret',
    }));
    vi.resetModules();
    const { fetchRagChunks: fetchWithMockedConstants } = await import('../ragUtils');

    const mockChunks = [{ id: 'c1', ref: 'a.pdf', page_start: 1, page_end: 2, text: 'hi', score: 0.9 }];
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ chunks: mockChunks }),
    });

    const meta = { ref_document: 'a.pdf', pages: { start: 1, end: 5 } };
    const chunks = await fetchWithMockedConstants(meta, 'question', bundleConfig);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://rag.example.com/retrieve',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer secret' }),
      })
    );
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.top_k).toBe(3);
    expect(body.pages).toEqual({ start: 1, end: 5 });
    expect(body.refs).toContain('a.pdf');
    expect(chunks).toEqual(mockChunks);
  });
});

describe('formatChunksForPrompt', () => {
  it('returns null for an empty chunk list', () => {
    expect(formatChunksForPrompt([])).toBeNull();
  });

  it('formats chunks with ref, page range, and score', () => {
    const text = formatChunksForPrompt([
      { ref: 'a.pdf', page_start: 1, page_end: 2, score: 0.856, text: 'hello world' },
    ]);
    expect(text).toContain('a.pdf');
    expect(text).toContain('pp.1–2');
    expect(text).toContain('0.86');
    expect(text).toContain('hello world');
  });
});

describe('buildSystemPrompt', () => {
  it('includes chunk block when provided and omits EDITS instructions in read-only mode', () => {
    const prompt = buildSystemPrompt(
      { title: 'X' },
      'OKF CONTENT',
      'INDEX CONTENT',
      'LOG CONTENT',
      bundleConfig,
      'CHUNK BLOCK',
      true
    );
    expect(prompt).toContain('CHUNK BLOCK');
    expect(prompt).toContain('OKF CONTENT');
    expect(prompt).toContain('MODE LECTURE SEULE');
    expect(prompt).not.toContain('<EDITS>');
  });

  it('includes EDITS instructions when not read-only', () => {
    const prompt = buildSystemPrompt({}, 'OKF', 'INDEX', 'LOG', bundleConfig, null, false);
    expect(prompt).toContain('<EDITS>');
    expect(prompt).not.toContain('MODE LECTURE SEULE');
  });
});

describe('getRagStatus', () => {
  it('returns disabled when there is no RAG API URL', () => {
    expect(getRagStatus('', [], false)).toBe('disabled');
  });
  it('returns loading while a request is in flight', () => {
    expect(getRagStatus('https://x', [], true)).toBe('loading');
  });
  it('returns ok when chunks were retrieved', () => {
    expect(getRagStatus('https://x', [{ id: '1' }], false)).toBe('ok');
  });
  it('returns idle otherwise', () => {
    expect(getRagStatus('https://x', [], false)).toBe('idle');
  });
});

describe('getRagIndicatorLabel', () => {
  it('pluralizes the chunk count label correctly', () => {
    expect(getRagIndicatorLabel('ok', 1)).toBe('1 chunk injecté');
    expect(getRagIndicatorLabel('ok', 3)).toBe('3 chunks injectés');
  });
  it('returns the expected label for each non-ok status', () => {
    expect(getRagIndicatorLabel('idle', 0)).toBe('RAG en attente');
    expect(getRagIndicatorLabel('loading', 0)).toBe('Retrieval…');
    expect(getRagIndicatorLabel('error', 0)).toBe('RAG indisponible');
    expect(getRagIndicatorLabel('disabled', 0)).toBe('RAG non configuré');
  });
});
