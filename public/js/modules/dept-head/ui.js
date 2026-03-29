export function initResponsiveLayout() {
  handleResponsiveLayout();

  // Section Navigation (Top Nav + Mobile Bottom Nav - data-section)
  // Exclude .ep-tab-item (profile internal tabs)
  const sections = document.querySelectorAll('.content-section');
  const navItems = document.querySelectorAll('[data-section]:not(.ep-tab-item)');
  const mobileNavItems = document.querySelectorAll('.mobile-nav-item[data-section]');
  const mobileDropdownItems = document.querySelectorAll('.mobile-nav-dropdown-item[data-section]');

  function showSection(sectionId) {
    sections.forEach(section => section.classList.remove('active'));
    navItems.forEach(item => item.classList.remove('active'));
    mobileNavItems.forEach(item => item.classList.remove('active'));
    mobileDropdownItems.forEach(item => item.classList.remove('active'));

    const targetSection = document.getElementById(`section-${sectionId}`);
    if (targetSection) {
      targetSection.classList.add('active');
    }

    const activeNav = document.querySelector(`[data-section="${sectionId}"]`);
    if (activeNav) {
      activeNav.classList.add('active');
    }

    const activeMobileNav = document.querySelector(`.mobile-nav-item[data-section="${sectionId}"]`);
    if (activeMobileNav) {
      activeMobileNav.classList.add('active');
    }

    const activeMobileDropdown = document.querySelector(`.mobile-nav-dropdown-item[data-section="${sectionId}"]`);
    if (activeMobileDropdown) {
      activeMobileDropdown.classList.add('active');
    }

    // Close dropdown after selecting
    const dropdown = document.querySelector('.mobile-nav-dropdown');
    if (dropdown) {
      dropdown.classList.remove('open');
    }

    // Store current section in sessionStorage
    try { sessionStorage.setItem('depthead_active_section', sectionId); } catch (e) { }
  }

  navItems.forEach(item => {
    item.addEventListener('click', function () {
      const section = this.getAttribute('data-section');
      if (section) {
        showSection(section);
      }
    });
  });

  mobileNavItems.forEach(item => {
    item.addEventListener('click', function () {
      const section = this.getAttribute('data-section');
      showSection(section);
    });
  });

  mobileDropdownItems.forEach(item => {
    item.addEventListener('click', function () {
      const section = this.getAttribute('data-section');
      showSection(section);
    });
  });

  // Hero Button Navigation
  const generateReportBtn = document.getElementById('generateReportBtn');
  const viewAnalyticsBtn = document.getElementById('viewAnalyticsBtn');

  if (generateReportBtn) {
    generateReportBtn.addEventListener('click', async function () {
      // Call the report generation function directly
      if (window.handleAttendanceReportGeneration) {
        await window.handleAttendanceReportGeneration();
      }
    });
  }

  if (viewAnalyticsBtn) {
    viewAnalyticsBtn.addEventListener('click', function () {
      showSection('analytics');
    });
  }

  // Mobile dropdown toggle
  const mobileMoreBtn = document.querySelector('.mobile-nav-more-btn');
  const mobileDropdown = document.querySelector('.mobile-nav-dropdown');
  
  if (mobileMoreBtn && mobileDropdown) {
    mobileMoreBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      mobileDropdown.classList.toggle('open');
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', function (e) {
      if (!mobileDropdown.contains(e.target)) {
        mobileDropdown.classList.remove('open');
      }
    });
  }

  // Restore last active section
  try {
    const lastSection = sessionStorage.getItem('depthead_active_section') || 'dashboard';
    showSection(lastSection);
  } catch (e) {
    showSection('dashboard');
  }

  // Handle Resize
  window.addEventListener('resize', handleResponsiveLayout);
}

export function handleResponsiveLayout() {
  // Responsive logic if needed
}

