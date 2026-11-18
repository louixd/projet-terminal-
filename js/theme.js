const themeStorageKey = 'tradio-theme';
const legacyThemeStorageKey = 'tradio-profile-theme';
const root = document.documentElement;

function applyTheme(theme) {
    root.dataset.theme = theme;

    let themeColor = document.querySelector('meta[name="theme-color"]');
    if (!themeColor) {
        themeColor = document.createElement('meta');
        themeColor.name = 'theme-color';
        document.head.append(themeColor);
    }

    themeColor.content = theme === 'light' ? '#f1eef5' : '#15111b';
}

export function getTheme() {
    return root.dataset.theme === 'light' ? 'light' : 'dark';
}

export function setTheme(theme) {
    if (theme !== 'light' && theme !== 'dark') {
        throw new TypeError('Theme must be "light" or "dark".');
    }

    localStorage.setItem(themeStorageKey, theme);
    applyTheme(theme);
}

try {
    let savedTheme = localStorage.getItem(themeStorageKey);
    if (savedTheme !== 'light' && savedTheme !== 'dark') {
        savedTheme = localStorage.getItem(legacyThemeStorageKey);
    }

    applyTheme(savedTheme === 'light' ? 'light' : 'dark');
} catch (error) {
    applyTheme('dark');
    console.error('Unable to load the saved theme preference:', error);
}

window.addEventListener('storage', (event) => {
    if (event.key === themeStorageKey) {
        applyTheme(event.newValue === 'light' ? 'light' : 'dark');
    }
});
