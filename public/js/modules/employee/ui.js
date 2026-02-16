
export function initResponsiveLayout() {
  handleResponsiveLayout();

  // Mobile menu toggle
  const menuToggleBtn = document.getElementById('menuToggleBtn');
  const sidebar = document.querySelector('.sidebar');

  if (menuToggleBtn && sidebar) {
    menuToggleBtn.addEventListener('click', () => {
      sidebar.classList.toggle('open');
    });
  }

  // Section Navigation (Tabs)
  const sections = document.querySelectorAll('.content-section');
  // FIX: Updated selector for Top Nav layout (v2)
  // Was: .sidebar-nav .nav-item
  // Now: .nav-link[data-section] inside the top nav
  const navItems = document.querySelectorAll('.nav-link[data-section]');
  const sectionTitle = document.getElementById('section-title');

  const sectionTitles = {
    'dashboard': 'Dashboard',
    'requests': 'My Requests',
    'schedule': 'My Schedule',
    'attendance': 'Attendance',
    'online-attendance': 'Online Attendance',
    'profile': 'My Profile'
  };

  function showSection(sectionId) {
    sections.forEach(section => section.classList.remove('active'));
    navItems.forEach(item => item.classList.remove('active'));

    const targetSection = document.getElementById(`section-${sectionId}`);
    if (targetSection) {
      targetSection.classList.add('active');
    }

    const activeNav = document.querySelector(`[data-section="${sectionId}"]`);
    if (activeNav) {
      activeNav.classList.add('active');
    }

    if (sectionTitle && sectionTitles[sectionId]) {
      sectionTitle.textContent = sectionTitles[sectionId];
    }

    // Store current section in sessionStorage
    try { sessionStorage.setItem('employee_active_section', sectionId); } catch (e) { }
  }

  navItems.forEach(item => {
    item.addEventListener('click', function () {
      const section = this.getAttribute('data-section');
      showSection(section);

      // On mobile, close sidebar after selection
      if (window.innerWidth <= 1199 && sidebar) {
        sidebar.classList.remove('open');
      }
    });
  });

  // Restore last active section
  try {
    const lastSection = sessionStorage.getItem('employee_active_section') || 'dashboard';
    showSection(lastSection);
  } catch (e) {
    showSection('dashboard');
  }

  // Close sidebar when clicking outside on tablets/mobile
  document.addEventListener('click', function (event) {
    if (sidebar && menuToggleBtn && window.innerWidth <= 1199) {
      if (!sidebar.contains(event.target) && !menuToggleBtn.contains(event.target)) {
        sidebar.classList.remove('open');
      }
    }
  });

  // Handle resize events
  window.addEventListener('resize', handleResponsiveLayout);

  // Set current date
  updateCurrentDate();
}

function updateCurrentDate() {
  const now = new Date();
  const options = { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' };
  const dateString = now.toLocaleDateString('en-US', options);

  const currentDateEl = document.getElementById('currentDate');
  if (currentDateEl) currentDateEl.textContent = dateString;

  // Only set todayText if it exists (dashboard view)
  const todayTextEl = document.getElementById('todayText');
  if (todayTextEl) todayTextEl.textContent = dateString;
}

function handleResponsiveLayout() {
  const menuToggleBtn = document.getElementById('menuToggleBtn');
  const sidebar = document.querySelector('.sidebar');

  function updateMenuToggleVisibility() {
    if (window.innerWidth <= 1199) {
      if (menuToggleBtn) menuToggleBtn.style.display = 'flex';
    } else {
      if (menuToggleBtn) menuToggleBtn.style.display = 'none';
      if (sidebar) sidebar.classList.remove('open');
    }
  }

  updateMenuToggleVisibility();
}
