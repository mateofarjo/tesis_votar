type ApiErrorBody = {
  details?: string;
  error?: string;
};

export async function readApiJson<T>(
  response: Response,
  fallbackMessage: string,
): Promise<T> {
  const payload = (await response.json()) as T & ApiErrorBody;

  if (!response.ok) {
    throw new Error(payload.details ?? payload.error ?? fallbackMessage);
  }

  return payload;
}
