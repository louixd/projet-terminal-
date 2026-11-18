try {
    const savedTheme = localStorage.getItem('tradio-theme')
        || localStorage.getItem('tradio-profile-theme');

    if (savedTheme === 'light' || savedTheme === 'dark') {
        document.documentElement.dataset.theme = savedTheme;
    }
} catch (error) {
    console.error('Unable to initialize the saved theme preference:', error);
}
