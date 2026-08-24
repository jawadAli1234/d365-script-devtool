# QA Checklist — before Chrome Web Store submission

Run through every section below in an actual D365 sandbox before submitting. Check
the browser console (F12) and the background service worker's own console
(`chrome://extensions` → "service worker") throughout — any red error in either,
even one that doesn't visibly break the UI, is worth fixing before submission.

## 1. Install / load

- [ ] Fresh install (Remove any old version first, then Load unpacked) shows no
      "Errors" badge on the extension card in `chrome://extensions`.
- [ ] Service worker shows **Active**, not "Inactive" with an error.
- [ ] Extension icon appears in the toolbar (pin it if needed).
- [ ] Panel does **not** appear automatically on any D365 page (click-to-show only).

## 2. Panel visibility (toolbar icon)

- [ ] Click icon on a D365 record page → panel appears.
- [ ] Click again → panel disappears.
- [ ] Click a third time → panel reappears, and its state (any typed text, expanded
      "+ New script" section, etc.) is preserved from before it was hidden — it's a
      show/hide, not a rebuild.
- [ ] Click the icon on a **non-D365 tab** (e.g. google.com) → nothing breaks, no
      visible error to the user (check console for the harmless expected warning).
- [ ] Open D365 in two different tabs, toggle the panel independently in each —
      confirm they don't interfere with each other.

## 3. Theme

- [ ] ⚙ → switch to Light — panel restyles immediately, fully readable (check every
      section: attached scripts list, new-script form, CodeMirror editor, status
      messages in all three colors, dropdowns/menus).
- [ ] Refresh the page, reopen the panel — theme choice persisted.
- [ ] Switch back to Dark — same checks.

## 4. Context detection

- [ ] Open a record with only one form (no form picker) — entity/form id resolve
      without getting stuck on "detecting...".
- [ ] Open a record on an entity with multiple forms — same.
- [ ] With the panel already open, navigate to a **different record** via a subgrid
      link or search **without a full page reload** (D365 often does this as an
      SPA) — hide and re-show the panel via the toolbar icon and confirm the
      context line/attached scripts update to the new record, not stale data from
      the previous one.

## 5. Attached scripts list

- [ ] Shows OnLoad / OnSave / OnChange groups correctly for a form with existing
      customizations.
- [ ] "custom" checkbox correctly hides Microsoft first-party handlers by default;
      unchecking shows everything with correct "(X of Y)" counts.
- [ ] A field that has **two duplicate controls** on different tabs shows as
      **one** de-duplicated OnChange entry, not two.
- [ ] Refresh link re-pulls the list without a page reload.
- [ ] Click a script name → inline editor expands, pre-filled with real content,
      Publisher/File type/Web resource name locked (greyed out, not editable).
- [ ] ⋮ menu → Remove → confirms removal and disappears from the list after a
      Hard Refresh.

## 6. Create new script

- [ ] JS / CSS / HTML / XML / RESX file types all selectable; picking a non-JS type
      hides Operation/Function name and disables the CodeMirror mode switch
      correctly (still shows raw text, just different syntax highlighting).
- [ ] Publisher dropdown populates real publishers with version-free names (or
      Solution dropdown separately — see below); Web resource name field shows
      the locked `{prefix}_` correctly and updates live when Publisher changes.
- [ ] Publishing with a name that **already exists** as an unrelated resource shows
      the overwrite-confirmation warning and requires a second click to proceed.
- [ ] Publishing with a **solution** selected actually adds the component to that
      solution (verify in the native Solutions explorer — remember Default
      Solution always shows everything regardless).
- [ ] OnLoad, OnSave, and OnChange (on at least one field with **only one**
      control, and one with **duplicate** controls) each fire correctly after
      Publish + Hard Refresh.
- [ ] Enabled / Pass execution context / Parameters checkboxes and field actually
      affect the published `<Handler>` attributes (verify via native Form Editor).

## 7. Use existing

- [ ] Search returns real matches as you type (debounced, no flooding).
- [ ] Selecting a resource loads its **real** content into the editor.
- [ ] Adding a new function alongside the existing one and publishing updates the
      file without breaking the original function.
- [ ] Attaching a function that doesn't appear in the content yet shows the
      non-blocking "wasn't found" warning, and it clears once you add it.

## 8. Field reference / autocomplete

- [ ] Typing in the OnChange **Field** box and the **Field reference** box both
      show live suggestions, whether the field is empty or already has a value.
- [ ] Selecting a field shows accurate type, required level, format, OptionSet
      values, or Lookup targets.
- [ ] "Insert getAttribute snippet" lands cleanly on its own line regardless of
      cursor position, and never overwrites a text selection.

*(Run Now / live-execution feature removed for this release - deferred to v2.)*

## 10. Hard refresh

- [ ] After publishing a script content change, **one** Hard Refresh click is
      enough to see the new behavior (no longer needing 2–3 clicks).

## 11. Error handling / edge cases

- [ ] Publish while offline / with an expired session — shows a real error message,
      doesn't hang forever on "Publishing...".
- [ ] Two rapid Publish clicks don't double-submit or produce duplicate handlers.
- [ ] Extremely long script content (a few thousand lines) doesn't freeze the
      CodeMirror editor or the panel.
- [ ] Backspace/Delete/Arrow keys and Ctrl+V paste all work correctly inside the
      CodeMirror editor.

## 12. Store-readiness specifics

- [ ] No console errors on install, on panel open, or on any button click across
      the whole checklist above.
- [ ] `manifest.json` icons (16/32/48/128) all display correctly — toolbar, the
      extensions page, and `chrome://extensions/shortcuts` if applicable.
- [ ] Every permission in the manifest is actually exercised by a real feature
      (see below) — nothing requested "just in case."
- [ ] Write a short privacy disclosure for the Chrome Web Store dashboard: this
      extension reads/writes Dataverse customizations (web resources, form
      definitions) only within the user's own connected environment, does not
      transmit any data to a third-party server, and stores only a theme
      preference locally via `chrome.storage.local`.

### Permission justification reference (for the CWS review form)

| Permission | Why it's needed |
|---|---|
| `scripting` | Inject/execute code in the D365 page's main world to call `Xrm.WebApi` with the user's own session |
| `tabs` | Reload the D365 tab (Hard Refresh) and relay messages to it from the popup |
| `storage` | Persist the Dark/Light theme preference locally |
| `browsingData` | Clear cache/IndexedDB scoped to the D365 origin only, so published script changes show up reliably |
| `host_permissions: *://*.dynamics.com/*` | The tool only operates on the user's own Dynamics 365/Dataverse pages |
