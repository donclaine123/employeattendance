export function initResponsiveLayout() {
  handleResponsiveLayout();

  // Elements
  const menuToggleBtn = document.getElementById('menuToggleBtn');
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('menuOverlay');

  // Toggle Menu
  if (menuToggleBtn && sidebar) {
    menuToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      sidebar.classList.toggle('open');
      if (overlay) overlay.classList.toggle('visible');
    });
  }

  // Close on Overlay Click
  // Close on Overlay Click
  if (overlay) {
    overlay.addEventListener('click', () => {
      closeSidebar();
    });
  }

  // Close on Nav Item Click (Mobile)
  const navItems = document.querySelectorAll('.sidebar-nav .nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      if (window.innerWidth <= 1024) {
        closeSidebar();
      }
    });
  });

  // Handle Resize
  window.addEventListener('resize', handleResponsiveLayout);

  function closeSidebar() {
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('visible');
  }
}

export function handleResponsiveLayout() {
  const menuToggleBtn = document.getElementById('menuToggleBtn');
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('menuOverlay');

  if (window.innerWidth <= 1024) {
    // Tablet/Mobile
    if (menuToggleBtn) menuToggleBtn.style.display = 'flex';
  } else {
    // Desktop
    if (menuToggleBtn) menuToggleBtn.style.display = 'none';
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('visible');
  }
}
