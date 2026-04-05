/**
 * ui.js
 * UI and Layout Management for HR Dashboard
 */

// import { AuthGuard } from '../../auth-guard.js'; // AuthGuard is global

export function initUI() {
  console.log('[HR] Initializing UI...');

  setupNavigation();
  setupMobileNav();
  setupProfileDisplay();
  setupHeroGreeting();
  // Theme toggle is handled by global theme-toggle.js
  setupLogout();
}

/**
 * Setup Top Navigation
 */
function setupNavigation() {
  console.log('[HR] Setting up top navigation...');
  const navLinks = document.querySelectorAll('.nav-link[data-section]:not(.user-profile-nav)');
  const sections = document.querySelectorAll('.content-section');
  const attendanceGroup = new Set(['attendance', 'hourly-rounds', 'online-attendance']);
  const analyticsGroup = new Set(['analytics', 'reports']);
  const attendanceSuiteNav = document.getElementById('attendanceSuiteNav');
  const attendanceTabs = document.querySelectorAll('.attendance-suite-tab[data-section]');
  const analyticsSuiteNav = document.getElementById('analyticsSuiteNav');
  const analyticsTabs = document.querySelectorAll('.analytics-suite-tab[data-section]');
  const employeeTabs = document.querySelectorAll('.employee-hub-tab[data-employee-tab]');
  const employeePanels = document.querySelectorAll('.employee-hub-panel[data-employee-panel]');
  const employeeHubTabsContainer = document.querySelector('.employee-hub-tabs');

  function syncAttendanceSuite(sectionId) {
    const isAttendanceGroup = attendanceGroup.has(sectionId);

    if (attendanceSuiteNav) {
      attendanceSuiteNav.classList.toggle('is-visible', isAttendanceGroup);
    }

    document.body.dataset.hrSection = sectionId;

    attendanceTabs.forEach(tab => {
      const isActive = tab.dataset.section === sectionId;
      tab.classList.toggle('active', isActive);
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
      tab.tabIndex = isActive ? 0 : -1;
    });
  }

  function syncAnalyticsSuite(sectionId) {
    const isAnalyticsGroup = analyticsGroup.has(sectionId);

    if (analyticsSuiteNav) {
      analyticsSuiteNav.classList.toggle('is-visible', isAnalyticsGroup);
    }

    document.body.dataset.hrSection = sectionId;

    analyticsTabs.forEach(tab => {
      const isActive = tab.dataset.section === sectionId;
      tab.classList.toggle('active', isActive);
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
      tab.tabIndex = isActive ? 0 : -1;
    });
  }

  function syncEmployeeHub(tabId = 'employees') {
    const activeTab = tabId === 'registration' ? 'registration' : 'employees';

    if (employeeHubTabsContainer) {
      employeeHubTabsContainer.dataset.activeEmployeeTab = activeTab;
    }

    if (!employeeTabs.length && !employeePanels.length) {
      return;
    }

    employeeTabs.forEach(tab => {
      const isActive = tab.dataset.employeeTab === activeTab;
      tab.classList.toggle('active', isActive);
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    employeePanels.forEach(panel => {
      const isActive = panel.dataset.employeePanel === activeTab;
      panel.classList.toggle('active', isActive);
      panel.hidden = !isActive;
    });

    try {
      sessionStorage.setItem('hr_employee_hub_tab', activeTab);
    } catch (e) {
      console.debug('Could not save employee hub tab to sessionStorage:', e);
    }
  }

  function getStoredEmployeeHubTab() {
    try {
      const storedTab = sessionStorage.getItem('hr_employee_hub_tab');
      return storedTab === 'registration' ? 'registration' : 'employees';
    } catch (e) {
      return 'employees';
    }
  }

  function bindEmployeeHubTabs() {
    employeeTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const tabId = tab.dataset.employeeTab === 'registration' ? 'registration' : 'employees';

        syncEmployeeHub(tabId);

        const employeeSection = document.getElementById('section-employees');
        if (employeeSection) {
          employeeSection.classList.add('active');
        }

        navLinks.forEach(link => {
          link.classList.toggle('active', link.dataset.section === 'employees');
        });

        const mobileNavItems = document.querySelectorAll('.mobile-nav-item[data-section]');
        mobileNavItems.forEach(item => {
          item.classList.toggle('active', item.dataset.section === 'employees');
        });

        try {
          sessionStorage.setItem('hr_active_section', 'employees');
        } catch (e) {
          console.debug('Could not save section to sessionStorage:', e);
        }
      });
    });
  }

  function showSection(sectionId, options = {}) {
    const resolvedSectionId = sectionId === 'invitations' ? 'employees' : sectionId;
    const activeNavSection = attendanceGroup.has(resolvedSectionId) ? 'attendance' : resolvedSectionId;
    const analyticsNavSection = analyticsGroup.has(resolvedSectionId) ? 'analytics' : activeNavSection;

    // Update Navigation Links
    navLinks.forEach(link => {
      if (link.dataset.section === analyticsNavSection) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });

    // Update Mobile Bottom Nav
    const mobileNavItems = document.querySelectorAll('.mobile-nav-item[data-section]');
    mobileNavItems.forEach(item => {
      if (item.dataset.section === analyticsNavSection) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    // Update Content Sections
    sections.forEach(section => {
      if (section.id === `section-${resolvedSectionId}`) {
        section.classList.add('active');
      } else {
        section.classList.remove('active');
      }
    });

    syncAttendanceSuite(resolvedSectionId);

    syncAnalyticsSuite(resolvedSectionId);

    if (resolvedSectionId === 'employees') {
      syncEmployeeHub(options.employeeTab || getStoredEmployeeHubTab());
    }

    // Store current section
    try {
      sessionStorage.setItem('hr_active_section', resolvedSectionId);
      if (resolvedSectionId === 'employees' && options.employeeTab) {
        sessionStorage.setItem('hr_employee_hub_tab', options.employeeTab);
      }
    } catch (e) {
      console.debug('Could not save section to sessionStorage:', e);
    }
  }

  // Add click listeners to nav links
  navLinks.forEach(link => {
    link.addEventListener('click', function (e) {
      e.preventDefault();
      const sectionId = this.dataset.section;
      const employeeTab = this.dataset.employeeTab || (sectionId === 'employees' ? 'employees' : (sectionId === 'invitations' ? 'registration' : undefined));
      showSection(sectionId, { employeeTab });
    });
  });

  attendanceTabs.forEach(tab => {
    tab.addEventListener('click', function (e) {
      e.preventDefault();
      showSection(this.dataset.section);
    });
  });

  analyticsTabs.forEach(tab => {
    tab.addEventListener('click', function (e) {
      e.preventDefault();
      showSection(this.dataset.section);
    });
  });

  // Restore last active section
  try {
    const storedSection = sessionStorage.getItem('hr_active_section') || 'dashboard';
    const lastSection = storedSection === 'qr' ? 'dashboard' : (storedSection === 'invitations' ? 'employees' : storedSection);
    const storedEmployeeTab = storedSection === 'invitations' ? 'registration' : getStoredEmployeeHubTab();
    showSection(lastSection, { employeeTab: storedEmployeeTab });
  } catch (e) {
    showSection('dashboard');
  }

  bindEmployeeHubTabs();

  window.HRNavigation = {
    showSection,
    attendanceGroup,
    analyticsGroup,
    showEmployeeHubTab: syncEmployeeHub
  };
}

/**
 * Setup Mobile Bottom Navigation
 */
function setupMobileNav() {
  // Handle main mobile nav items
  const mobileNavItems = document.querySelectorAll('.mobile-nav-item[data-section]');
  mobileNavItems.forEach(item => {
    item.addEventListener('click', function (e) {
      e.preventDefault();
      const sectionId = this.dataset.section;
      
      // Find and click the corresponding top nav link
      const navLink = document.querySelector(`.nav-link[data-section="${sectionId}"]`);
      if (navLink) {
        navLink.click();
      }
    });
  });
}

/**
 * Setup Profile Display
 */
async function setupProfileDisplay() {
  try {
    await new Promise(resolve => setTimeout(resolve, 200));

    const userNameElement = document.getElementById('userName');
    const userAvatarElement = document.getElementById('sidebarAvatar');
    const profileBtn = document.querySelector('.user-profile-nav');

    const user = await AuthGuard.getCurrentUser();

    let nameToDisplay = 'Monitoring';
    if (user && user.first_name && user.last_name) {
      nameToDisplay = `${user.first_name} ${user.last_name}`;
    } else if (user && user.username) {
      nameToDisplay = user.username;
    }

    if (userNameElement) {
      userNameElement.textContent = nameToDisplay;
    }

    if (userAvatarElement) {
      const initials = nameToDisplay
        .split(' ')
        .map(n => n[0])
        .join('')
        .substring(0, 2)
        .toUpperCase();
      userAvatarElement.textContent = initials || 'MO';
    }

    // Profile Button Click - Navigate to profile section (not modal)
    if (profileBtn) {
      profileBtn.addEventListener('click', (e) => {
        e.preventDefault();

        if (window.HRNavigation && typeof window.HRNavigation.showSection === 'function') {
          window.HRNavigation.showSection('profile');
          return;
        }

        // Fallback for very early init failures
        const sections = document.querySelectorAll('.content-section');
        const navLinks = document.querySelectorAll('.nav-link[data-section]');
        const mobileNavItems = document.querySelectorAll('.mobile-nav-item[data-section]');

        sections.forEach(section => {
          section.classList.toggle('active', section.id === 'section-profile');
        });

        navLinks.forEach(link => {
          link.classList.toggle('active', link.dataset.section === 'profile');
        });

        mobileNavItems.forEach(item => {
          item.classList.toggle('active', item.dataset.section === 'profile');
        });

        try {
          sessionStorage.setItem('hr_active_section', 'profile');
        } catch (error) {
          console.debug('Could not save section to sessionStorage:', error);
        }
      });
    }

  } catch (e) {
    console.debug('Could not update profile display:', e);
  }
}

/**
 * Setup Hero Greeting Section
 */
async function setupHeroGreeting() {
  try {
    const heroTitle = document.getElementById('userNameHero');
    const heroDate = document.getElementById('heroDate');

    if (!heroTitle && !heroDate) return; // No hero section on this page

    // Update date
    if (heroDate) {
      const now = new Date();
      const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
      const dateStr = now.toLocaleDateString('en-US', options);
      heroDate.textContent = dateStr;
    }

    // Get user info and update greeting
    const user = await AuthGuard.getCurrentUser();
    let userName = 'HR Team';
    
    if (user && user.first_name && user.last_name) {
      userName = `${user.first_name} ${user.last_name}`;
    } else if (user && user.username) {
      userName = user.username;
    }

    if (heroTitle) {
      // Determine time-based greeting
      const hour = new Date().getHours();
      let greeting = 'Good Morning';
      if (hour >= 12 && hour < 18) {
        greeting = 'Good Afternoon';
      } else if (hour >= 18) {
        greeting = 'Good Evening';
      }
      heroTitle.textContent = `${greeting}, ${userName}`;
    }
  } catch (e) {
    console.debug('Could not setup hero greeting:', e);
  }
}

/**
 * Setup Logout Button
 */
function setupLogout() {
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        await AuthGuard.logout();
        // Redirect to home/login page (relative path from current page location)
        window.location.href = '../index.html';
      } catch (err) {
        console.error('Logout failed:', err);
        // Force navigate anyway
        window.location.href = '../index.html';
      }
    });
  }
}
