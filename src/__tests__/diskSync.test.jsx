import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';
import * as fsAccess from '../utils/fsAccess';

// Full integration test for the live disk-persistence flow: connecting to
// a folder, editing a fiche (which writes through atomically, debounced),
// and reconciling an external change made outside the app on window focus.
vi.mock('../utils/fsAccess', () => ({
  isFileSystemAccessSupported: vi.fn(() => true),
  pickDirectory: vi.fn(),
  verifyPermission: vi.fn(),
  getOrCreateFileHandle: vi.fn(),
  readFileText: vi.fn(),
  writeFileAtomic: vi.fn(),
  listMarkdownFiles: vi.fn(),
}));

beforeAll(() => {
  global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
  global.URL.revokeObjectURL = vi.fn();
});

describe('Live disk sync — end-to-end (App + useBundle + fsAccess)', () => {
  it('writes edits through atomically and pulls in external changes on window focus', async () => {
    const dirHandle = { kind: 'directory', name: 'disk-bundle' };
    const indexHandle = { kind: 'file', name: 'index.md' };
    const logHandle = { kind: 'file', name: 'log.md' };
    const okfHandle = { kind: 'file', name: 'OKF-1.md' };

    const initialFiche = '---\nid: OKF-1\ntitle: Integration Fiche\nstatus: DRAFT\n---\n\nInitial body.';

    fsAccess.pickDirectory.mockResolvedValue(dirHandle);
    fsAccess.verifyPermission.mockResolvedValue(true);
    fsAccess.listMarkdownFiles.mockResolvedValue([
      { name: 'index.md', handle: indexHandle },
      { name: 'log.md', handle: logHandle },
      { name: 'OKF-1.md', handle: okfHandle },
    ]);
    fsAccess.readFileText.mockImplementation(async (handle) => {
      if (handle === indexHandle) return '# Index';
      if (handle === logHandle) return '# Log';
      if (handle === okfHandle) return initialFiche;
      throw new Error('unexpected handle');
    });
    fsAccess.writeFileAtomic.mockResolvedValue(undefined);

    render(<App />);

    // Connect to a real folder via the Header entry point.
    fireEvent.click(screen.getByText(/Connecter un dossier/));

    await waitFor(() => {
      expect(screen.getByText('disk-bundle')).toBeInTheDocument();
    });

    const getTextarea = () => document.querySelectorAll('textarea')[0];
    await waitFor(() => {
      expect(getTextarea().value).toBe(initialFiche);
    });

    // Edit the active fiche locally.
    const editedContent = initialFiche + '\n\nEdited locally.';
    fireEvent.change(getTextarea(), { target: { value: editedContent } });
    expect(getTextarea().value).toBe(editedContent);

    // The debounced atomic write should fire against the right file.
    await waitFor(() => {
      expect(fsAccess.writeFileAtomic).toHaveBeenCalledWith(dirHandle, 'OKF-1.md', editedContent);
    }, { timeout: 2000 });

    // Wait for the write to fully settle (saveStatus leaves 'saving') so the
    // upcoming sync isn't skipped by the in-flight-write guard.
    await waitFor(() => {
      expect(screen.queryByText('Enregistrement…')).not.toBeInTheDocument();
    }, { timeout: 2000 });

    // Simulate an external change made outside the app (e.g. another editor).
    const externallyEditedContent = '---\nid: OKF-1\ntitle: Integration Fiche\nstatus: DRAFT\n---\n\nEdited externally.';
    fsAccess.readFileText.mockImplementation(async (handle) => {
      if (handle === indexHandle) return '# Index';
      if (handle === logHandle) return '# Log';
      if (handle === okfHandle) return externallyEditedContent;
      throw new Error('unexpected handle');
    });

    // The File System Access API has no watch/push notification: regaining
    // window focus is what triggers reconciliation with disk.
    fireEvent(window, new Event('focus'));

    await waitFor(() => {
      expect(getTextarea().value).toBe(externallyEditedContent);
    }, { timeout: 2000 });
  });
});
