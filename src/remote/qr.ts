import qrcode from 'qrcode-generator';

/** The address as a QR code image. It is drawn here in the app, so it needs no internet. */
export function qrDataUrl(text: string, cellSize = 6): string {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createDataURL(cellSize, 4);
}
