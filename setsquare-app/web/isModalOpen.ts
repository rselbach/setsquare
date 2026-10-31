/**
 * Whether a modal dialog is open anywhere in `doc`, so that the page's own
 * shortcuts stand down. It looks at the whole document rather than the key's
 * target, since focus may have left the dialog.
 */
export const isModalOpen = (doc: Document) =>
  doc.querySelector('[aria-modal="true"]') !== null;
