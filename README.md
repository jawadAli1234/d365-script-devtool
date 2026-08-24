# D365 Script Devtool

Attach OnLoad / OnSave / OnChange scripts to a Dataverse form directly from the form
itself — no maker portal, no page to migrate between environments.

## Load it (unpacked)

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this folder (must contain `manifest.json` directly).
4. Open any Dynamics 365 / Dataverse form. A compact floating panel appears bottom-right.

## Use it

The panel **never appears automatically** — click the extension's toolbar icon to
show it, click again to hide it (same idea as Power Pane's own toggle). It shows
every script currently attached to the form, grouped by **OnLoad / OnSave /
OnChange**, with a **custom** filter (on by default) that hides Microsoft's
first-party handlers so you only see your own.

### Settings (⚙ in the header)

- **Theme**: Dark (default) or Light — applies instantly, persisted across sessions.

- Click a script's name (or its **⋮ → Edit**) to load it into the inline editor below,
  pre-filled with its real content, ready to modify and re-publish.
- Click the **⋮ → Remove** to strip a handler from wherever it lives in the form.
- Click **+ New script** to open the same inline editor blank, for adding a new one.
- **Hard refresh** in the panel footer forces a cache-bypassing reload of the D365 tab.

Everything happens in the one panel — nothing opens in a new tab or window.

### The inline editor

1. Choose **Create new** (upload your own script) or **Use existing** (point a new
   event at a function that already lives in another web resource, without touching
   its content at all — search by name, pick a match, done).
2. For **Create new**: pick **Publisher**, **File type**, and a **Web resource name**
   (just the base name — the `{prefix}_` and extension are added automatically and
   shown live in a preview line).
3. Pick **Operation** (OnLoad / OnSave / OnChange — OnChange shows a **Field** box)
   and enter the **Function name**.
4. Set **Enabled**, **Pass execution context as first parameter**, and an optional
   comma-separated **parameters** list — these map directly to the same attributes
   the native Configure Event dialog writes, and editing an already-attached handler
   correctly updates them in place instead of leaving the old values behind.
5. The **Field** box (OnChange) and the **Field reference** search both autocomplete
   from every field actually on the form. Typing/selecting a field in **Field
   reference** shows its type, required level, format, OptionSet values (value =
   label), or Lookup target entity types — then **Insert getAttribute snippet at
   cursor** drops a ready-to-edit `formContext.getAttribute("...").getValue();` line
   (with OptionSet/Lookup info as a trailing comment) right into the script at the
   cursor position.
6. Paste or edit the **Script** (use the font-size dropdown next to the Script label
   if the default is too small to read comfortably — the editor has full JavaScript/
   CSS/HTML/XML syntax highlighting via CodeMirror, switching automatically with the
   File type dropdown), then click **Publish**. This will:
   - create or update the named web resource with your script content (skipped
     entirely in **Use existing** mode)
   - publish that web resource
   - patch the form's `formxml` to register the library + event handler in the
     correct top-level events block (verified by re-reading the form afterward)
   - publish the form
7. Go back to the D365 tab (still in the same tab the whole time) and click
   **Hard refresh** in the panel — this forces a cache-bypassing reload, since
   Dataverse caches web resource `.js` files aggressively.

## How it works

- The **content script** (in the D365 tab) renders the whole panel — list and inline
  editor both — but it can't see `window.Xrm` or bypass cache directly (isolated JS
  world).
- The **background service worker** uses `chrome.scripting.executeScript(..., world:
  'MAIN')` to run the actual `Xrm.WebApi` calls inside the D365 page, reusing your
  already authenticated session.
- Hard refresh (cache/IndexedDB clearing) lives in the background worker because
  those APIs aren't available in the page's own JS world.

## Known limitations

- OnChange targets are matched by `datafieldname` on `<control>` elements. Controls
  inside subgrids or quick-view forms aren't specifically handled.
- Context detection uses `Xrm.Page`, a broadly-supported but deprecated API surface.
- Only one form-XML backup per form id is kept (the most recent).
- This writes directly into the target environment's unmanaged customizations, so
  treat it as a dev/sandbox accelerator, not a deployment mechanism. Export a proper
  solution when you're ready to promote to test/prod.
