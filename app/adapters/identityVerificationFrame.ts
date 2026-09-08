export type IdentityProvider = "didit" | "veriff" | string;

export type IdentityFrameController = {
  close: () => void;
};

const DIDIT_MODAL_ATTRIBUTE = "data-identity-verification-modal";
const DIDIT_MODAL_VALUE = "didit";

type OpenIdentityFrameOptions = {
  onCanceled?: () => void;
  onFinished?: () => void;
  onReload?: () => void;
  onStarted?: () => void;
  provider?: IdentityProvider;
  url: string;
};

export function closeIdentityVerificationFrames(): void {
  if (typeof document === "undefined") {
    return;
  }

  document
    .querySelectorAll(`[${DIDIT_MODAL_ATTRIBUTE}="${DIDIT_MODAL_VALUE}"]`)
    .forEach((element) => element.remove());

  document.body.style.overflow = "";
}

function openDiditIframeModal({
  onStarted,
  url,
}: Pick<OpenIdentityFrameOptions, "onStarted" | "url">): IdentityFrameController {
  closeIdentityVerificationFrames();

  const overlay = document.createElement("div");
  overlay.setAttribute(DIDIT_MODAL_ATTRIBUTE, DIDIT_MODAL_VALUE);
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.zIndex = "9999";
  overlay.style.display = "grid";
  overlay.style.placeItems = "center";
  overlay.style.background = "rgba(15, 23, 42, 0.68)";
  overlay.style.backdropFilter = "blur(4px)";
  overlay.style.padding = "16px";

  const container = document.createElement("div");
  container.style.position = "relative";
  container.style.width = "min(480px, 100%)";
  container.style.height = "min(760px, 92vh)";
  container.style.overflow = "hidden";
  container.style.borderRadius = "18px";
  container.style.background = "#fff";
  container.style.boxShadow = "0 24px 80px rgba(15, 23, 42, 0.35)";

  const iframe = document.createElement("iframe");
  iframe.src = url;
  iframe.allow = "camera; microphone; fullscreen; autoplay; encrypted-media";
  iframe.referrerPolicy = "strict-origin-when-cross-origin";
  iframe.style.width = "100%";
  iframe.style.height = "100%";
  iframe.style.border = "0";

  const previousBodyOverflow = document.body.style.overflow;
  let isClosed = false;

  function close() {
    if (isClosed) {
      return;
    }

    isClosed = true;
    document.body.style.overflow = previousBodyOverflow;
    overlay.remove();
  }

  container.append(iframe);
  overlay.append(container);
  document.body.append(overlay);
  document.body.style.overflow = "hidden";
  onStarted?.();

  return { close };
}

export async function openIdentityVerificationFrame({
  onCanceled,
  onFinished,
  onReload,
  onStarted,
  provider,
  url,
}: OpenIdentityFrameOptions): Promise<IdentityFrameController> {
  if (provider === "veriff") {
    const { MESSAGES, createVeriffFrame } = await import("@veriff/incontext-sdk");
    return createVeriffFrame({
      lang: "es",
      onEvent(message) {
        if (message === MESSAGES.STARTED) {
          onStarted?.();
        }

        if (message === MESSAGES.SUBMITTED || message === MESSAGES.FINISHED) {
          onFinished?.();
        }

        if (message === MESSAGES.CANCELED) {
          onCanceled?.();
        }
      },
      onReload() {
        onReload?.();
      },
      url,
    });
  }

  if (provider === "didit") {
    return openDiditIframeModal({
      onStarted,
      url,
    });
  }

  const popup = window.open(url, "_blank", "noopener,noreferrer");
  onStarted?.();

  return {
    close() {
      popup?.close();
    },
  };
}
