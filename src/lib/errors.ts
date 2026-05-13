type SerializedError = {
  name?: string;
  message?: string;
  code?: string;
  stack?: string;
  cause?: unknown;
  errors?: unknown;
  value?: unknown;
};

export function serializeError(error: unknown): SerializedError {
  if (error instanceof AggregateError) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      errors: error.errors.map(serializeError),
    };
  }

  if (error instanceof Error) {
    const errorWithDetails = error as Error & {
      code?: string;
      cause?: unknown;
    };

    return {
      name: error.name,
      message: error.message,
      code: errorWithDetails.code,
      stack: error.stack,
      cause:
        errorWithDetails.cause === undefined
          ? undefined
          : serializeError(errorWithDetails.cause),
    };
  }

  if (error && typeof error === "object") {
    try {
      return { value: JSON.parse(JSON.stringify(error)) };
    } catch {
      return { value: String(error) };
    }
  }

  return { value: error };
}
