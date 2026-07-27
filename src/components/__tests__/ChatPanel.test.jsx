import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ChatPanel from '../ChatPanel';
import { LLM_API_URL } from '../../constants';

const baseProps = {
  okfContent: '---\nid: OKF-1\n---\nOKF BODY CONTENT',
  indexContent: 'INDEX BODY CONTENT',
  logContent: 'LOG BODY CONTENT',
  readOnly: false,
  meta: { id: 'OKF-1', ref_document: 'a.pdf' },
  bundleConfig: { pdfs: [{ id: 'p1', name: 'a.pdf' }] },
  activeOKF: { id: 'OKF-1', content: '---\nid: OKF-1\n---\nOKF BODY CONTENT' },
};

function sendChatMessage(text) {
  const textarea = screen.getByPlaceholderText(/modification souhaitée|question sur cette fiche/);
  fireEvent.change(textarea, { target: { value: text } });
  fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock('../../constants');
  vi.resetModules();
});

describe('ChatPanel — RAG disabled (default constants, RAG_API_URL empty)', () => {
  it('shows "RAG non configuré" before any message is sent', () => {
    render(<ChatPanel {...baseProps} onApplyEdit={vi.fn()} />);
    expect(screen.getByText('RAG non configuré')).toBeInTheDocument();
  });

  it('still calls the LLM and renders the reply, with OKF/index/log context in the system prompt', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ text: 'Voici ma réponse.' }] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<ChatPanel {...baseProps} onApplyEdit={vi.fn()} />);
    sendChatMessage('Bonjour');

    await waitFor(() => expect(screen.getByText('Voici ma réponse.')).toBeInTheDocument());

    // RAG is disabled, so only the LLM call happens
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe(LLM_API_URL);
    const body = JSON.parse(opts.body);
    expect(body.system).toContain('OKF BODY CONTENT');
    expect(body.system).toContain('INDEX BODY CONTENT');
    expect(body.system).toContain('LOG BODY CONTENT');
    expect(body.messages.at(-1)).toEqual({ role: 'user', content: 'Bonjour' });
  });

  it('parses an <EDITS> block, shows the proposed-changes panel, and applies edits on click', async () => {
    const editsPayload = { fiche: 'NEW FICHE', index: 'NEW INDEX', log: 'NEW LOG', summary: 'Résumé test' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ text: `Voici les changements.\n\n<EDITS>${JSON.stringify(editsPayload)}</EDITS>` }],
      }),
    }));

    const onApplyEdit = vi.fn();
    render(<ChatPanel {...baseProps} onApplyEdit={onApplyEdit} />);
    sendChatMessage('Mets à jour la fiche');

    await waitFor(() => expect(screen.getByText('Voici les changements.')).toBeInTheDocument());
    expect(screen.queryByText(/<EDITS>/)).not.toBeInTheDocument();
    expect(screen.getByText('MODIFICATIONS PROPOSÉES')).toBeInTheDocument();
    expect(screen.getByText('Résumé test')).toBeInTheDocument();
    expect(screen.getByText('📝 fiche.md')).toBeInTheDocument();
    expect(screen.getByText('📋 index.md')).toBeInTheDocument();
    expect(screen.getByText('📒 log.md')).toBeInTheDocument();

    fireEvent.click(screen.getByText(/Appliquer les modifications/));
    expect(onApplyEdit).toHaveBeenCalledWith(editsPayload);
    expect(await screen.findByText(/Modifications appliquées/)).toBeInTheDocument();
  });

  it('disables applying edits in read-only mode and does not call onApplyEdit', async () => {
    const editsPayload = { fiche: 'NEW FICHE', summary: 'Résumé' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ text: `Changement proposé.\n\n<EDITS>${JSON.stringify(editsPayload)}</EDITS>` }],
      }),
    }));

    const onApplyEdit = vi.fn();
    render(<ChatPanel {...baseProps} readOnly onApplyEdit={onApplyEdit} />);
    sendChatMessage('Question en lecture seule');

    await waitFor(() => expect(screen.getByText('Changement proposé.')).toBeInTheDocument());
    const disabledButton = screen.getByText(/Modifications désactivées/);
    fireEvent.click(disabledButton);
    expect(onApplyEdit).not.toHaveBeenCalled();
  });
});

describe('ChatPanel — RAG enabled (mocked RAG_API_URL)', () => {
  it('transitions RAG status through loading -> ok, renders chunks in the drawer, and injects them into the system prompt', async () => {
    vi.doMock('../../constants', async (importOriginal) => {
      const actual = await importOriginal();
      return { ...actual, RAG_API_URL: 'https://rag.example.com/retrieve', RAG_TOP_K: 5, RAG_API_KEY: '' };
    });
    vi.resetModules();
    const { default: MockedChatPanel } = await import('../ChatPanel');

    const chunk = { id: 'c1', ref: 'ISO_9001_2015.pdf', page_start: 10, page_end: 12, text: 'Exigence de traçabilité détaillée.', score: 0.87 };
    const mockFetch = vi.fn((url) => {
      if (url === 'https://rag.example.com/retrieve') {
        return Promise.resolve({ ok: true, json: async () => ({ chunks: [chunk] }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ content: [{ text: 'Réponse basée sur les extraits.' }] }) });
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<MockedChatPanel {...baseProps} onApplyEdit={vi.fn()} />);
    expect(screen.getByText('RAG en attente')).toBeInTheDocument();

    sendChatMessage('Que dit le document ?');

    await waitFor(() => expect(screen.getByText('Réponse basée sur les extraits.')).toBeInTheDocument());

    // Both the RAG endpoint and the LLM endpoint were called
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toBe('https://rag.example.com/retrieve');
    expect(mockFetch.mock.calls[1][0]).toBe(LLM_API_URL);

    // The chunk content made it into the LLM system prompt
    const llmBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(llmBody.system).toContain('ISO_9001_2015.pdf');
    expect(llmBody.system).toContain('Exigence de traçabilité détaillée.');

    // Status indicator reflects the retrieved chunk count, and the drawer shows it
    expect(screen.getByText('1 chunk injecté')).toBeInTheDocument();
    expect(screen.getByText('Contexte des documents injecté')).toBeInTheDocument();
    expect(screen.getByText('ISO_9001_2015.pdf')).toBeInTheDocument();
  });

  it('resolves refs from an OKF referencing multiple PDFs and includes them all in the RAG request', async () => {
    vi.doMock('../../constants', async (importOriginal) => {
      const actual = await importOriginal();
      return { ...actual, RAG_API_URL: 'https://rag.example.com/retrieve', RAG_TOP_K: 5, RAG_API_KEY: '' };
    });
    vi.resetModules();
    const { default: MockedChatPanel } = await import('../ChatPanel');

    const mockFetch = vi.fn((url) => {
      if (url === 'https://rag.example.com/retrieve') {
        return Promise.resolve({ ok: true, json: async () => ({ chunks: [] }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ content: [{ text: 'ok' }] }) });
    });
    vi.stubGlobal('fetch', mockFetch);

    const multiPdfProps = {
      ...baseProps,
      meta: { id: 'OKF-1', ref_document: 'ISO_9001_2015.pdf, ISO_9000_2015.pdf' },
      bundleConfig: {
        pdfs: [
          { id: 'p1', name: 'ISO_9001_2015.pdf' },
          { id: 'p2', name: 'ISO_9000_2015.pdf' },
        ],
      },
    };

    render(<MockedChatPanel {...multiPdfProps} onApplyEdit={vi.fn()} />);
    sendChatMessage('Compare les deux normes');

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));

    const ragBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(ragBody.refs).toEqual(expect.arrayContaining(['ISO_9001_2015.pdf', 'ISO_9000_2015.pdf']));
    expect(ragBody.refs).toHaveLength(2);
  });
});
