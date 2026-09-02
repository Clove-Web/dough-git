/* src/repometa.ts */
//
// Clearing the SQLite-side metadata that belongs to one repository.
//
// The filesystem is what says a repository exists; these tables only describe
// one that does. When a repo goes away — deleted, or moved into the trash — its
// rows have to go with it, or a later repo that happens to reuse the name
// inherits them. access.ts already warns about exactly that for grants; the
// mirror-status cache has the same hazard.
//
// This module exists so both sides of that invariant are named in one place.
// It is deliberately not a metadata *framework*: it is one function, and it
// grows a line when a new table becomes repo-scoped.

import { dropRepoAccess } from "./access.ts";
import { dropMirrorStatus } from "./mirror.ts";
import type { RepoRef } from "./git.ts";

export function clearRepoMetadata(ref: RepoRef): void {
  dropRepoAccess(ref);
  dropMirrorStatus(ref);
}
