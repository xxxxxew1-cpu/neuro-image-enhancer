/** Detect an image mime type from the first bytes (magic numbers). */
export function sniffMime(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return 'image/png';
  // BMP: 42 4D ("BM")
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp';
  // GIF: "GIF8"
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  // WEBP: "RIFF"...."WEBP"
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return 'image/webp';
  // HEIC/HEIF: bytes 4..8 == "ftyp", brand at 8..12
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]).toLowerCase();
    if (
      brand.startsWith('hei') || // heic, heix, heim, heis
      brand.startsWith('hev') || // hevc, hevx
      brand === 'mif1' ||
      brand === 'msf1' ||
      brand === 'avif'
    ) {
      return brand === 'avif' ? 'image/avif' : 'image/heic';
    }
  }
  return null;
}

export function isHeicMime(mime: string): boolean {
  return /image\/(heic|heif)/i.test(mime);
}
