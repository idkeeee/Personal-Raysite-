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
    const UP_SHOW_PX = 40;   // swipe up distance to show         // IMPORTANT :  smaller = show easier
    const UP_SHOW_VEL = 0.6;          // px/ms minimum upward speed (fast flick)
    const DOWN_HIDE_PX = 28; // swipe down distance to hide       // IMPORTANT :  smaller = hide easier
    const SCROLL_HIDE_COOLDOWN_MS = 400; // ignore scroll-hide right after showing

   // ---- State ----
    let startY = 0;
    let startT = 0;
    let isTouching = false;
    let gestureConsumed = false;
    let lastShowAt = 0;

    function showHome() {
    if (!homeBtn.classList.contains("show")) {
        homeBtn.classList.add("show");
        lastShowAt = performance.now();
    }
    }
    function hideHome() {
    if (homeBtn.classList.contains("show")) {
        homeBtn.classList.remove("show");
    }
    }

    // Capture swipes anywhere (even on inputs inside the table)
    document.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "touch") return;
    isTouching = true;
    gestureConsumed = false;
    startY = e.clientY;
    startT = performance.now();
    }, { capture: true, passive: true });

    document.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "touch" || !isTouching) return;
    const dy = e.clientY - startY;              // + = down,  - = up
    const dt = Math.max(1, performance.now() - startT);
    const upVel = (-dy) / dt;                   // px per ms

    // Show on decent upward swipe (distance OR fast flick)
    if (!gestureConsumed && !homeBtn.classList.contains("show") &&
        (dy <= -UP_SHOW_PX || upVel >= UP_SHOW_VEL)) {
        showHome();
        gestureConsumed = true;
        return;
    }

    // Hide on small downward move while visible
    if (!gestureConsumed && homeBtn.classList.contains("show") &&
        dy >= DOWN_HIDE_PX) {
        hideHome();
        gestureConsumed = true;
    }
    }, { capture: true, passive: true });

    document.addEventListener("pointerup", (e) => {
    if (e.pointerType !== "touch") return;
    isTouching = false;
    if (gestureConsumed) return;

    const dy = e.clientY - startY;
    const dt = Math.max(1, performance.now() - startT);
    const upVel = (-dy) / dt;

    if (!homeBtn.classList.contains("show") &&
        (dy <= -UP_SHOW_PX || upVel >= UP_SHOW_VEL)) {
        showHome();
    } else if (homeBtn.classList.contains("show") &&
                dy >= DOWN_HIDE_PX) {
        hideHome();
    }
    }, { capture: true, passive: true });

    // Don’t let normal page scroll immediately hide it
    let lastScrollY = window.scrollY;
    window.addEventListener("scroll", () => {
    const now = performance.now();
    if (isTouching) return;                             // ignore while finger down
    if (now - lastShowAt < SCROLL_HIDE_COOLDOWN_MS) return;

    const cur = window.scrollY;
    const delta = cur - lastScrollY; // >0 = scrolling down (finger swipes up)
    lastScrollY = cur;

    if (delta > 12) hideHome();                         // needs a bit more scroll to hide
    }, { passive: true });
    
    }); 
//