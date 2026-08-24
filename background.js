console.log("[D365 devtool] background.js loaded - build 2026-08-24-toolbar-retry-v1");

// ---------------------------------------------------------------------------
// These three functions run INSIDE THE PAGE (world: 'MAIN'), not in the
// extension's own context. That's what gives them access to window.Xrm and
// the page's authenticated session. Because chrome.scripting serializes them
// to inject, they must be fully self-contained: no references to anything
// outside their own body.
// ---------------------------------------------------------------------------

function bridgeGetContext() {
  if (!window.Xrm) {
    return { ok: false, error: "Xrm not found on this page yet. Wait for the form to finish loading." };
  }
  try {
    const globalContext = Xrm.Utility.getGlobalContext ? Xrm.Utility.getGlobalContext() : null;
    const orgUrl = globalContext?.getClientUrl?.() || null;
    const entityName = Xrm.Page?.data?.entity?.getEntityName?.() || null;

    let formId = null;
    try {
      const current = Xrm.Page?.ui?.formSelector?.getCurrentItem?.();
      if (current) formId = current.getId?.()?.replace(/[{}]/g, "") || null;
    } catch (_) {
      formId = null;
    }
    if (!formId) {
      // Fallback: entities with only one form sometimes don't populate
      // getCurrentItem() (nothing to "select" when there's just one), but
      // the items collection still lists it.
      try {
        const items = Xrm.Page?.ui?.formSelector?.items?.get?.();
        if (items && items.length > 0) {
          formId = items[0].getId?.()?.replace(/[{}]/g, "") || null;
        }
      } catch (_) {
        formId = null;
      }
    }
    const fields = [];
    if (Xrm.Page?.data?.entity?.attributes) {
      Xrm.Page.data.entity.attributes.forEach((attr) => {
        const name = attr.getName();
        const type = attr.getAttributeType?.() || "unknown";
        const field = { name, type };

        try {
          field.requiredLevel = attr.getRequiredLevel?.() || null;
        } catch (_) {
          field.requiredLevel = null;
        }
        try {
          field.format = attr.getFormat?.() || null;
        } catch (_) {
          field.format = null;
        }
        try {
          if ((type === "optionset" || type === "multiselectoptionset" || type === "boolean") && attr.getOptions) {
            field.options = attr.getOptions().map((o) => ({ value: o.value, text: o.text }));
          } else {
            field.options = null;
          }
        } catch (_) {
          field.options = null;
        }
        try {
          if (type === "lookup") {
            const control = Xrm.Page.getControl ? Xrm.Page.getControl(name) : null;
            field.lookupTargets = control?.getEntityTypes ? control.getEntityTypes() : null;
          } else {
            field.lookupTargets = null;
          }
        } catch (_) {
          field.lookupTargets = null;
        }

        fields.push(field);
      });
    }
    if (!entityName) {
      return { ok: false, error: "Xrm found but no entity context yet (form still loading)." };
    }
    return { ok: true, orgUrl, entityName, formId, fields };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

async function bridgeGetHandlers(formId) {
  try {
    const rec = await Xrm.WebApi.retrieveRecord("systemform", formId, "?$select=formxml");
    const doc = new DOMParser().parseFromString(rec.formxml, "application/xml");
    const formEl = doc.documentElement.tagName.toLowerCase() === "form" ? doc.documentElement : doc.querySelector("form");

    function collectFrom(eventNode) {
      if (!eventNode) return [];
      const out = [];
      ["Handlers", "InternalHandlers"].forEach((tag) => {
        const container = Array.from(eventNode.children).find((c) => c.tagName === tag);
        if (!container) return;
        Array.from(container.getElementsByTagName("Handler")).forEach((h) => {
          out.push({
            functionName: h.getAttribute("functionName"),
            libraryName: h.getAttribute("libraryName"),
            enabled: h.getAttribute("enabled") !== "false",
            passExecutionContext: h.getAttribute("passExecutionContext") !== "false",
            parameters: h.getAttribute("parameters") || "",
            internal: tag === "InternalHandlers"
          });
        });
      });
      return out;
    }

    // Top-level form events - the only place OnLoad/OnSave actually fire from.
    const topEvents = Array.from(formEl.children).find((c) => c.tagName === "events");
    function collectTopLevel(eventName) {
      if (!topEvents) return [];
      const eventNode = Array.from(topEvents.children).find((e) => e.tagName === "event" && e.getAttribute("name") === eventName);
      return collectFrom(eventNode);
    }
    const onload = collectTopLevel("onload");
    const onsave = collectTopLevel("onsave");

    // OnChange's <events> lives as a SIBLING of <control> (both children of
    // <cell>), not inside <control> itself - <control> only permits
    // <labels>/<parameters> as children per the form schema.
    const onchangeRaw = [];
    Array.from(doc.getElementsByTagName("control")).forEach((control) => {
      const field = control.getAttribute("datafieldname");
      if (!field) return;
      const cell = control.parentElement;
      if (!cell) return;
      const events = Array.from(cell.children).find((c) => c.tagName === "events");
      if (!events) return;
      const eventNode = Array.from(events.children).find((e) => e.tagName === "event" && e.getAttribute("name") === "onchange");
      collectFrom(eventNode).forEach((h) => onchangeRaw.push({ ...h, field }));
    });
    // A field can have the same handler on multiple duplicate controls
    // (e.g. shown on more than one tab) - collapse those into one entry.
    const seen = new Set();
    const onchange = onchangeRaw.filter((h) => {
      const key = `${h.field}|${h.functionName}|${h.libraryName}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return { ok: true, onload, onsave, onchange };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

async function bridgeCheckWebResourceExists(name) {
  try {
    const result = await Xrm.WebApi.retrieveMultipleRecords("webresource", `?$select=webresourceid&$filter=name eq '${name}'`);
    return { ok: true, exists: result.entities.length > 0 };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

async function bridgeSearchWebResources(term, fileType) {
  try {
    const filterParts = [`webresourcetype eq ${fileType}`];
    if (term) {
      filterParts.push(`contains(name,'${term.replace(/'/g, "''")}')`);
    }
    const result = await Xrm.WebApi.retrieveMultipleRecords(
      "webresource",
      `?$select=name,displayname&$filter=${filterParts.join(" and ")}&$orderby=name&$top=25`
    );
    return { ok: true, resources: result.entities.map((r) => ({ name: r.name, displayName: r.displayname })) };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

async function bridgeGetWebResourceContent(libraryName) {
  try {
    const result = await Xrm.WebApi.retrieveMultipleRecords(
      "webresource",
      `?$select=content&$filter=name eq '${libraryName}'`
    );
    if (result.entities.length === 0) {
      return { ok: false, error: "Web resource not found." };
    }
    const base64 = result.entities[0].content;
    const text = decodeURIComponent(escape(atob(base64)));
    return { ok: true, content: text };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

async function bridgeGetPublishers() {
  try {
    const result = await Xrm.WebApi.retrieveMultipleRecords(
      "publisher",
      "?$select=friendlyname,customizationprefix,publisherid&$orderby=friendlyname"
    );
    return {
      ok: true,
      publishers: result.entities.map((p) => ({
        id: p.publisherid,
        name: p.friendlyname,
        prefix: p.customizationprefix
      }))
    };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

async function bridgeGetSolutions() {
  try {
    // Only unmanaged, visible solutions - you can't add components to a
    // managed solution, and hidden ones aren't meant to be picked directly.
    const result = await Xrm.WebApi.retrieveMultipleRecords(
      "solution",
      "?$select=friendlyname,uniquename,solutionid,version&$filter=isvisible eq true and ismanaged eq false&$orderby=friendlyname"
    );
    return {
      ok: true,
      solutions: result.entities.map((s) => ({
        id: s.solutionid,
        name: s.friendlyname,
        uniqueName: s.uniquename,
        version: s.version
      }))
    };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

async function bridgeRemoveHandler(formId, libraryName, functionName, entityLogicalName) {
  try {
    const rec = await Xrm.WebApi.retrieveRecord("systemform", formId, "?$select=formxml");
    const doc = new DOMParser().parseFromString(rec.formxml, "application/xml");
    const parseErr = doc.querySelector("parsererror");
    if (parseErr) throw new Error("Could not parse form XML.");

    // Search the WHOLE document, not just the top-level events block - the
    // point is to clean up stray handlers wherever a buggy earlier publish
    // may have put them (e.g. nested inside a field's own events block).
    const handlers = Array.from(doc.getElementsByTagName("Handler")).filter(
      (h) => h.getAttribute("functionName") === functionName && h.getAttribute("libraryName") === libraryName
    );

    if (handlers.length === 0) {
      return { ok: true, removedCount: 0 };
    }

    handlers.forEach((h) => {
      const handlersParent = h.parentElement; // <Handlers> or <InternalHandlers>
      handlersParent.removeChild(h);

      if (handlersParent.children.length === 0) {
        const eventNode = handlersParent.parentElement; // <event>
        eventNode.removeChild(handlersParent);

        const hasAnyHandlerContainer = Array.from(eventNode.children).some(
          (c) => c.tagName === "Handlers" || c.tagName === "InternalHandlers"
        );
        if (!hasAnyHandlerContainer) {
          const eventsParent = eventNode.parentElement; // <events>
          eventsParent.removeChild(eventNode);

          if (eventsParent.children.length === 0) {
            eventsParent.parentElement.removeChild(eventsParent);
          }
        }
      }
    });

    // Drop the <Library> entry too, but only if nothing else still references it.
    const stillUsed = Array.from(doc.getElementsByTagName("Handler")).some(
      (h) => h.getAttribute("libraryName") === libraryName
    );
    if (!stillUsed) {
      const libNode = Array.from(doc.getElementsByTagName("Library")).find((l) => l.getAttribute("name") === libraryName);
      if (libNode) libNode.parentElement.removeChild(libNode);
    }

    const newXml = new XMLSerializer().serializeToString(doc);
    await Xrm.WebApi.updateRecord("systemform", formId, { formxml: newXml });
    await Xrm.WebApi.online.execute({
      getMetadata: () => ({
        boundParameter: null,
        parameterTypes: { ParameterXml: { typeName: "Edm.String", structuralProperty: 1 } },
        operationType: 0,
        operationName: "PublishXml"
      }),
      ParameterXml: `<importexportxml><entities><entity>${entityLogicalName}</entity></entities></importexportxml>`
    });

    return { ok: true, removedCount: handlers.length, libraryRemoved: !stillUsed };
  } catch (e) {
    console.error("[D365 devtool] remove handler failed:", e);
    return { ok: false, error: e.message || String(e) };
  }
}

async function bridgePublish(params) {
  const {
    entityLogicalName,
    formId,
    operation,
    fieldName,
    functionName,
    libraryName,
    scriptContent,
    fileType,
    useExisting,
    enabled,
    passExecutionContext,
    parameters,
    solutionUniqueName
  } = params;

  try {
    const isValidGuid = (v) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

    let wrId = null;
    if (!useExisting) {
      wrId = await upsertWebResource(libraryName, scriptContent, fileType || 3);

      // Defensive: if upsert didn't return something that actually looks
      // like a real GUID - not just "truthy" (the literal string
      // "undefined" is truthy but obviously not a valid id) - re-fetch it
      // by name before doing anything that requires a real GUID.
      if (!isValidGuid(wrId)) {
        console.warn("[D365 devtool] upsertWebResource returned an invalid id:", JSON.stringify(wrId), "- attempting fallback lookup by name:", libraryName);
        const lookup = await Xrm.WebApi.retrieveMultipleRecords(
          "webresource",
          `?$select=webresourceid&$filter=name eq '${libraryName}'`
        );
        wrId = lookup.entities[0]?.webresourceid || null;
        console.warn("[D365 devtool] Fallback lookup result:", JSON.stringify(wrId));
      }

      await publishXml(`<importexportxml><webresources><webresource>{${wrId}}</webresource></webresources></importexportxml>`);

      var solutionResult = null;
      if (solutionUniqueName) {
        if (!isValidGuid(wrId)) {
          solutionResult = { ok: false, error: `Could not resolve a valid web resource id (got: ${JSON.stringify(wrId)}).` };
          console.error("[D365 devtool]", solutionResult.error, "Skipping AddSolutionComponent.");
        } else {
          try {
            await addToSolution(wrId, solutionUniqueName);
            solutionResult = { ok: true };
          } catch (solutionError) {
            // Don't let a solution-membership failure abort the whole
            // publish - the script/form wiring below is the important part.
            // Surface this separately so it's visible instead of silent.
            console.error("[D365 devtool] AddSolutionComponent failed:", solutionError);
            solutionResult = { ok: false, error: solutionError.message || String(solutionError) };
          }
        }
      }
    }

    // Only patch form events for JavaScript (webresourcetype 3) - other file
    // types (CSS, HTML, XML, RESX) are just uploaded/published, not wired to events.
    if ((fileType || 3) === 3 && operation) {
      const form = await Xrm.WebApi.retrieveRecord("systemform", formId, "?$select=formxml");
      const patchedXml = patchFormXml(form.formxml, {
        libraryName,
        functionName,
        operation,
        fieldName,
        enabled,
        passExecutionContext,
        parameters
      });
      await Xrm.WebApi.updateRecord("systemform", formId, { formxml: patchedXml });
      await publishXml(`<importexportxml><entities><entity>${entityLogicalName}</entity></entities></importexportxml>`);

      // Verify: re-read the form and confirm our handler is actually present
      // in the correct location - the TOP-LEVEL form <events> block for
      // OnLoad/OnSave, or the specific field's <cell> for OnChange. A naive
      // substring check would also pass if the handler got attached to some
      // unrelated nested field/cell's own <events> block, which never
      // actually fires even though it's valid, published XML.
      const verifyRec = await Xrm.WebApi.retrieveRecord("systemform", formId, "?$select=formxml");
      const verifyDoc = new DOMParser().parseFromString(verifyRec.formxml, "application/xml");
      const verifyFormEl =
        verifyDoc.documentElement.tagName.toLowerCase() === "form" ? verifyDoc.documentElement : verifyDoc.querySelector("form");

      let hasHandler = false;
      if (operation === "onchange") {
        const verifyControls = Array.from(verifyDoc.getElementsByTagName("control")).filter(
          (c) => c.getAttribute("datafieldname") === fieldName
        );
        hasHandler =
          verifyControls.length > 0 &&
          verifyControls.every((control) => {
            const cell = control.parentElement;
            const cellEvents = cell ? Array.from(cell.children).find((c) => c.tagName === "events") : null;
            return cellEvents
              ? Array.from(cellEvents.getElementsByTagName("Handler")).some(
                  (h) => h.getAttribute("functionName") === functionName && h.getAttribute("libraryName") === libraryName
                )
              : false;
          });
      } else {
        const topLevelEvents = Array.from(verifyFormEl.children).find((c) => c.tagName === "events");
        hasHandler = topLevelEvents
          ? Array.from(topLevelEvents.getElementsByTagName("Handler")).some(
              (h) => h.getAttribute("functionName") === functionName && h.getAttribute("libraryName") === libraryName
            )
          : false;
      }

      if (!hasHandler) {
        return {
          ok: false,
          error:
            "Update call succeeded, but the handler was not found in the expected location afterward. " +
            "Check that the Form Id (and Field, for OnChange) match what you're actually viewing."
        };
      }
    }

    return { ok: true, webResourceId: wrId, solutionResult: typeof solutionResult !== "undefined" ? solutionResult : null };
  } catch (e) {
    // Log the FULL raw error object to the page's own console (visible via
    // F12 on the D365 tab) - e.message alone is often a generic platform
    // string that hides the actual OData error code/details underneath.
    console.error("[D365 devtool] publish failed - full error object:", e);
    try {
      console.error("[D365 devtool] error as JSON:", JSON.stringify(e, Object.getOwnPropertyNames(e)));
    } catch (_) {
      /* ignore stringify failures */
    }
    return { ok: false, error: e.message || String(e) };
  }

  async function upsertWebResource(name, content, webresourcetype) {
    const base64 = btoa(unescape(encodeURIComponent(content)));
    const existing = await Xrm.WebApi.retrieveMultipleRecords(
      "webresource",
      `?$select=webresourceid&$filter=name eq '${name}'`
    );
    if (existing.entities.length > 0) {
      const id = existing.entities[0].webresourceid;
      await Xrm.WebApi.updateRecord("webresource", id, { content: base64 });
      return id;
    }
    const created = await Xrm.WebApi.createRecord("webresource", {
      name,
      displayname: name,
      webresourcetype,
      content: base64
    });
    return created.id;
  }

  async function addToSolution(componentId, solutionUniqueName) {
    return Xrm.WebApi.online.execute({
      getMetadata: () => ({
        boundParameter: null,
        parameterTypes: {
          // Edm.Guid here has a known client-side execute() bug that sends
          // the literal string "undefined" regardless of the actual value.
          // Edm.String works around it - the server still parses a
          // well-formed GUID string correctly against the real Guid field.
          ComponentId: { typeName: "Edm.String", structuralProperty: 1 },
          ComponentType: { typeName: "Edm.Int32", structuralProperty: 1 },
          SolutionUniqueName: { typeName: "Edm.String", structuralProperty: 1 },
          AddRequiredComponents: { typeName: "Edm.Boolean", structuralProperty: 1 },
          DoNotIncludeSubcomponents: { typeName: "Edm.Boolean", structuralProperty: 1 }
        },
        operationType: 0,
        operationName: "AddSolutionComponent"
      }),
      ComponentId: componentId,
      ComponentType: 61, // Web Resource
      SolutionUniqueName: solutionUniqueName,
      AddRequiredComponents: false,
      DoNotIncludeSubcomponents: false // only valid as true for Entity (type 1) components
    });
  }

  async function publishXml(paramXml) {
    return Xrm.WebApi.online.execute({
      getMetadata: () => ({
        boundParameter: null,
        parameterTypes: { ParameterXml: { typeName: "Edm.String", structuralProperty: 1 } },
        operationType: 0,
        operationName: "PublishXml"
      }),
      ParameterXml: paramXml
    });
  }

  function patchFormXml(xmlString, opts) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, "application/xml");
    const err = doc.querySelector("parsererror");
    if (err) throw new Error("Could not parse form XML.");

    const formEl = doc.documentElement.tagName.toLowerCase() === "form" ? doc.documentElement : doc.querySelector("form");

    let formLibraries = doc.querySelector("formLibraries");
    if (!formLibraries) {
      formLibraries = doc.createElement("formLibraries");
      formEl.prepend(formLibraries);
    }
    let libNode = Array.from(formLibraries.getElementsByTagName("Library")).find(
      (l) => l.getAttribute("name") === opts.libraryName
    );
    if (!libNode) {
      libNode = doc.createElement("Library");
      libNode.setAttribute("name", opts.libraryName);
      libNode.setAttribute("libraryUniqueId", crypto.randomUUID());
      formLibraries.appendChild(libNode);
    }

    function ensureHandler(eventsParent, eventName, insertBefore) {
      let events = Array.from(eventsParent.children).find((c) => c.tagName === "events");
      if (!events) {
        events = doc.createElement("events");
        // Schema enforces element order (labels, events, control, ...) - a
        // freshly-created <events> must land BEFORE <control>, not just get
        // appended at the end, or the platform rejects the whole form XML.
        if (insertBefore) {
          eventsParent.insertBefore(events, insertBefore);
        } else {
          eventsParent.appendChild(events);
        }
      }
      let eventNode = Array.from(events.getElementsByTagName("event")).find(
        (e) => e.getAttribute("name") === eventName
      );
      if (!eventNode) {
        eventNode = doc.createElement("event");
        eventNode.setAttribute("name", eventName);
        eventNode.setAttribute("application", "true");
        eventNode.setAttribute("active", "true");
        const handlers = doc.createElement("Handlers");
        eventNode.appendChild(handlers);
        events.appendChild(eventNode);
      }
      const handlers = eventNode.getElementsByTagName("Handlers")[0];
      let handler = Array.from(handlers.getElementsByTagName("Handler")).find(
        (h) => h.getAttribute("functionName") === opts.functionName && h.getAttribute("libraryName") === opts.libraryName
      );
      if (!handler) {
        handler = doc.createElement("Handler");
        handler.setAttribute("functionName", opts.functionName);
        handler.setAttribute("libraryName", opts.libraryName);
        handler.setAttribute("handlerUniqueId", crypto.randomUUID());
        handlers.appendChild(handler);
      }
      // Always sync these - whether the handler is brand new or already existed,
      // so editing an existing handler's settings actually takes effect instead
      // of silently keeping whatever was there before.
      handler.setAttribute("enabled", opts.enabled === false ? "false" : "true");
      handler.setAttribute("parameters", opts.parameters || "");
      handler.setAttribute("passExecutionContext", opts.passExecutionContext === false ? "false" : "true");
    }

    if (opts.operation === "onload" || opts.operation === "onsave") {
      ensureHandler(formEl, opts.operation);
    } else if (opts.operation === "onchange") {
      const controls = Array.from(doc.getElementsByTagName("control")).filter(
        (c) => c.getAttribute("datafieldname") === opts.fieldName
      );
      if (controls.length === 0) throw new Error(`Field "${opts.fieldName}" not found on this form.`);
      // A field can appear as more than one <control> if it's placed on
      // multiple tabs/sections (a common D365 pattern). Wire every instance
      // so the handler fires regardless of which one the user interacts
      // with, not just whichever happened to come first in the document.
      controls.forEach((control) => {
        // <events> must be a SIBLING of <control> (both children of <cell>) -
        // <control> itself only permits <labels>/<parameters> as children.
        const cell = control.parentElement;
        ensureHandler(cell, "onchange", control);
      });
    }

    return new XMLSerializer().serializeToString(doc);
  }
}

// ---------------------------------------------------------------------------
// Extension-side message router
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = msg.payload?.tabId ?? sender.tab?.id;
  if (!tabId) return;

  if (msg.type === "GET_CONTEXT") {
    (async () => {
      try {
        // Unified Interface renders the form inside a nested iframe, so Xrm
        // usually isn't on the top frame. Inject into every frame and see
        // which one actually has it.
        const results = await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          world: "MAIN",
          func: bridgeGetContext
        });
        const hit = results.find((r) => r.result?.ok);
        if (!hit) {
          const anyError = results.find((r) => r.result?.error)?.result?.error;
          sendResponse({ ok: false, error: anyError || "Xrm not found in any frame on this page." });
          return;
        }
        sendResponse({ ...hit.result, frameId: hit.frameId });
      } catch (e) {
        sendResponse({ ok: false, error: e.message || String(e) });
      }
    })();
    return true;
  }

  if (msg.type === "GET_HANDLERS") {
    chrome.scripting
      .executeScript({
        target: { tabId, frameIds: [msg.payload?.frameId ?? 0] },
        world: "MAIN",
        func: bridgeGetHandlers,
        args: [msg.payload.formId]
      })
      .then((r) => sendResponse(r[0]?.result))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.type === "CHECK_WEBRESOURCE_EXISTS") {
    chrome.scripting
      .executeScript({
        target: { tabId, frameIds: [msg.payload?.frameId ?? 0] },
        world: "MAIN",
        func: bridgeCheckWebResourceExists,
        args: [msg.payload.name]
      })
      .then((r) => sendResponse(r[0]?.result))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.type === "SEARCH_WEBRESOURCES") {
    chrome.scripting
      .executeScript({
        target: { tabId, frameIds: [msg.payload?.frameId ?? 0] },
        world: "MAIN",
        func: bridgeSearchWebResources,
        args: [msg.payload.term || "", msg.payload.fileType]
      })
      .then((r) => sendResponse(r[0]?.result))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.type === "GET_WEBRESOURCE_CONTENT") {
    chrome.scripting
      .executeScript({
        target: { tabId, frameIds: [msg.payload?.frameId ?? 0] },
        world: "MAIN",
        func: bridgeGetWebResourceContent,
        args: [msg.payload.libraryName]
      })
      .then((r) => sendResponse(r[0]?.result))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.type === "GET_SOLUTIONS") {
    chrome.scripting
      .executeScript({
        target: { tabId, frameIds: [msg.payload?.frameId ?? 0] },
        world: "MAIN",
        func: bridgeGetSolutions
      })
      .then((r) => sendResponse(r[0]?.result))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.type === "GET_PUBLISHERS") {
    chrome.scripting
      .executeScript({
        target: { tabId, frameIds: [msg.payload?.frameId ?? 0] },
        world: "MAIN",
        func: bridgeGetPublishers
      })
      .then((r) => sendResponse(r[0]?.result))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.type === "PUBLISH") {
    (async () => {
      try {
        const result = await chrome.scripting.executeScript({
          target: { tabId, frameIds: [msg.payload.frameId ?? 0] },
          world: "MAIN",
          func: bridgePublish,
          args: [msg.payload]
        });
        sendResponse(result[0]?.result);
      } catch (e) {
        sendResponse({ ok: false, error: e.message || String(e) });
      }
    })();
    return true;
  }

  if (msg.type === "REMOVE_HANDLER") {
    (async () => {
      const result = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [msg.payload.frameId ?? 0] },
        world: "MAIN",
        func: bridgeRemoveHandler,
        args: [msg.payload.formId, msg.payload.libraryName, msg.payload.functionName, msg.payload.entityLogicalName]
      });
      sendResponse(result[0]?.result);
    })();
    return true;
  }

  if (msg.type === "HARD_REFRESH") {
    (async () => {
      const originUrl = msg.payload?.orgUrl;
      if (originUrl) {
        try {
          // D365/UCI caches web resource content and metadata in its own
          // IndexedDB store (visible in the page console as
          // "[storage] ClientBrowserStore..."), well beyond plain HTTP
          // cache. A cache-bypassing tab reload alone doesn't touch that,
          // which is why a script update can take several hard refreshes
          // to actually show up. Clear both, scoped to just this origin.
          await chrome.browsingData.remove(
            { origins: [originUrl] },
            { cache: true, indexedDB: true, cacheStorage: true, serviceWorkers: true }
          );
        } catch (e) {
          console.error("[D365 devtool] browsingData.remove failed:", e);
        }
      }
      chrome.tabs.reload(tabId, { bypassCache: true });
      sendResponse({ ok: true });
    })();
    return true;
  }
});

// Toolbar icon toggling is now handled by popup.html/popup.js - a
// declarative default_popup, which works via manifest configuration alone
// rather than the chrome.action JS API (which was unavailable in this
// environment for reasons unrelated to our manifest, which was confirmed
// correct). Note: onClick would never fire once a default_popup is set
// anyway, so there's nothing to register here.

