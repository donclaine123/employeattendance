// Theme Manager for Dark/Light Mode Toggle
(function() {
    const ThemeManager = {
        // Theme storage key
        STORAGE_KEY: 'workline_theme',
        
        init: function() {
            // Check local storage or default to dark
            const savedTheme = localStorage.getItem(this.STORAGE_KEY);
            
            if (savedTheme) {
                this.applyTheme(savedTheme);
            } else {
                // Default to dark if no preference
                this.applyTheme('dark');
            }
            
            // Setup listeners after DOM load
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => this.setupUI());
            } else {
                this.setupUI();
            }
        },
        
        setupUI: function() {
            // Find all theme toggle buttons (could be in different headers)
            const toggleBtns = document.querySelectorAll('.theme-toggle-btn');
            
            toggleBtns.forEach(btn => {
                // Set initial icon state
                this.updateButtonState(btn);
                
                // Add click listener
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.toggleTheme();
                });
            });
            
            // Also check for a container to inject the button if it doesn't exist
            // (For pages where we modify HTML dynamically)
            this.injectToggleIfMissing();
        },
        
        injectToggleIfMissing: function() {
            // Polling retry to handle dynamic loading of headers
            const maxRetries = 10;
            let attempts = 0;
            
            const tryInject = () => {
                // Check both .header-actions (HR/Superadmin) and .header-right (Employee/DeptHead)
                const headerActions = document.querySelector('.header-actions') || document.querySelector('.header-right');
                
                if (headerActions) {
                    if (!headerActions.querySelector('.theme-toggle-btn')) {
                        const btn = document.createElement('button');
                        // Detect which button class the page uses
                        const existingBtn = headerActions.querySelector('button');
                        const btnClass = existingBtn && existingBtn.classList.contains('btn-header') 
                            ? 'btn-header theme-toggle-btn' 
                            : 'header-btn theme-toggle-btn';
                        btn.className = btnClass;
                        // Ensure button is visible and styled
                        btn.style.display = 'flex';
                        btn.style.alignItems = 'center';
                        btn.style.gap = '8px';
                        
                        btn.innerHTML = `
                            <svg class="icon-sun" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:none;">
                                <circle cx="12" cy="12" r="5"></circle>
                                <line x1="12" y1="1" x2="12" y2="3"></line>
                                <line x1="12" y1="21" x2="12" y2="23"></line>
                                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                                <line x1="1" y1="12" x2="3" y2="12"></line>
                                <line x1="21" y1="12" x2="23" y2="12"></line>
                                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
                            </svg>
                            <svg class="icon-moon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
                            </svg>
                            <span>Theme</span>
                        `;
                        
                        // Insert before logout/profile if possible
                        const profileBtn = headerActions.querySelector('#profileBtn');
                        const logoutBtn = headerActions.querySelector('#logoutBtn');
                        
                        if (profileBtn) {
                            headerActions.insertBefore(btn, profileBtn);
                        } else if (logoutBtn) {
                            headerActions.insertBefore(btn, logoutBtn);
                        } else {
                            headerActions.prepend(btn);
                        }
                        
                        // Init new button
                        this.updateButtonState(btn);
                        btn.addEventListener('click', (e) => {
                            e.preventDefault();
                            this.toggleTheme();
                        });
                        console.log('[Theme] Toggle button injected successfully');
                    }
                } else {
                    attempts++;
                    if (attempts < maxRetries) {
                        setTimeout(tryInject, 200);
                    }
                }
            };
            
            tryInject();
        },
        
        toggleTheme: function() {
            const current = document.documentElement.getAttribute('data-theme');
            const next = current === 'light' ? 'dark' : 'light';
            this.applyTheme(next);
        },
        
        applyTheme: function(theme) {
            document.documentElement.setAttribute('data-theme', theme);
            localStorage.setItem(this.STORAGE_KEY, theme);
            
            // Update all buttons
            const btns = document.querySelectorAll('.theme-toggle-btn');
            btns.forEach(btn => this.updateButtonState(btn));
        },
        
        updateButtonState: function(btn) {
            const theme = document.documentElement.getAttribute('data-theme');
            const sun = btn.querySelector('.icon-sun');
            const moon = btn.querySelector('.icon-moon');
            
            if (sun && moon) {
                if (theme === 'light') {
                    sun.style.display = 'none';
                    moon.style.display = 'block'; // Show moon to switch to dark
                } else {
                    sun.style.display = 'block'; // Show sun to switch to light
                    moon.style.display = 'none';
                }
            }
        }
    };
    
    // Expose global
    window.ThemeManager = ThemeManager;
    
    // Auto-init
    ThemeManager.init();
})();
