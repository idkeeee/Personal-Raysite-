//Side menu 
    function toggleMenu()
    {
        const menu = document.getElementById('sideMenu');
        const backdrop = document.getElementById('menuBackdrop') ;

        const will_open = !menu.classList.contains('open') ;

        menu.classList.toggle('open', will_open);
        backdrop.classList.toggle('show', will_open);

        // lock scroll when open (nice on mobile)
        document.body.classList.toggle('menu-open', will_open);
        document.body.style.overflow = will_open ? 'hidden' : '';

        // a11y
        menu.setAttribute('aria-hidden', String(!willOpen));
    }
    document.addEventListener // this one is to close on escape
    (
        'keydown', (e) => 
        {
        if (e.key === 'Escape') 
        {
        const menu = document.getElementById('sideMenu');
        if (menu && menu.classList.contains('open')) toggleMenu();
        }
        }
    );
//


//  HOME BUTTON WHEN SCROLLING UP ON PHONE
    // js/home-button.js
    document.addEventListener("DOMContentLoaded", () => {
    // Inject button once per page
    const homeBtn = document.createElement("button");
    homeBtn.id = "homeBtn";
    homeBtn.className = "home-btn";
    homeBtn.textContent = "🏠";
    document.body.appendChild(homeBtn);

    homeBtn.addEventListener("click", () => {
        window.location.href = "index.html";
    });

    // Swipe detection
    let touchStartY = 0;
    let startedNearBottom = false; // to avoid accidental hides from normal scrolling

    function isPointInside(el, x, y) {
        const r = el.getBoundingClientRect();
        return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    }

    window.addEventListener(
        "touchstart",
        (e) => {
        if (e.touches.length !== 1) return;
        const t = e.touches[0];
        touchStartY = t.clientY;

        // Consider the swipe “near bottom” if:
        // - it starts within ~100px of the bottom, or
        // - it starts on the button itself when visible
        const fromViewportBottom = window.innerHeight - touchStartY;
        startedNearBottom =
            fromViewportBottom < 100 ||
            (homeBtn.classList.contains("show") &&
            isPointInside(homeBtn, t.clientX, t.clientY));
        },
        { passive: true }
    );

    window.addEventListener(
        "touchend",
        (e) => {
        if (e.changedTouches.length !== 1) return;
        const t = e.changedTouches[0];
        const dy = t.clientY - touchStartY; // + = down, - = up
        const UP_THRESHOLD = -80;  // swipe up at least 80px
        const DOWN_THRESHOLD = 80; // swipe down at least 80px

        // Show on swipe UP (from bottom area), only if currently hidden
        if (dy <= UP_THRESHOLD && !homeBtn.classList.contains("show")) {
            homeBtn.classList.add("show");
            return;
        }

        // Hide on swipe DOWN (start near bottom or on the button), only if visible
        if (
            dy >= DOWN_THRESHOLD &&
            homeBtn.classList.contains("show") &&
            startedNearBottom
        ) {
            homeBtn.classList.remove("show");
        }
        },
        { passive: true }
    );

    // Optional: tap anywhere to hide if it's visible
    window.addEventListener("click", (e) => {
        if (homeBtn.classList.contains("show") && !homeBtn.contains(e.target)) {
        homeBtn.classList.remove("show");
        }
    });
    });

//