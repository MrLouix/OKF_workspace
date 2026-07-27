import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SideFiles from '../SideFiles';

beforeAll(() => {
  global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
});

function setup(overrides = {}) {
  const props = {
    indexContent: '# Index',
    logContent: '# Log',
    bundleConfig: { id: 'b1', name: 'Bundle', pdfs: [] },
    onIndexChange: vi.fn(),
    onLogChange: vi.fn(),
    onExportZIP: vi.fn(),
    readOnly: false,
    diskConnected: false,
    saveStatus: {},
    ...overrides,
  };
  const utils = render(<SideFiles {...props} />);
  return { ...utils, props };
}

describe('SideFiles — manual upload/download affordances', () => {
  it('shows the upload and download buttons when disk is not connected (default behavior)', () => {
    setup();
    expect(screen.getByText('↑')).toBeInTheDocument();
    expect(screen.getByText('↓')).toBeInTheDocument();
  });

  it('hides the upload and download buttons once disk-connected', () => {
    setup({ diskConnected: true });
    expect(screen.queryByText('↑')).not.toBeInTheDocument();
    expect(screen.queryByText('↓')).not.toBeInTheDocument();
  });

  it('still hides the upload button in read-only mode when disk is not connected', () => {
    setup({ readOnly: true, diskConnected: false });
    expect(screen.queryByText('↑')).not.toBeInTheDocument();
    // Download remains available in read-only mode when not disk-connected
    expect(screen.getByText('↓')).toBeInTheDocument();
  });

  it('always shows the ZIP export button, regardless of disk connection', () => {
    const { rerender, props } = setup({ diskConnected: false });
    expect(screen.getByText('📦 ZIP')).toBeInTheDocument();

    rerender(<SideFiles {...props} diskConnected />);
    expect(screen.getByText('📦 ZIP')).toBeInTheDocument();
  });

  it('does not show the ZIP export button when there is no bundleConfig', () => {
    setup({ bundleConfig: null });
    expect(screen.queryByText('📦 ZIP')).not.toBeInTheDocument();
  });
});

describe('SideFiles — live disk-save status indicator', () => {
  it('does not render a status indicator when disk is not connected', () => {
    setup({ diskConnected: false, saveStatus: { index: 'saving' } });
    expect(screen.queryByText('Enregistrement…')).not.toBeInTheDocument();
    expect(screen.queryByText('Enregistré')).not.toBeInTheDocument();
  });

  it('reflects saveStatus.index while the index tab is active', () => {
    setup({ diskConnected: true, saveStatus: { index: 'saving', log: 'saved' } });
    expect(screen.getByText('Enregistrement…')).toBeInTheDocument();
  });

  it('reflects saveStatus.log after switching to the log tab', () => {
    setup({ diskConnected: true, saveStatus: { index: 'saving', log: 'error' } });
    fireEvent.click(screen.getByText('📒 log.md'));
    expect(screen.getByText("Erreur d'enregistrement")).toBeInTheDocument();
  });

  it('treats an undefined/idle status for the active tab as "saved"', () => {
    setup({ diskConnected: true, saveStatus: {} });
    expect(screen.getByText('Enregistré')).toBeInTheDocument();
  });
});
