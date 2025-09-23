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
    const UP_SHOW_PX = 60;   // swipe up distance to show
    const DOWN_HIDE_PX = 24; // swipe down distance to hide (more sensitive)

    // --- State ---
    let touchStartY = 0;
    let lastY = 0;
    let startedNearBottom = false;
    let gestureConsumed = false; // prevents double-trigger between move/end

    function isPointInside(el, x, y) {
    const r = el.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    }

    window.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    touchStartY = lastY = t.clientY;
    gestureConsumed = false;

    const fromBottom = window.innerHeight - touchStartY;
    startedNearBottom =
        fromBottom < 120 || // a bit more lenient
        (homeBtn.classList.contains("show") &&
        isPointInside(homeBtn, t.clientX, t.clientY));
    }, { passive: true });

    window.addEventListener("touchmove", (e) => {
    if (e.touches.length !== 1) return;
    const y = e.touches[0].clientY;
    const dy = y - touchStartY; // + = down, - = up
    lastY = y;

    // Show quickly on swipe UP
    if (!homeBtn.classList.contains("show") && dy <= -UP_SHOW_PX && startedNearBottom && !gestureConsumed) {
        homeBtn.classList.add("show");
        gestureConsumed = true;
        return;
    }

    // Hide aggressively on any downward move while visible
    if (homeBtn.classList.contains("show") && dy >= DOWN_HIDE_PX && !gestureConsumed) {
        homeBtn.classList.remove("show");
        gestureConsumed = true;
    }
    }, { passive: true });

    window.addEventListener("touchend", (e) => {
    if (gestureConsumed || e.changedTouches.length !== 1) return;
    const dy = e.changedTouches[0].clientY - touchStartY;

    if (!homeBtn.classList.contains("show") && dy <= -UP_SHOW_PX && startedNearBottom) {
        homeBtn.classList.add("show");
    } else if (homeBtn.classList.contains("show") && dy >= DOWN_HIDE_PX) {
        homeBtn.classList.remove("show");
    }
    }, { passive: true });

    // Also hide on page scroll down (flicks that move content)
    let lastScrollY = window.scrollY;
    window.addEventListener("scroll", () => {
    const cur = window.scrollY;
    const delta = cur - lastScrollY; // >0 = scrolling down
    lastScrollY = cur;
    if (delta > 6 && homeBtn.classList.contains("show")) {
        homeBtn.classList.remove("show");
    }
    }, { passive: true });


//