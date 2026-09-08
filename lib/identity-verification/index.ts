import { diditAdapter } from "./adapters/didit";
import { veriffAdapter } from "./adapters/veriff";
import type { IdentityProviderId, IdentityVerificationAdapter } from "./types";

export type {
  IdentityDecision,
  IdentityProviderId,
  IdentitySession,
  IdentitySessionRequest,
  IdentityVerificationAdapter,
  IdentityWebhookPayload,
} from "./types";

export function getIdentityProviderId(): IdentityProviderId {
  const provider = (
    process.env.IDENTITY_VERIFICATION_PROVIDER ??
    process.env.KYC_PROVIDER ??
    "veriff"
  )
    .trim()
    .toLowerCase();

  if (provider === "didit") {
    return "didit";
  }

  return "veriff";
}

export function getIdentityVerificationAdapter(): IdentityVerificationAdapter {
  return getIdentityProviderId() === "didit" ? diditAdapter : veriffAdapter;
}
