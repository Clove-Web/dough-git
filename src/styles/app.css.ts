/* src/styles/app.css.ts
 *
 * Component classes. Each is a generated, scoped class name (zero runtime).
 * Imported as a single `classes` object by the HTML views.
 */

import { globalStyle, style } from "@vanilla-extract/css";
import { vars } from "./theme.css";

const readme = style({
  margin: "1rem 0",
  padding: "1rem 1.25rem",
  background: vars.surface,
  border: `1px solid ${vars.border}`,
  borderRadius: vars.radius,
  overflowWrap: "break-word",
});

export const classes = {
  readme,

  siteHeader: style({
    display: "grid",
    gridTemplateColumns: "1fr auto 1fr",
    alignItems: "center",
    gap: "1rem",
    padding: "0.75rem 1.25rem",
    borderBottom: `1px solid ${vars.border}`,
    background: vars.bgRaised,
  }),

  siteTitle: style({
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    fontWeight: 700,
    fontSize: "1.1rem",
    color: vars.text,
  }),

  siteLogo: style({
    width: "1.5rem",
    height: "1.5rem",
    borderRadius: 0,
    objectFit: "cover",
  }),

  siteWho: style({
    display: "flex",
    justifyContent: "center",
    minWidth: 0,
  }),

  siteNav: style({
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: "0.75rem",
  }),

  navLink: style({ color: vars.accent }),

  user: style({
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
    minWidth: 0,
    color: vars.textMuted,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  }),

  avatar: style({
    position: "relative",
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 0,
    background: vars.surfaceHi,
    color: vars.textSoft,
    fontWeight: 600,
    lineHeight: 1,
    overflow: "hidden",
    userSelect: "none",
  }),

  avatarSm: style({
    width: "25px",
    minWidth: "25px",
    maxWidth: "25px",
    height: "25px",
    minHeight: "25px",
    maxHeight: "25px",
    fontSize: "13px",
  }),

  avatarLg: style({
    width: "60px",
    minWidth: "60px",
    maxWidth: "60px",
    height: "60px",
    minHeight: "60px",
    maxHeight: "60px",
    fontSize: "30px",
  }),

  avatarImg: style({
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
  }),

  profileHead: style({
    display: "flex",
    alignItems: "center",
    gap: "1rem",
    margin: "0.5rem 0 1.5rem",
  }),

  profileName: style({
    fontSize: "1.4rem",
    margin: 0,
  }),

  ownerLink: style({ color: vars.textMuted }),

  content: style({
    maxWidth: "960px",
    margin: "0 auto",
    padding: "1.25rem",
  }),

  pageTitle: style({
    fontSize: "1.4rem",
    margin: "0.25rem 0 1rem",
  }),

  sectionTitle: style({
    fontSize: "1.05rem",
    margin: "1.5rem 0 0.5rem",
    color: vars.textSoft,
  }),

  repoList: style({}),

  repoRow: style({}),

  repoName: style({ fontWeight: 600 }),

  repoDesc: style({ color: vars.textMuted }),

  repoVis: style({
    fontFamily: vars.mono,
    fontSize: "0.85em",
    color: vars.textDim,
  }),

  repoIdle: style({
    fontFamily: vars.mono,
    fontSize: "0.85em",
    color: vars.textDim,
    whiteSpace: "nowrap",
  }),

  repoTabs: style({
    display: "flex",
    gap: "0.5rem",
    margin: "0.75rem 0",
  }),

  tab: style({
    padding: "0.2rem 0.7rem",
    border: `1px solid ${vars.border}`,
    borderRadius: vars.radius,
    color: vars.textSoft,
  }),

  tabActive: style({
    background: vars.surfaceHi,
    color: vars.text,
    fontWeight: 600,
  }),

  cloneBox: style({
    margin: "1rem 0",
    padding: "0.6rem 0.9rem",
    background: vars.surface,
    border: `1px solid ${vars.border}`,
    borderRadius: vars.radius,
  }),

  cloneLabel: style({
    color: vars.textMuted,
    marginRight: "0.5rem",
  }),

  commitList: style({}),

  commitDate: style({
    fontFamily: vars.mono,
    fontSize: "0.85em",
    color: vars.textDim,
    whiteSpace: "nowrap",
  }),

  commitSubject: style({}),

  commitAuthor: style({ color: vars.textMuted }),

  commitHash: style({
    fontFamily: vars.mono,
    fontSize: "0.85em",
    color: vars.textDim,
  }),

  treeList: style({}),

  treeMode: style({
    fontFamily: vars.mono,
    fontSize: "0.85em",
    color: vars.textDim,
  }),

  treeName: style({}),

  treeSize: style({
    fontFamily: vars.mono,
    fontSize: "0.85em",
    color: vars.textDim,
    textAlign: "right",
  }),

  code: style({
    display: "block",
    padding: "0.75rem 1rem",
    background: vars.surface,
    border: `1px solid ${vars.border}`,
    borderRadius: vars.radius,
    fontSize: "0.85rem",
    color: vars.textSoft,
  }),

  commitMeta: style({
    display: "grid",
    gridTemplateColumns: "max-content 1fr",
    gap: "0.2rem 1rem",
    margin: "0.75rem 0",
  }),

  binaryNotice: style({ color: vars.textMuted }),

  message: style({ color: vars.textMuted }),

  badge: style({
    display: "inline-block",
    padding: "0.05rem 0.4rem",
    marginLeft: "0.4rem",
    borderRadius: 0,
    border: `1px solid ${vars.border}`,
    background: vars.surfaceHi,
    fontFamily: vars.mono,
    fontSize: "0.75em",
    color: vars.textMuted,
    verticalAlign: "middle",
  }),

  formRow: style({
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "0.5rem",
  }),

  grow: style({
    flex: "1 1 12rem",
    minWidth: 0,
  }),

  revPicker: style({
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "0.5rem",
    margin: "0.75rem 0",
  }),

  empty: style({ color: vars.textDim }),

  statusGood: style({ color: vars.success }),
  statusWarn: style({ color: vars.accent }),
  statusBad: style({ color: vars.danger }),
  statusMuted: style({ color: vars.textDim }),

  mirrorRow: style({
    display: "grid",
    gridTemplateColumns: "minmax(5rem, auto) minmax(9rem, auto) auto 1fr",
    gap: "0.5rem 1rem",
    alignItems: "baseline",
    padding: "0.3rem 0",
    "@media": {
      "screen and (max-width: 40rem)": {
        gridTemplateColumns: "1fr",
        gap: "0.1rem",
        paddingBottom: "0.6rem",
      },
    },
  }),

  mirrorKind: style({ color: vars.textSoft, fontWeight: 600 }),

  siteFooter: style({
    color: vars.textDim,
    textAlign: "center",
    padding: "2rem 0",
    fontSize: "0.85em",
  }),
} as const;

globalStyle(`${readme} > :first-child`, { marginTop: 0 });
globalStyle(`${readme} > :last-child`, { marginBottom: 0 });

globalStyle(
  `${readme} h1, ${readme} h2, ${readme} h3, ${readme} h4, ${readme} h5, ${readme} h6`,
  {
    fontWeight: 600,
    lineHeight: 1.25,
    margin: "1.5rem 0 0.75rem",
  },
);

globalStyle(`${readme} h1`, { fontSize: "1.5rem" });
globalStyle(`${readme} h2`, { fontSize: "1.25rem" });
globalStyle(`${readme} h3`, { fontSize: "1.05rem" });
globalStyle(`${readme} h4, ${readme} h5, ${readme} h6`, {
  fontSize: "0.95rem",
  color: vars.textSoft,
});

globalStyle(`${readme} h1, ${readme} h2`, {
  paddingBottom: "0.3rem",
  borderBottom: `1px solid ${vars.border}`,
});

globalStyle(`${readme} p`, { margin: "0.75rem 0" });

globalStyle(`${readme} code`, {
  background: vars.surfaceHi,
  padding: "0.12em 0.35em",
  borderRadius: 0,
  fontSize: "0.9em",
});

globalStyle(`${readme} pre`, {
  margin: "0.75rem 0",
  padding: "0.75rem 1rem",
  background: vars.bgDeep,
  border: `1px solid ${vars.border}`,
  borderRadius: vars.radius,
  overflowX: "auto",
});

globalStyle(`${readme} pre code`, {
  background: "none",
  padding: 0,
  borderRadius: 0,
  fontSize: "0.85rem",
  color: vars.textSoft,
});

globalStyle(`${readme} blockquote`, {
  margin: "0.75rem 0",
  padding: "0.1rem 0 0.1rem 1rem",
  borderLeft: `3px solid ${vars.border}`,
  color: vars.textMuted,
});

globalStyle(`${readme} ul, ${readme} ol`, {
  margin: "0.75rem 0",
  paddingLeft: "1.5rem",
});

globalStyle(`${readme} li`, { margin: "0.25rem 0" });

globalStyle(`${readme} li > input[type="checkbox"]`, {
  marginRight: "0.35rem",
});

globalStyle(`${readme} hr`, {
  border: 0,
  borderTop: `1px solid ${vars.border}`,
  margin: "1.5rem 0",
});

globalStyle(`${readme} img`, {
  maxWidth: "100%",
  verticalAlign: "middle",
});

globalStyle(`${readme} table`, {
  display: "block",
  width: "max-content",
  maxWidth: "100%",
  overflowX: "auto",
  margin: "0.75rem 0",
});

globalStyle(`${readme} th[data-align="center"], ${readme} td[data-align="center"]`, {
  textAlign: "center",
});

globalStyle(`${readme} th[data-align="right"], ${readme} td[data-align="right"]`, {
  textAlign: "right",
});

globalStyle(`${readme} del`, { color: vars.textDim });

export type Classes = typeof classes;
