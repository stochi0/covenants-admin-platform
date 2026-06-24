export function getErrorMessage(error: unknown, fallback = "Something went wrong.") {
  return error instanceof Error ? error.message : fallback;
}

export function getClerkErrorMessage(error: unknown, fallback = "Unable to complete this action.") {
  if (
    error &&
    typeof error === "object" &&
    "errors" in error &&
    Array.isArray((error as { errors?: unknown }).errors)
  ) {
    const [first] = (error as { errors: Array<{ longMessage?: string; message?: string }> }).errors;
    return first?.longMessage ?? first?.message ?? fallback;
  }

  return getErrorMessage(error, fallback);
}
