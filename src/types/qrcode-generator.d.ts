// The qrcode-generator package ships without its own types. This is the part of it the app uses: a QR code drawn as an
// image, made here in the app with no online service.
declare module 'qrcode-generator' {
  interface QrCode {
    addData(data: string): void;
    make(): void;
    /** A PNG-style data URL of the code. `cellSize` is pixels per module; `margin` is the quiet border in modules. */
    createDataURL(cellSize?: number, margin?: number): string;
  }
  export default function qrcode(typeNumber: 0, errorCorrectionLevel: 'L' | 'M' | 'Q' | 'H'): QrCode;
}
