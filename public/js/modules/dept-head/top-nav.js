/**
 * Department Head Top Navigation Handler
 * Manages navigation links, dropdown menu, and section switching
 */

export function initTopNav() {
  const navLinks = document.querySelectorAll('.nav-link[data-section]');
  const navDropdownItems = document.querySelectorAll('.nav-dropdown-item[data-section]');
  const navDropdownToggle = document.querySelector('.nav-dropdown-toggle');
  const navDropdown = document.querySelector('.nav-dropdown');
  const navDropdownMenu = document.querySelector('.nav-dropdown-menu');

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!navDropdown.contains(e.target)) {
      navDropdown.classList.remove('open');
    }
  });

  // Toggle dropdown menu
  if (navDropdownToggle) {
    navDropdownToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      navDropdown.classList.toggle('open');
    });
  }

  // Handle main navigation links
  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const section = link.getAttribute('data-section');
      navigateToSection(section);
      updateNavActiveState(section);
    });
  });

  // Handle dropdown navigation items
  navDropdownItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const section = item.getAttribute('data-section');
      navigateToSection(section);
      updateNavActiveState(section);
      navDropdown.classList.remove('open');
    });
  });
}

/**
 * Update active state for navigation items
 */
function updateNavActiveState(section) {
  // Remove active from all nav links
  const allNavLinks = document.querySelectorAll('.nav-link, .nav-dropdown-item');
  allNavLinks.forEach(link => link.classList.remove('active'));

  // Add active to current section
  const activeLink = document.querySelector(
    `.nav-link[data-section="${section}"], .nav-dropdown-item[data-section="${section}"]`
  );
  if (activeLink) {
    activeLink.classList.add('active');
  }

  // Update section title if it exists
  const sectionTitle = document.getElementById('section-title');
  if (sectionTitle) {
    const linkText = activeLink?.querySelector('span')?.textContent || section;
    sectionTitle.textContent = linkText;
  }
}

/**
 * Navigate to a section
 * This function should replicate the existing section switching logic
 */
function navigateToSection(section) {
  const allSections = document.querySelectorAll('.content-section');
  
  allSections.forEach(el => {
    el.classList.remove('active');
  });

  const targetSection = document.getElementById(`section-${section}`);
  if (targetSection) {
    targetSection.classList.add('active');
  }
}

/**
 * Initialize navigation on page load
 */
document.addEventListener('DOMContentLoaded', () => {
  initTopNav();

  // Set initial active state
  const dashboardLink = document.querySelector('.nav-link[data-section="dashboard"]');
  if (dashboardLink) {
    updateNavActiveState('dashboard');
  }
});
