(function () {
    "use strict";

    var hasShownWelcome = false;
    var WELCOME_DURATION_MS = 2920;

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
            dot.style.setProperty("--welcome-size", particle[2] + "px");
            dot.style.setProperty("--welcome-delay", particle[3] + "ms");
            dot.style.setProperty("--welcome-drift", particle[4] + "px");
            particleLayer.appendChild(dot);
        });
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

        var brand = headerInner.querySelector(".admin-brand");
        if (brand && brand.parentNode === headerInner) {
            brand.insertAdjacentElement("afterend", greeting);
        } else {
            headerInner.insertBefore(greeting, headerInner.firstChild);
        }
    }

    window.addEventListener("swayphics:admin-welcome-authorized", showWelcome);
})();
