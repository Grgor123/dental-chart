// Turns the A4 invoice (renderInvoiceHtml with the Paged.js script) into a
// PDF in the browser, for emailing: the invoice is laid out in an off-screen
// frame exactly like the preview, each finished A4 sheet is captured as an
// image (html2canvas, 3×: sharp text and a scannable QR) and the sheets become the pages of
// the PDF (jsPDF). Same pages as the preview and the printout — there's no
// second layout to keep in sync. Both libraries load only when needed.
const READY_TIMEOUT_MS = 20_000;

declare global {
  interface Window {
    __invoicePagesReady?: boolean;
  }
}

function waitForPages(win: Window): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (win.__invoicePagesReady) resolve();
      else if (Date.now() - started > READY_TIMEOUT_MS) reject(new Error('Priprava PDF ni uspela (časovna omejitev).'));
      else setTimeout(tick, 100);
    };
    tick();
  });
}

/** Returns the PDF as base64 (no data: prefix). */
export async function invoiceHtmlToPdfBase64(html: string): Promise<string> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  // Wide enough that the preview's fit-to-width zoom stays at 1.
  Object.assign(iframe.style, { position: 'fixed', left: '-10000px', top: '0', width: '1000px', height: '1400px', border: '0' });
  document.body.appendChild(iframe);
  try {
    await new Promise<void>((resolve) => {
      iframe.onload = () => resolve();
      iframe.srcdoc = html;
    });
    const win = iframe.contentWindow;
    if (!win) throw new Error('Priprava PDF ni uspela.');
    await waitForPages(win);

    const pages = Array.from(win.document.querySelectorAll<HTMLElement>('.pagedjs_page'));
    if (pages.length === 0) throw new Error('Priprava PDF ni uspela (ni strani).');
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    for (const [i, page] of pages.entries()) {
      // 3× keeps the UPN QR code sharp enough to scan from a screen.
      const canvas = await html2canvas(page, { scale: 3, backgroundColor: '#ffffff', logging: false });
      if (i > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297);
    }
    return pdf.output('datauristring').split(',')[1];
  } finally {
    iframe.remove();
  }
}
