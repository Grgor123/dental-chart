import QRCode from 'qrcode';

// Draws the UPN QR payload (supabase/functions/_shared/invoice/payment.ts)
// as an inline SVG string for the printed invoice: version 15, error
// correction M, as the UPN QR standard prescribes. Synchronous, so the
// invoice preview can render it in the same pass as the rest of the page.
export function upnQrSvg(payload: string): string {
  const qr = QRCode.create(payload, { errorCorrectionLevel: 'M', version: 15 });
  const { size, data } = qr.modules;
  let path = '';
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (data[y * size + x]) path += `M${x} ${y}h1v1h-1z`;
    }
  }
  const quiet = 4;
  const view = size + quiet * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-quiet} ${-quiet} ${view} ${view}" shape-rendering="crispEdges"><rect x="${-quiet}" y="${-quiet}" width="${view}" height="${view}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
