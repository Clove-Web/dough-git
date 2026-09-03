# dough-git

A minimal self-hosted git forge: HTTP clone/pull/push, a cgit-style read-only
viewer, per-user access tokens, and PocketID (OIDC) for browser login. About
6k lines of TypeScript, four runtime dependencies, one SQLite file, and a
directory of bare repositories that is the whole of your state.

It is a **mirror and a backup target** first. There are no issues, no pull
requests and no CI — the things it does have are the things a backup of your
work actually needs: it stores every ref you push, it tells you when a copy on
GitHub or Codeberg has drifted, and it does not lose a repository you delete by
accident.

## Quick start

```sh
cp .env.example .env      # fill in OIDC_* and SESSION_SECRET at minimum
docker compose up -d
```

`compose.yml` binds to `127.0.0.1:4010` and expects a reverse proxy in front of
it for TLS. Your bare repositories live in `./data/repos`; back that directory
up and you have backed up the forge.

Without Docker:

```sh
npm ci
npm run build
npm start
```

Node 22+ is required — the token store uses the built-in `node:sqlite`, so
there is no native module to compile.

| Command | What it does |
| --- | --- |
| `npm run build` | Compiles the Vanilla Extract styles and bundles the server to `dist/` |
| `npm start` | Runs `dist/server.js` |
| `npm run dev` | Build, then start |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Runs every file in `test/` |

## How it is put together

The single most useful thing to know is where the line between the filesystem
and the database falls, because everything else follows from it.

**The filesystem is authoritative for what exists and who may see it.** A
repository is a directory, `<repos>/<owner>/<name>.git`. It is public if it
contains a marker file (`minigit-public` by default) and private if it does
not. A deleted repository is a directory that has been moved to
`<repos>/.trash/`. You can inspect, back up, and repair all of this with `ls`
and `mv`.

**SQLite holds identity, grants, and caches.** The user directory (OIDC `sub`
to a stable owner slug), token hashes, collaborator grants, per-account
settings, and the mirror-status cache. Every one of these describes a
repository the filesystem already says exists — none of them can conjure one.
When a repository goes away its rows go with it, through the single function in
`src/repometa.ts`.

| File | Responsibility |
| --- | --- |
| `server.ts` | Routes, middleware, authorization decisions |
| `git.ts` | Every shell-out to git; repo names, trash, refs, trees, blobs |
| `smart-http.ts` | The git transport (`upload-pack` / `receive-pack`) |
| `auth.ts` | OIDC login, signed session cookies, Basic-auth for git |
| `access.ts` | Who may read and write a repository |
| `urls.ts` | Validation of every URL that reaches git or `fetch()` |
| `markdown.ts` | An escape-first README renderer |
| `views.ts` | HTML |
| `styles/` | Vanilla Extract, compiled to one static stylesheet at build time |

## Authentication

Browser login is PocketID over OIDC with PKCE. The resulting session is a
stateless HMAC-signed cookie — there is no server-side session store — and the
account is recorded in the user directory so its **owner slug** is stable and
unique. That slug is the identity everything else is keyed by.

Git over HTTP uses Basic auth, where the password is a token minted in the
browser at `/settings/tokens` and the username is the slug that token belongs
to. Only hashes are stored; the plaintext is shown once. There is no
instance-wide credential: a token is always somebody in particular.

```sh
git clone https://<slug>:<token>@git.example.com/<owner>/<repo>.git
```

A token may push to repositories under its own slug, and to any repository
where its account was granted `write` as a collaborator. Pushing to a name that
does not exist yet creates it, unless `MINIGIT_AUTO_CREATE=false`.

## Profile READMEs and the `+` namespace

A repository named **`+dough`** is special: its `README.md` is rendered on its
owner's profile page at `/<owner>`. It is an ordinary repository in every other
respect — clone it, push to it, make it private, delete it — it is simply
hidden from repository listings, because it is the page you are already
looking at.

```sh
git clone https://git.example.com/clove/+dough.git
cd +dough && $EDITOR README.md
git commit -am "profile" && git push
```

Or press the button on your own profile page, which creates it for you.

The leading `+` is a reserved namespace. Every `+` name is refused as a
repository except that one, which buys two things: route segments like
`/<owner>/+repos` (the full repository list) can never collide with a real
repository, and the profile repo cannot be squatted or created by accident. The
rule lives in `safeName()` in `src/git.ts`; the name itself is the
`PROFILE_REPO` constant beside it.

## Security notes

The recurring approach here is an allow-list rather than a sanitiser, so that
the unsafe cases are the ones that were never constructed:

- **README rendering** escapes every character *before* producing any markup and
  parks generated HTML in a stash. Raw HTML in the source is dropped, not
  filtered, and link schemes are allow-listed. Injection is prevented by
  construction rather than by a sanitiser keeping step with a parser.
- **Outbound URLs** (mirror links, the Discord webhook) are checked against a
  fixed list of exact hosts, and the stored URL is rebuilt from validated parts
  rather than passed through. A mirror URL reaches the git binary as a remote,
  where `ext::` would run a shell command; a webhook URL reaches `fetch()`,
  where an arbitrary host is an SSRF probe.
- **Outbound git** runs with `protocol.allow=never` (plus https), no credential
  helper, no redirects, an empty config environment, a timeout and an output
  cap.
- **Repository names** are validated in one place, and `..`, dotfiles and path
  separators are refused. The trash root, the static handler and the repo root
  each re-check that a resolved path stayed inside them.
- Sessions are signed and compared in constant time. CSP, CSRF same-origin
  checks, `nosniff`, `X-Frame-Options` and HSTS are applied to everything except
  the git transport, which is authenticated by token instead.

`git ls-remote` against a mirror is a **monitor, not a synchroniser**: nothing
in this application pushes to, fetches from, creates or deletes anything on a
remote.

## Configuration

Everything is environment variables, read once at startup by `src/config.ts`.
See [`.env.example`](.env.example), which documents each one. The values you
must set are `MINIGIT_BASE_URL`, `SESSION_SECRET`, and the `OIDC_*` group.

## Licence

[Doughmination Authorised Source Licence 1.1](LICENCE.md).
