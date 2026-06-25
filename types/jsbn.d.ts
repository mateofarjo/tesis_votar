declare module "jsbn" {
  export class BigInteger {
    constructor(value: string | number[] | Uint8Array | Buffer, radix?: number);
    toString(radix?: number): string;
  }
}
