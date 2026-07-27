import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';

beforeAll(() => {
  // jsdom doesn't implement Blob URLs; stub them so the InitializerModal /
  // PDFPanel flows that call URL.createObjectURL don't throw.
  global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
  global.URL.revokeObjectURL = vi.fn();
});

describe('App (composition root)', () => {
  it('renders without crashing and seeds the sample bundle on first load', () => {
    render(<App />);
    expect(screen.getByText('OKF Workspace')).toBeInTheDocument();
    // Sample bundle name (from SAMPLE_BUNDLE_CONFIG) shown in the header
    expect(screen.getByText('Normes ISO 9001')).toBeInTheDocument();
    // First sample OKF file (from SAMPLE_OKF_FILES) is active
    expect(screen.getAllByText('OKF-2026-001').length).toBeGreaterThan(0);
    // Sample PDFs are listed as tabs in PDFPanel (and referenced in OKFPanel metadata)
    expect(screen.getAllByText('ISO_9001_2015.pdf').length).toBeGreaterThan(0);
  });

  it('switches layout modes via the header buttons', () => {
    render(<App />);
    const grid = screen.getByTestId('layout-grid');
    const initialColumns = grid.style.gridTemplateColumns;
    expect(initialColumns).toBe('1fr 1fr 1fr');

    fireEvent.click(screen.getByTitle('focus-okf'));
    expect(grid.style.gridTemplateColumns).toBe('2fr 1.5fr 0.5fr');

    fireEvent.click(screen.getByTitle('focus-pdf'));
    expect(grid.style.gridTemplateColumns).toBe('0.5fr 2fr 1fr');

    fireEvent.click(screen.getByTitle('3col'));
    expect(grid.style.gridTemplateColumns).toBe('1fr 1fr 1fr');
  });

  it('toggles read-only mode without blanking the screen', () => {
    render(<App />);
    // "✏️ Édition" also appears as an OKFPanel tab label while not read-only;
    // the header toggle button is the first occurrence in document order.
    const editToggle = () => screen.getAllByText('✏️ Édition')[0];
    expect(editToggle()).toBeInTheDocument();

    fireEvent.click(editToggle());

    // The app must still be fully rendered (no white screen / crash)
    expect(screen.getByText('🔒 Lecture')).toBeInTheDocument();
    expect(screen.getByText('OKF Workspace')).toBeInTheDocument();
    expect(screen.getAllByText('OKF-2026-001').length).toBeGreaterThan(0);
    expect(screen.getByText(/lecture seule/)).toBeInTheDocument();

    // Toggle back to edit mode
    fireEvent.click(screen.getByText('🔒 Lecture'));
    expect(editToggle()).toBeInTheDocument();
    expect(screen.getByText('OKF Workspace')).toBeInTheDocument();
  });

  it('opens and closes the InitializerModal via the "New Bundle" header button', () => {
    render(<App />);
    expect(screen.queryByText('Créer un nouveau Bundle OKF')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText(/Nouveau Bundle/));
    expect(screen.getByText('Créer un nouveau Bundle OKF')).toBeInTheDocument();

    fireEvent.click(screen.getByText('×'));
    expect(screen.queryByText('Créer un nouveau Bundle OKF')).not.toBeInTheDocument();
  });

  it('creating a bundle via InitializerModal updates the rendered OKF/PDF panels', async () => {
    render(<App />);

    fireEvent.click(screen.getByText(/Nouveau Bundle/));
    expect(screen.getByText('Créer un nouveau Bundle OKF')).toBeInTheDocument();

    // Step 1: folder
    fireEvent.change(screen.getByPlaceholderText(/Chemin du dossier/), {
      target: { value: '/tmp/my-bundle' },
    });
    fireEvent.click(screen.getByText('Suivant →'));

    // Step 2: name
    fireEvent.change(screen.getByPlaceholderText(/Normes ISO 9001/), {
      target: { value: 'Test Bundle' },
    });
    fireEvent.click(screen.getByText('Suivant →'));

    // Step 3: PDFs
    const file = new File(['%PDF-1.4'], 'doc.pdf', { type: 'application/pdf' });
    const fileInput = screen.getByLabelText(/Ajouter des PDFs/);
    fireEvent.change(fileInput, { target: { files: [file] } });
    expect(screen.getByText('doc.pdf')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Suivant →'));

    // Step 4: confirm
    fireEvent.click(screen.getByText('✅ Créer le Bundle'));

    await waitFor(() => {
      expect(screen.queryByText('Créer un nouveau Bundle OKF')).not.toBeInTheDocument();
    });

    // Header now shows the newly created bundle name
    expect(screen.getByText('Test Bundle')).toBeInTheDocument();
    // PDFPanel now shows a tab for the newly added PDF
    expect(screen.getByRole('button', { name: 'doc.pdf' })).toBeInTheDocument();
    // The old sample bundle content is gone
    expect(screen.queryByText('Normes ISO 9001')).not.toBeInTheDocument();
  });

  describe('bundle save -> load round trip through the Header controls', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('preserves an in-progress edit across a real save then load', async () => {
      let capturedBlob = null;
      global.URL.createObjectURL = vi.fn((blob) => {
        capturedBlob = blob;
        return 'blob:mock-save-url';
      });
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

      render(<App />);

      // OKFPanel's raw-content textarea renders before SideFiles' in the DOM
      const okfTextarea = document.querySelectorAll('textarea')[0];
      const editedContent = okfTextarea.value + '\n\nEdited by round-trip test.';
      fireEvent.change(okfTextarea, { target: { value: editedContent } });
      expect(document.querySelectorAll('textarea')[0].value).toBe(editedContent);

      // Save via the Header button
      fireEvent.click(screen.getByText(/Sauvegarder/));
      expect(capturedBlob).not.toBeNull();
      const savedJson = await capturedBlob.text();
      const saved = JSON.parse(savedJson);
      expect(saved.bundle.name).toBe('Normes ISO 9001');
      expect(saved.files[0].content).toBe(editedContent);

      // Load that exact file back in via the Header's "Charger" input
      const file = new File([savedJson], 'bundle.json', { type: 'application/json' });
      fireEvent.change(screen.getByLabelText(/Charger/), { target: { files: [file] } });

      await waitFor(() => {
        expect(document.querySelectorAll('textarea')[0].value).toBe(editedContent);
      });
      expect(screen.getByText('Normes ISO 9001')).toBeInTheDocument();
      expect(screen.getAllByText('OKF-2026-001').length).toBeGreaterThan(0);
    });
  });
});
