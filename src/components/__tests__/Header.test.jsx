import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Header from '../Header';

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
    expect(onLoadBundle).toHaveBeenCalledWith(file);
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
