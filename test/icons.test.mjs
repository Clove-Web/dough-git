// Tests for the inline icon helper.
//
// icon() reads from the installed pixelarticons package at call time, so these
// checks pin the contract views.ts relies on: a real icon name yields one
// <svg> that inherits colour and stays crisp, the size argument is honoured,
// and an unknown name fails loudly rather than rendering nothing.
//
// Run:  node --experimental-strip-types test/icons.test.mjs

import { icon } from "../src/icons.ts";

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures++;
}

// The pixelarticons names dough-git actually uses.
const names = [
  "git-branch",
  "git-commit",
  "git-merge",
  "git-pull-request",
  "folder",
  "file-text",
  "code",
  "lock",
  "unlock",
  "eye",
  "eye-off",
  "user",
  "users",
  "download",
  "github",
  "bookmark",
  "clock",
];

for (const name of names) {
  const svg = icon(name);
  check(`${name} renders one svg`, (svg.match(/<svg /g) ?? []).length === 1);
  check(`${name} has at least one path`, svg.includes("<path "));
}

check(
  "default size is 16",
  icon("folder").includes('width="16"') && icon("folder").includes('height="16"'),
);
check(
  "an explicit size is honoured",
  icon("lock", 24).includes('width="24"'),
);
check(
  "the 24x24 grid is carried through",
  names.every((name) => icon(name).includes('viewBox="0 0 24 24"')),
);
check(
  "icons carry the .icon class for styling",
  icon("user").includes('class="icon"'),
);
check(
  "icons are decorative to screen readers",
  icon("user").includes('aria-hidden="true"'),
);
check(
  "colour is inherited, not hard-coded",
  !icon("git-branch").includes("fill="),
);

let threw = false;
try {
  icon("definitely-not-an-icon");
} catch {
  threw = true;
}
check("an unknown name throws rather than rendering nothing", threw);

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
