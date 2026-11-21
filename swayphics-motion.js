
(function () {
  "use strict";

  if (window.__swayphicsMotionReady) return;
  window.__swayphicsMotionReady = true;

  var reducedMotion = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : { matches: false };

  var revealSelector = [
    ".hero-intro",
    ".hero-showcase",
    ".services-intro",
    ".package-card",
    ".custom-services-header",
    ".service-category",
    ".why-header",
    ".why-card",
    ".testimonials-header",
    ".testimonial-card",
    ".testimonials-cta",
    ".selected-work-header",
    ".about-content",
    ".about-belief",
    ".innerme-intro",
    ".innerme-card",
    ".sway-journey-copy",
    ".sway-journey-graphic",
    ".sp-hero-grid > *",
    ".sp-process .sp-step",
    ".sp-faq details",
    ".sp-benefit",
    ".sp-feature-card",
    ".admin-intro",
    ".sway-admin-workspace",
    ".sway-workspace-grid > *",
    ".sway-stat-card",
    ".sway-workspace-card",
    ".sway-chart-card",
    ".portfolio-admin-list > *",
    ".testimonials-admin-list > *",
    ".testimonial-admin-card",
    ".portal-hero",
    ".next-step-card",
    ".portal-section-head",
    ".stat-card",
    ".portal-card",
    ".finance-overview-panel",
    ".project-item",
    ".portal-document-card",
    ".onboarding-section",
    ".onboarding-progress",
    ".testimonial-page .brand",
    ".testimonial-intro",
    ".testimonial-page .testimonial-card",
    ".testimonial-form > .form-row",
    ".testimonial-form > .form-group"
  ].join(",");

  var revealObserver = null;

  function drawCharts(root) {
    if (!root || !root.querySelectorAll) return;

    var paths = [];
    if (root.matches && root.matches("path.sway-chart-line,path.sway-journey-growth-line")) {
      paths.push(root);
    }

    root.querySelectorAll("path.sway-chart-line,path.sway-journey-growth-line").forEach(function (path) {
      paths.push(path);
    });

    paths.forEach(function (path) {
      if (path.dataset.swayMotionDrawn === "true") return;

      if (reducedMotion.matches) {
        path.style.strokeDashoffset = "0";
        path.dataset.swayMotionDrawn = "true";
        return;
      }

      if (path.closest && path.closest(".sway-motion-pending")) return;

      try {
        var length = path.getTotalLength();
        if (!Number.isFinite(length) || length <= 0) return;

        path.style.strokeDasharray = String(length);
        path.style.strokeDashoffset = String(length);
        path.classList.add("sway-motion-chart-path");

        window.requestAnimationFrame(function () {
          window.requestAnimationFrame(function () {
            path.style.strokeDashoffset = "0";
            path.dataset.swayMotionDrawn = "true";
          });
        });
      } catch (error) {
        /* A chart that cannot expose its path length remains visible without drawing. */
      }
    });
  }

  function reveal(element) {
    if (!element || !element.classList) return;
    element.classList.remove("sway-motion-pending");
    element.classList.add("sway-motion-visible");
    drawCharts(element);
  }

  if (!reducedMotion.matches && "IntersectionObserver" in window) {
    revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        reveal(entry.target);
        revealObserver.unobserve(entry.target);
      });
    }, {
      root: null,
      rootMargin: "0px 0px -6% 0px",
      threshold: 0.08
    });
  }

  function prepare(element) {
    if (!element || element.nodeType !== 1 || element.dataset.swayMotionPrepared === "true") return;

    element.dataset.swayMotionPrepared = "true";
    element.classList.add("sway-motion-item");

    var siblings = element.parentElement
      ? Array.from(element.parentElement.children).filter(function (sibling) {
          return sibling.matches && sibling.matches(revealSelector);
        })
      : [];

    var siblingIndex = Math.max(0, siblings.indexOf(element));
    element.style.setProperty("--sway-motion-delay", Math.min(siblingIndex, 5) * 58 + "ms");

    if (reducedMotion.matches || !revealObserver) {
      element.classList.add("sway-motion-visible");
      drawCharts(element);
      return;
    }

    element.classList.add("sway-motion-pending");
    revealObserver.observe(element);
  }

  function scan(node) {
    if (!node) return;

    if (node.nodeType === 1) {
      if (node.matches && node.matches(revealSelector)) prepare(node);

      if (node.querySelectorAll) {
        node.querySelectorAll(revealSelector).forEach(prepare);
      }

      drawCharts(node);
      return;
    }

    if (node.querySelectorAll) {
      node.querySelectorAll(revealSelector).forEach(prepare);
    }
  }

  function initJourney(root) {
    var panels = Array.from(root.querySelectorAll("[data-sway-journey-panel]"));
    var stepButtons = Array.from(root.querySelectorAll("[data-sway-journey-step]"));
    var status = root.querySelector("[data-sway-journey-status]");
    var toggle = root.querySelector("[data-sway-journey-toggle]");
    var previous = root.querySelector("[data-sway-journey-previous]");
    var next = root.querySelector("[data-sway-journey-next]");

    if (!panels.length) return;

    var current = 0;
    var inView = false;
    var userPaused = false;
    var hoverPaused = false;
    var focusPaused = false;
    var timer = null;
    var intervalMs = 4800;

    function stopTimer() {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    }

    function shouldPlay() {
      return inView &&
        !userPaused &&
        !hoverPaused &&
        !focusPaused &&
        !reducedMotion.matches &&
        document.visibilityState !== "hidden";
    }

    function refreshPlayback() {
      var playing = shouldPlay();
      root.classList.toggle("is-playing", playing);
      root.classList.toggle("is-paused", !playing);
      root.classList.toggle("is-hover-paused", hoverPaused || focusPaused);

      if (playing && timer === null) {
        timer = window.setInterval(function () {
          setStep(current + 1);
        }, intervalMs);
      } else if (!playing) {
        stopTimer();
      }

      if (toggle) {
        toggle.textContent = userPaused ? "Resume" : "Pause";
        toggle.setAttribute("aria-pressed", userPaused ? "true" : "false");
        toggle.setAttribute(
          "aria-label",
          userPaused ? "Resume the animated journey" : "Pause the animated journey"
        );
      }
    }

    function setStep(index) {
      current = (index + panels.length) % panels.length;

      panels.forEach(function (panel, panelIndex) {
        var active = panelIndex === current;
        panel.classList.toggle("is-active", active);
        panel.setAttribute("aria-hidden", active ? "false" : "true");
        if ("inert" in panel) panel.inert = !active;
        if (active) drawCharts(panel);
      });

      stepButtons.forEach(function (button, buttonIndex) {
        var active = buttonIndex === current;
        button.classList.toggle("is-current", active);
        if (active) button.setAttribute("aria-current", "step");
        else button.removeAttribute("aria-current");
      });

      if (status) {
        var title = panels[current].getAttribute("data-step-title") || "Journey stage";
        status.textContent =
          String(current + 1).padStart(2, "0") +
          " / " +
          String(panels.length).padStart(2, "0") +
          " · " +
          title;
      }

      refreshPlayback();
    }

    stepButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        var step = Number(button.getAttribute("data-sway-journey-step"));
        if (Number.isInteger(step)) setStep(step);
      });
    });

    if (previous) {
      previous.addEventListener("click", function () {
        setStep(current - 1);
      });
    }

    if (next) {
      next.addEventListener("click", function () {
        setStep(current + 1);
      });
    }

    if (toggle) {
      toggle.addEventListener("click", function () {
        userPaused = !userPaused;
        refreshPlayback();
      });
    }

    root.addEventListener("pointerenter", function () {
      hoverPaused = true;
      refreshPlayback();
    });

    root.addEventListener("pointerleave", function () {
      hoverPaused = false;
      refreshPlayback();
    });

    root.addEventListener("focusin", function () {
      focusPaused = true;
      refreshPlayback();
    });

    root.addEventListener("focusout", function (event) {
      if (!event.relatedTarget || !root.contains(event.relatedTarget)) {
        focusPaused = false;
        refreshPlayback();
      }
    });

    if ("IntersectionObserver" in window) {
      var journeyObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          inView = entry.isIntersecting;
          refreshPlayback();
        });
      }, { threshold: 0.24 });

      journeyObserver.observe(root);
    } else {
      inView = true;
      refreshPlayback();
    }

    document.addEventListener("visibilitychange", refreshPlayback);

    if (reducedMotion.addEventListener) {
      reducedMotion.addEventListener("change", refreshPlayback);
    }

    setStep(0);
  }

  function initialise() {
    document.querySelectorAll(revealSelector).forEach(prepare);
    document.querySelectorAll("[data-sway-journey]").forEach(initJourney);

    if ("MutationObserver" in window && document.body) {
      var mutationObserver = new MutationObserver(function (records) {
        records.forEach(function (record) {
          record.addedNodes.forEach(function (node) {
            if (node.nodeType !== 1) return;
            scan(node);
            if (node.querySelectorAll) {
              node.querySelectorAll("[data-sway-journey]").forEach(initJourney);
            }
          });
        });
      });

      mutationObserver.observe(document.body, {
        childList: true,
        subtree: true
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialise, { once: true });
  } else {
    initialise();
  }
})();
