
import { login } from './auth.js';

const form = document.getElementById('login-form');
const message = document.getElementById('message');

form.addEventListener('submit', async (event) => {

    event.preventDefault();

    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    try {

        message.textContent = 'Connecting...';

        await login(email, password);

        window.location.href = '../index.html';

    } catch (error) {

        message.textContent = error instanceof Error
            ? error.message
            : 'Unable to log in. Please try again.';

    }

});
