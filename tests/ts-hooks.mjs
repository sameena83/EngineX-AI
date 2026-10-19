// Let Node run the app's TypeScript directly.
//
// Node strips types natively, but it resolves import specifiers literally, and the
// source uses extensionless relative imports (`./channels`) the way a bundler
// does. This hook teaches the resolver the same rules: try the path as written,
// then with `.ts`, `.tsx`, and as a directory index; and resolve the `@/` alias to
// `src/`, so a route handler can be imported and called in a test exactly as the
// app imports it. That keeps the test suite dependency-free — no bundler, no
// transform, no build step — while testing the exact files that ship.

const EXTENSIONS = [".ts", ".tsx", "/index.ts"];
const SRC = new URL("../src/", import.meta.url);

/** `@/lib/db` is `src/lib/db`, the tsconfig path alias. */
function fromAlias(specifier) {
  if (!specifier.startsWith("@/")) return null;
  return new URL(specifier.slice(2), SRC).href;
}

export async function resolve(specifier, context, next) {
  const aliased = fromAlias(specifier);
  if (aliased) {
    try {
      return await next(aliased, context);
    } catch (err) {
      for (const extension of EXTENSIONS) {
        try {
          return await next(`${aliased}${extension}`, context);
        } catch {
          // Try the next candidate; the alias error is raised if none work.
        }
      }
      throw err;
    }
  }

  try {
    return await next(specifier, context);
  } catch (err) {
    const bare = specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/i.test(specifier);
    if (!bare) throw err;
    for (const extension of EXTENSIONS) {
      try {
        return await next(`${specifier}${extension}`, context);
      } catch {
        // Try the next candidate; the original error is raised if none work.
      }
    }
    throw err;
  }
}