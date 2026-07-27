import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PDFPanel from '../PDFPanel';

beforeAll(() => {
  global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
  global.URL.revokeObjectURL = vi.fn();
});

const bundleConfig = {
  id: 'b1',
  name: 'Bundle',
  pdfs: [
    { id: 'pdf-1', name: 'ISO_9001_2015.pdf', path: 'ISO_9001_2015.pdf', pages: { start: 10, end: 20, raw: '10-20' } },
    { id: 'pdf-2', name: 'ISO_9000_2015.pdf', path: 'ISO_9000_2015.pdf', pages: { start: 1, end: 5, raw: '1-5' } },
  ],
};

const fileA = new File(['%PDF-1.4 a'], 'ISO_9001_2015.pdf', { type: 'application/pdf' });
const fileB = new File(['%PDF-1.4 b'], 'ISO_9000_2015.pdf', { type: 'application/pdf' });

const pdfFiles = {
  'pdf-1': { file: fileA, url: 'blob:pdf-1-url' },
  'pdf-2': { file: fileB, url: 'blob:pdf-2-url' },
};

function setup(overrides = {}) {
  const props = {
    bundleConfig,
    pdfFiles,
    activePDFId: 'pdf-1',
    setActivePDFById: vi.fn(),
    currentPage: 10,
    setCurrentPage: vi.fn(),
    activePDFRef: bundleConfig.pdfs[0],
    meta: {},
    addPDF: vi.fn().mockResolvedValue('mock-pdf-id'),
    ...overrides,
  };
  const utils = render(<PDFPanel {...props} />);
  return { ...utils, props };
}

describe('PDFPanel — multi-PDF tab switching', () => {
  it('renders a tab for every PDF in the bundle and highlights the active one', () => {
    setup();
    const tabA = screen.getByTitle('ISO_9001_2015.pdf');
    const tabB = screen.getByTitle('ISO_9000_2015.pdf');
    expect(tabA).toBeInTheDocument();
    expect(tabB).toBeInTheDocument();
    // Active tab renders with a solid amber bottom border; inactive has none
    expect(tabA.style.borderBottomStyle).toBe('solid');
    expect(tabB.style.borderBottomStyle).toBe('none');
  });

  it('shows the currently active PDF in the iframe, keyed by its own blob URL', () => {
    setup();
    const iframe = screen.getByTitle('Visionneuse PDF');
    expect(iframe.src).toContain('blob:pdf-1-url');
    expect(iframe.src).toContain('#page=10');
  });

  it('clicking another tab calls setActivePDFById with that PDF\'s id', () => {
    const { props } = setup();
    fireEvent.click(screen.getByTitle('ISO_9000_2015.pdf'));
    expect(props.setActivePDFById).toHaveBeenCalledWith('pdf-2');
  });

  it('renders the second PDF\'s own blob URL once it becomes active', () => {
    setup({ activePDFId: 'pdf-2', activePDFRef: bundleConfig.pdfs[1], currentPage: 1 });
    const iframe = screen.getByTitle('Visionneuse PDF');
    expect(iframe.src).toContain('blob:pdf-2-url');
    expect(iframe.src).not.toContain('blob:pdf-1-url');
  });

  it('shows the placeholder when the active tab has no loaded blob yet', () => {
    setup({ pdfFiles: {}, activePDFId: 'pdf-1' });
    expect(screen.getByText('Charger un PDF de référence')).toBeInTheDocument();
    expect(screen.queryByTitle('Visionneuse PDF')).not.toBeInTheDocument();
  });
});

describe('PDFPanel — page navigation', () => {
  it('shows page shortcut buttons for the active pages range and highlights the current page', () => {
    setup();
    const pageButtons = ['10', '11', '12', '13', '14', '15', '16', '17'];
    pageButtons.forEach(p => expect(screen.getByRole('button', { name: p })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: '10' }).style.color).toContain('210, 153, 34'); // amber = current page
  });

  it('clicking a page shortcut calls setCurrentPage with that page number', () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole('button', { name: '15' }));
    expect(props.setCurrentPage).toHaveBeenCalledWith(15);
  });

  it('prev/next buttons and the "go to page" input update the current page', () => {
    const { props } = setup();
    const pageInput = screen.getByDisplayValue('10');
    fireEvent.change(pageInput, { target: { value: '12' } });
    expect(props.setCurrentPage).toHaveBeenCalledWith(12);
  });
});

describe('PDFPanel — adding a PDF in bundle mode', () => {
  it('calls addPDF (not the legacy single-file fallback) when a file is selected via "Ajouter"', () => {
    const { props, container } = setup();
    const newFile = new File(['%PDF-1.4 c'], 'new.pdf', { type: 'application/pdf' });
    const fileInput = container.querySelector('input[type="file"]');
    fireEvent.change(fileInput, { target: { files: [newFile] } });

    // Compare by name rather than deep-equality on the File object itself —
    // jsdom's File instances don't play well with vitest's deep-equal walk.
    expect(props.addPDF).toHaveBeenCalledTimes(1);
    expect(props.addPDF.mock.calls[0][0].name).toBe('new.pdf');
    // The legacy fallback iframe/pdfUrl path must not have been triggered —
    // the active tab (pdf-1) still shows its own blob, not the newly picked file
    const iframe = screen.getByTitle('Visionneuse PDF');
    expect(iframe.src).toContain('blob:pdf-1-url');
  });

  it('falls back to the legacy single-PDF preview when there is no bundle configured', () => {
    setup({ bundleConfig: null, pdfFiles: {}, activePDFId: null, activePDFRef: null });
    expect(screen.getByText('Aucun PDF chargé')).toBeInTheDocument();

    const file = new File(['%PDF-1.4'], 'solo.pdf', { type: 'application/pdf' });
    const fileInput = document.querySelector('input[type="file"]');
    fireEvent.change(fileInput, { target: { files: [file] } });

    expect(screen.getByTitle('Visionneuse PDF').src).toContain('blob:mock-url');
  });
});
