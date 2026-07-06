// Minimal structured logger — keeps webhook traffic readable in the terminal
// and easy to grep once deployed.

type Fields = Record<string, unknown>;

function emit(level: string, msg: string, fields?: Fields) {
  const line: Fields = { t: new Date().toISOString(), level, msg, ...fields };
  const out = level === "error" ? console.error : console.log;
  out(JSON.stringify(line));
}

export const log = {
  info: (msg: string, fields?: Fields) => emit("info", msg, fields),
  warn: (msg: string, fields?: Fields) => emit("warn", msg, fields),
  error: (msg: string, fields?: Fields) => emit("error", msg, fields),
};

/**
 * Turn anything thrown into a loggable object. Error instances stringify fine,
 * but Supabase/PostgREST reject with PLAIN objects ({message, code, details,
 * hint}) — String(err) on those yields a useless "[object Object]". Pull out the
 * useful fields so logs are actionable.
 */
export function serializeError(err: unknown): Fields {
  if (err instanceof Error) {
    return { message: err.message, name: err.name, stack: err.stack };
  }
  if (err && typeof err === "object") {
    // Supabase PostgrestError-shaped objects and similar.
    const e = err as Record<string, unknown>;
    return {
      message: e.message ?? String(err),
      code: e.code,
      details: e.details,
      hint: e.hint,
    };
  }
  return { message: String(err) };
}
