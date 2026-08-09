/* Component classes. Each is a generated, scoped class name (zero runtime).
 * Imported as a single `classes` object by the HTML views.
 */

import { style } from "@vanilla-extract/css";
import { vars } from "./theme.css";

export const classes = {
  siteHeader: style({
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "0.75rem 1.25rem",
    borderBottom: `1px solid ${vars.border}`,
    background: vars.bgRaised,
  }),

  siteTitle: style({
    fontWeight: 700,
    fontSize: "1.1rem",
    color: vars.text,
  }),

  siteNav: style({
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
  }),

  navLink: style({ color: vars.accent }),

  user: style({ color: vars.textMuted }),

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

  empty: style({ color: vars.textDim }),

  siteFooter: style({
    color: vars.textDim,
    textAlign: "center",
    padding: "2rem 0",
    fontSize: "0.85em",
  }),
} as const;

export type Classes = typeof classes;
