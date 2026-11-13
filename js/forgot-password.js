
import { forgotPassword } from './auth.js';

const form = document.getElementById('forgot-form');
const message = document.getElementById('message');

form.addEventListener('submit', async (event) => {

    event.preventDefault();

    const email = document.getElementById('email').value.trim();

    try {

        message.textContent = 'Sending email...';

        await forgotPassword(email);

        message.textContent =
            'If an account matches this email, a reset link will be sent.';

    } catch (error) {

        message.textContent = error instanceof Error
            ? error.message
            : 'Unable to send the reset email. Please try again later.';

    }

});
