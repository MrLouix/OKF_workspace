import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Header from '../Header';
import * as fsAccess from '../../utils/fsAccess';

vi.mock('../../utils/fsAccess', () => ({
  isFileSystemAccessSupported: vi.fn()
}));

const baseProps = {
  meta: {},
  bundleConfig: null,
  setShowInitializer: vi.fn(),
  readOnly: false,
  setReadOnly: vi.fn(),
  setLayout: vi.fn(),
  layout: '3col',
  RAG_API_URL: '',
};

describe('Header — bundle save/load wiring', () => {
  it('disables the Save button when there is no active bundle', () => {
    render(<Header {...baseProps} onSaveBundle={vi.fn()} onLoadBundle={vi.fn()} />);
    expect(screen.getByText(/Sauvegarder/).closest('button')).toBeDisabled();
  });

  it('calls onSaveBundle when the Save button is clicked with an active bundle', () => {
    const onSaveBundle = vi.fn();
    render(
      <Header
        {...baseProps}
        bundleConfig={{ id: 'b1', name: 'My Bundle', pdfs: [] }}
        onSaveBundle={onSaveBundle}
        onLoadBundle={vi.fn()}
      />
    );
    const saveButton = screen.getByText(/Sauvegarder/).closest('button');
    expect(saveButton).not.toBeDisabled();
    fireEvent.click(saveButton);
    expect(onSaveBundle).toHaveBeenCalledTimes(1);
  });

  it('calls onLoadBundle with the selected file when a bundle.json is chosen', () => {
    const onLoadBundle = vi.fn().mockResolvedValue(undefined);
    render(<Header {...baseProps} onSaveBundle={vi.fn()} onLoadBundle={onLoadBundle} />);

    const file = new File([JSON.stringify({ version: '1.0', bundle: {}, files: [] })], 'bundle.json', {
      type: 'application/json',
    });
    const fileInput = screen.getByLabelText(/Charger/);
    fireEvent.change(fileInput, { target: { files: [file] } });

    expect(onLoadBundle).toHaveBeenCalledTimes(1);
    // Compare by name rather than deep-equality on the File object itself —
    // jsdom's File instances don't play well with vitest's deep-equal walk.
    expect(onLoadBundle.mock.calls[0][0].name).toBe('bundle.json');
  });

  it('logs an error instead of throwing when onLoadBundle rejects', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onLoadBundle = vi.fn().mockRejectedValue(new Error('bad bundle'));
    render(<Header {...baseProps} onSaveBundle={vi.fn()} onLoadBundle={onLoadBundle} />);

    const file = new File(['not json'], 'bundle.json', { type: 'application/json' });
    const fileInput = screen.getByLabelText(/Charger/);
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(errorSpy).toHaveBeenCalled());
    errorSpy.mockRestore();
  });
});

describe('Header — connect-to-folder entry point', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the "Connecter un dossier" button when the File System Access API is supported', () => {
    fsAccess.isFileSystemAccessSupported.mockReturnValue(true);
    render(<Header {...baseProps} onSaveBundle={vi.fn()} onLoadBundle={vi.fn()} onConnectFolder={vi.fn()} />);
    expect(screen.getByText(/Connecter un dossier/)).toBeInTheDocument();
  });

  it('hides the button when the File System Access API is not supported', () => {
    fsAccess.isFileSystemAccessSupported.mockReturnValue(false);
    render(<Header {...baseProps} onSaveBundle={vi.fn()} onLoadBundle={vi.fn()} onConnectFolder={vi.fn()} />);
    expect(screen.queryByText(/Connecter un dossier/)).not.toBeInTheDocument();
  });

  it('calls onConnectFolder when clicked', () => {
    fsAccess.isFileSystemAccessSupported.mockReturnValue(true);
    const onConnectFolder = vi.fn().mockResolvedValue(undefined);
    render(<Header {...baseProps} onSaveBundle={vi.fn()} onLoadBundle={vi.fn()} onConnectFolder={onConnectFolder} />);
    fireEvent.click(screen.getByText(/Connecter un dossier/));
    expect(onConnectFolder).toHaveBeenCalledTimes(1);
  });

  it('logs an error instead of throwing when onConnectFolder rejects (e.g. picker cancelled)', async () => {
    fsAccess.isFileSystemAccessSupported.mockReturnValue(true);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onConnectFolder = vi.fn().mockRejectedValue(new Error('cancelled'));
    render(<Header {...baseProps} onSaveBundle={vi.fn()} onLoadBundle={vi.fn()} onConnectFolder={onConnectFolder} />);

    fireEvent.click(screen.getByText(/Connecter un dossier/));

    await waitFor(() => expect(errorSpy).toHaveBeenCalled());
  });
});
