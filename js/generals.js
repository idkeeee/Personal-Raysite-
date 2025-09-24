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
        menu.setAttribute('aria-hidden', String(!will_open));
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





//  HOME BUTTON WHEN SCROLLING UP ON PHONE  🏡
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

    // --- Sensitivity config ---
    const UP_SHOW_PX = 48;   // swipe up distance to show         // IMPORTANT :  smaller = show easier
    const DOWN_HIDE_PX = 20; // swipe down distance to hide       // IMPORTANT :  smaller = hide easier
    const SCROLL_HIDE_COOLDOWN_MS = 400; // ignore scroll-hide right after showing

    // --- State ---
    let touchStartY = 0;
    let startedNearBottom = false;
    let gestureConsumed = false;
    let isTouching = false;
    let lastShowAt = 0;

    function isPointInside(el, x, y) {
    const r = el.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    }

    window.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    isTouching = true;
    const t = e.touches[0];
    touchStartY = t.clientY;
    gestureConsumed = false;

    const fromBottom = window.innerHeight - touchStartY;
    startedNearBottom =
        fromBottom < 140 || // slightly more lenient
        (homeBtn.classList.contains("show") &&
        isPointInside(homeBtn, t.clientX, t.clientY));
    }, { passive: true });

    window.addEventListener("touchmove", (e) => {
    if (e.touches.length !== 1) return;
    const y = e.touches[0].clientY;
    const dy = y - touchStartY; // + = down, - = up

    // Show quickly on swipe UP from bottom-ish area
    if (!homeBtn.classList.contains("show") &&
        startedNearBottom && dy <= -UP_SHOW_PX && !gestureConsumed) {
        homeBtn.classList.add("show");
        lastShowAt = performance.now();      // <-- start cooldown
        gestureConsumed = true;
        return;
    }

    // Hide aggressively on small downward move while visible
    if (homeBtn.classList.contains("show") &&
        dy >= DOWN_HIDE_PX && !gestureConsumed) {
        homeBtn.classList.remove("show");
        gestureConsumed = true;
    }
    }, { passive: true });

    window.addEventListener("touchend", (e) => {
    isTouching = false;
    if (gestureConsumed || e.changedTouches.length !== 1) return;
    const dy = e.changedTouches[0].clientY - touchStartY;

    if (!homeBtn.classList.contains("show") &&
        startedNearBottom && dy <= -UP_SHOW_PX) {
        homeBtn.classList.add("show");
        lastShowAt = performance.now();      // <-- start cooldown
    } else if (homeBtn.classList.contains("show") &&
                dy >= DOWN_HIDE_PX) {
        homeBtn.classList.remove("show");
    }
    }, { passive: true });

    // Hide on page scroll DOWN, but NOT during touch and NOT right after showing
    let lastScrollY = window.scrollY;
    window.addEventListener("scroll", () => {
    const now = performance.now();
    if (isTouching) return; // ignore while finger on screen
    if (now - lastShowAt < SCROLL_HIDE_COOLDOWN_MS) return; // ignore during cooldown

    const cur = window.scrollY;
    const delta = cur - lastScrollY; // >0 = scrolling down
    lastScrollY = cur;

    if (delta > 4 && homeBtn.classList.contains("show")) {
        homeBtn.classList.remove("show");
    }
    }, { passive: true });

    });

//