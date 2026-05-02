// Chilean RUT utilities: cleaning, formatting and validation.

/** Strip dots, hyphens and any character that is not 0-9 or K. Uppercase. */
export function cleanRUT(input: string): string {
  return (input ?? "")
    .toUpperCase()
    .replace(/[^0-9K]/g, "");
}

/**
 * Format a RUT as XXXXXXXX-X (no dots) for live typing.
 * - Keeps only digits and a trailing K.
 * - Inserts a hyphen before the last character once length >= 2.
 */
export function formatRUT(input: string): string {
  const clean = cleanRUT(input);
  if (clean.length === 0) return "";
  if (clean.length === 1) return clean;
  const body = clean.slice(0, -1);
  const dv = clean.slice(-1);
  return `${body}-${dv}`;
}

/** Validate Chilean RUT using mod-11 algorithm. Accepts formatted or raw input. */
export function validateRUT(rut: string): boolean {
  const clean = cleanRUT(rut);
  if (clean.length < 2) return false;
  const body = clean.slice(0, -1);
  const dv = clean.slice(-1).toUpperCase();
  if (!/^\d+$/.test(body)) return false;

  let sum = 0;
  let multiplier = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += parseInt(body[i], 10) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  const mod = 11 - (sum % 11);
  const expected = mod === 11 ? "0" : mod === 10 ? "K" : String(mod);
  return dv === expected;
}

/** Returns the canonical stored representation: digits + DV, no hyphen, no dots. */
export function normalizeRUT(rut: string): string {
  return cleanRUT(rut);
}
