// Prints a finished HTML document (from renderInvoiceHtml, supabase/functions/
// _shared/invoice/render.ts) through a hidden iframe, so the app's own CSS
// never touches the printout and the page underneath doesn't change.
//
// The A4 invoice is laid out by Paged.js inside the iframe and prints itself
// once its pages are ready (`selfPrinting`); the thermal receipt is printed
// here as soon as it loads. The iframe gets a real size (just off-screen),
// since page layout needs one.
//
// A web page can't print silently: the browser's print dialog opens every
// time. Pick the thermal printer there once and the browser remembers it for
// the next receipt.
export function printHtml(html: string, options: { selfPrinting?: boolean } = {}): void {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  Object.assign(iframe.style, {
    position: 'fixed',
    left: '-10000px',
    top: '0',
    width: '900px',
    height: '1200px',
    border: '0',
  });
  document.body.appendChild(iframe);

  const cleanup = () => iframe.remove();
  iframe.onload = () => {
    const win = iframe.contentWindow;
    if (!win) return cleanup();
    win.addEventListener('afterprint', () => setTimeout(cleanup, 0));
    if (!options.selfPrinting) {
      win.focus();
      win.print();
    }
    // Fallback for browsers that never fire afterprint.
    setTimeout(cleanup, 120_000);
  };
  iframe.srcdoc = html;
}
