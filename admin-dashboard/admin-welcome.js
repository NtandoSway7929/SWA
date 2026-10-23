(function () {
    "use strict";

    var hasShownWelcome = false;
    var WELCOME_DURATION_MS = 2920;
    var WELCOME_CENTER_POP_MS = 700;
    var WELCOME_CENTER_SETTLE_MS = 180;
    var WELCOME_CENTER_HOLD_MS = 6200;
    var WELCOME_TRAVEL_DURATION_MS = 2700;
    var WELCOME_FLIGHT_DURATION_MS =
        WELCOME_CENTER_POP_MS +
        WELCOME_CENTER_SETTLE_MS +
        WELCOME_CENTER_HOLD_MS +
        WELCOME_TRAVEL_DURATION_MS;

    function getJohannesburgHour() {
        try {
            var parts = new Intl.DateTimeFormat("en-GB", {
                timeZone: "Africa/Johannesburg",
                hour: "2-digit",
                hourCycle: "h23"
            }).formatToParts(new Date());

            var hourPart = parts.find(function (part) {
                return part.type === "hour";
            });

            var hour = hourPart ? Number(hourPart.value) : NaN;
            return Number.isInteger(hour) && hour >= 0 && hour <= 23
                ? hour
                : null;
        } catch (error) {
            return null;
        }
    }

    function getWelcomeCopy(fullName) {
        var hour = getJohannesburgHour();
        var greeting;
        var subtitle;

        if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
            return {
                greeting: fullName ? "Welcome back, " + fullName : "Welcome back",
                subtitle: "Let’s make this session count."
            };
        }

        if (hour >= 5 && hour < 12) {
            greeting = "Good morning";
            subtitle = "Let’s make something great today.";
        } else if (hour >= 12 && hour < 17) {
            greeting = "Good afternoon";
            subtitle = "Let’s keep the momentum going.";
        } else if (hour >= 17 && hour < 21) {
            greeting = "Good evening";
            subtitle = "Let’s bring today’s ideas to life.";
        } else {
            greeting = "Welcome back";
            subtitle = "Let’s make this session count.";
        }

        return {
            greeting: fullName ? greeting + ", " + fullName : "Welcome back",
            subtitle: subtitle
        };
    }

    function addParticles(particleLayer) {
        var particles = [
            [8, 28, 3, 0, 12], [17, 76, 2, 160, -8],
            [23, 17, 2, 230, 9], [31, 84, 3, 90, -12],
            [39, 24, 2, 310, 14], [47, 77, 2, 120, -9],
            [57, 16, 3, 210, 10], [64, 88, 2, 40, -15],
            [72, 24, 2, 260, 9], [79, 74, 3, 180, -11],
            [87, 31, 2, 60, 13], [93, 67, 2, 300, -7],
            [13, 52, 2, 140, 10], [90, 48, 3, 220, -13]
        ];

        particles.forEach(function (particle) {
            var dot = document.createElement("span");
            dot.className = "swayphics-welcome-particle";
            dot.setAttribute("aria-hidden", "true");
            dot.style.setProperty("--welcome-x", particle[0] + "%");
            dot.style.setProperty("--welcome-y", particle[1] + "%");
            dot.style.setProperty("--welcome-size", Math.max(3, particle[2]) + "px");
            dot.style.setProperty("--welcome-delay", particle[3] + "ms");
            dot.style.setProperty("--welcome-drift", particle[4] + "px");
            particleLayer.appendChild(dot);
        });
    }

    function animateWelcomeFromCenter(greeting) {
        if (
            !greeting ||
            typeof Element === "undefined" ||
            typeof Element.prototype.animate !== "function" ||
            !document.body
        ) {
            return false;
        }

        var targetRect = greeting.getBoundingClientRect();
        if (!targetRect.width || !targetRect.height) {
            return false;
        }

        var viewportWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth);
        var viewportHeight = Math.max(1, window.innerHeight || document.documentElement.clientHeight);
        var centerX = viewportWidth / 2;
        var centerY = viewportHeight / 2;
        var startWidth = Math.min(
            Math.max(targetRect.width * 1.42, 320),
            Math.max(220, viewportWidth - 28)
        );
        var startHeight = Math.min(
            Math.max(targetRect.height * 2.15, 96),
            Math.max(72, viewportHeight - 40)
        );
        var targetStyle = window.getComputedStyle(greeting);
        var targetTitle = greeting.querySelector(".swayphics-welcome-title");
        var targetSubtitle = greeting.querySelector(".swayphics-welcome-subtitle");
        var targetTitleSize = targetTitle
            ? window.getComputedStyle(targetTitle).fontSize
            : "12px";
        var targetSubtitleSize = targetSubtitle
            ? window.getComputedStyle(targetSubtitle).fontSize
            : "9px";
        var flight = greeting.cloneNode(true);
        var backdrop = document.createElement("div");
        var flightTitle;
        var flightSubtitle;
        var animation;
        var backdropAnimation;
        var popEndOffset = WELCOME_CENTER_POP_MS / WELCOME_FLIGHT_DURATION_MS;
        var settleEndOffset =
            (WELCOME_CENTER_POP_MS + WELCOME_CENTER_SETTLE_MS) /
            WELCOME_FLIGHT_DURATION_MS;
        var holdEndOffset =
            (WELCOME_CENTER_POP_MS +
                WELCOME_CENTER_SETTLE_MS +
                WELCOME_CENTER_HOLD_MS) /
            WELCOME_FLIGHT_DURATION_MS;
        var travelDelay =
            WELCOME_CENTER_POP_MS +
            WELCOME_CENTER_SETTLE_MS +
            WELCOME_CENTER_HOLD_MS;
        var travelDuration = WELCOME_TRAVEL_DURATION_MS;
        var flightDuration = WELCOME_FLIGHT_DURATION_MS;

        flight.id = "swayphics-admin-welcome-flight";
        flight.setAttribute("aria-hidden", "true");
        flight.setAttribute("data-flight-state", "in-progress");
        flight.removeAttribute("role");
        flight.removeAttribute("aria-live");
        flight.removeAttribute("aria-atomic");
        flight.classList.add("swayphics-welcome-flight");

        // The traveling copy is a visual duplicate. Keep the accessible status
        // message and grid item in place so the header never reflows mid-flight.
        flight.style.setProperty("position", "fixed", "important");
        flight.style.setProperty("z-index", "2147483647", "important");
        flight.style.setProperty("display", "flex", "important");
        flight.style.setProperty("flex", "none", "important");
        flight.style.setProperty("align-items", "center", "important");
        flight.style.setProperty("justify-content", "flex-start", "important");
        flight.style.setProperty("overflow", "hidden", "important");
        flight.style.setProperty("isolation", "isolate", "important");
        flight.style.setProperty("pointer-events", "none", "important");
        flight.style.setProperty("margin", "0", "important");
        flight.style.setProperty("min-width", "0", "important");
        flight.style.setProperty("min-height", "0", "important");
        flight.style.setProperty("max-width", "none", "important");
        flight.style.setProperty("transform-origin", "center center", "important");
        flight.style.left = centerX + "px";
        flight.style.top = centerY + "px";
        flight.style.width = startWidth + "px";
        flight.style.height = startHeight + "px";
        flight.style.opacity = "0";
        flight.style.transform = "translate(-50%, -50%) scale(0.58)";
        flight.style.padding = "12px 16px";
        flight.style.border = "1px solid rgba(44,145,252,0.30)";
        flight.style.borderRadius = "18px";
        flight.style.boxShadow = "0 18px 60px rgba(0,32,150,0.18)";
        flight.style.willChange = "left, top, width, height, transform, opacity";

        flightTitle = flight.querySelector(".swayphics-welcome-title");
        flightSubtitle = flight.querySelector(".swayphics-welcome-subtitle");
        if (flightTitle) {
            flightTitle.style.fontSize = "clamp(1.05rem, 2vw, 1.45rem)";
            flightTitle.style.lineHeight = "1.18";
        }
        if (flightSubtitle) {
            flightSubtitle.style.fontSize = "clamp(0.78rem, 1.2vw, 0.9rem)";
            flightSubtitle.style.lineHeight = "1.25";
        }

        backdrop.id = "swayphics-admin-welcome-backdrop";
        backdrop.className = "swayphics-welcome-backdrop";
        backdrop.setAttribute("aria-hidden", "true");
        backdrop.setAttribute("data-blur-state", "active");

        document.body.appendChild(backdrop);
        document.body.appendChild(flight);
        greeting.setAttribute("data-flight-state", "in-progress");
        greeting.style.setProperty("opacity", "0", "important");

        try {
            // Blur and softly dim the dashboard while the enlarged greeting is held
            // in the center. The overlay then fades as the card returns to the header.
            backdropAnimation = backdrop.animate(
                [
                    { offset: 0, opacity: 0 },
                    { offset: 0.06, opacity: 0.92, easing: "ease-out" },
                    { offset: holdEndOffset, opacity: 0.92 },
                    { offset: 1, opacity: 0, easing: "ease-in-out" }
                ],
                {
                    duration: flightDuration,
                    easing: "linear",
                    fill: "both"
                }
            );

            animation = flight.animate(
                [
                    {
                        offset: 0,
                        left: centerX + "px",
                        top: centerY + "px",
                        width: startWidth + "px",
                        height: startHeight + "px",
                        padding: "12px 16px",
                        borderRadius: "18px",
                        transform: "translate(-50%, -50%) scale(0.58)",
                        opacity: 0
                    },
                    {
                        offset: popEndOffset,
                        left: centerX + "px",
                        top: centerY + "px",
                        width: startWidth + "px",
                        height: startHeight + "px",
                        padding: "12px 16px",
                        borderRadius: "18px",
                        transform: "translate(-50%, -50%) scale(1.06)",
                        opacity: 1,
                        easing: "cubic-bezier(0.16, 1, 0.3, 1)"
                    },
                    {
                        offset: settleEndOffset,
                        left: centerX + "px",
                        top: centerY + "px",
                        width: startWidth + "px",
                        height: startHeight + "px",
                        padding: "12px 16px",
                        borderRadius: "18px",
                        transform: "translate(-50%, -50%) scale(1)",
                        opacity: 1,
                        easing: "linear"
                    },
                    {
                        offset: holdEndOffset,
                        left: centerX + "px",
                        top: centerY + "px",
                        width: startWidth + "px",
                        height: startHeight + "px",
                        padding: "12px 16px",
                        borderRadius: "18px",
                        transform: "translate(-50%, -50%) scale(1)",
                        opacity: 1,
                        easing: "cubic-bezier(0.22, 0.7, 0.25, 1)"
                    },
                    {
                        offset: 1,
                        left: targetRect.left + "px",
                        top: targetRect.top + "px",
                        width: targetRect.width + "px",
                        height: targetRect.height + "px",
                        padding: targetStyle.padding,
                        borderRadius: targetStyle.borderRadius,
                        transform: "translate(0, 0) scale(1)",
                        opacity: 1
                    }
                ],
                {
                    duration: flightDuration,
                    easing: "linear",
                    fill: "both"
                }
            );

            if (flightTitle) {
                flightTitle.animate(
                    [{ fontSize: flightTitle.style.fontSize }, { fontSize: targetTitleSize }],
                    {
                        delay: travelDelay,
                        duration: travelDuration,
                        easing: "cubic-bezier(0.22, 0.7, 0.25, 1)",
                        fill: "both"
                    }
                );
            }

            if (flightSubtitle) {
                flightSubtitle.animate(
                    [{ fontSize: flightSubtitle.style.fontSize }, { fontSize: targetSubtitleSize }],
                    {
                        delay: travelDelay,
                        duration: travelDuration,
                        easing: "cubic-bezier(0.22, 0.7, 0.25, 1)",
                        fill: "both"
                    }
                );
            }

            function revealHeaderGreeting() {
                greeting.style.removeProperty("opacity");
                greeting.removeAttribute("data-flight-state");
                flight.remove();
                backdrop.remove();
            }

            animation.addEventListener("finish", revealHeaderGreeting, { once: true });
            animation.addEventListener("cancel", revealHeaderGreeting, { once: true });
            return true;
        } catch (error) {
            greeting.style.removeProperty("opacity");
            greeting.removeAttribute("data-flight-state");
            flight.remove();
            backdrop.remove();
            return false;
        }
    }

    function showWelcome(event) {
        if (
            hasShownWelcome ||
            !event ||
            !event.detail
        ) {
            return;
        }

        var headerInner = document.querySelector(".admin-header-inner");
        if (!headerInner || document.getElementById("swayphics-admin-welcome")) {
            return;
        }

        hasShownWelcome = true;

        var fullName = typeof event.detail.fullName === "string"
            ? event.detail.fullName.trim()
            : "";
        var copy = getWelcomeCopy(fullName);
        var prefersReducedMotion = Boolean(
            window.matchMedia &&
            window.matchMedia("(prefers-reduced-motion: reduce)").matches
        );
        var shouldAnimate = event.detail.animate === true && !prefersReducedMotion;

        var greeting = document.createElement("section");
        greeting.id = "swayphics-admin-welcome";
        greeting.className = "swayphics-welcome-toast";
        greeting.setAttribute(
            "data-motion-state",
            prefersReducedMotion
                ? "reduced-motion"
                : shouldAnimate
                    ? "animated"
                    : "static-session"
        );
        greeting.setAttribute("role", "status");
        greeting.setAttribute("aria-live", "polite");
        greeting.setAttribute("aria-atomic", "true");

        var content = document.createElement("div");
        content.className = "swayphics-welcome-copy";

        var title = document.createElement("h2");
        title.className = "swayphics-welcome-title";
        title.textContent = copy.greeting;

        var subtitle = document.createElement("p");
        subtitle.className = "swayphics-welcome-subtitle";
        subtitle.textContent = copy.subtitle;

        content.appendChild(title);
        content.appendChild(subtitle);

        if (shouldAnimate) {
            greeting.classList.add("swayphics-welcome-animate");

            var trails = document.createElement("div");
            trails.className = "swayphics-welcome-light-trails";
            trails.setAttribute("aria-hidden", "true");

            for (var i = 0; i < 3; i += 1) {
                trails.appendChild(document.createElement("span"));
            }

            var particles = document.createElement("div");
            particles.className = "swayphics-welcome-particles";
            particles.setAttribute("aria-hidden", "true");
            addParticles(particles);

            greeting.appendChild(trails);
            greeting.appendChild(particles);

            window.setTimeout(function () {
                if (trails.parentNode === greeting) {
                    greeting.removeChild(trails);
                }
                if (particles.parentNode === greeting) {
                    greeting.removeChild(particles);
                }
                greeting.classList.remove("swayphics-welcome-animate");
            }, WELCOME_DURATION_MS);
        }

        greeting.appendChild(content);
        headerInner.classList.add("swayphics-has-welcome");

        var header = headerInner.closest(".admin-header");
        if (header) {
            header.classList.add("swayphics-has-welcome");
        }

        var brand = headerInner.querySelector(".admin-brand");
        if (brand && brand.parentNode === headerInner) {
            brand.insertAdjacentElement("afterend", greeting);
        } else {
            headerInner.insertBefore(greeting, headerInner.firstChild);
        }

        if (shouldAnimate) {
            animateWelcomeFromCenter(greeting);
        }
    }

    window.addEventListener("swayphics:admin-welcome-authorized", showWelcome);
})();
