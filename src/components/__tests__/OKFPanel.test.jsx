import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import OKFPanel from '../OKFPanel';

beforeAll(() => {
  global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
});

const content = `---
id: OKF-2026-001
title: Exigence de traçabilité
ref_document: ISO_9001_2015.pdf
pages: 10-25
status: DRAFT
version: 1.0
author: Jean Dupont
related:
  - OKF-2026-002
---

# OKF-2026-001 — Exigence de traçabilité

## Objet
Définir les exigences de traçabilité.`;

const meta = {
  id: 'OKF-2026-001',
  title: 'Exigence de traçabilité',
  ref_document: 'ISO_9001_2015.pdf',
  pages: { start: 10, end: 25, raw: '10-25' },
  status: 'DRAFT',
  version: '1.0',
  author: 'Jean Dupont',
  related: ['OKF-2026-002'],
};

function setup(overrides = {}) {
  const props = {
    content,
    onChange: vi.fn(),
    meta,
    readOnly: false,
    activeOKF: { id: 'OKF-2026-001', content },
    bundleConfig: null,
    ...overrides,
  };
  const utils = render(<OKFPanel {...props} />);
  return { ...utils, props };
}

describe('OKFPanel — generic metadata display', () => {
  it('shows the OKF id, ref_document, pages, version, and author', () => {
    setup();
    expect(screen.getByText('OKF-2026-001')).toBeInTheDocument();
    expect(screen.getByText('ISO_9001_2015.pdf')).toBeInTheDocument();
    expect(screen.getByText('10-25')).toBeInTheDocument();
    expect(screen.getByText('v1.0')).toBeInTheDocument();
    expect(screen.getByText('Jean Dupont')).toBeInTheDocument();
  });

  it('shows related links', () => {
    setup();
    expect(screen.getByText('OKF-2026-002')).toBeInTheDocument();
  });

  it('renders a status badge reflecting meta.status', () => {
    setup();
    expect(screen.getByText('BROUILLON')).toBeInTheDocument(); // DRAFT -> French label
  });

  it('falls back to legacy field names (ref_rccm/pages_pdf/statut/auteur) when present', () => {
    setup({
      meta: {
        id: 'OKF-2024-003',
        ref_rccm: 'B5300, B5310',
        pages_pdf: { start: 142, end: 158, raw: '142-158' },
        statut: 'EN_COURS',
        auteur: 'J. Martin',
      },
    });
    expect(screen.getByText('B5300, B5310')).toBeInTheDocument();
    expect(screen.getByText('142-158')).toBeInTheDocument();
    expect(screen.getByText('J. Martin')).toBeInTheDocument();
    expect(screen.getByText('EN REVUE')).toBeInTheDocument(); // EN_COURS -> IN_REVIEW -> "EN REVUE"
  });
});

describe('OKFPanel — inline editing via the raw content textarea', () => {
  it('calls onChange with the full updated content as the user types', () => {
    const { props, container } = setup();
    const textarea = container.querySelector('textarea');
    fireEvent.change(textarea, { target: { value: content + '\nplus de texte' } });
    expect(props.onChange).toHaveBeenCalledWith(content + '\nplus de texte');
  });

  it('switches to the preview tab and renders parsed markdown (stripped of front-matter)', () => {
    setup();
    fireEvent.click(screen.getByText('👁 Aperçu'));
    expect(screen.getByText('Objet')).toBeInTheDocument();
    expect(screen.getByText(/Définir les exigences de traçabilité/)).toBeInTheDocument();
    // Front-matter itself should not leak into the rendered preview
    expect(screen.queryByText(/ref_document: ISO_9001_2015\.pdf/)).not.toBeInTheDocument();
  });
});

describe('OKFPanel — live disk-save status', () => {
  it('shows the Ouvrir/Save buttons when disk is not connected (default behavior)', () => {
    setup();
    expect(screen.getByText('Ouvrir')).toBeInTheDocument();
  });

  it('hides the Ouvrir/Save buttons and shows a live status indicator once disk-connected', () => {
    setup({ diskConnected: true, saveStatus: 'saved' });
    expect(screen.queryByText('Ouvrir')).not.toBeInTheDocument();
    expect(screen.getByText('Enregistré')).toBeInTheDocument();
  });

  it('does not render a status indicator when disk is not connected, even if saveStatus is set', () => {
    setup({ diskConnected: false, saveStatus: 'saving' });
    expect(screen.queryByText('Enregistrement…')).not.toBeInTheDocument();
  });

  it('shows "Enregistrement…" while saveStatus is saving', () => {
    setup({ diskConnected: true, saveStatus: 'saving' });
    expect(screen.getByText('Enregistrement…')).toBeInTheDocument();
  });

  it('shows "Enregistré" while saveStatus is saved', () => {
    setup({ diskConnected: true, saveStatus: 'saved' });
    expect(screen.getByText('Enregistré')).toBeInTheDocument();
  });

  it('shows an error message while saveStatus is error', () => {
    setup({ diskConnected: true, saveStatus: 'error' });
    expect(screen.getByText("Erreur d'enregistrement")).toBeInTheDocument();
  });

  it('treats an undefined/idle saveStatus as "saved" once disk-connected', () => {
    setup({ diskConnected: true, saveStatus: undefined });
    expect(screen.getByText('Enregistré')).toBeInTheDocument();
  });

  it('drops the Save button once disk-connected, keeping only the tab and copy buttons', () => {
    const { rerender, props } = setup({ diskConnected: false });
    // Not disk-connected: 2 tab buttons + save button + copy button = 4
    expect(screen.getAllByRole('button')).toHaveLength(4);

    rerender(<OKFPanel {...props} diskConnected saveStatus="saved" />);
    // Disk-connected: 2 tab buttons + copy button = 3 (no save button)
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });
});

describe('OKFPanel — read-only mode', () => {
  it('forces the preview tab and hides edit/upload/save controls', () => {
    setup({ readOnly: true });
    expect(screen.queryByText('✏️ Édition')).not.toBeInTheDocument();
    expect(screen.getByText('👁 Aperçu')).toBeInTheDocument();
    expect(screen.getByText(/lecture seule/)).toBeInTheDocument();
    expect(screen.queryByText('Ouvrir')).not.toBeInTheDocument();
  });

  it('switching from edit to read-only mid-session snaps back to preview', () => {
    const { rerender, props, container } = setup({ readOnly: false });
    expect(container.querySelector('textarea')).toBeInTheDocument(); // edit tab active
    rerender(<OKFPanel {...props} readOnly />);
    expect(container.querySelector('textarea')).not.toBeInTheDocument();
    expect(screen.getByText(/Objet/)).toBeInTheDocument();
  });
});
