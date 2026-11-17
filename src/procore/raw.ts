import type { Person } from "../domain/types.js";

/**
 * Helpers for reading loosely-typed Procore JSON. Field shapes vary between
 * API versions and company configurations, so every reader is defensive.
 */
export type Raw = Record<string, any>;

export function str(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number") return String(value);
  return undefined;
}

export function num(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[,\s$]/g, ""));
    return value.trim() !== "" && Number.isFinite(parsed) ? parsed : undefined;
  }
  if (value && typeof value === "object") {
    const obj = value as Raw;
    return num(obj.value ?? obj.amount);
  }
  return undefined;
}

export function lower(value: unknown): string {
  return (str(value) ?? "").toLowerCase();
}

export function person(value: unknown): Person | undefined {
  if (typeof value === "string") return value.trim() ? { name: value.trim() } : undefined;
  if (!value || typeof value !== "object") return undefined;
  const obj = value as Raw;
  if (obj.login_information && typeof obj.login_information === "object") {
    return person(obj.login_information);
  }
  const name = str(obj.name) ?? str(obj.login_information_name) ?? str(obj.user_name) ?? str(obj.login);
  if (!name) return undefined;
  const id = num(obj.id ?? obj.login_information_id);
  return id === undefined ? { name } : { id, name };
}

export function people(value: unknown): Person[] {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return uniquePeople(list.map(person).filter((p): p is Person => p !== undefined));
}

export function uniquePeople(list: Person[]): Person[] {
  const seen = new Set<string>();
  return list.filter((p) => {
    const key = personKey(p);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function personKey(p: Person): string {
  return p.id !== undefined ? `id:${p.id}` : `name:${p.name.toLowerCase()}`;
}

/** Lowercase snake_case, so "Revised Budget" and "revised_budget" compare equal. */
export function normKey(key: string): string {
  return key
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/** Reads the first numeric column whose normalized name matches a candidate. */
export function column(row: Raw, candidates: readonly string[]): number | undefined {
  const byNorm = new Map(Object.keys(row).map((k) => [normKey(k), k]));
  for (const candidate of candidates) {
    const key = byNorm.get(normKey(candidate));
    if (key !== undefined) {
      const value = num(row[key]);
      if (value !== undefined) return value;
    }
  }
  return undefined;
}
