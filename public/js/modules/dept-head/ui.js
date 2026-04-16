export function initResponsiveLayout() {
  const profileSection = document.getElementById('section-profile');
  const profileWrapper = document.querySelector('#section-profile .ep-profile-wrapper');

  if (profileSection && profileWrapper) {
    const movableNodes = [
      document.getElementById('createScheduleModal'),
      document.getElementById('editScheduleModal'),
      document.getElementById('viewScheduleModal'),
      document.getElementById('cloneTermModal')
    ].filter((node) => node && node.parentElement === profileWrapper);

    const insertionPoint = profileSection.nextSibling;
    movableNodes.forEach((node) => {
      profileSection.parentElement.insertBefore(node, insertionPoint);
    });
  }

  handleResponsiveLayout();

  setupEmployeeHubTabs();

  // Section Navigation (Top Nav + Mobile Bottom Nav - data-section)
  // Exclude .ep-tab-item (profile internal tabs)
  const sections = document.querySelectorAll('.content-section');
  const navItems = document.querySelectorAll('[data-section]:not(.ep-tab-item)');
  const mobileNavItems = document.querySelectorAll('.mobile-nav-item[data-section]');
  const mobileDropdownItems = document.querySelectorAll('.mobile-nav-dropdown-item[data-section]');

  const normalizeSectionId = (sectionId) => (sectionId === 'schedules' ? 'curriculum' : sectionId);

  function showSection(sectionId) {
    const normalizedSectionId = normalizeSectionId(sectionId);

    sections.forEach(section => section.classList.remove('active'));
    navItems.forEach(item => item.classList.remove('active'));
    mobileNavItems.forEach(item => item.classList.remove('active'));
    mobileDropdownItems.forEach(item => item.classList.remove('active'));

    const targetSection = document.getElementById(`section-${normalizedSectionId}`);
    if (targetSection) {
      targetSection.classList.add('active');
    }

    const activeNav = document.querySelector(`[data-section="${normalizedSectionId}"]`);
    if (activeNav) {
      activeNav.classList.add('active');
    }

    const activeMobileNav = document.querySelector(`.mobile-nav-item[data-section="${normalizedSectionId}"]`);
    if (activeMobileNav) {
      activeMobileNav.classList.add('active');
    }

    const activeMobileDropdown = document.querySelector(`.mobile-nav-dropdown-item[data-section="${normalizedSectionId}"]`);
    if (activeMobileDropdown) {
      activeMobileDropdown.classList.add('active');
    }

    // Close dropdown after selecting
    const dropdown = document.querySelector('.mobile-nav-dropdown');
    if (dropdown) {
      dropdown.classList.remove('open');
    }

    // Store current section in sessionStorage
    try { sessionStorage.setItem('depthead_active_section', normalizedSectionId); } catch (e) { }
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
    const lastSection = normalizeSectionId(sessionStorage.getItem('depthead_active_section') || 'dashboard');
    showSection(lastSection);
  } catch (e) {
    showSection('dashboard');
  }

  // Handle Resize
  window.addEventListener('resize', handleResponsiveLayout);
}

function setupEmployeeHubTabs() {
  const section = document.getElementById('section-employees');
  const tabsContainer = section?.querySelector('.employee-hub-tabs');
  const tabs = section?.querySelectorAll('.employee-hub-tab[data-employee-tab]');
  const panels = section?.querySelectorAll('.employee-hub-panel[data-employee-panel]');
  const tools = section?.querySelector('.employee-hub-tools');

  if (!section || !tabsContainer || !tabs?.length || !panels?.length) {
    return;
  }

  const getStoredTab = () => {
    return 'employees';
  };

  const showEmployeeTab = (tabId = 'employees') => {
    const activeTab = tabId === 'registration' ? 'registration' : 'employees';

    tabsContainer.dataset.activeEmployeeTab = activeTab;

    tabs.forEach((tab) => {
      const isActive = tab.dataset.employeeTab === activeTab;
      tab.classList.toggle('active', isActive);
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
      tab.tabIndex = isActive ? 0 : -1;
    });

    panels.forEach((panel) => {
      const isActive = panel.dataset.employeePanel === activeTab;
      panel.classList.toggle('active', isActive);
      panel.hidden = !isActive;
    });

    if (tools) {
      tools.style.display = activeTab === 'employees' ? 'flex' : 'none';
    }

    try {
      sessionStorage.setItem('departmenthead_employee_hub_tab', activeTab);
    } catch (error) {
      console.debug('Could not save department head employee hub tab:', error);
    }
  };

  tabs.forEach((tab) => {
    tab.addEventListener('click', (event) => {
      event.preventDefault();
      showEmployeeTab(tab.dataset.employeeTab || 'employees');
    });
  });

  const openInviteModalBtn = section.querySelector('#openDeptHeadInviteModalBtn');
  if (openInviteModalBtn) {
    openInviteModalBtn.addEventListener('click', () => {
      if (window.deptHeadInvitations && typeof window.deptHeadInvitations.openCreateModal === 'function') {
        window.deptHeadInvitations.openCreateModal();
      }
    });
  }

  window.departmentHeadEmployeeHub = {
    showTab: showEmployeeTab,
    getActiveTab: () => tabsContainer.dataset.activeEmployeeTab || 'employees'
  };

  showEmployeeTab(getStoredTab());
}

function moveInvitationGlider(element, index) {
  if (!element) {
    return;
  }

  const container = element.closest('.toggle-container');
  if (!container) {
    return;
  }

  const glider = container.querySelector('.glider');
  const buttons = container.querySelectorAll('.toggle-button');

  if (glider) {
    glider.style.transform = `translateX(${index * 100}%)`;
  }

  buttons.forEach((button) => button.classList.toggle('active', button === element));

  const status = element.getAttribute('data-status') || 'active';
  if (window.deptHeadInvitations && typeof window.deptHeadInvitations.setStatusFilter === 'function') {
    window.deptHeadInvitations.setStatusFilter(status);
  }
}

window.moveInvitationGlider = moveInvitationGlider;

export function handleResponsiveLayout() {
  // Responsive logic if needed
}

