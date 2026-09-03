// Style entrypoint. Importing this pulls in the theme + global rules (side
// effects) and exposes the component class names. The esbuild + vanilla-extract
// build turns all of this into one static CSS file at compile time.

import "./fonts.css.ts";
import "./theme.css.ts";
import "./global.css.ts";

export { FONT_ORIGIN } from "./fonts.css.ts";
export { classes } from "./app.css.ts";
export type { Classes } from "./app.css.ts";
