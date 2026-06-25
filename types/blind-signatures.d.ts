declare module "blind-signatures" {
  import NodeRSA from "node-rsa";

  type BlindableValue = {
    toString(radix?: number): string;
  };

  type BlindResult = {
    blinded: BlindableValue;
    r: BlindableValue;
  };

  type RsaKeyLike = NodeRSA | {
    keyPair: {
      d?: BlindableValue;
      e?: BlindableValue;
      n: BlindableValue;
    };
  };

  type BlindParams = {
    E?: string;
    N?: string;
    key?: RsaKeyLike;
    message: string;
  };

  type SignParams = {
    blinded: BlindableValue | string;
    key: RsaKeyLike;
  };

  type UnblindParams = {
    N?: string;
    key?: RsaKeyLike;
    r: BlindableValue | string;
    signed: BlindableValue | string;
  };

  type VerifyParams = {
    E?: string;
    N?: string;
    key?: RsaKeyLike;
    message: string;
    unblinded: BlindableValue | string;
  };

  const BlindSignature: {
    blind(params: BlindParams): BlindResult;
    keyGeneration(params?: { b: number }): NodeRSA;
    messageToHash(message: string): string;
    sign(params: SignParams): BlindableValue;
    unblind(params: UnblindParams): BlindableValue;
    verify(params: VerifyParams): boolean;
    verify2(params: { key: RsaKeyLike; message: string; unblinded: BlindableValue | string }): boolean;
  };

  export = BlindSignature;
}
