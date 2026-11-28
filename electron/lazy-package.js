// Third-party packages that no launch needs (Word and PowerPoint import, the updater) are loaded the first time they are used.
//
// `require` rather than `import()`: it answers at once, so the callers stay as they were, and it works inside the packaged app's compiled
// bytecode. It only loads CommonJS packages, which these are; the app's own modules are ES modules and are not loaded this way.
import { createRequire } from 'node:module';

const requireFromHere = createRequire(import.meta.url);

/** Returns a function that loads `name` on its first call and answers with the same value after that. A failed load is tried again. */
export function lazyPackage(name, load = requireFromHere) {
  let loaded;
  return () => (loaded ??= load(name));
}
