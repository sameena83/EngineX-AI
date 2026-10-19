// Let Node run the app's TypeScript directly.
//
// Node strips types natively, but it resolves import specifiers literally, and the
// source uses extensionless relative imports (`./channels`) the way a bundler
// does. This hook teaches the resolver the same rule: try the path as written,
// then with `.ts`, `.tsx`, and as a directory index. That keeps the test suite
// dependency-free — no bundler, no transform, no build step — while testing the
// exact files that ship.

const EXTENSIONS = [".ts", ".tsx", "/index.ts"];

export async function resolve(specifier, context, next) {
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
