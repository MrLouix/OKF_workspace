import '@testing-library/jest-dom'

// jsdom doesn't implement layout-dependent APIs like scrollIntoView;
// stub it so components that auto-scroll (e.g. ChatPanel) don't throw.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

