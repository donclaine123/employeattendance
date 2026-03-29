/**
 * ui.js
 * UI and Layout Management for HR Dashboard
 */

// import { AuthGuard } from '../../auth-guard.js'; // AuthGuard is global

export function initUI() {
  console.log('[HR] Initializing UI...');

  setupNavigation();
  setupDropdownMenu();
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
  const navLinks = document.querySelectorAll('.nav-link[data-section]:not(.nav-dropdown-toggle):not(.user-profile-nav)');
  const sections = document.querySelectorAll('.content-section');

  function showSection(sectionId) {
    // Update Navigation Links
    navLinks.forEach(link => {
      if (link.dataset.section === sectionId) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });

    // Update Mobile Bottom Nav
    const mobileNavItems = document.querySelectorAll('.mobile-nav-item[data-section]');
    mobileNavItems.forEach(item => {
      if (item.dataset.section === sectionId) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    // Update Content Sections
    sections.forEach(section => {
      if (section.id === `section-${sectionId}`) {
        section.classList.add('active');
      } else {
        section.classList.remove('active');
      }
    });

    // Store current section
    try {
      sessionStorage.setItem('hr_active_section', sectionId);
    } catch (e) {
      console.debug('Could not save section to sessionStorage:', e);
    }
  }

  // Add click listeners to nav links
  navLinks.forEach(link => {
    link.addEventListener('click', function (e) {
      e.preventDefault();
      const sectionId = this.dataset.section;
      showSection(sectionId);

      // Handle QR Module State
      if (sectionId === 'qr') {
        if (window.initializeLiveQR) {
          console.log('[HR UI] Initializing Live QR');
          setTimeout(() => window.initializeLiveQR(), 100);
        }
      } else {
        if (window.stopLiveQR) {
          console.log('[HR UI] Stopping Live QR');
          window.stopLiveQR();
        }
      }

      // Close dropdown after selection
      closeDropdownMenu();
    });
  });

  // Restore last active section
  try {
    const lastSection = sessionStorage.getItem('hr_active_section') || 'dashboard';
    showSection(lastSection);

    // Auto-init QR if that's the active section
    if (lastSection === 'qr') {
      setTimeout(() => {
        if (window.initializeLiveQR) window.initializeLiveQR();
      }, 1000);
    }
  } catch (e) {
    showSection('dashboard');
  }
}

/**
 * Setup Dropdown Menu
 */
function setupDropdownMenu() {
  const dropdownToggle = document.querySelector('.nav-dropdown-toggle');
  const dropdownMenu = document.querySelector('.nav-dropdown-menu');
  const dropdownItems = document.querySelectorAll('.nav-dropdown-item');

  if (!dropdownToggle || !dropdownMenu) return;

  // Toggle dropdown on click
  dropdownToggle.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropdownMenu.classList.toggle('active');
  });

  // Handle dropdown item clicks
  dropdownItems.forEach(item => {
    item.addEventListener('click', function (e) {
      e.preventDefault();
      const sectionId = this.dataset.section;
      
      // Try to find a nav link first (for primary items)
      let navLink = document.querySelector(`.nav-link[data-section="${sectionId}"]:not(.nav-dropdown-toggle):not(.user-profile-nav)`);
      if (navLink) {
        navLink.click();
      } else {
        // For dropdown-only sections, manually handle navigation
        const sections = document.querySelectorAll('.content-section');
        sections.forEach(section => {
          if (section.id === `section-${sectionId}`) {
            section.classList.add('active');
          } else {
            section.classList.remove('active');
          }
        });
        
        // Update nav links active state
        const allNavLinks = document.querySelectorAll('.nav-link[data-section]:not(.nav-dropdown-toggle):not(.user-profile-nav)');
        allNavLinks.forEach(link => {
          link.classList.remove('active');
        });
        
        // Update mobile nav
        const mobileNavItems = document.querySelectorAll('.mobile-nav-item[data-section]');
        mobileNavItems.forEach(mobileItem => {
          if (mobileItem.dataset.section === sectionId) {
            mobileItem.classList.add('active');
          } else {
            mobileItem.classList.remove('active');
          }
        });
        
        // Store current section
        try {
          sessionStorage.setItem('hr_active_section', sectionId);
        } catch (e) {
          console.debug('Could not save section to sessionStorage:', e);
        }
      }
      
      closeDropdownMenu();
    });
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.nav-dropdown')) {
      closeDropdownMenu();
    }
  });
}

function closeDropdownMenu() {
  const dropdownMenu = document.querySelector('.nav-dropdown-menu');
  if (dropdownMenu) {
    dropdownMenu.classList.remove('active');
  }
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
      
      // Close mobile dropdown if open
      closeMobileDropdown();
    });
  });

  // Handle mobile dropdown toggle
  const mobileMoreBtn = document.querySelector('.mobile-nav-more-btn');
  const mobileDropdown = document.querySelector('.mobile-nav-dropdown');

  if (mobileMoreBtn && mobileDropdown) {
    mobileMoreBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      mobileDropdown.classList.toggle('open');
      mobileMoreBtn.classList.toggle('active');
    });
  }

  // Handle mobile dropdown items
  const mobileDropdownItems = document.querySelectorAll('.mobile-nav-dropdown-item[data-section]');
  mobileDropdownItems.forEach(item => {
    item.addEventListener('click', function (e) {
      e.preventDefault();
      const sectionId = this.dataset.section;
      
      // Update mobile dropdown active state
      mobileDropdownItems.forEach(i => {
        i.classList.remove('active');
      });
      this.classList.add('active');
      
      // Find and click the corresponding top nav link
      let navLink = document.querySelector(`.nav-link[data-section="${sectionId}"]`);
      if (navLink) {
        navLink.click();
      } else {
        // For dropdown-only sections, manually handle navigation
        const sections = document.querySelectorAll('.content-section');
        sections.forEach(section => {
          if (section.id === `section-${sectionId}`) {
            section.classList.add('active');
          } else {
            section.classList.remove('active');
          }
        });
        
        // Update nav links active state
        const allNavLinks = document.querySelectorAll('.nav-link[data-section]:not(.nav-dropdown-toggle):not(.user-profile-nav)');
        allNavLinks.forEach(link => {
          link.classList.remove('active');
        });
        
        // Store current section
        try {
          sessionStorage.setItem('hr_active_section', sectionId);
        } catch (e) {
          console.debug('Could not save section to sessionStorage:', e);
        }
      }
      
      // Close dropdown after selection
      closeMobileDropdown();
    });
  });

  // Close mobile dropdown when clicking outside
  document.addEventListener('click', (e) => {
    const mobileNavDropdown = document.querySelector('.mobile-nav-dropdown');
    if (mobileNavDropdown && !e.target.closest('.mobile-nav-dropdown')) {
      closeMobileDropdown();
    }
  });
}

function closeMobileDropdown() {
  const mobileDropdown = document.querySelector('.mobile-nav-dropdown');
  const mobileMoreBtn = document.querySelector('.mobile-nav-more-btn');
  if (mobileDropdown) {
    mobileDropdown.classList.remove('open');
  }
  if (mobileMoreBtn) {
    mobileMoreBtn.classList.remove('active');
  }
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
        
        // Use the section navigation system (same as other nav links)
        const sections = document.querySelectorAll('.content-section');
        const navLinks = document.querySelectorAll('.nav-link[data-section]');
        const mobileNavItems = document.querySelectorAll('.mobile-nav-item[data-section]');
        
        // Show profile section
        sections.forEach(section => {
          if (section.id === 'section-profile') {
            section.classList.add('active');
          } else {
            section.classList.remove('active');
          }
        });
        
        // Update nav active states
        navLinks.forEach(link => {
          if (link.dataset.section === 'profile') {
            link.classList.add('active');
          } else {
            link.classList.remove('active');
          }
        });
        
        mobileNavItems.forEach(item => {
          if (item.dataset.section === 'profile') {
            item.classList.add('active');
          } else {
            item.classList.remove('active');
          }
        });
        
        // Store current section
        try {
          sessionStorage.setItem('hr_active_section', 'profile');
        } catch (e) {
          console.debug('Could not save section to sessionStorage:', e);
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
