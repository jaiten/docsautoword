(function () {
  "use strict";

  if (window.__docsWordCountAutoRan) return;
  window.__docsWordCountAutoRan = true;

  // Nothing here waits on a fixed clock if it can help it. Every step is keyed
  // to a real DOM signal (a MutationObserver batch or an animation frame), so
  // the script moves the instant Docs is ready instead of on a poll boundary.
  const READY_TIMEOUT_MS = 20000; // stop waiting for the editor to exist
  const DIALOG_TIMEOUT_MS = 6000; // stop waiting for the dialog to open
  const RETRY_FIRST_MS = 80; // first re-fire comes quickly...
  const RETRY_MAX_MS = 250; // ...then backs off to this
  const RETRY_BUDGET_MS = 5000; // total time spent re-firing the shortcut
  const UNHIDE_DEADLINE_MS = 3000; // failsafe: never leave dialogs hidden
  const COALESCE_FALLBACK_MS = 100; // used only when frames are not being served

  const HIDE_STYLE_ID = "docs-word-count-auto-hide";
  const WORD_COUNT_LABEL = "display word count";
  const CHECKBOX_SELECTOR = 'input[type="checkbox"], [role="checkbox"]';
  const DIALOG_SELECTOR =
    ".docs-dialog-container, .modal-dialog, .modal-dialog-bg, .goog-modalpopup, .goog-modalpopup-bg";
  const DIALOG_ROOT_SELECTOR =
    ".docs-dialog-container, .modal-dialog, .goog-modalpopup";

  function isMac() {
    const platform = navigator.userAgentData?.platform || navigator.platform || "";
    return platform.toUpperCase().includes("MAC");
  }

  // An element with no client rects is display:none or detached. visibility
  // and opacity (which is all the hide style touches) leave rects intact, so
  // this reports what Docs is doing, not what we did.
  function isLaidOut(element) {
    return !!element && element.getClientRects().length > 0;
  }

  function dialogRoot() {
    for (const element of document.querySelectorAll(DIALOG_ROOT_SELECTOR)) {
      if (isLaidOut(element)) return element;
    }
    return null;
  }

  function dialogVisible() {
    for (const element of document.querySelectorAll(DIALOG_SELECTOR)) {
      if (isLaidOut(element)) return true;
    }
    return false;
  }

  function wordCountBarVisible() {
    for (const element of document.querySelectorAll('[class*="wordcount"]')) {
      if (isLaidOut(element) && element.textContent.trim()) return true;
    }
    return false;
  }

  // Runs `fn` once, on the next frame -- or on a short timer if frames are not
  // being served (a Doc opened in a background tab). Loading a Doc fires
  // thousands of mutations, so coalescing per frame keeps the cost of watching
  // flat instead of proportional to how busy the page is.
  function scheduleCheck(fn) {
    let ran = false;

    const run = () => {
      if (ran) return;
      ran = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(run, COALESCE_FALLBACK_MS);
    requestAnimationFrame(run);
  }

  // Runs `predicate` now, then after every mutation batch until it passes or
  // the deadline expires. Replaces the fixed-interval polling: no wasted
  // wake-ups while Docs loads, and no poll-boundary lag once it is ready.
  function waitFor(predicate, { timeout, onMatch, onTimeout }) {
    if (predicate()) {
      onMatch();
      return;
    }

    let settled = false;
    let pending = false;
    let timer = 0;

    function settle(matched) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      observer.disconnect();
      if (matched) onMatch();
      else if (onTimeout) onTimeout();
    }

    const observer = new MutationObserver(() => {
      if (settled || pending) return;
      pending = true;

      scheduleCheck(() => {
        pending = false;
        if (!settled && predicate()) settle(true);
      });
    });

    timer = setTimeout(() => settle(false), timeout);
    observer.observe(document, { childList: true, subtree: true });
  }

  function hideDialogs() {
    if (document.getElementById(HIDE_STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = HIDE_STYLE_ID;
    style.textContent = `
      ${DIALOG_SELECTOR} {
        opacity: 0 !important;
        visibility: hidden !important;
        pointer-events: none !important;
        transition: none !important;
        animation: none !important;
      }
    `;

    (document.head || document.documentElement).appendChild(style);
  }

  function unhideDialogs() {
    document.getElementById(HIDE_STYLE_ID)?.remove();
  }

  function fireWordCountShortcut() {
    const mac = isMac();

    const iframe = document.querySelector(".docs-texteventtarget-iframe");
    const target =
      iframe?.contentDocument?.body ||
      document.querySelector(".kix-appview-editor") ||
      document.body;

    if (!target) return;

    for (const type of ["keydown", "keypress", "keyup"]) {
      target.dispatchEvent(
        new KeyboardEvent(type, {
          key: "c",
          code: "KeyC",
          keyCode: 67,
          which: 67,
          ctrlKey: !mac,
          metaKey: mac,
          shiftKey: true,
          bubbles: true,
          cancelable: true
        })
      );
    }
  }

  function findWordCountCheckbox() {
    // Docs keeps only a handful of checkboxes in the DOM, so this stays cheap
    // even though it runs on every mutation batch. The expensive text sweep
    // below is scoped to the dialog and only runs once one is actually open.
    for (const box of document.querySelectorAll(CHECKBOX_SELECTOR)) {
      const text = [
        box.getAttribute("aria-label") || "",
        box.closest("label")?.textContent || box.parentElement?.textContent || ""
      ]
        .join(" ")
        .toLowerCase();

      if (text.includes(WORD_COUNT_LABEL)) return box;
    }

    const root = dialogRoot();
    if (!root) return null;

    for (const node of root.querySelectorAll("label, div, span")) {
      const text = node.textContent?.toLowerCase() || "";
      if (!text.includes(WORD_COUNT_LABEL)) continue;

      const box =
        node.querySelector(CHECKBOX_SELECTOR) ||
        node.parentElement?.querySelector(CHECKBOX_SELECTOR);

      if (box) return box;
    }

    return null;
  }

  function findOkButton() {
    const root = dialogRoot() || document;

    for (const button of root.querySelectorAll(
      "button, .goog-button, .jfk-button, [role='button']"
    )) {
      const text = button.textContent.trim().toLowerCase();
      if (text === "ok" || text === "okay" || text === "done") return button;
    }

    return (
      root.querySelector(".docs-dialog-buttons .goog-buttonset-default") ||
      root.querySelector(".goog-buttonset-default") ||
      document.querySelector(".goog-buttonset-default")
    );
  }

  // Unhide on the first frame after Docs has actually torn the dialog down,
  // rather than guessing with a fixed delay.
  function unhideWhenDialogCloses() {
    let done = false;

    function finish() {
      if (done) return;
      done = true;
      clearTimeout(failsafe);
      unhideDialogs();
    }

    // Hard deadline on a plain timer, so the hide style can never outlive the
    // operation even if frames stop being served mid-way.
    const failsafe = setTimeout(finish, UNHIDE_DEADLINE_MS);

    (function check() {
      if (done) return;
      if (!dialogVisible()) {
        finish();
        return;
      }
      scheduleCheck(check);
    })();
  }

  function applySetting() {
    const checkbox = findWordCountCheckbox();

    if (checkbox) {
      const isChecked =
        checkbox.checked === true ||
        checkbox.getAttribute("aria-checked") === "true";

      if (!isChecked) checkbox.click();
    }

    // One task turn for Docs to process the toggle before confirming, instead
    // of the 100ms the old flow spent here.
    setTimeout(() => {
      findOkButton()?.click();
      unhideWhenDialogCloses();
    }, 0);
  }

  function openDialogAndEnable() {
    // Fast path: once Docs has persisted the setting the bar is already there,
    // so the whole dialog round trip (and any chance of stealing focus) is
    // skipped entirely.
    if (wordCountBarVisible()) return;

    hideDialogs();
    fireWordCountShortcut();

    // A shortcut fired before Docs binds its key handler is silently dropped,
    // and the editor shell renders well before that handler exists. So re-fire
    // -- quickly at first, since the gap is usually short, then backing off for
    // documents that take their time. Never re-fire while a dialog is already
    // open: the second press would land on the dialog instead.
    let delay = RETRY_FIRST_MS;
    let retryTimer = 0;
    const giveUpAt = Date.now() + RETRY_BUDGET_MS;

    function scheduleRetry() {
      retryTimer = setTimeout(() => {
        if (dialogVisible() || Date.now() > giveUpAt) return;

        fireWordCountShortcut();
        delay = Math.min(Math.round(delay * 1.5), RETRY_MAX_MS);
        scheduleRetry();
      }, delay);
    }

    scheduleRetry();

    waitFor(() => findWordCountCheckbox() !== null, {
      timeout: DIALOG_TIMEOUT_MS,
      onMatch: () => {
        clearTimeout(retryTimer);
        applySetting();
      },
      onTimeout: () => {
        clearTimeout(retryTimer);
        unhideDialogs();
      }
    });
  }

  function start() {
    // Docs routes keystrokes through a hidden iframe; until the editor shell
    // exists there is nothing listening for the shortcut.
    waitFor(
      () =>
        !!document.querySelector(".docs-texteventtarget-iframe") ||
        !!document.querySelector(".kix-appview-editor"),
      { timeout: READY_TIMEOUT_MS, onMatch: openDialogAndEnable }
    );
  }

  start();
})();
