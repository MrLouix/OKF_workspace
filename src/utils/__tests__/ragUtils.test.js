import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildRagQuery,
  fetchRagChunks,
  formatChunksForPrompt,
  buildSystemPrompt,
  getRagStatus,
  getRagIndicatorLabel,
} from '../ragUtils';
import { _resetCollectionReady } from '../pdfIndexer';

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
    _resetCollectionReady();
    vi.doUnmock('../../constants');
    vi.resetModules();
  });

  it('returns [] without calling fetch when RAG_API_URL or QDRANT_COLLECTION is empty', async () => {
    vi.doMock('../../constants', () => ({
      RAG_API_URL: '',
      QDRANT_COLLECTION: '',
      RAG_TOP_K: 5,
      RAG_API_KEY: '',
      MISTRAL_EMBEDDINGS_URL: '',
    }));
    vi.resetModules();
    const { fetchRagChunks: fetchWithMockedConstants } = await import('../ragUtils');
    
    global.fetch = vi.fn();
    const chunks = await fetchWithMockedConstants({ ref_document: 'a.pdf' }, 'hello', bundleConfig);
    expect(chunks).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns [] and does not throw when the RAG API call fails', async () => {
    vi.doMock('../../constants', () => ({
      RAG_API_URL: 'http://localhost:6333',
      QDRANT_COLLECTION: 'okf_documents',
      RAG_TOP_K: 5,
      RAG_API_KEY: '',
      MISTRAL_EMBEDDINGS_URL: 'https://api.mistral.ai/v1/embeddings',
    }));
    vi.resetModules();
    const { fetchRagChunks: fetchWithMockedConstants } = await import('../ragUtils');
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'));
    const chunks = await fetchWithMockedConstants({ ref_document: 'a.pdf' }, 'hello', bundleConfig);
    expect(chunks).toEqual([]);
  });

  it('posts to Qdrant with embeddings and returns formatted chunks on success', async () => {
    vi.doMock('../../constants', () => ({
      RAG_API_URL: 'http://localhost:6333',
      QDRANT_COLLECTION: 'okf_documents',
      RAG_TOP_K: 3,
      RAG_API_KEY: 'secret',
      MISTRAL_EMBEDDINGS_URL: 'https://api.mistral.ai/v1/embeddings',
    }));
    vi.resetModules();
    const { fetchRagChunks: fetchWithMockedConstants } = await import('../ragUtils');

    // Mock embeddings response from Mistral
    const mockEmbeddings = [0.1, 0.2, 0.3, 0.4];
    // Mock Qdrant response
    const mockQdrantPoints = [
      {
        id: 'c1',
        payload: { ref: 'a.pdf', page_start: 1, page_end: 2, text: 'hello world' },
        score: 0.9
      }
    ];
    
    // Mock all API calls (including ensureCollection GET)
    global.fetch = vi.fn().mockImplementation(async (url, opts) => {
      if (url.includes('embeddings')) {
        // Mistral embeddings API
        return {
          ok: true,
          json: async () => ({ data: [{ embedding: mockEmbeddings }] }),
        };
      } else if (url.includes('collections/okf_documents/points/search')) {
        // Qdrant search
        return {
          ok: true,
          json: async () => ({ result: { points: mockQdrantPoints } }),
        };
      } else if (url.includes('/collections/') && (!opts || opts.method === undefined || opts.method === 'GET')) {
        // ensureCollection check — collection exists
        return { ok: true, json: async () => ({ result: {} }) };
      }
      return { ok: false };
    });

    const meta = { ref_document: 'a.pdf', pages: { start: 1, end: 5 } };
    const chunks = await fetchWithMockedConstants(meta, 'question', bundleConfig);

    // Verify Mistral embeddings was called
    const embeddingsCall = global.fetch.mock.calls.find(call => 
      call[0].includes('embeddings')
    );
    expect(embeddingsCall).toBeDefined();
    expect(embeddingsCall[1].headers['Authorization']).toBeDefined();
    
    // Verify Qdrant was called
    const qdrantCall = global.fetch.mock.calls.find(call => 
      call[0].includes('collections/okf_documents/points/search')
    );
    expect(qdrantCall).toBeDefined();
    expect(qdrantCall[1].headers['Authorization']).toBeDefined();
    
    // Verify the Qdrant search body contains the embedding vector
    const qdrantBody = JSON.parse(qdrantCall[1].body);
    expect(qdrantBody.vector).toEqual(mockEmbeddings);
    expect(qdrantBody.limit).toBe(3);
    // Note: refs include both meta.ref_document and bundleConfig.pdfs
    expect(qdrantBody.filter.must.some((f) => f.key === 'ref' && f.match.value === 'a.pdf')).toBe(true);
    
    // Verify returned chunks are properly formatted
    expect(chunks).toEqual([
      { id: 'c1', ref: 'a.pdf', page_start: 1, page_end: 2, text: 'hello world', score: 0.9 }
    ]);
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
