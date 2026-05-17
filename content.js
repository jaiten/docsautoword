(function () {
  if (window.__docsWordCountAutoRan) return;
  window.__docsWordCountAutoRan = true;

  const MAX_WAIT_MS = 15000;
  const CHECK_EVERY_MS = 500;

  function isMac() {
    return navigator.platform.toUpperCase().includes("MAC");
  }

  function waitForDocsReady(callback) {
    const start = Date.now();

    const timer = setInterval(() => {
      const ready =
        document.querySelector(".docs-presence-plus-container") ||
        document.querySelector(".kix-appview-editor") ||
        document.querySelector(".docs-titlebar-buttons");

      if (ready) {
        clearInterval(timer);
        callback();
        return;
      }

      if (Date.now() - start > MAX_WAIT_MS) {
        clearInterval(timer);
      }
    }, CHECK_EVERY_MS);
  }

  function hideWordCountDialog() {
    if (document.getElementById("docs-word-count-auto-hide")) return;

    const style = document.createElement("style");
    style.id = "docs-word-count-auto-hide";
    style.textContent = `
      .docs-dialog-container,
      .modal-dialog-bg {
        opacity: 0 !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }
    `;

    document.head.appendChild(style);
  }

  function unhideWordCountDialog() {
    document.getElementById("docs-word-count-auto-hide")?.remove();
  }

  function fireWordCountShortcut() {
    const mac = isMac();

    const iframe = document.querySelector(".docs-texteventtarget-iframe");
    const target =
      iframe?.contentDocument?.body ||
      document.querySelector(".kix-appview-editor") ||
      document.body;

    ["keydown", "keypress", "keyup"].forEach((type) => {
      const event = new KeyboardEvent(type, {
        key: "c",
        code: "KeyC",
        keyCode: 67,
        which: 67,
        ctrlKey: !mac,
        metaKey: mac,
        shiftKey: true,
        bubbles: true,
        cancelable: true
      });

      target.dispatchEvent(event);
    });
  }

  function findWordCountCheckbox() {
    const checkboxes = document.querySelectorAll(
      'input[type="checkbox"], [role="checkbox"]'
    );

    for (const checkbox of checkboxes) {
      const container =
        checkbox.closest("label") ||
        checkbox.parentElement ||
        checkbox.closest("div");

      const text = container?.textContent?.toLowerCase() || "";

      if (text.includes("display word count")) {
        return checkbox;
      }
    }

    const possibleLabels = document.querySelectorAll("label, div, span");

    for (const label of possibleLabels) {
      const text = label.textContent?.toLowerCase() || "";

      if (text.includes("display word count")) {
        return (
          label.querySelector('input[type="checkbox"], [role="checkbox"]') ||
          label.parentElement?.querySelector('input[type="checkbox"], [role="checkbox"]') ||
          label.previousElementSibling?.querySelector?.('input[type="checkbox"], [role="checkbox"]')
        );
      }
    }

    return null;
  }

  function findOkButton() {
    const buttons = document.querySelectorAll(
      "button, .goog-button, .jfk-button, [role='button']"
    );

    for (const button of buttons) {
      const text = button.textContent.trim().toLowerCase();

      if (text === "ok" || text === "okay" || text === "done") {
        return button;
      }
    }

    return (
      document.querySelector(".docs-dialog-buttons .goog-buttonset-default") ||
      document.querySelector(".goog-buttonset-default")
    );
  }

  function enableDisplayWordCount() {
    hideWordCountDialog();
    fireWordCountShortcut();

    let attempts = 0;
    const watcher = setInterval(() => {
      attempts++;

      const checkbox = findWordCountCheckbox();

      if (checkbox) {
        clearInterval(watcher);

        const isChecked =
          checkbox.checked === true ||
          checkbox.getAttribute("aria-checked") === "true";

        if (!isChecked) {
          checkbox.click();
        }

        setTimeout(() => {
          findOkButton()?.click();

          setTimeout(() => {
            unhideWordCountDialog();
          }, 300);
        }, 100);

        return;
      }

      if (attempts > 40) {
        clearInterval(watcher);
        unhideWordCountDialog();
      }
    }, 100);
  }

  waitForDocsReady(() => {
    setTimeout(enableDisplayWordCount, 1000);
  });
})();