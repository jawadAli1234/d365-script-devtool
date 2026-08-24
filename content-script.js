(function () {
  if (window.__d365DevtoolLoaded) return;
  window.__d365DevtoolLoaded = true;

  let host = null;

  // -------------------------------------------------------------------------
  // Propagation guard: D365/Unified Interface attaches its own keyboard
  // shortcut handling on `document` (capture phase) that can swallow Ctrl+V
  // before it reaches our panel. A listener on `window` always sees events
  // before `document` does (structural, not registration order), so we can
  // intercept just the clipboard-related events there.
  //
  // This must stay narrow: CodeMirror is not a native editable field - it
  // has no browser-default fallback for Backspace/Delete/arrow keys, it
  // relies entirely on its own keydown listener actually receiving the
  // event. Blocking keydown broadly (as an earlier version of this guard
  // did) silently breaks all editing in CodeMirror, since the event never
  // even reaches it. Only paste/copy/cut - and the specific Ctrl/Cmd+V/C/X
  // combos that trigger them - are ever stopped here.
  // -------------------------------------------------------------------------
  ["paste", "copy", "cut", "keydown"].forEach((type) => {
    window.addEventListener(
      type,
      (e) => {
        if (!host) return;
        const path = e.composedPath ? e.composedPath() : [];
        if (!path.includes(host)) return;

        if (type === "paste" || type === "copy" || type === "cut") {
          e.stopPropagation();
          return;
        }
        // type === "keydown": only stop the specific clipboard shortcuts
        if ((e.ctrlKey || e.metaKey) && ["v", "c", "x"].includes(e.key?.toLowerCase())) {
          e.stopPropagation();
        }
      },
      true
    );
  });

  function init() {
    if (document.getElementById("d365-devtool-host")) return;

    const PANEL_CSS = `
      :host {
        all: initial;
        --bg: #1e1f22; --bg-header: #111214; --bg-input: #2a2b2e; --bg-input-disabled: #242527;
        --bg-hover: #3a3b3e; --bg-menu: #2f3034; --border: #3a3b3e; --border-strong: #45464b;
        --text-primary: #e8e8e8; --text-secondary: #9aa0a6; --text-muted: #7a7d82; --text-heading: #eee;
        --accent: #3a7afe; --accent-text: #fff; --danger-text: #ff9a9a; --link: #8ab4ff;
        --status-ok-bg: #16351f; --status-ok-text: #8ee0a0; --status-err-bg: #3a1a1a; --status-err-text: #ff9a9a;
        --status-info-bg: #1a2a3a; --status-info-text: #8ab4ff; --divider: #303134; --panel-shadow: rgba(0,0,0,.4);
      }
      .panel.light {
        --bg: #ffffff; --bg-header: #f2f3f5; --bg-input: #f5f6f8; --bg-input-disabled: #ececf0;
        --bg-hover: #e8e9ed; --bg-menu: #ffffff; --border: #d7d9de; --border-strong: #c2c4ca;
        --text-primary: #1e1f22; --text-secondary: #6b6f76; --text-muted: #8a8d94; --text-heading: #111214;
        --accent: #3a7afe; --accent-text: #fff; --danger-text: #c0392b; --link: #1a56db;
        --status-ok-bg: #e5f5ea; --status-ok-text: #1e7e34; --status-err-bg: #fdeceb; --status-err-text: #c0392b;
        --status-info-bg: #e8f0fe; --status-info-text: #1a56db; --divider: #e2e3e7; --panel-shadow: rgba(0,0,0,.15);
      }
      .panel { position: fixed; bottom: 20px; right: 20px; width: 320px; max-height: calc(100vh - 40px);
        display: flex; flex-direction: column;
        font-family: system-ui, sans-serif; font-size: 13px; background: var(--bg);
        color: var(--text-primary); border-radius: 10px; box-shadow: 0 8px 28px var(--panel-shadow);
        z-index: 999999; transition: width .15s ease; }
      .panel.expanded { width: 560px; }
      .header { flex-shrink: 0; position: relative; display:flex; justify-content:space-between; align-items:center;
        padding: 10px 14px; background:var(--bg-header); border-radius:10px 10px 0 0;
        cursor: move; font-weight: 600; }
      .header-actions { display:flex; align-items:center; gap:10px; }
      .header button { background:none; border:none; color:var(--text-secondary); cursor:pointer; font-size:14px; }
      .body { flex: 1 1 auto; min-height: 0; overflow-y: auto;
        padding: 14px; display: flex; flex-direction: column; gap: 12px; }
      .context-line { font-size:11px; color:var(--text-muted); padding-bottom:6px; border-bottom:1px solid var(--divider);
        word-break: break-all; }
      .section-title { font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.04em;
        color:var(--text-secondary); display:flex; justify-content:space-between; align-items:center; }
      .section-actions { display:flex; align-items:center; gap:10px; font-weight:400; text-transform:none; }
      .mini-toggle { display:flex; align-items:center; gap:4px; font-size:11px; color:var(--text-secondary); cursor:pointer; }
      .mini-toggle input { margin:0; }
      button.link { background:none; border:none; color:var(--link); cursor:pointer; padding:0; font-size:11px; }
      button.link.danger { color:var(--danger-text); }
      .handlers-list { max-height:280px; overflow-y:auto; display:flex; flex-direction:column; gap:6px; }
      .handler-group-title { font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:.04em;
        color:var(--text-muted); margin-top:4px; }
      .handler-group-title:first-child { margin-top:0; }
      .handler-card { position:relative; display:flex; align-items:center; justify-content:space-between;
        background:var(--bg-input); border:1px solid var(--border); border-radius:8px; padding:8px 6px 8px 10px; gap:6px; }
      .handler-card:hover { border-color:var(--border-strong); }
      .handler-link { flex:1; min-width:0; background:none; border:none; color:var(--link); text-align:left;
        cursor:pointer; font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding:0; }
      .handler-link:hover { text-decoration:underline; }
      .handler-label-plain { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis;
        white-space:nowrap; color:var(--text-secondary); font-size:12px; }
      .handler-menu-btn { flex-shrink:0; background:none; border:none; color:var(--text-secondary); cursor:pointer;
        font-size:16px; line-height:1; padding:2px 6px; border-radius:4px; }
      .handler-menu-btn:hover { background:var(--bg-hover); }
      .handler-menu { position:absolute; top:100%; right:6px; margin-top:4px; background:var(--bg-menu);
        border:1px solid var(--border-strong); border-radius:6px; box-shadow:0 4px 12px var(--panel-shadow); z-index:10;
        display:flex; flex-direction:column; min-width:110px; overflow:hidden; }
      .handler-menu button { background:none; border:none; color:var(--text-heading); text-align:left; padding:8px 10px;
        cursor:pointer; font-size:12px; }
      .handler-menu button:hover { background:var(--bg-hover); }
      .handler-menu button.danger { color:var(--danger-text); }
      button.full-btn { width:100%; background:var(--bg-hover); border:none; color:var(--text-heading); padding:9px;
        border-radius:6px; cursor:pointer; font-size:12px; font-weight:600; }
      .row { display:flex; flex-direction:column; gap:5px; }
      label { font-size:11px; color:var(--text-secondary); text-transform:uppercase; letter-spacing:.03em; }
      input, select, textarea { background:var(--bg-input); border:1px solid var(--border); color:var(--text-heading);
        border-radius:6px; padding:7px 9px; font-family:inherit; font-size:13px; }
      input:disabled, select:disabled { background:var(--bg-input-disabled); color:var(--text-muted); cursor:not-allowed; }
      .prefixed-input:has(input:disabled) { background:var(--bg-input-disabled); }
      .prefixed-input:has(input:disabled) input { color:var(--text-muted); cursor:not-allowed; }
      textarea { font-family:"SFMono-Regular", Consolas, monospace; font-size:12px; resize:vertical; min-height:130px; }
      .panel.expanded .handlers-list { max-height:160px; }
      .prefixed-input { display:flex; align-items:center; background:var(--bg-input);
        border:1px solid var(--border); border-radius:6px; overflow:hidden; }
      .prefixed-input .prefix { padding:7px 0 7px 9px; color:var(--text-secondary); font-size:13px;
        white-space:nowrap; user-select:none; }
      .prefixed-input input { flex:1; min-width:0; background:transparent; border:none;
        border-radius:0; padding:7px 9px 7px 2px; }
      .prefixed-input input:focus { outline:none; }
      .hint { font-size:11px; color:var(--text-muted); margin-top:-3px; }
      .actions { display:flex; gap:8px; margin-top:2px; }
      button.primary { flex:1; background:var(--accent); border:none; color:var(--accent-text); padding:9px;
        border-radius:6px; cursor:pointer; font-weight:600; }
      button.secondary { flex:1; background:var(--bg-hover); border:none; color:var(--text-heading); padding:9px;
        border-radius:6px; cursor:pointer; }
      .new-script-body { display:flex; flex-direction:column; gap:10px; padding-top:2px; }
      .checkbox-row { display:flex; align-items:center; }
      .checkbox-row label { display:flex; align-items:center; gap:7px; text-transform:none;
        font-size:12px; letter-spacing:normal; color:var(--text-primary); cursor:pointer; }
      .checkbox-row input { margin:0; }
      .autocomplete-results { max-height:160px; overflow-y:auto; background:var(--bg-input);
        border:1px solid var(--border); border-radius:6px; margin-top:-2px; }
      .autocomplete-results div { padding:6px 9px; font-size:12px; cursor:pointer; color:var(--text-primary); }
      .autocomplete-results div:hover { background:var(--bg-hover); }
      .field-ref-box { background:var(--bg-input); border:1px solid var(--border); border-radius:6px;
        padding:9px 10px; font-size:12px; color:var(--text-primary); display:flex; flex-direction:column; gap:4px; }
      .field-ref-box .fr-title { font-weight:600; color:var(--text-heading); }
      .field-ref-box .fr-row { color:var(--text-secondary); }
      .field-ref-box .fr-options { max-height:120px; overflow-y:auto; display:flex; flex-direction:column;
        gap:2px; margin-top:2px; font-family:"SFMono-Regular", Consolas, monospace; font-size:11px; }
      .field-ref-box .fr-options div { color:var(--text-primary); }
      #nsFontSize { width:auto; padding:3px 6px; font-size:11px; text-transform:none; }
      .CodeMirror { border:1px solid var(--border); border-radius:6px; height:150px; }
      .panel.expanded .CodeMirror { height:420px; }
      .mode-toggle { display:flex; gap:0; border:1px solid var(--border); border-radius:6px; overflow:hidden; }
      .mode-btn { flex:1; background:var(--bg-input); border:none; color:var(--text-secondary); padding:7px; font-size:12px; cursor:pointer; }
      .mode-btn.active { background:var(--accent); color:var(--accent-text); }
      .selected-resource { display:flex; align-items:center; justify-content:space-between;
        background:var(--bg-input); border:1px solid var(--border); border-radius:6px; padding:8px 10px; font-size:12px; }
      #exResults .handler-card { cursor:pointer; }
      #exResults .handler-card:hover { border-color:var(--link); }
      .footer-row { display:flex; padding-top:6px; border-top:1px solid var(--divider); }
      .status { font-size:11px; padding:7px 9px; border-radius:6px; min-height:14px; }
      .status.ok { background:var(--status-ok-bg); color:var(--status-ok-text); }
      .status.err { background:var(--status-err-bg); color:var(--status-err-text); }
      .status.info { background:var(--status-info-bg); color:var(--status-info-text); }
      .settings-panel { position:absolute; top:100%; right:0; margin-top:4px; background:var(--bg-menu);
        border:1px solid var(--border-strong); border-radius:8px; box-shadow:0 4px 16px var(--panel-shadow);
        padding:12px; z-index:20; width:220px; display:flex; flex-direction:column; gap:12px; cursor:default; }
      .settings-panel .row label { color:var(--text-secondary); }
      .hidden { display:none; }
    `;

    host = document.createElement("div");
    host.id = "d365-devtool-host";
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });

    shadow.innerHTML = `
      <link rel="stylesheet" href="${chrome.runtime.getURL("lib/codemirror.css")}">
      <link rel="stylesheet" href="${chrome.runtime.getURL("lib/material-darker.css")}">
      <style>${PANEL_CSS}</style>
      <div class="panel">
        <div class="header">
          <span>D365 script devtool</span>
          <div class="header-actions">
            <button id="settingsToggle" title="Settings">⚙</button>
            <button id="toggle" title="Collapse">_</button>
          </div>
          <div class="settings-panel hidden" id="settingsPanel">
            <div class="row">
              <label>Theme</label>
              <div class="mode-toggle">
                <button class="mode-btn" id="themeDark">Dark</button>
                <button class="mode-btn" id="themeLight">Light</button>
              </div>
            </div>
          </div>
        </div>
        <div class="body" id="body">
          <div class="context-line" id="contextLine">detecting form context...</div>

          <div class="section-title">
            Attached scripts
            <span class="section-actions">
              <label class="mini-toggle"><input type="checkbox" id="onlyCustom" checked /> custom</label>
              <button class="link" id="refreshHandlers">Refresh</button>
            </span>
          </div>
          <div class="handlers-list" id="handlersList">detecting...</div>

          <button class="full-btn" id="newScript">+ New script</button>

          <div id="newScriptSection" class="new-script-body hidden">
            <div class="mode-toggle">
              <button class="mode-btn active" id="modeNew">Create new</button>
              <button class="mode-btn" id="modeExisting">Use existing</button>
            </div>

            <div id="newModeFields">
              <div class="row"><label>Solution</label>
                <select id="nsSolution"><option value="">loading...</option></select>
              </div>
              <div class="row"><label>Publisher</label>
                <select id="nsPublisher"><option value="">loading...</option></select>
              </div>
              <div class="row"><label>File type</label>
                <select id="nsFileType">
                  <optgroup label="Code">
                    <option value="3" selected>JavaScript (JS)</option>
                    <option value="2">Style Sheet (CSS)</option>
                    <option value="1">Webpage (HTML)</option>
                  </optgroup>
                  <optgroup label="Data">
                    <option value="4">Data (XML)</option>
                    <option value="9">String (RESX)</option>
                  </optgroup>
                </select>
              </div>
              <div class="row"><label>Web resource name</label>
                <div class="prefixed-input">
                  <span id="nsLibraryPrefix" class="prefix">..._</span>
                  <input id="nsLibrary" placeholder="mytool" />
                </div>
              </div>
              <div class="hint" id="nsLibraryPreview"></div>
            </div>

            <div id="existingModeFields" class="hidden">
              <div class="row"><label>Search web resources (JS)</label>
                <input id="exSearch" placeholder="type to search by name..." />
              </div>
              <div class="handlers-list" id="exResults"></div>
              <div class="row hidden" id="exSelectedRow">
                <label>Selected web resource</label>
                <div class="selected-resource">
                  <span id="exSelectedName"></span>
                  <button class="link" id="exChange">change</button>
                </div>
              </div>
            </div>

            <div class="row">
              <label>Operation</label>
              <select id="nsOperation">
                <option value="onload">OnLoad</option>
                <option value="onsave">OnSave</option>
                <option value="onchange">OnChange</option>
              </select>
            </div>
            <div class="row hidden" id="nsFieldRow">
              <label>Field</label>
              <input id="nsField" placeholder="field logical name" autocomplete="off" />
              <div class="autocomplete-results hidden" id="nsFieldResults"></div>
            </div>
            <div class="row" id="nsFunctionRow"><label>Function name</label><input id="nsFunction" placeholder="myFunction" /></div>
            <div class="hint hidden" id="nsFunctionWarning"></div>

            <div class="checkbox-row"><label><input type="checkbox" id="nsEnabled" checked /> Enabled</label></div>
            <div class="checkbox-row">
              <label><input type="checkbox" id="nsPassContext" checked /> Pass execution context as first parameter</label>
            </div>
            <div class="row">
              <label>Comma separated list of parameters</label>
              <textarea id="nsParameters" rows="2" placeholder="param1,param2"></textarea>
            </div>

            <div class="row">
              <label>Field reference (look up a field's type, required level, options...)</label>
              <input id="fieldRefSearch" placeholder="type a field logical name..." autocomplete="off" />
              <div class="autocomplete-results hidden" id="fieldRefResults"></div>
            </div>
            <div class="field-ref-box hidden" id="fieldRefBox"></div>
            <button class="link hidden" id="fieldRefInsert">Insert getAttribute snippet at cursor</button>

            <div class="row" id="nsScriptRow">
              <label style="display:flex;justify-content:space-between;align-items:center">
                Script
                <select id="nsFontSize">
                  <option value="12">12px</option>
                  <option value="13" selected>13px</option>
                  <option value="14">14px</option>
                  <option value="16">16px</option>
                  <option value="18">18px</option>
                </select>
              </label>
              <textarea id="nsScript" rows="7" placeholder="function myFunction(executionContext) {\n  // your code\n}"></textarea>
            </div>
            <div class="actions">
              <button class="primary" id="nsPublish">Publish</button>
              <button class="secondary" id="nsHardRefresh">Hard refresh</button>
            </div>
          </div>

          <div class="footer-row">
            <button class="link" id="hardRefresh">Hard refresh</button>
          </div>

          <div class="status hidden" id="status"></div>
        </div>
      </div>
    `;

    const $ = (id) => shadow.getElementById(id);
    const panelEl = shadow.querySelector(".panel");
    let context = null;
    let currentPublisherPrefixes = [];
    let allPublishers = [];
    let allSolutions = [];
    let lastHandlersData = null;

    function applyTheme(theme) {
      panelEl.classList.toggle("light", theme === "light");
      $("themeDark").classList.toggle("active", theme !== "light");
      $("themeLight").classList.toggle("active", theme === "light");
    }

    chrome.storage.local.get(["theme"], (stored) => {
      applyTheme(stored.theme === "light" ? "light" : "dark");
    });

    $("themeDark").addEventListener("click", () => {
      applyTheme("dark");
      chrome.storage.local.set({ theme: "dark" });
    });
    $("themeLight").addEventListener("click", () => {
      applyTheme("light");
      chrome.storage.local.set({ theme: "light" });
    });

    $("settingsToggle").addEventListener("click", (e) => {
      e.stopPropagation();
      $("settingsPanel").classList.toggle("hidden");
    });
    shadow.addEventListener("click", (e) => {
      if (!e.target.closest?.("#settingsPanel") && !e.target.closest?.("#settingsToggle")) {
        $("settingsPanel").classList.add("hidden");
      }
    });


    // Prefixes Microsoft's own solutions use, even though some (like msdyn_)
    // can legitimately appear as a registered "publisher" in an org. Never
    // treat these as user-editable regardless of what the publisher list says.
    const RESERVED_PREFIXES = ["msdyn", "mscrm", "adx", "msfp", "msevt", "stagegate", "sample", "referenceapp", "msuce"];

    function libraryPrefix(libraryName) {
      const m = libraryName.match(/^([a-zA-Z0-9]+)_/);
      return m ? m[1].toLowerCase() : null;
    }

    function isOwnHandler(h) {
      if (h.internal) return false;
      const prefix = libraryPrefix(h.libraryName);
      return !!prefix && currentPublisherPrefixes.includes(prefix) && !RESERVED_PREFIXES.includes(prefix);
    }

    function setStatus(text, kind) {
      const el = $("status");
      el.textContent = text;
      el.className = `status ${kind}`;
    }

    function send(type, payload) {
      return new Promise((resolve) => chrome.runtime.sendMessage({ type, payload }, resolve));
    }

    async function detectContext(attempt = 1) {
      setStatus(`Detecting form context... (attempt ${attempt})`, "info");
      const result = await send("GET_CONTEXT");
      if (!result?.ok) {
        if (attempt < 20) {
          setTimeout(() => detectContext(attempt + 1), 1500);
        } else {
          setStatus(`${result?.error || "Could not detect context."} Click Retry.`, "err");
        }
        return;
      }

      // Set context as soon as the entity/fields are known - Field
      // reference, autocomplete, etc. only need this, not formId.
      context = result;
      $("contextLine").textContent = `${result.entityName}  ·  form ${result.formId || "(not resolved yet)"}`;
      await Promise.all([loadPublisherPrefixes(), loadSolutions()]);

      if (!result.formId) {
        // formId specifically still missing - keep retrying just for that,
        // without blocking anything that doesn't need it.
        if (attempt < 20) {
          setStatus(`Entity ready (${result.entityName}). Still resolving form id for Attached scripts/Publish...`, "info");
          setTimeout(() => detectContext(attempt + 1), 1500);
        } else {
          setStatus(
            `Entity ready (${result.entityName}), but form id never resolved. Attached scripts/Publish won't work here - Field reference still will. Click to retry.`,
            "err"
          );
        }
        return;
      }

      setStatus(`Context ready: ${result.entityName}`, "ok");
      loadHandlers();
    }

    function setupFieldAutocomplete(inputId, resultsId, onSelect) {
      const input = $(inputId);
      const results = $(resultsId);

      function render() {
        const term = input.value.trim().toLowerCase();
        const matches = (context?.fields || [])
          .filter((f) => f.name.toLowerCase().includes(term))
          .slice(0, 30);
        results.innerHTML = "";
        if (matches.length === 0) {
          results.classList.add("hidden");
          return;
        }
        matches.forEach((f) => {
          const row = document.createElement("div");
          row.textContent = `${f.name}  (${f.type})`;
          // mousedown + preventDefault fires before the input's blur, so
          // selecting a suggestion doesn't get cut off by the field losing
          // focus first - the input stays focused and value updates cleanly,
          // no matter whether it already had a value or not.
          row.addEventListener("mousedown", (e) => {
            e.preventDefault();
            input.value = f.name;
            results.classList.add("hidden");
            if (onSelect) onSelect(f);
          });
          results.appendChild(row);
        });
        results.classList.remove("hidden");
      }

      input.addEventListener("focus", render);
      input.addEventListener("input", render);
      input.addEventListener("blur", () => {
        setTimeout(() => results.classList.add("hidden"), 150);
      });
    }


    function escapeHtml(str) {
      const div = document.createElement("div");
      div.textContent = str;
      return div.innerHTML;
    }

    function buildFieldSnippet(field) {
      let snippet = `formContext.getAttribute("${field.name}").getValue();`;
      if (field.options && field.options.length) {
        snippet += `  // ${field.options.map((o) => `${o.value}=${o.text}`).join(", ")}`;
      } else if (field.lookupTargets && field.lookupTargets.length) {
        snippet += `  // targets: ${field.lookupTargets.join(", ")}`;
      }
      return snippet;
    }

    let currentFieldRefMatch = null;

    function renderFieldRef(field) {
      const box = $("fieldRefBox");
      currentFieldRefMatch = field || null;
      $("fieldRefInsert").classList.toggle("hidden", !field);
      if (!field) {
        box.classList.add("hidden");
        box.innerHTML = "";
        return;
      }
      let html = `<div class="fr-title">${escapeHtml(field.name)}</div><div class="fr-row">Type: ${escapeHtml(field.type)}</div>`;
      if (field.requiredLevel) html += `<div class="fr-row">Required: ${escapeHtml(field.requiredLevel)}</div>`;
      if (field.format) html += `<div class="fr-row">Format: ${escapeHtml(field.format)}</div>`;
      if (field.lookupTargets && field.lookupTargets.length) {
        html += `<div class="fr-row">Targets: ${escapeHtml(field.lookupTargets.join(", "))}</div>`;
      }
      if (field.options && field.options.length) {
        html +=
          `<div class="fr-row">Options:</div><div class="fr-options">` +
          field.options.map((o) => `<div>${escapeHtml(String(o.value))} = ${escapeHtml(o.text)}</div>`).join("") +
          `</div>`;
      }
      box.innerHTML = html;
      box.classList.remove("hidden");
    }

    $("fieldRefSearch").addEventListener("input", (e) => {
      const name = e.target.value.trim();
      const field = (context?.fields || []).find((f) => f.name === name);
      renderFieldRef(field);
    });

    setupFieldAutocomplete("nsField", "nsFieldResults");
    setupFieldAutocomplete("fieldRefSearch", "fieldRefResults", (f) => renderFieldRef(f));

    function insertSnippetOnOwnLine(snippet) {
      const cursor = scriptEditor.getCursor();
      const line = scriptEditor.getLine(cursor.line);
      const indent = (line.match(/^\s*/) || [""])[0];
      const before = line.slice(0, cursor.ch);
      const after = line.slice(cursor.ch);
      let text = snippet;
      if (before.trim() !== "") text = `\n${indent}${text}`;
      if (after.trim() !== "") text = `${text}\n${indent}`;
      scriptEditor.replaceSelection(text);
    }

    $("fieldRefInsert").addEventListener("click", () => {
      if (!currentFieldRefMatch) return;
      ensureScriptEditor();
      // Never let Insert overwrite selected text - if something's selected,
      // collapse to the end of it first so this only ever adds code.
      scriptEditor.setCursor(scriptEditor.getCursor("to"));
      insertSnippetOnOwnLine(buildFieldSnippet(currentFieldRefMatch));
      scriptEditor.focus();
    });

    async function loadPublisherPrefixes() {
      const result = await send("GET_PUBLISHERS", { frameId: context.frameId });
      allPublishers = result?.ok ? result.publishers : [];
      currentPublisherPrefixes = allPublishers.map((p) => p.prefix);
    }

    async function loadSolutions() {
      const result = await send("GET_SOLUTIONS", { frameId: context.frameId });
      allSolutions = result?.ok ? result.solutions : [];
    }

    async function loadHandlers() {
      if (!context?.formId) return;
      $("handlersList").textContent = "loading...";
      const result = await send("GET_HANDLERS", { formId: context.formId, frameId: context.frameId });
      if (!result?.ok) {
        $("handlersList").textContent = result?.error || "Could not load handlers.";
        return;
      }
      lastHandlersData = result;
      renderHandlers(result);
    }

    function closeAllMenus() {
      shadow.querySelectorAll(".handler-menu").forEach((m) => m.classList.add("hidden"));
    }

    function renderHandlers(data) {
      const container = $("handlersList");
      container.innerHTML = "";
      const onlyCustom = $("onlyCustom").checked;
      const groups = [
        { title: "OnLoad", operation: "onload", items: data.onload || [] },
        { title: "OnSave", operation: "onsave", items: data.onsave || [] },
        { title: "OnChange", operation: "onchange", items: data.onchange || [] }
      ];
      let any = false;
      groups.forEach((group) => {
        const items = group.items.map((h) => ({ ...h, _isOurs: isOwnHandler(h) }));
        const visible = onlyCustom ? items.filter((h) => h._isOurs) : items;
        if (visible.length === 0) return;
        any = true;

        const header = document.createElement("div");
        header.className = "handler-group-title";
        header.textContent =
          visible.length !== items.length ? `${group.title} (${visible.length} of ${items.length})` : `${group.title} (${items.length})`;
        container.appendChild(header);

        visible.forEach((h) => {
          const row = document.createElement("div");
          row.className = "handler-card";
          const labelText = group.operation === "onchange" ? `${h.field}: ${h.functionName}` : h.functionName;

          if (h._isOurs) {
            const link = document.createElement("button");
            link.className = "handler-link";
            link.title = `${h.functionName} / ${h.libraryName}`;
            link.textContent = labelText;
            link.addEventListener("click", () => loadHandlerForEdit({ ...h, operation: group.operation }));
            row.appendChild(link);

            const menuBtn = document.createElement("button");
            menuBtn.className = "handler-menu-btn";
            menuBtn.textContent = "⋮";
            row.appendChild(menuBtn);

            const menu = document.createElement("div");
            menu.className = "handler-menu hidden";
            const editItem = document.createElement("button");
            editItem.textContent = "Edit";
            editItem.addEventListener("click", () => {
              menu.classList.add("hidden");
              loadHandlerForEdit({ ...h, operation: group.operation });
            });
            const removeItem = document.createElement("button");
            removeItem.className = "danger";
            removeItem.textContent = "Remove";
            removeItem.addEventListener("click", () => {
              menu.classList.add("hidden");
              quickRemoveHandler(h);
            });
            menu.appendChild(editItem);
            menu.appendChild(removeItem);
            row.appendChild(menu);

            menuBtn.addEventListener("click", (e) => {
              e.stopPropagation();
              const isHidden = menu.classList.contains("hidden");
              closeAllMenus();
              if (isHidden) menu.classList.remove("hidden");
            });
          } else {
            const plain = document.createElement("span");
            plain.className = "handler-label-plain";
            plain.title = `${h.functionName} / ${h.libraryName}`;
            plain.textContent = labelText;
            row.appendChild(plain);
          }

          container.appendChild(row);
        });
      });
      if (!any) {
        container.textContent = onlyCustom ? 'No custom scripts found. Uncheck "custom" to see all.' : "No handlers found on this form.";
      }
    }

    async function loadHandlerForEdit(h) {
      $("newScriptSection").classList.remove("hidden");
      $("newScript").textContent = "− Close";
      panelEl.classList.add("expanded");
      setNsMode("new");
      isEditingExisting = true;
      pendingOverwriteName = null;
      populateInlinePublisherSelect();
      populateInlineSolutionSelect();

      // Locked: changing either would compute a different full library name
      // than the one this handler actually points at, silently editing the
      // wrong resource (or creating a stray new one) instead of this one.
      $("nsPublisher").disabled = true;
      $("nsLibrary").disabled = true;
      $("nsFileType").disabled = true;

      $("nsOperation").disabled = false;
      $("nsOperation").value = h.operation;
      $("nsFieldRow").classList.toggle("hidden", h.operation !== "onchange");
      if (h.operation === "onchange") $("nsField").value = h.field || "";
      $("nsFileType").value = "3";
      $("nsFontSize").value = "13";
      ensureScriptEditor();
      scriptEditor.setOption("mode", cmModeFor("3"));
      scriptEditor.getWrapperElement().style.fontSize = "13px";
      $("nsFunction").value = h.functionName;
      $("nsEnabled").checked = h.enabled !== false;
      $("nsPassContext").checked = h.passExecutionContext !== false;
      $("nsParameters").value = h.parameters || "";

      const match = h.libraryName.match(/^([a-zA-Z0-9]+)_(.+)\.([a-zA-Z0-9]+)$/);
      if (match) {
        const [, prefix, base] = match;
        if (Array.from($("nsPublisher").options).some((o) => o.value === prefix)) {
          $("nsPublisher").value = prefix;
        }
        $("nsLibrary").value = base;
      } else {
        $("nsLibrary").value = h.libraryName;
      }
      nsUpdatePreview();
      updateNsOperationUI();

      setStatus(`Loading ${h.functionName}...`, "info");
      const result = await send("GET_WEBRESOURCE_CONTENT", { frameId: context.frameId, libraryName: h.libraryName });
      if (result?.ok) {
        scriptEditor.setValue(result.content || "");
        setTimeout(() => scriptEditor.refresh(), 0);
        if (!result.content) {
          setStatus(
            `${h.libraryName} was fetched successfully but has no saved content (it's genuinely empty in Dataverse). Write your code and Publish to set it.`,
            "info"
          );
        } else {
          setStatus(`Loaded ${h.functionName} for editing. Change the script and click Publish to update.`, "ok");
        }
      } else {
        setStatus(result?.error || "Could not load script content.", "err");
      }
    }

    async function quickRemoveHandler(h) {
      if (!context?.formId) return;
      setStatus(`Removing ${h.functionName}...`, "info");
      const result = await send("REMOVE_HANDLER", {
        formId: context.formId,
        frameId: context.frameId,
        entityLogicalName: context.entityName,
        libraryName: h.libraryName,
        functionName: h.functionName
      });
      if (result?.ok) {
        setStatus(`Removed ${result.removedCount} handler(s). Hard refresh to confirm.`, "ok");
        loadHandlers();
      } else {
        setStatus(result?.error || "Remove failed.", "err");
      }
    }

    shadow.addEventListener("click", (e) => {
      if (!e.target.closest?.(".handler-menu-btn")) closeAllMenus();
    });

    $("onlyCustom").addEventListener("change", () => {
      if (lastHandlersData) renderHandlers(lastHandlersData);
    });

    $("refreshHandlers").addEventListener("click", (e) => {
      e.preventDefault();
      loadHandlers();
    });

    $("newScript").addEventListener("click", () => {
      const section = $("newScriptSection");
      const nowHidden = section.classList.toggle("hidden");
      $("newScript").textContent = nowHidden ? "+ New script" : "− Close";
      panelEl.classList.toggle("expanded", !nowHidden);
      if (!nowHidden) {
        populateInlinePublisherSelect();
        populateInlineSolutionSelect();
        $("nsSolution").value = "";
        setNsMode("new");
        isEditingExisting = false;
        pendingOverwriteName = null;
        $("nsPublisher").disabled = false;
        $("nsLibrary").disabled = false;
        $("nsFileType").disabled = false;
        selectedExistingLibrary = null;
        selectedExistingContent = null;
        $("exSelectedRow").classList.add("hidden");
        $("exSearch").classList.remove("hidden");
        $("exSearch").value = "";
        $("exResults").innerHTML = "";
        $("nsEnabled").checked = true;
        $("nsPassContext").checked = true;
        $("nsParameters").value = "";
        $("nsFontSize").value = "13";
        ensureScriptEditor();
        scriptEditor.setOption("mode", cmModeFor($("nsFileType").value));
        scriptEditor.getWrapperElement().style.fontSize = "13px";
        scriptEditor.setValue("");
        $("nsFunction").value = "";
        $("nsLibrary").value = "";
        $("fieldRefSearch").value = "";
        renderFieldRef(null);
        updateNsOperationUI();
        setTimeout(() => scriptEditor.refresh(), 0);
      }
    });

    let scriptEditor = null;
    let isEditingExisting = false;
    let pendingOverwriteName = null;

    function cmModeFor(fileType) {
      return { "3": "javascript", "2": "css", "1": "htmlmixed", "4": "xml", "9": "xml" }[fileType] || "javascript";
    }

    function ensureScriptEditor() {
      if (scriptEditor) return scriptEditor;
      scriptEditor = CodeMirror.fromTextArea($("nsScript"), {
        lineNumbers: true,
        mode: "javascript",
        theme: "material-darker",
        indentUnit: 2,
        tabSize: 2,
        viewportMargin: 50
      });
      scriptEditor.getWrapperElement().style.fontSize = "13px";
      let checkDebounce;
      scriptEditor.on("change", () => {
        clearTimeout(checkDebounce);
        checkDebounce = setTimeout(() => checkFunctionExists(), 400);
      });
      return scriptEditor;
    }

    let nsMode = "new"; // "new" | "existing"
    let selectedExistingLibrary = null;
    let selectedExistingContent = null;
    let searchDebounce = null;

    function setNsMode(mode) {
      nsMode = mode;
      $("modeNew").classList.toggle("active", mode === "new");
      $("modeExisting").classList.toggle("active", mode === "existing");
      $("newModeFields").classList.toggle("hidden", mode !== "new");
      $("existingModeFields").classList.toggle("hidden", mode !== "existing");
      updateNsOperationUI();
      if (scriptEditor) setTimeout(() => scriptEditor.refresh(), 0);
    }

    $("modeNew").addEventListener("click", () => setNsMode("new"));
    $("modeExisting").addEventListener("click", () => setNsMode("existing"));

    async function runResourceSearch(term) {
      const results = $("exResults");
      results.textContent = "searching...";
      const result = await send("SEARCH_WEBRESOURCES", { frameId: context.frameId, term, fileType: 3 });
      if (!result?.ok) {
        results.textContent = result?.error || "Search failed.";
        return;
      }
      results.innerHTML = "";
      if (result.resources.length === 0) {
        results.textContent = "No matches.";
        return;
      }
      result.resources.forEach((r) => {
        const row = document.createElement("div");
        row.className = "handler-card";
        const label = document.createElement("span");
        label.className = "handler-label-plain";
        label.textContent = r.name;
        row.appendChild(label);
        row.addEventListener("click", () => selectExistingResource(r.name));
        results.appendChild(row);
      });
    }

    async function selectExistingResource(name) {
      selectedExistingLibrary = name;
      $("exSelectedName").textContent = name;
      $("exSelectedRow").classList.remove("hidden");
      $("exResults").innerHTML = "";
      $("exSearch").value = "";
      $("exSearch").classList.add("hidden");
      selectedExistingContent = null;
      ensureScriptEditor();
      scriptEditor.setOption("mode", "javascript");
      scriptEditor.setValue("loading...");
      setTimeout(() => scriptEditor.refresh(), 0);
      const result = await send("GET_WEBRESOURCE_CONTENT", { frameId: context.frameId, libraryName: name });
      if (result?.ok) {
        selectedExistingContent = result.content;
        scriptEditor.setValue(result.content || "");
        setStatus(`Loaded ${name}. Add a new function below, then Publish to update it and attach.`, "ok");
      } else {
        scriptEditor.setValue("");
        setStatus(result?.error || "Could not load this resource's content.", "err");
      }
      checkFunctionExists();
    }

    $("exChange").addEventListener("click", () => {
      selectedExistingLibrary = null;
      selectedExistingContent = null;
      $("exSelectedRow").classList.add("hidden");
      $("exSearch").classList.remove("hidden");
      $("exSearch").focus();
      if (scriptEditor) scriptEditor.setValue("");
    });

    $("exSearch").addEventListener("input", (e) => {
      clearTimeout(searchDebounce);
      const term = e.target.value.trim();
      searchDebounce = setTimeout(() => runResourceSearch(term), 300);
    });

    function checkFunctionExists() {
      const fn = $("nsFunction").value.trim();
      const warn = $("nsFunctionWarning");
      const currentContent = scriptEditor ? scriptEditor.getValue() : selectedExistingContent;
      if (nsMode !== "existing" || !currentContent || !fn) {
        warn.classList.add("hidden");
        return;
      }
      if (!currentContent.includes(fn)) {
        warn.textContent = `"${fn}" wasn't found in ${selectedExistingLibrary}'s content yet - add it below, or double check the spelling.`;
        warn.classList.remove("hidden");
      } else {
        warn.classList.add("hidden");
      }
    }
    $("nsFunction").addEventListener("blur", checkFunctionExists);

    $("nsFontSize").addEventListener("change", (e) => {
      if (scriptEditor) {
        scriptEditor.getWrapperElement().style.fontSize = `${e.target.value}px`;
        scriptEditor.refresh();
      }
    });

    function nsExtensionFor(fileType) {
      return { "3": "js", "2": "css", "1": "html", "4": "xml", "9": "resx" }[fileType] || "js";
    }

    function nsComputeFullLibraryName() {
      const prefix = $("nsPublisher").value;
      const ext = nsExtensionFor($("nsFileType").value);
      const base = $("nsLibrary").value.trim().replace(/^[/\\]+/, "").replace(/\.[a-zA-Z0-9]+$/, "");
      if (!base) return "";
      return prefix ? `${prefix}_${base}.${ext}` : `${base}.${ext}`;
    }

    function nsUpdatePreview() {
      $("nsLibraryPrefix").textContent = $("nsPublisher").value ? `${$("nsPublisher").value}_` : "";
      const full = nsComputeFullLibraryName();
      $("nsLibraryPreview").textContent = full ? `Will be saved as: ${full}` : "";
    }

    function updateNsOperationUI() {
      const isJs = $("nsFileType").value === "3";
      $("nsOperation").disabled = !isJs;
      $("nsFunctionRow").classList.toggle("hidden", !isJs);
      $("nsFieldRow").classList.toggle("hidden", !isJs || $("nsOperation").value !== "onchange");
    }

    function populateInlinePublisherSelect() {
      const select = $("nsPublisher");
      select.innerHTML = "";
      if (allPublishers.length === 0) {
        select.innerHTML = '<option value="">could not load publishers</option>';
        return;
      }
      allPublishers.forEach((p) => {
        const opt = document.createElement("option");
        opt.value = p.prefix;
        opt.textContent = `${p.prefix}_  (${p.name})`;
        select.appendChild(opt);
      });
      nsUpdatePreview();
    }

    function populateInlineSolutionSelect() {
      const select = $("nsSolution");
      select.innerHTML = '<option value="">(none - don\'t add to a solution)</option>';
      allSolutions.forEach((s) => {
        const opt = document.createElement("option");
        opt.value = s.uniqueName;
        opt.textContent = s.version ? `${s.name}  (v${s.version})` : s.name;
        select.appendChild(opt);
      });
    }

    $("nsFileType").addEventListener("change", (e) => {
      updateNsOperationUI();
      nsUpdatePreview();
      pendingOverwriteName = null;
      if (scriptEditor) scriptEditor.setOption("mode", cmModeFor(e.target.value));
    });
    $("nsOperation").addEventListener("change", updateNsOperationUI);
    $("nsPublisher").addEventListener("change", () => {
      nsUpdatePreview();
      pendingOverwriteName = null;
    });
    $("nsLibrary").addEventListener("input", () => {
      nsUpdatePreview();
      pendingOverwriteName = null;
    });

    $("nsPublish").addEventListener("click", async () => {
      if (!context?.formId) {
        setStatus("No form context detected yet.", "err");
        return;
      }
      const isJs = nsMode === "existing" ? true : $("nsFileType").value === "3";
      const libraryName = nsMode === "existing" ? selectedExistingLibrary : nsComputeFullLibraryName();

      const payload = {
        entityLogicalName: context.entityName,
        formId: context.formId,
        frameId: context.frameId,
        fileType: nsMode === "existing" ? 3 : parseInt($("nsFileType").value, 10),
        operation: isJs ? $("nsOperation").value : null,
        fieldName: isJs && $("nsOperation").value === "onchange" ? $("nsField").value.trim() : null,
        functionName: isJs ? $("nsFunction").value.trim() : null,
        libraryName,
        scriptContent: scriptEditor ? scriptEditor.getValue() : "",
        useExisting: false,
        enabled: $("nsEnabled").checked,
        passExecutionContext: $("nsPassContext").checked,
        parameters: $("nsParameters").value.trim(),
        solutionUniqueName: nsMode === "existing" ? null : $("nsSolution").value || null
      };

      if (nsMode === "existing") {
        if (!payload.libraryName || !payload.functionName || !payload.scriptContent) {
          setStatus("Pick an existing web resource, make sure it has content, and enter the function name to attach.", "err");
          return;
        }
      } else if (!payload.libraryName || !payload.scriptContent || (isJs && !payload.functionName)) {
        setStatus("Web resource name, script content, and (for JS) function name are required.", "err");
        return;
      }

      // Guard against silently overwriting an unrelated existing web resource
      // that just happens to share this name - only relevant when creating
      // something new (not editing a handler, which is meant to overwrite
      // the same resource, and not "Use existing" mode, which starts from
      // that resource's real content on purpose). Require an explicit
      // second Publish click to confirm.
      if (nsMode === "new" && !isEditingExisting) {
        if (pendingOverwriteName !== payload.libraryName) {
          setStatus("Checking if this name is already in use...", "info");
          const check = await send("CHECK_WEBRESOURCE_EXISTS", { frameId: context.frameId, name: payload.libraryName });
          if (check?.ok && check.exists) {
            pendingOverwriteName = payload.libraryName;
            setStatus(
              `A web resource named "${payload.libraryName}" already exists. Click Publish again to overwrite its content, or change the name to create a separate one.`,
              "err"
            );
            return;
          }
        }
      }

      setStatus("Publishing...", "info");
      const result = await send("PUBLISH", payload);
      if (result?.ok) {
        pendingOverwriteName = null;
        loadHandlers();
        if (payload.solutionUniqueName && result.solutionResult) {
          if (result.solutionResult.ok) {
            setStatus("Published and added to the selected solution. Click Hard refresh to load it.", "ok");
          } else {
            setStatus(
              `Published, but could NOT add it to the selected solution: ${result.solutionResult.error} (check console for details)`,
              "err"
            );
          }
        } else {
          setStatus("Published. Click Hard refresh to load it.", "ok");
        }
      } else {
        setStatus(`${result?.error || "Publish failed."} (full details logged to console)`, "err");
      }
    });

    $("nsHardRefresh").addEventListener("click", () => send("HARD_REFRESH", { orgUrl: context?.orgUrl }));

    $("hardRefresh").addEventListener("click", () => send("HARD_REFRESH", { orgUrl: context?.orgUrl }));

    $("status").addEventListener("click", () => {
      if ($("status").className.includes("err")) detectContext();
    });
    $("status").style.cursor = "pointer";

    $("toggle").addEventListener("click", () => {
      $("body").classList.toggle("hidden");
    });

    detectContext();
    refreshContextFn = detectContext;
  }

  let refreshContextFn = null;

  function togglePanelVisibility() {
    if (!host) {
      init();
      return;
    }
    const wasHidden = host.style.display === "none";
    host.style.display = wasHidden ? "" : "none";
    if (wasHidden && refreshContextFn) {
      refreshContextFn(1);
    }
  }

  // D365/UCI is largely an SPA - navigating to a different record (via a
  // subgrid link, global search, breadcrumb, etc.) very often does NOT
  // trigger a full page reload, so context detected once can go stale while
  // the panel sits open the whole time. Poll the URL's entity/record
  // identifiers and auto-refresh whenever they actually change, independent
  // of the panel's visibility toggle.
  function getRecordKeyFromUrl() {
    const params = new URLSearchParams(location.search);
    return `${params.get("etn")}|${params.get("id")}`;
  }

  let lastKnownRecordKey = getRecordKeyFromUrl();
  setInterval(() => {
    const currentKey = getRecordKeyFromUrl();
    if (currentKey !== lastKnownRecordKey) {
      lastKnownRecordKey = currentKey;
      if (host && refreshContextFn) refreshContextFn(1);
    }
  }, 1000);

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "TOGGLE_PANEL_VISIBILITY") {
      togglePanelVisibility();
    }
  });

  // The panel never appears automatically - it's created and shown only
  // when the toolbar icon is clicked (see popup.js -> TOGGLE_PANEL_VISIBILITY),
  // same as Power Pane's own show/hide behavior.
})();
