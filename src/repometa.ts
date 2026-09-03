/* src/repometa.ts
 * LICENCED DASL-1.0 (c) Clove Twilight
 */

import { dropRepoAccess } from "./access.ts";
import { dropMirrorStatus } from "./mirror.ts";
import type { RepoRef } from "./git.ts";

export function clearRepoMetadata(ref: RepoRef): void {
  dropRepoAccess(ref);
  dropMirrorStatus(ref);
}
