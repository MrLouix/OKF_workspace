import { describe, it, expect } from 'vitest';
import {
  parseFrontMatter,
  generateFrontMatter,
  hasFrontMatter,
  stripFrontMatter,
} from '../parseFrontMatter';

describe('parseFrontMatter', () => {
  it('returns {} for missing/undefined content', () => {
    expect(parseFrontMatter(undefined)).toEqual({});
    expect(parseFrontMatter('')).toEqual({});
  });

  it('returns {} when there is no front-matter block', () => {
    expect(parseFrontMatter('# Just a heading\n\nSome body text.')).toEqual({});
  });

  it('parses new generic field names', () => {
    const md = `---
id: OKF-2026-001
title: Exigence de traçabilité
ref_document: ISO_9001_2015.pdf
pages: 10-25
status: DRAFT
version: 1.0
author: Jean Dupont
updated_at: 2026-07-27
---

# Body`;
    const meta = parseFrontMatter(md);
    expect(meta.id).toBe('OKF-2026-001');
    expect(meta.title).toBe('Exigence de traçabilité');
    expect(meta.ref_document).toBe('ISO_9001_2015.pdf');
    expect(meta.pages).toEqual({ start: 10, end: 25, raw: '10-25' });
    expect(meta.status).toBe('DRAFT');
    expect(meta.author).toBe('Jean Dupont');
  });

  it('parses old RCC-M field names and maps them to generic equivalents', () => {
    const md = `---
id: OKF-2024-003
titre: Contrôle des soudures bout-à-bout
ref_rccm: B5300, B5310, B5320
pages_pdf: 142-158
statut: EN_COURS
date_maj: 2024-06-15
auteur: J. Martin
---

# Body`;
    const meta = parseFrontMatter(md);
    // new normalized keys
    expect(meta.title).toBe('Contrôle des soudures bout-à-bout');
    expect(meta.ref_document).toBe('B5300, B5310, B5320');
    expect(meta.pages).toEqual({ start: 142, end: 158, raw: '142-158' });
    expect(meta.status).toBe('EN_COURS');
    expect(meta.updated_at).toBe('2024-06-15');
    expect(meta.author).toBe('J. Martin');
    // old keys preserved for backward compatibility
    expect(meta.titre).toBe('Contrôle des soudures bout-à-bout');
    expect(meta.ref_rccm).toBe('B5300, B5310, B5320');
    expect(meta.pages_pdf).toEqual({ start: 142, end: 158, raw: '142-158' });
    expect(meta.statut).toBe('EN_COURS');
    expect(meta.date_maj).toBe('2024-06-15');
    expect(meta.auteur).toBe('J. Martin');
  });

  it('parses a mix of old and new field names in the same document', () => {
    const md = `---
titre: Mixed doc
ref_document: doc.pdf
statut: VALIDATED
---

Body`;
    const meta = parseFrontMatter(md);
    expect(meta.title).toBe('Mixed doc');
    expect(meta.ref_document).toBe('doc.pdf');
    expect(meta.status).toBe('VALIDATED');
  });

  it('parses inline bracket tags', () => {
    const md = `---
tags: [soudure, contrôle, END]
---
Body`;
    expect(parseFrontMatter(md).tags).toEqual(['soudure', 'contrôle', 'END']);
  });

  it('parses a single bare tag as a one-element array', () => {
    const md = `---
tags: solo
---
Body`;
    expect(parseFrontMatter(md).tags).toEqual(['solo']);
  });

  it('parses multi-line YAML block arrays for related/liens', () => {
    const md = `---
id: OKF-2024-003
related:
  - OKF-2024-001
  - OKF-2024-007
---

# Body`;
    const meta = parseFrontMatter(md);
    expect(meta.related).toEqual(['OKF-2024-001', 'OKF-2024-007']);
  });

  it('parses the legacy "liens" block array and mirrors it to "related"', () => {
    const md = `---
liens:
  - OKF-2024-001
  - OKF-2024-007
---

# Body`;
    const meta = parseFrontMatter(md);
    expect(meta.related).toEqual(['OKF-2024-001', 'OKF-2024-007']);
    expect(meta.liens).toEqual(['OKF-2024-001', 'OKF-2024-007']);
  });

  it('parses comma-separated related values on a single line', () => {
    const md = `---
related: OKF-1, OKF-2
---
Body`;
    expect(parseFrontMatter(md).related).toEqual(['OKF-1', 'OKF-2']);
  });

  it('handles values containing colons without truncating them', () => {
    const md = `---
title: Ratio 3:1 acceptable
---
Body`;
    expect(parseFrontMatter(md).title).toBe('Ratio 3:1 acceptable');
  });

  it('strips surrounding quotes from values', () => {
    const md = `---
title: "Quoted Title"
---
Body`;
    expect(parseFrontMatter(md).title).toBe('Quoted Title');
  });
});

describe('generateFrontMatter', () => {
  it('returns an empty string for an empty meta object', () => {
    expect(generateFrontMatter({})).toBe('');
  });

  it('round-trips a generic OKFFile-shaped object through parseFrontMatter', () => {
    const meta = {
      id: 'OKF-2026-001',
      title: 'Exigence de traçabilité',
      ref_document: 'ISO_9001_2015.pdf',
      pages: { start: 10, end: 25, raw: '10-25' },
      status: 'DRAFT',
      version: '1.0',
      author: 'Jean Dupont',
      updated_at: '2026-07-27',
      tags: ['traçabilité', 'qualité', 'ISO'],
      related: ['OKF-2026-002', 'OKF-2026-003'],
    };
    const fm = generateFrontMatter(meta);
    expect(fm.startsWith('---\n')).toBe(true);
    const parsed = parseFrontMatter(fm + '\nBody');
    expect(parsed.id).toBe(meta.id);
    expect(parsed.title).toBe(meta.title);
    expect(parsed.ref_document).toBe(meta.ref_document);
    expect(parsed.pages).toEqual(meta.pages);
    expect(parsed.status).toBe(meta.status);
    expect(parsed.version).toBe(meta.version);
    expect(parsed.author).toBe(meta.author);
    expect(parsed.updated_at).toBe(meta.updated_at);
    expect(parsed.tags).toEqual(meta.tags);
    expect(parsed.related).toEqual(meta.related);
  });

  it('round-trips a single-item related array (regression: item must not be glued to the key line)', () => {
    const fm = generateFrontMatter({ related: ['OKF-2026-002'] });
    expect(fm).toContain('related:\n  - OKF-2026-002');
    const parsed = parseFrontMatter(fm + '\nBody');
    expect(parsed.related).toEqual(['OKF-2026-002']);
  });

  it('omits empty array fields entirely', () => {
    const fm = generateFrontMatter({ title: 'X', tags: [], related: [] });
    expect(fm).not.toContain('tags');
    expect(fm).not.toContain('related');
  });

  it('serializes additional non-standard fields not in the fixed field order', () => {
    const fm = generateFrontMatter({ title: 'X', custom_field: 'custom_value' });
    expect(fm).toContain('custom_field: custom_value');
  });
});

describe('hasFrontMatter', () => {
  it('detects presence of a front-matter block', () => {
    expect(hasFrontMatter('---\nid: 1\n---\nBody')).toBe(true);
  });

  it('returns false when there is no front-matter block', () => {
    expect(hasFrontMatter('# Just a heading')).toBe(false);
  });
});

describe('stripFrontMatter', () => {
  it('removes the front-matter block and leaves the body', () => {
    const md = '---\nid: 1\n---\n\n# Body content';
    expect(stripFrontMatter(md).trim()).toBe('# Body content');
  });

  it('returns content unchanged when there is no front-matter block', () => {
    expect(stripFrontMatter('# Body only')).toBe('# Body only');
  });

  it('returns falsy content unchanged', () => {
    expect(stripFrontMatter('')).toBe('');
  });
});
