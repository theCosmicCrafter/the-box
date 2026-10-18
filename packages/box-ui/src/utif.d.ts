// Minimal UTIF surface - the package ships no declarations.
declare module "utif" {
  export interface Ifd {
    width: number;
    height: number;
    data: Uint8Array;
    [k: string]: unknown;
  }
  const UTIF: {
    decode(buf: ArrayBuffer | Uint8Array): Ifd[];
    decodeImage(buf: ArrayBuffer | Uint8Array, ifd: Ifd): void;
    toRGBA8(ifd: Ifd): Uint8Array;
  };
  export default UTIF;
}
