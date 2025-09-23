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
    // Home Button setup
        document.addEventListener("DOMContentLoaded", () => 
        {
        // Create the button dynamically so you don’t edit every HTML
        const homeBtn = document.createElement("button");
        homeBtn.id = "homeBtn";
        homeBtn.className = "home-btn";
        homeBtn.textContent = "🏠";
        document.body.appendChild(homeBtn);

        // Navigate home
        homeBtn.addEventListener("click", () => 
            {
            window.location.href = "index.html";
        });

        // Swipe detection
        let touchStartY = 0;
        window.addEventListener("touchstart", (e) => 
            {
            touchStartY = e.touches[0].clientY;
        });

        window.addEventListener("touchend", (e) => 
            {
            const touchEndY = e.changedTouches[0].clientY;
            const swipeDistance = touchEndY - touchStartY;
            if (swipeDistance > 80) {
            homeBtn.classList.add("show");
            }
        });

        // Hide if you tap elsewhere
        window.addEventListener("click", (e) => 
            {
            if (!homeBtn.contains(e.target)) {
            homeBtn.classList.remove("show");
            }
        });
        });

//