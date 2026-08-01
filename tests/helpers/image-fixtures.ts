const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVR4nGPgUbL4D8IMMAYALGgFldJRhbgAAAAASUVORK5CYII=";
const JPEG_BASE64 = "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCfAFEB/9k=";
const WEBP_BASE64 = "UklGRjAAAABXRUJQVlA4ICQAAABQAQCdASoCAAIAAUAmJQBOgC6gAP77LkvF3YjjJ4dVU9ffoAA=";
const JPEG_WITH_METADATA_BASE64 = "/9j/4QC8RXhpZgAASUkqAAgAAAAGABIBAwABAAAABgAAABoBBQABAAAAVgAAABsBBQABAAAAXgAAACgBAwABAAAAAgAAABMCAwABAAAAAQAAAGmHBAABAAAAZgAAAAAAAAA4YwAA6AMAADhjAADoAwAABgAAkAcABAAAADAyMTABkQcABAAAAAECAwAAoAcABAAAADAxMDABoAMAAQAAAP//AAACoAQAAQAAAAIAAAADoAQAAQAAAAIAAAAAAAAA/+IB8ElDQ19QUk9GSUxFAAEBAAAB4GxjbXMEIAAAbW50clJHQiBYWVogB+IAAwAUAAkADgAdYWNzcE1TRlQAAAAAc2F3c2N0cmwAAAAAAAAAAAAAAAAAAPbWAAEAAAAA0y1oYW5keem/Vlo+AbaDI4VVRvdPqgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKZGVzYwAAAPwAAAAkY3BydAAAASAAAAAid3RwdAAAAUQAAAAUY2hhZAAAAVgAAAAsclhZWgAAAYQAAAAUZ1hZWgAAAZgAAAAUYlhZWgAAAawAAAAUclRSQwAAAcAAAAAgZ1RSQwAAAcAAAAAgYlRSQwAAAcAAAAAgbWx1YwAAAAAAAAABAAAADGVuVVMAAAAIAAAAHABzAFIARwBCbWx1YwAAAAAAAAABAAAADGVuVVMAAAAGAAAAHABDAEMAMAAAWFlaIAAAAAAAAPbWAAEAAAAA0y1zZjMyAAAAAAABDD8AAAXd///zJgAAB5AAAP2S///7of///aIAAAPcAADAcVhZWiAAAAAAAABvoAAAOPIAAAOPWFlaIAAAAAAAAGKWAAC3iQAAGNpYWVogAAAAAAAAJKAAAA+FAAC2xHBhcmEAAAAAAAMAAAACZmkAAPKnAAANWQAAE9AAAApb/9sAQwAGBAUGBQQGBgUGBwcGCAoQCgoJCQoUDg8MEBcUGBgXFBYWGh0lHxobIxwWFiAsICMmJykqKRkfLTAtKDAlKCko/9sAQwEHBwcKCAoTCgoTKBoWGigoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgo/8AAEQgAAgACAwEiAAIRAQMRAf/EABUAAQEAAAAAAAAAAAAAAAAAAAAI/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/EABUBAQEAAAAAAAAAAAAAAAAAAAQF/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AnwBRAf/Z";
const ANIMATED_WEBP_BASE64 = "UklGRsIAAABXRUJQVlA4WAoAAAACAAAAAAAAAAAAQU5JTQYAAAD/////AABBTk1GSAAAAAAAAAAAAAAAAAAAAGQAAAJWUDggMAAAANABAJ0BKgEAAQABQCYloAJ0ugH4AAOwAP7y63/82BXNc+/3/9Lg/S4P0uD/0pAAAEFOTUZGAAAAAAAAAAAAAAAAAAAAZAAAAFZQOCAuAAAAlAEAnQEqAQABAAAAJiWgAnS6AAOYAP77VeP/pcH/0uD/6XB/6XB/G7LOG6QAAA==";

export const validPng = Buffer.from(PNG_BASE64, "base64");
export const validJpeg = Buffer.from(JPEG_BASE64, "base64");
export const validWebp = Buffer.from(WEBP_BASE64, "base64");
export const jpegWithMetadata = Buffer.from(JPEG_WITH_METADATA_BASE64, "base64");
export const animatedWebp = Buffer.from(ANIMATED_WEBP_BASE64, "base64");

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer) {
  const typeBytes = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return chunk;
}

export function pngWithText(text: string, exactSize?: number) {
  const iendOffset = validPng.lastIndexOf(Buffer.from("IEND", "ascii")) - 4;
  const baseLength = validPng.length + 12;
  const textBytes = exactSize === undefined
    ? Buffer.from(text, "utf8")
    : Buffer.alloc(exactSize - baseLength, 0x61);
  if (exactSize !== undefined) Buffer.from(text, "utf8").copy(textBytes);
  return Buffer.concat([validPng.subarray(0, iendOffset), pngChunk("tEXt", textBytes), validPng.subarray(iendOffset)]);
}

export function pngWithoutImageData() {
  const idatOffset = validPng.indexOf(Buffer.from("IDAT", "ascii")) - 4;
  const dataLength = validPng.readUInt32BE(idatOffset);
  return Buffer.concat([validPng.subarray(0, idatOffset), validPng.subarray(idatOffset + dataLength + 12)]);
}

export function pngWithDimensions(width: number, height: number) {
  const result = Buffer.from(validPng);
  result.writeUInt32BE(width, 16);
  result.writeUInt32BE(height, 20);
  result.writeUInt32BE(crc32(result.subarray(12, 29)), 29);
  return result;
}

export function pngWithCorruptCrc() {
  const result = Buffer.from(validPng);
  const idatOffset = result.indexOf(Buffer.from("IDAT", "ascii")) - 4;
  const dataLength = result.readUInt32BE(idatOffset);
  result[idatOffset + dataLength + 8] ^= 0xff;
  return result;
}
