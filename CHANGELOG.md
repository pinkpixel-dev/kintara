# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [1.7.0] - 2026-08-21

### 🔐 Private libraries

- Every library and document now has an owner. Existing NAS content belongs to the
  installation owner, scanned files continue to belong to that owner, and browser
  uploads belong to the person who uploaded them.
- Library owners can share a library with an existing Kintara user as a viewer or editor.
  Viewers can read its documents. Editors can also manage its documents and collections.
  Only the document owner can delete the file from Kintara.
- Document lists, search, Recent, Favorites, files, covers, annotations, tags, and AI
  routes now apply the requesting user's access before returning or changing data.

### 🗂️ Sidebar

- The sidebar now separates `My Libraries` from `Shared With Me`. Both groups and each
  library are collapsible, and their open state stays on the current device.
- New accounts start without an automatic library. The user can create one from the
  sidebar, while existing content remains with the installation owner.
- Shared library rows show the owner's GitHub username. Viewer rows do not show import,
  filing, collection settings, or sharing controls.

### 🧪 Tests

- Added real SQLite and Axum tests for private library isolation, same-name libraries,
  viewer and editor permissions, permanent-delete protection, and access revocation.
- Verified the sidebar and sharing modal against an isolated local server at 320px,
  375px, 414px, 768px, and desktop widths. The browser reported no console errors or
  horizontal overflow.

### 🏷️ Versioning

- Bumped Kintara from 1.6.0 to 1.7.0 for private libraries and explicit sharing.

## [1.6.0] - 2026-08-21

### 🤖 AI

- Added optional document summarization through OpenAI Responses and Google Interactions.
  Before anything leaves the NAS, Kintara shows the provider, model, approximate input
  tokens, and asks for confirmation. Provider storage is disabled on every request.
- Added per-user AI settings with the approved model lists and model-specific controls.
  OpenAI temperature appears only when reasoning is off; Google receives thinking level
  but no unsupported temperature field.
- Provider keys can be saved, replaced, or removed in Settings. They are encrypted before
  entering SQLite and never returned to the browser. Token usage is recorded per user.

### 🔐 Access

- Replaced password login with GitHub OAuth. The first GitHub identity claims the owner;
  admins invite later users by GitHub username. GitHub tokens are not stored, and Kintara
  issues its own HTTP-only sessions after identity verification.
- Added a local `recover-owner` operator command that can relink the owner and revoke all
  sessions without adding a second login path.

### 🔎 Documents

- PDF, Markdown, and text documents now receive searchable extracted text during scans.
  PDF text is also stored by page for future citations. Missing poppler, image-only PDFs,
  and oversized text are recorded explicitly instead of blocking indexing.
- Existing unchanged documents are backfilled during a scan when they have no extraction
  timestamp, so upgrades do not require a destructive reindex.

### 🏷️ Versioning

- Bumped Kintara from 1.5.0 to 1.6.0 for the new user-facing auth, AI settings, and
  summarization workflows.

## [1.5.0] - 2026-08-21
### Added
- **The empty grid now says what emptied it.** It used to read "No documents found in this
  view" whether you were looking at a library with nothing in it, a search that matched
  nothing, an unopened Recent list, or an empty Favorites. Those want different words and,
  more importantly, different next steps. A scoped search that found nothing now names the
  scope — "No matches in Infrastructure" — and offers **Search everywhere**, which keeps
  the query and drops the scope. An empty library or collection offers **Import a
  document**. This mattered most on a phone, where the scope chip lives inside the drawer:
  a search with no results looked exactly like a library that had lost its contents, with
  the only explanation off-screen.
- **`npm test` runs the frontend tests too.** There were none before. The new
  `apps/web/test` suite covers the empty-grid logic and needs no test framework — Node 22
  strips the types itself — so this adds no dependency. `npm run test:web` and
  `npm run test:server` run each half on its own.
- **`npm run check:css` fails on a class name no stylesheet defines.** This project does
  not run Tailwind, and a utility-looking class that was never defined here fails silently:
  it reads as correct in review and does nothing in the browser. Five real layout bugs have
  started that way. The checker understands both `className="…"` and the template-literal
  form with conditionals in it, which the ad-hoc script in `ERRORS.md` did not.

### Fixed
- **The welcome screen had no padding and never showed its three columns.** It was built
  from `p-10`, `p-5` and `grid grid-cols-1 md:grid-cols-3 gap-6`, none of which this
  project defines, so the text ran to the edges of the panel and the feature cards stacked
  in a single column at every width including desktop.
- **The keyboard shortcuts in Help were the same bug.** `grid grid-cols-1 md:grid-cols-2`
  is undefined here, so six shortcuts listed in one long column instead of two, and `p-2`
  left each row's label and key flush against the fill behind them.
- **A favourited document's star was never drawn filled.** `fill-current` is used in three
  places and defined in none, so the favourited and unfavourited stars rendered
  identically. On a card the state was still legible from the separate corner marker; in
  the reader's action bar it was not visible at all.
- **Destructive buttons were drawn like ordinary ones.** Delete in the confirm dialog and
  Remove in the import dialog both asked for `text-red-400 hover:text-red-500
  hover:bg-red-500/10`, and none of those three exist here.
- **Settings controls no longer sit in a ragged column.** The four selects asked for `w-32`
  and got nothing, so each one sized itself to its longest option.
- **Three icon-only close buttons had no accessible name.** Settings, Library Settings and
  Help each closed with a bare ✕ that a screen reader announced as "button". The tag
  remove button in the details panel had the same gap.
- **Touch targets no longer shrink below 44px at the Small interface size.** The new
  tap-target floors were written in `rem`, and the root font size is scaled by
  `--ui-scale`, so they measured 39px at the default size — smallest exactly where someone
  has asked for a more compact interface. They are absolute pixels now.
- **The "new library" + is reachable on touch.** It was written as `opacity-0
  group-hover:opacity-100` — a Tailwind mechanism this project does not have — so it has in
  fact always been visible. It now follows the same contract as the row actions: hover on a
  pointer device, permanent on touch, revealed by keyboard focus.

### Changed
- **The fonts are self-hosted.** They were the last thing loaded from a CDN at runtime,
  which on an offline or firewalled NAS meant the app silently fell back to system fonts.
  The six families the app actually offers now ship as woff2 in `apps/web/public/fonts`.
  Trimming this down mattered: `index.html` was pulling **seven** families, one of them
  (Life Savers) referenced nowhere in the app, at full 100–900 variable ranges plus
  italics. Vendoring only the latin and latin-ext subsets at the weights actually rendered
  brings it to **509 KB across 22 faces**, against 1,218 KB for the naive copy of what was
  being requested. `scripts/vendor-fonts.py` regenerates it.
- **Roughly 80 undefined utility classes are gone.** Every one has either become a named
  rule — `.modal-close`, `.dialog-title`, `.empty-state`, `.reader-tab`, `.cover-picker`,
  the `.sidebar-*` and `.onboarding-*` families — or been deleted as dead. `npm run
  check:css` now reports zero. Notably, one close-button class string had been copy-pasted
  verbatim into eight components, and three of its classes did not exist.

### Removed
- **The two decorative blurred orbs behind the welcome screen.** `blur-[100px]`, `w-64` and
  `-top-32` are all undefined, so they have only ever rendered as zero-size invisible divs.
  Implementing them rather than deleting them would have meant adding a glow effect the
  project's design rules rule out.

## [1.4.1] - 2026-08-21
### Security
- **pdf.js upgraded from 5.7.284 to 6.2.108** (CVE-2026-16633, GHSA-hq66-cqwq-w95j —
  arbitrary JavaScript execution from a malicious PDF). 5.7.284 was the last 5.x release,
  so there was no backport and the fix required the major bump.

  **Kintara was not exposed.** The advisory is about the `enableScripting` option in the
  pdf.js *viewer*; this app uses only the raw API — `getDocument` and `page.render` onto a
  canvas — with no `PDFViewer`, no scripting manager, and no annotation layer. `pdf.sandbox`
  ships inside the package but was never bundled, and PDF JavaScript cannot execute without
  it. The upgrade was done to clear the advisory rather than to close a reachable hole.

  Verified rather than assumed: page 1 of a 67-page magazine whose images are *entirely*
  JPEG 2000 renders **pixel-identically** before and after — zero differing pixels across
  the frame. That fixture was chosen deliberately, because a broken wasm path makes pdf.js
  drop photographs while still drawing the text, which looks like nothing went wrong. Also
  checked: pages 2–4, an ordinary DCTDecode document, and drawing, page-scoping, persisting
  and deleting a highlight.


## [1.4.0] - 2026-08-21
### Added
- **Pick an accent colour.** Eight of them, in Settings under Appearance: red, orange,
  yellow, green, blue, cyan, purple, pink. Purple is the Pink Pixel brand purple and stays
  the default, so anyone who never opens the setting sees exactly the app they had. Each
  accent carries a separate light-theme and dark-theme value, because a colour that reads
  well on white is usually too weak on near-black. Yellow and cyan also carry their own
  text colour: every other accent is dark enough to put white on, and a yellow sidebar row
  with white text on it cannot be read. Every pairing clears 4.5:1.
- **Move a document straight from its card.** The action existed in the reader and in the
  file dialog but not on the cards, which is where you are actually looking when you decide
  something is in the wrong place. Same two-way Move and Add as everywhere else, and Move
  still only appears when there is a library or collection to take it out of.
- **Import several documents at once.** Selecting more than one file in the import picker
  opens a batch flow instead of the single-document one. It asks where the whole batch
  should go before uploading anything — forty title fields is not a form anyone fills in —
  then uploads them one at a time with a progress count and a running list. A file the
  server rejects does not stop the batch; it is listed at the end with the reason. There is
  no second Import button to learn: picking one file behaves exactly as it did.
- **A reader overflow menu below 640px.** The reader's five actions were hidden entirely at
  phone widths, on the assumption that the details panel carried them, which it did not.
  They now collapse into one labelled menu rather than disappearing.

### Changed
- **The card's actions slide up from the bottom of the cover instead of sitting in its four
  corners.** Four corners left nowhere to put a fifth action, and covered the parts of the
  art that identify the document — on a book cover, usually the title. Now the cover stays
  clear until you reach for it: hover on a pointer, a kebab on touch, keyboard focus on
  either. Whether something is favourited still shows at rest, as a marker in the corner,
  since that is state you want to see without opening anything.
- **The Details panel is no longer a toggle in the header.** It opens from a document's own
  Show details action, on a card or in the reader, and closes from its own X. The toggle
  could open an empty panel that said "select a document", which is a control that does
  nothing most of the time; it also meant the panel's open state and its contents could
  disagree. The header slot it occupied is deliberately left free.

### Removed
- **The frozen Tauri desktop shell at `apps/desktop`.** It had not been built since 1.1.0
  and was kept "for reference", but the reference had gone stale in the worst way: it
  carried its own SQLite schema frozen at the pre-server single-user model — favourites and
  reading progress as columns on `documents`, no full-text index, no users or sessions — so
  reading it to understand how Kintara stores anything gave you the model this project
  deliberately left behind. Reviving it was never the route to a desktop build either; that
  route is a thin shell around the existing server binary, and it does not need the old
  crate. Its icon set moved to `assets/icons/`, and the code remains in git history. See
  `DOCS/MEMORY.md`.

### Fixed
- **The onboarding dialog's glow was pinned to the brand purple** rather than following the
  accent, so it stayed purple whatever else the app was set to.

## [1.3.0] - 2026-08-10
### Added
- **Document actions in the reader.** Details, favourite, move, download and delete now sit
  in the reader header. They existed on the library cards and stopped at the reader door,
  so favouriting something you were actually reading meant going back to the grid to find
  its card. Same set, same order, so the two surfaces agree. Hidden below 640px where the
  tab strip needs the room; the details panel carries them there.
- **Move or add a document to another library or collection.** Two actions rather than
  one, because libraries here are views over the documents rather than folders that own
  them — a document can sit in several at once. Move takes it out of the library or
  collection you are looking at; Add leaves it where it is. Move only appears when there is
  a scope to remove it from, so it can never silently do nothing from All Documents. The
  destination is added before the source is removed, which is the recoverable order to
  fail in.
- **Import straight into a library or collection.** The + on a library row now offers
  "Import a document here" or "New collection"; collections get their own +, which imports
  into that collection. The destination is preselected in the import dialog.
- **Create a library while importing.** The library picker has a "+ New library..." entry
  that names it inline, so wanting a new library no longer means cancelling the import to
  go and make one first.

### Changed
- **"Base Font Size" is now "Interface Size", and it moves everything.** The old setting
  only changed text: card columns were pinned at 140px and every icon carried a pixel size
  prop, so Small and Medium were indistinguishable and the control read as broken rather
  than subtle. One step now scales text, cards, icons, the logo, and the sidebar together —
  cards run 148px to 233px across the four steps. The PDF canvas is deliberately excluded
  so pages stay sharp; the reader has its own controls. An existing font size setting is
  carried over to the nearest step rather than reset.
- Interface Size sits under Appearance rather than Typography, since it moves considerably
  more than the type.

### Fixed
- **The + and gear on library rows were drawn half again as large as intended.** A blanket
  `.sidebar-item svg` rule forced every icon inside a row to 18px, including the disclosure
  chevron and the 12px row controls. The rule is now scoped to a row's own leading icon,
  and the controls render at the 14px they ask for.

## [1.2.1] - 2026-08-10
### Fixed
- **The import dialog changed size with every document and hid its own Save button.** The
  cover preview was sized with `w-1/3`, which this project's stylesheet does not define —
  it maintains its utility classes by hand rather than running Tailwind — so the frame
  collapsed onto the cover's natural pixel dimensions. A tall scan made a tall dialog, a
  wide one pushed the form out of the dialog entirely, and reaching Save meant scrolling
  sideways. The preview is now a fixed frame with the cover fitted inside it, so every
  import opens at the same size whatever shape the page is. Contained rather than cropped,
  because covers run from portrait pages to square product shots and filling the frame
  cuts off the part that identifies the document. Below 900px the frame goes landscape and
  sits above the form, keeping Save on screen without scrolling.
- **The sidebar's search icon sat on the edge of the input.** It was positioned with
  `left-4` and `top-2.5`, neither of which is defined either, so it fell back to
  `left: auto` at its static position. It now has real CSS, matching how the password
  field already positions its visibility toggle.

## [1.2.0] - 2026-08-10
### Added
- **Search runs inside whatever you are looking at.** Typing in a library or collection
  now searches that library or collection instead of quietly widening to the whole
  library. The server already combined `q` with `libraryId`/`collectionId`; the frontend
  was throwing the scope away as soon as you typed. Favourites scopes the same way.
  Recent deliberately does not — it is the last ten things, not a scope worth searching
  within, so a query there searches everything.
- **A scope chip under the search box** names what you are searching in, with a control
  that drops the scope and reruns the same query everywhere. It appears only once there
  is a query; before that the placeholder already says where the search will land. Both
  the placeholder and the chip are derived from the active view, so they cannot disagree
  with it.
- **Search matches tag names.** Title, author, keywords and summary were already indexed;
  tags were not, because they live in a joined table. A tag query is now unioned with the
  FTS results rather than denormalised into the index — the index cannot drift out of
  step with the tags table that way. Multi-word queries need every term to hit a tag, so
  `space opera` does not return everything tagged `space`.

### Changed
- Choosing a library, collection, or quick view clears the search box. Carrying a query
  across a view change would make the new view look empty for a reason that is off-screen
  on a phone. An empty query in a scoped view lists that whole library or collection, as
  it always has.

## [1.1.2] - 2026-08-10
### Fixed
- **The service worker cached the development bundle, so code changes never appeared.**
  It registered in development as well as production and served static assets cache-first.
  That is correct for a production build, where Vite content-hashes every filename, and
  actively harmful in development, where modules are served at stable URLs like
  `/src/App.tsx` — the first version fetched was then served forever. It now registers
  only in production, and in development actively unregisters any worker and clears any
  cache an earlier build left behind, so affected machines heal themselves on next load.
  The worker also skips Vite's `/@`, `/src/`, and `/node_modules/` paths as a backstop,
  and its cache version was bumped so installed copies replace themselves.
- **The tab close button rendered as a grey box instead of an X.** The old markup gave it
  no `border`, so the browser's default button border drew a rounded rectangle around the
  icon. The project has no global button reset, and every other button happens to set
  `border-none` explicitly. The `.tab-close` class now sets `border: none` and a
  transparent background. A scan of every button in the running app found no other case;
  the only remaining bordered button is the cover upload's dashed drop zone, which is
  deliberate.
- **The tab close button was also hard to see.** At `--text-muted` it sat around 4:1
  against the tab — legible in theory, easy to miss for a 14px glyph. It now uses
  `--text-secondary`.

## [1.1.1] - 2026-08-10
### Fixed
- **Tabs stayed open for documents that no longer exist.** Open tabs are client state, so
  a document removed from the library — deleted, or its file taken off the share and
  dropped by the scanner — left a tab behind that opened a reader for nothing. Tabs are
  now reconciled when the view changes, and a tab whose document returns a definite 404
  closes itself. A network error does not close anything.
- **The tab close button was a 20px target**, fiddly with a trackpad and unusable on
  touch. It is now 24px, and 40px on touch devices.

### Added
- Middle-click a tab to close it, matching browsers and editors. `Ctrl+W` already worked
  and still does.

## [1.1.0] - 2026-08-10
### Changed
- **Library and collection settings moved onto the sidebar rows.** Each library and
  collection now has its own gear, so renaming or deleting one no longer requires
  navigating into it first and finding a control in the header. The header gear is gone —
  it was easily mistaken for the app Settings in the sidebar footer, which uses the same
  icon and does something entirely different.
- Row actions are visible on hover and on keyboard focus, always visible on touch devices
  where there is no hover, and use larger tap targets there.

### Fixed
- Opening library or collection settings swallowed errors. An unhandled rejection in a
  click handler fails silently, so any failure looked like a button that does nothing.

## [1.0.5] - 2026-08-10
### Fixed
- **Edited author, summary, and keywords appeared to vanish after saving.** They were
  saved correctly — the server had them the whole time — but the details panel was showing
  a stale copy. When a document is opened in the reader and the panel is toggled from the
  header, it renders the open tab's document rather than one picked from a card, and only
  the latter was being refreshed after a save. Tags looked fine because they are fetched
  from the server on every open. No data was lost by this.

## [1.0.4] - 2026-08-10
### Fixed
- **"Name your first library" reappeared on every new device, and renamed the library you
  already had.** Onboarding is tracked in localStorage, which is per device, while
  libraries live on the server and are shared. A second browser, a second device, or
  cleared site data re-ran onboarding — and the handler renamed the first existing library
  to whatever was typed. It now asks the server what exists and only offers to name a
  library when the install is genuinely untouched.

### Added
- **Show/hide toggle on the password field**, on both the sign-in and first-run setup
  forms. Keyboard reachable and labelled for screen readers, with `aria-pressed` conveying
  its state and a tap target sized for a phone.

## [1.0.3] - 2026-08-10
### Fixed
- **Photographs were missing from PDFs.** Pages rendered their text, vector art, and links
  correctly and simply left the images blank. pdf.js 5 decodes JPEG 2000 and JBIG2 — the
  two codecs scanned magazines reach for most — through WebAssembly modules it fetches at
  runtime, and only `workerSrc` had been configured. Without `wasmUrl` the decode fails
  quietly, so it looks like missing pictures rather than an error.
  `cMapUrl` (CJK text), `standardFontDataUrl` (base-14 fonts), and `iccUrl` (colour
  profiles) were missing for the same reason and are now set too.
- A Vite plugin serves these assets from `node_modules` in development and copies them into
  the build, rather than vendoring 4 MB of binaries into the repository where they would
  drift out of step with the installed pdf.js.

## [1.0.2] - 2026-08-10
### Fixed
- **Uploading any real PDF failed** with "Error parsing `multipart/form-data` request". Axum
  applies a 2 MB body limit by default, and every document worth adding is bigger than that.
  The limit is now configurable via `KINTARA_MAX_UPLOAD_MB` and defaults to 1 GB. Every test
  had used a ~900-byte synthetic PDF, which is exactly why this was missed.
- **Uploads were buffered entirely in memory.** A 120 MB magazine meant 120 MB of RAM per
  upload, which a NAS does not have to spare. Uploads now stream to disk while hashing;
  server memory stayed flat at 19 MB across a 122 MB upload. Failed and rejected uploads
  clean up after themselves.
- **The scanner also read whole files into memory** to hash them, so scanning a library of
  magazines loaded each one in turn. It now hashes in 128 KB chunks.
- **NAS metadata directories were indexed as documents.** `@eaDir`, `#recycle`,
  `#snapshot`, `lost+found`, and `$RECYCLE.BIN` are now skipped, along with any dot
  directory, so Synology thumbnails and deleted files no longer fill the library.

### Added
- `npm run dev` at the repository root now starts the API and the frontend together. Running
  only the frontend produced a wall of `ECONNREFUSED` proxy errors and an app that looked
  broken for no visible reason.
- The app shows **"Can't reach the Kintara server"** with a retry button when the API does
  not answer, instead of rendering an empty library with a dead Save button.
- `KINTARA_MAX_UPLOAD_MB` (default 1024) caps upload size. Covers are separately capped at
  32 MB.

## [1.0.1] - 2026-08-10
### Fixed
- **The Save button did nothing in the welcome flow and when creating a library.** The Vite
  dev server had no `/api` proxy, so in development every API call hit Vite, which answers
  unknown paths with `index.html`. The client saw `200 text/html`, tried to parse it as
  JSON, and threw — leaving the dialog open with no explanation. `vite.config.ts` now
  proxies `/api` to the server (override with `KINTARA_DEV_API`). Production builds were
  never affected, since the server serves both.
- **A failed save left dialogs open and silent**, which reads as a dead button. The library
  prompt and the library settings modal now show the error and re-enable the button.
- **The API client threw a raw `SyntaxError` when a response was not JSON.** It now reports
  that the API did not answer, rather than surfacing "Unexpected token '<'" from inside a
  component.
- **The default library was created twice on startup.** `loadData` both reads and writes,
  and React invokes effects twice in development, so two overlapping calls each saw an
  empty list and both posted — producing a 409 and, depending on timing, an empty sidebar.
  Creation is now deduplicated.
- Finishing onboarding with no library present silently did nothing. It now creates the
  library instead of giving up.

## [1.0.0] - 2026-08-10
The server-first rewrite is complete. Kintara is a self-hosted document library that runs
in Docker on a NAS, watches a folder you already drop PDFs into, and is read through the
browser on any device.

### Added
- **Library scanner.** A startup sweep plus a live filesystem watcher, so files copied
  onto the share over SMB appear without touching the app. Handles new files, edits,
  deletions, and renames. A rename keeps the document's id, so reading progress and
  highlights survive it. Identical content under two names is indexed once.
  Non-documents, dotfiles, and half-written `.part` files are ignored.
- **Authentication.** First run asks for a username and password; after that the API
  requires a session. Passwords are argon2-hashed, sessions live in the database so
  logging out actually revokes access, and the cookie is HttpOnly and SameSite=Lax.
  Setup reuses the seeded account, so anything indexed before you set a password keeps
  its reading state.
- **Docker image.** Multi-stage build with cargo-chef dependency caching, poppler in the
  runtime, non-root execution, and PUID/PGID remapping so files land with an ownership
  your NAS agrees with. Separate `/library` and `/data` volumes, because SQLite on an SMB
  or NFS mount corrupts. A healthcheck that runs a real query rather than probing a port.
- **Multi-arch publishing** for `linux/amd64` and `linux/arm64` via GitHub Actions, plus
  a `docker-compose.yml` ready to edit.
- **PWA.** Installable on desktop and phone, with a manifest, icons, and a service worker
  that caches the app shell so Kintara opens instantly. The API is deliberately never
  cached — a stale library listing is worse than none.
- **30 more tests**, covering scanning, rescanning, deletion, renames, duplicate content,
  reindexing without clobbering hand-corrected metadata, setup, login, logout, session
  expiry, and forged cookies. 106 total.

### Fixed
- **The sign-in screen rendered in light theme and flipped to dark after signing in.**
  `AuthGate` mounts before `App`, which was where settings were applied. Theming now
  happens before the first render, which also removes the flash the app itself had.
- `favicon.png` was a 989 KB image served on every load. It and the sidebar logo are now
  8 KB and 20 KB.

### Changed
- `CurrentUser` resolves from the session cookie. Handlers were written against that
  extractor from the start, so adding authentication changed one function rather than
  every route. While no password is set it falls back to the owner account, so a first
  run can scan and reach the setup screen.
- `KINTARA_SCAN_ON_START` and `KINTARA_WATCH` control the scanner. Worth turning the
  watcher off on shares that do not report filesystem events.

### Known issues
- **Fonts are still loaded from Google Fonts**, in `App.css` and `index.html`. On a NAS
  with no outbound access they fall back to system fonts — the app works, it just looks
  wrong. This is the last external dependency.
- The PDF reader has no pinch-zoom or swipe paging. It is usable on a phone but not yet
  pleasant.
- The Docker image is unbuilt: no daemon was running in the environment where it was
  written. Everything else here was verified end to end.

## [0.10.0] - 2026-08-10
### Added
- **Kintara runs in a browser.** The frontend now talks to the server over HTTP and has no
  Tauri dependency at all. Verified end to end: a PDF uploads, gets its metadata and cover
  extracted, appears in the grid, and renders in a browser tab with working page controls.
- **`apps/web/src/api/`** replaces `db.ts`. The client no longer runs SQL — it calls the
  API, which means a browser tab can no longer issue arbitrary queries against the library.
- **Download button** on every document card. On a NAS the point is getting a copy onto the
  device you are actually reading on.
- **`ConfirmDialog`** replaces the desktop build's native `ask()` dialogs, with a focus
  trap, Escape to dismiss, and initial focus on Cancel so a stray Enter never deletes
  anything.
- **Responsive layout.** Below 900px both side panels become overlay drawers with a
  tap-to-dismiss scrim, instead of fixed columns that pushed the reader off screen.
- **Settings moved to localStorage**, per device. A phone and a desktop genuinely want
  different font sizes, and reading them synchronously means the theme is applied before
  first paint rather than flashing.

### Fixed
- **The pdf.js worker was loaded from unpkg**, so PDFs would not render at all on an
  offline or firewalled NAS. It is now bundled by Vite and served from the app itself.
- **Horizontal overflow at every mobile width.** `.app-container` used `width: 100vw` with
  two fixed-width side panels, which at 375px was wider than the screen. Now `100%` with
  drawers, verified clean at 320px, 375px, and desktop.
- **PDF highlights drifted once the canvas was scaled.** Highlight boxes were positioned in
  raw canvas pixels, which stopped matching the page as soon as the canvas shrank to fit a
  phone. Coordinates are now converted through the display scale in both directions.
- **The overlay actions on document cards were hover-only**, making them unreachable on
  touch and invisible to keyboard users. They are now always visible on touch devices,
  revealed on keyboard focus, and have larger tap targets on touch.
- **`.hidden` was never defined**, so the file inputs behind the Import buttons rendered as
  visible "Choose File" controls.
- **The sidebar logo had been broken since before the rewrite** — it referenced
  `/logo.png`, which has never existed in `public/`. A 20 KB version now ships there,
  down from the 1 MB original.
- `100vh` replaced with `100dvh`, so the bottom of the app is not hidden under mobile
  browser chrome.

### Changed
- Every library view is now one endpoint with different filters, rather than a separate
  query per view.
- Adding a tag no longer fetches every tag first to look for a match — the server dedupes.
- Refreshing a document's details fetches that one document instead of listing the library.
- `App.tsx` split: tab and split-view state moved to a `useDocumentTabs` hook and the tab
  strip to a `TabBar` component, keeping every file under 500 lines.
- Cleared metadata fields are sent as null rather than empty strings, so the server clears
  them instead of storing blanks.

## [0.9.0] - 2026-08-10
### Added
- **Document write API.** `POST /api/documents` (multipart upload),
  `PATCH /api/documents/{id}` (metadata), `DELETE /api/documents/{id}`,
  `PUT /api/documents/{id}/progress`, `PUT /api/documents/{id}/favorite`.
- **Libraries, collections, and tags.** Full CRUD plus membership endpoints, each returning
  a `documentCount` so the sidebar renders without a request per row. Deleting a library
  removes the library and its collections but never the documents — a library is a view
  over documents, not a container that owns them.
- **Annotations.** `POST /api/annotations`, `DELETE /api/annotations/{id}`, and
  `GET /api/documents/{id}/annotations`, all scoped to the requesting user. The position
  blob is opaque to the server and round-trips byte-identical, so the Markdown reader's
  text offsets and the PDF reader's bounding boxes both work unchanged.
- **Metadata extraction and thumbnails** (`media.rs`). Uploaded PDFs get their title,
  author, keywords, page count, and year read via `pdfinfo`, and a cover rendered via
  `pdftoppm`. Poppler is used rather than a native crate because pdfium means shipping a
  shared library and the mupdf bindings are AGPL, which conflicts with this project's
  Apache-2.0 licence. The same module will serve the filesystem scanner, so a document is
  treated identically however it arrives.
- **Upload safety.** Filenames are stripped of directory components, so
  `../../../etc/passwd.pdf` lands in the library root as `passwd.pdf`. Content is hashed
  with blake3, so the same file uploaded twice is a 409 rather than a duplicate entry.
  Two genuinely different documents may still share a filename — the second becomes
  `name (2).pdf` rather than failing or overwriting.
- **48 new tests** covering uploads, deduplication, filename collisions, metadata edits,
  progress and favourites, deletion, library and collection CRUD, tag attachment, and
  annotation user-scoping.

### Fixed
- **Patch fields could not be cleared.** `#[serde(default)]` on `Option<Option<T>>`
  collapses a JSON `null` into `None`, making "clear this field" indistinguishable from
  "leave it alone", so clearing an author silently did nothing. A `double_option`
  deserializer now keeps absent, null, and value apart.
- **The year was never extracted from PDF metadata.** The `CreationDate` parser took the
  last whitespace token, but real poppler output ends with a timezone
  (`Sun Jun 11 20:00:00 2017 EDT`), so it parsed `EDT` and gave up. It now scans for the
  first plausible four-digit year. Found by testing against real poppler output rather
  than the hand-written sample the unit test used.
- Unique constraint violations now return 409 with a readable message instead of a 500.
- Referencing a missing library or document returns 404 rather than surfacing a raw
  foreign key error.

### Changed
- Creating a tag that already exists returns the existing tag with a 200 instead of a
  conflict. Tagging is a high-frequency free-text action, so a repeat is expected input.
- `DELETE /api/documents/{id}` removes the file from the library as well as the row.
  Removing only the row would let the scanner re-index it, making delete look broken.

## [0.8.0] - 2026-08-10
### Added
- **Document read API.**
  - `GET /api/documents` — paged listing with FTS5 search (`q`), filters
    (`libraryId`, `collectionId`, `tagId`, `favorite`), and sorting
    (`recent`, `added`, `title`, `author`, `year`). Returns `{ items, total, limit, offset }`
    with `limit` clamped to 200 so one request cannot pull an entire library.
  - `GET /api/documents/{id}` — single document.
  - `GET /api/documents/{id}/file` — the document itself, served with Range support.
  - `GET /api/documents/{id}/download` — same bytes with `Content-Disposition: attachment`.
  - `GET /api/documents/{id}/thumbnail` — generated thumbnail, cacheable for a week.
- **Range request support** on document serving. pdf.js fetches PDFs in chunks, so without
  it every page turn re-downloads the whole document and a 200 MB scan means a 200 MB
  allocation per reader. Verified end to end: two range-fetched halves of a real PDF
  reassemble into a valid file.
- **Local user** (migration 0002). Reading progress, favourites, and annotations are keyed
  by user, so reads need one before sessions exist. Seeded with an empty password hash,
  which argon2 can never verify against, so the account cannot be logged into until a
  password is set in the auth step.
- **34 new tests** covering listing, paging, clamping, search, filters, sorting, content
  types, Range (exact bytes, open-ended, suffix, unsatisfiable), downloads with non-ASCII
  filenames, path traversal, and missing files.

### Security
- **Documents are resolved against the library root and confined to it.** Paths are
  rejected up front for `..` and absolute components, then the canonicalised result is
  confirmed to still live under the root, which is what catches symlinks pointing at
  `/etc/shadow`. A row hand-edited to `../outside.txt` is not served.
- **The wire format never exposes `relative_path`.** Clients address documents by id;
  publishing filesystem layout to every browser tab leaks the shape of the NAS. Asserted
  in tests.
- Internal errors are logged, never returned. Clients get `not found` or
  `internal server error`.

### Changed
- Compression is now scoped structurally rather than applied globally: JSON responses and
  the static bundle are gzipped, document bytes never are. Gzipping a PDF burns NAS CPU for
  almost nothing, and compressing a 206 range response is simply wrong.
- Free-text search sanitises input into a quoted FTS5 expression with a prefix wildcard on
  the final token. Raw FTS5 treats `"`, `*`, `-`, `(`, and `AND` as syntax, so searching
  for `C++` would otherwise return a 500. An unusable query returns no results rather than
  silently listing the whole library.

## [0.7.0] - 2026-08-10
### Added
- **`kintara-server`** — new Rust/Axum backend in `apps/server/`. Runs, serves the built
  frontend, applies its own migrations, and answers `GET /api/health` with a live document
  count (which doubles as a container healthcheck, since it proves the database is reachable).
- **Server schema (migration 0001).** Ported from the desktop migrations with four
  deliberate changes for multi-user, containerised operation:
  - `documents.relative_path` replaces the desktop's absolute `file_path`, so the library
    volume can be remounted anywhere without invalidating every row.
  - `reading_progress` and `is_favorite` move off `documents` into `user_document_state`,
    keyed by `(user_id, document_id)`. `annotations` gains a `user_id`.
  - `documents` gains `file_hash`, `file_size`, and `indexed_at` for the incoming scanner.
  - Search is backed by an FTS5 external-content table with sync triggers, replacing the
    desktop's `LIKE '%term%'` full scan.
- **Configuration via environment** — `KINTARA_LIBRARY_DIR`, `KINTARA_DATA_DIR`,
  `KINTARA_WEB_DIR`, `KINTARA_BIND`, `KINTARA_LOG`. Defaults are relative so `cargo run`
  works with no setup; the container overrides them with absolute paths. The database
  deliberately lives under the data directory, never the library share, because SQLite
  over SMB/NFS corrupts.
- **Graceful SIGTERM shutdown**, so `docker stop` does not wait out the kill timeout.
- **12 integration tests** covering migrations, WAL and foreign-key enforcement on pool
  connections, cascade deletes, the `annotation_type` CHECK constraint, `relative_path`
  uniqueness, FTS insert/update/delete sync, and HTTP routing. They run against real
  SQLite files and the real router — no mocks.

### Fixed
- Unmatched `/api/*` routes returned the SPA `index.html` with a 200 instead of a JSON
  404, which would have made every client-side fetch bug look like an HTML-parsed-as-JSON
  error. Caught by the test written for it.

### Notes
- `apps/desktop/` stays pinned at 0.6.2. It is frozen, so its version reflects where it
  froze rather than tracking the server.

## [0.6.2] - 2026-08-10
### Changed
- **Repository restructured as a monorepo** in preparation for the server-first rewrite.
  `src/` moved to `apps/web/src/`, `src-tauri/` moved to `apps/desktop/`, and new empty
  `apps/server/` and `docker/` directories were added for the incoming Rust backend.
- Frontend is now an npm workspace (`@kintara/web`). The root `package.json` is the
  version source of truth and delegates `dev`, `build`, and `preview` to the workspace.
- Documentation moved into `DOCS/` (`OVERVIEW.md`, `ROADMAP.md`, `to-do.md`).
  `README.md`, `CHANGELOG.md`, and `LICENSE` remain at the repository root.
- Brand source images (`icon.png`, `logo.png`) moved to `assets/` so they are not
  copied into the web bundle.
- **Version fields reconciled.** `package.json`, `tauri.conf.json`, and `Cargo.toml`
  had drifted to `0.1.0` while the changelog had advanced to `0.6.1`. All now read `0.6.2`.
- Desktop crate renamed from `tauri-app` to `kintara-desktop`, with real author and
  description metadata.

### Removed
- `.github/workflows/build-windows.yml` — it built the now-frozen desktop shell. A
  multi-arch Docker workflow replaces it once the server exists.

### Notes
- No application logic changed in this release. The frontend still talks to Tauri and
  still builds; `apps/desktop/` is retained but frozen and not wired into any build.

## [0.6.1] - 2026-05-27
### Added
- **Highlight Color Picker** — new Highlights section in Settings lets users choose from 8 preset colors (Purple, Yellow, Green, Blue, Pink, Orange, Teal, Red) for text and PDF highlights.
- **Remove Highlights** — clicking any highlighted text in the Markdown reader removes that highlight immediately. Clicking a PDF highlight box also removes it (with fade hover feedback).
- `annotationService.delete(id)` method added to the DB service layer.

### Changed
- **Removed highlight confirmation dialog** — selecting text no longer shows a native `ask()` popup; highlights are applied instantly on mouse-up for a much smoother reading experience.
- Highlight color is now stored as a CSS custom property (`--highlight-color`) on `<html>` and applied on both app startup and whenever settings change, so both readers always use the user's chosen color.
- Markdown reader hint text updated to: "Select text to highlight · Click a highlight to remove it".
- PDF highlights now dim on hover to signal they are clickable/removable.

## [0.6.0] - 2026-05-27
### Added
- **Library Settings Modal** — clicking the ⚙ icon in the header when a library or collection is active opens a dedicated settings panel for renaming, deleting, and (for libraries) choosing a custom icon and icon color.
- **Library Icon Customization** — libraries can now have a custom Lucide icon (29 options: BookOpen, Palette, Code, Music, Film, etc.) and a custom icon color (15 presets + custom hex picker). The icon is displayed in the sidebar next to the library name.
- **Library & Collection Delete** — integrated delete with a two-step confirmation inside the settings modal. Deleting a library navigates back to Recent; documents are preserved but removed from the library.
- **Collection Rename** — collections can now be renamed via the same settings modal flow.
- **SQLite Migration v3** — adds `icon TEXT` and `icon_color TEXT` columns to the `libraries` table via an incremental Tauri migration.
- **Sidebar event listener** — sidebar now responds to a `reload-sidebar` custom event so library changes from anywhere in the app are reflected immediately.

### Changed
- Removed the inline Edit (pencil) icon from library rows in the sidebar — editing is now handled via the cleaner settings modal, reducing sidebar clutter especially at larger font sizes.
- Widened sidebar from 260 px to 280 px to better accommodate longer library names at larger text sizes.
- Made the "Kintara" logo text bolder (`fontWeight: 800`) and slightly larger (`1.25rem`) in the sidebar header.
- Logo image in sidebar header slightly enlarged from `w-12 h-12` to 52 px for improved visual presence.

### Added
- Implemented nested Collections under Libraries in the sidebar.
- Added a Document Grid view for library/collection browsing.
- Extracted PDF metadata (Title, Author, Keywords, Year) automatically via pdfjs-dist on import.
- Built an editable "Details" sidebar for managing document metadata, tags, and thumbnails.
- Created persistent Settings page (theme, typography) using `settings.json` in the app data directory.
- Added global keyboard shortcuts for navigation and actions.
- Introduced an interactive Help & Shortcuts modal and Onboarding overlay.
- Added the ability to completely delete imported documents.
- Added UI prompt system for creating and renaming libraries and collections.
- Added `remark-gfm` to support Markdown tables and GitHub Flavored Markdown in the reader.
- Added a Trash icon overlay on document thumbnails for quick deletion.
- Integrated Tauri's native `@tauri-apps/plugin-dialog` `ask` dialog API to replace basic web browser alert confirmations for deleting, highlighting, and canceling imports, creating a premium desktop-grade feel.
- Standardized document cover/thumbnail aspect ratio to consistent 3:4 (portrait) across the main grid and details sidebar.
- Configured Tauri bundler targets explicitly for `.deb`, `.appimage`, `.rpm`, and `.nsis` builds along with premium app-level metadata and descriptions in `tauri.conf.json`.
- Added manual GitHub Actions workflow (`build-windows.yml`) using `workflow_dispatch` to compile the Windows `.exe` installer and compile binary artifacts.
- Styled Kintara logo text in the sidebar to persistently render with the **Bellota** font family at a premium medium weight, isolated from general typography choices.
- Expanded typography settings in the Settings page to include Outfit, Livvic, Life Savers, M PLUS U, Bellota, and Elsie fonts.

### Fixed
- Resolved thumbnail and cover image loading failure (? icon) in the canvas, details sidebar, and import modal by implementing Tauri `convertFileSrc` and configuring scoped `assetProtocol` in `tauri.conf.json`.
- Fixed typescript compilation error in `DocumentGrid.tsx` caused by a missing `file_path` parameter on document deletion.
- Fixed typescript compilation error in `src/db.ts` by passing the required `canvas` parameter to `page.render()` for newer versions of `pdfjs-dist`.
- Fixed Tauri bundle build failure caused by invalid category value in `tauri.conf.json` by removing the optional category property.
- Removed redundant and accidental-click-prone delete button from DetailsSidebar header, centralizing delete action to the quick-action grid hover overlay.
- Fixed PDF extraction crashing due to reference error when parsing titles.
- Fixed `App.css` to properly support manual `[data-theme]` toggles for light/dark mode override.
- Fixed native HTML button rendering on sidebar chevrons to use clean, unstyled icons.
- Improved Help Modal spacing and readability with proper display utilities.
- Changed default app view to `recent` so the dashboard isn't empty upon initial load.
- Adjusted Onboarding flow to reliably trigger the "Name your first Library" prompt upon completion.
- Added layout CSS utility classes to fix scrunching and alignment bugs in UI.
- Fixed sidebar active selection styling to properly contrast in Light and Dark modes.
- Fixed settings logic so Reader Themes apply correctly and distinctly from UI Themes.
- Fixed PDF reader background to respond to the dark/light Reader Theme correctly.
- Fixed thumbnail Star icon to align to the top right and persistently display yellow when favorited.
- Fixed Details Sidebar to fallback to the currently active reading document if no specific thumbnail was clicked.
- Initialized Tauri + React + Vite + TypeScript project.
- Generated application icons from `icon.png`.
- Created initial documentation (`README.md`, `OVERVIEW.md`, `CHANGELOG.md`, `LICENSE`).

### Fixed
- Fixed missing app name by restoring "Kintara" to the sidebar header and separating the workspace selector.
- Reverted theme accent to `#410186` per request and improved UI typography.
- Updated sidebar logo to use `logo.png` instead of the icon.
- Fixed split view layout allowing both sides to scale equally by removing absolute positioning and standardizing DOM structures for panels.
- Relocated split view selector to main header to eliminate asymmetrical padding on the right panel.
- Fixed unreadable white-on-white text in select dropdowns by setting `color-scheme` property for native inputs and standardizing background colors globally.
- Constrained the maximum height of PDF pages to fit entirely within the viewport without clipping.
