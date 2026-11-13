
import { register } from './auth.js';

const form = document.getElementById('register-form');
const message = document.getElementById('message');

form.addEventListener('submit', async (event) => {

    event.preventDefault();

    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const confirmPassword =
        document.getElementById('confirm-password').value;

    if (password !== confirmPassword) {
        message.textContent = 'Passwords do not match.';
        return;
    }

    try {

        message.textContent = 'Creating your account...';

        const data = await register(email, password);

        if (data.session) {
            window.location.href = 'dashboard.html';
        } else {
            message.textContent =
                'Account created! Please check your email to confirm your account.';
        }

    } catch (error) {

        message.textContent = error.message;

    }

});
