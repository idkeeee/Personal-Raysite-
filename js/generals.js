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