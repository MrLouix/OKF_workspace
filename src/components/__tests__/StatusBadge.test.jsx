import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatusBadge from '../StatusBadge';

describe('StatusBadge — generic statuses', () => {
  it.each([
    ['DRAFT', 'BROUILLON'],
    ['IN_REVIEW', 'EN REVUE'],
    ['VALIDATED', 'VALIDÉ'],
    ['ARCHIVED', 'ARCHIVÉ'],
  ])('renders the French label for %s', (status, label) => {
    render(<StatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});

describe('StatusBadge — legacy RCC-M statuses map to the same labels as their generic equivalents', () => {
  it.each([
    ['BROUILLON', 'DRAFT', 'BROUILLON'],
    ['EN_COURS', 'IN_REVIEW', 'EN REVUE'],
    ['VALIDÉ', 'VALIDATED', 'VALIDÉ'],
  ])('%s renders the same label and color as %s', (legacyStatus, genericStatus, expectedLabel) => {
    const { unmount } = render(<StatusBadge status={legacyStatus} />);
    const legacyEl = screen.getByText(expectedLabel);
    expect(legacyEl).toBeInTheDocument();
    const legacyColor = legacyEl.style.color;
    unmount();

    render(<StatusBadge status={genericStatus} />);
    const genericEl = screen.getByText(expectedLabel);
    expect(genericEl.style.color).toBe(legacyColor);
  });
});

describe('StatusBadge — unknown/missing status', () => {
  it('renders an em dash placeholder when status is undefined', () => {
    render(<StatusBadge status={undefined} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders the raw value for an unrecognized status string', () => {
    render(<StatusBadge status="SOMETHING_ELSE" />);
    expect(screen.getByText('SOMETHING_ELSE')).toBeInTheDocument();
  });
});
