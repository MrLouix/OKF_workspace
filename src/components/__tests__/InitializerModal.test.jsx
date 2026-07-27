import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import InitializerModal from '../InitializerModal';

beforeAll(() => {
  global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
  global.URL.revokeObjectURL = vi.fn();
});

function goToStep(step) {
  if (step >= 1) {
    fireEvent.change(screen.getByPlaceholderText(/Chemin du dossier/), {
      target: { value: '/tmp/my-bundle' },
    });
    fireEvent.click(screen.getByText('Suivant →'));
  }
  if (step >= 2) {
    fireEvent.change(screen.getByPlaceholderText(/Normes ISO 9001/), {
      target: { value: 'Multi PDF Bundle' },
    });
    fireEvent.click(screen.getByText('Suivant →'));
  }
}

describe('InitializerModal — 4-step wizard with 2+ PDFs and custom page ranges', () => {
  it('renders nothing when isOpen is false', () => {
    const { container } = render(<InitializerModal isOpen={false} onClose={vi.fn()} onCreate={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('walks through folder -> name -> 2 PDFs with custom page ranges -> confirm -> create', () => {
    const onCreate = vi.fn();
    const onClose = vi.fn();
    render(<InitializerModal isOpen onClose={onClose} onCreate={onCreate} />);

    goToStep(2);

    // Step 3: add two PDFs
    const fileA = new File(['a'], 'ISO_9001_2015.pdf', { type: 'application/pdf' });
    const fileB = new File(['b'], 'ISO_9000_2015.pdf', { type: 'application/pdf' });
    const fileInput = screen.getByLabelText(/Ajouter des PDFs/);
    fireEvent.change(fileInput, { target: { files: [fileA, fileB] } });

    expect(screen.getByText('PDFs sélectionnés (2)')).toBeInTheDocument();

    // Set a custom page range for each file, scoped to its own row
    const rowA = screen.getByText('ISO_9001_2015.pdf').closest('div').parentElement;
    const [startA, endA] = within(rowA).getAllByRole('spinbutton');
    fireEvent.change(startA, { target: { value: '5' } });
    fireEvent.change(endA, { target: { value: '50' } });

    // Note: deliberately avoid "1" here — the input already displays that
    // default fallback value, and a React controlled input won't fire
    // onChange when the new value equals what's already tracked.
    const rowB = screen.getByText('ISO_9000_2015.pdf').closest('div').parentElement;
    const [startB, endB] = within(rowB).getAllByRole('spinbutton');
    fireEvent.change(startB, { target: { value: '2' } });
    fireEvent.change(endB, { target: { value: '30' } });

    fireEvent.click(screen.getByText('Suivant →'));

    // Step 4: confirm summary shows both files with their custom ranges
    expect(screen.getByText('Multi PDF Bundle')).toBeInTheDocument();
    expect(screen.getByText(/pp\. 5-50/)).toBeInTheDocument();
    expect(screen.getByText(/pp\. 2-30/)).toBeInTheDocument();
    expect(screen.getByText('2 fichiers')).toBeInTheDocument();

    fireEvent.click(screen.getByText('✅ Créer le Bundle'));

    expect(onCreate).toHaveBeenCalledTimes(1);
    const payload = onCreate.mock.calls[0][0];

    expect(payload.bundleConfig.name).toBe('Multi PDF Bundle');
    expect(payload.bundleConfig.pdfs).toHaveLength(2);
    expect(payload.bundleConfig.pdfs[0]).toMatchObject({ name: 'ISO_9001_2015.pdf', pages: { start: 5, end: 50, raw: '5-50' } });
    expect(payload.bundleConfig.pdfs[1]).toMatchObject({ name: 'ISO_9000_2015.pdf', pages: { start: 2, end: 30, raw: '2-30' } });

    // Every PDF ref has a matching entry in pdfFiles, keyed by its own id
    const pdfIds = payload.bundleConfig.pdfs.map(p => p.id);
    expect(Object.keys(payload.pdfFiles).sort()).toEqual([...pdfIds].sort());
    expect(payload.pdfFiles[pdfIds[0]].file.name).toBe('ISO_9001_2015.pdf');
    expect(payload.pdfFiles[pdfIds[1]].file.name).toBe('ISO_9000_2015.pdf');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('cannot proceed past the PDFs step with zero files selected', () => {
    render(<InitializerModal isOpen onClose={vi.fn()} onCreate={vi.fn()} />);
    goToStep(2);
    expect(screen.getByText('Aucun PDF sélectionné')).toBeInTheDocument();
    expect(screen.getByText('Suivant →')).toBeDisabled();
  });

  it('disables "Suivant" for a bundle name containing invalid characters and blocks navigation', () => {
    render(<InitializerModal isOpen onClose={vi.fn()} onCreate={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/Chemin du dossier/), { target: { value: '/tmp/x' } });
    fireEvent.click(screen.getByText('Suivant →'));

    fireEvent.change(screen.getByPlaceholderText(/Normes ISO 9001/), { target: { value: 'Bad/Name!' } });
    expect(screen.getByText('Suivant →')).toBeDisabled();

    fireEvent.click(screen.getByText('Suivant →'));
    // Still on the name step — the click on a disabled button is a no-op
    expect(screen.getByText('Étape 2 : Nom et description du bundle')).toBeInTheDocument();

    // A valid name re-enables the button
    fireEvent.change(screen.getByPlaceholderText(/Normes ISO 9001/), { target: { value: 'Good Name' } });
    expect(screen.getByText('Suivant →')).not.toBeDisabled();
  });

  it('removing a selected PDF drops it from the list and its page range', () => {
    render(<InitializerModal isOpen onClose={vi.fn()} onCreate={vi.fn()} />);
    goToStep(2);
    const file = new File(['a'], 'doc.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText(/Ajouter des PDFs/), { target: { files: [file] } });
    expect(screen.getByText('doc.pdf')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Supprimer'));
    expect(screen.queryByText('doc.pdf')).not.toBeInTheDocument();
    expect(screen.getByText('Aucun PDF sélectionné')).toBeInTheDocument();
  });

  it('closing via the header × button calls onClose without creating a bundle', () => {
    const onCreate = vi.fn();
    const onClose = vi.fn();
    render(<InitializerModal isOpen onClose={onClose} onCreate={onCreate} />);
    fireEvent.click(screen.getByText('×'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCreate).not.toHaveBeenCalled();
  });
});
