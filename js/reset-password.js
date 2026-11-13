
import { supabase } from './supabase.js';
import { updatePassword } from './auth.js';

const form = document.getElementById('reset-form');
const message = document.getElementById('message');

let recoverySession = false;

// Vérifier si le lien de récupération a créé une session
supabase.auth.onAuthStateChange((event, session) => {

    if (event === 'PASSWORD_RECOVERY' && session) {
        recoverySession = true;
    }

});

// Vérification initiale de la session
const { data: { session } } =
    await supabase.auth.getSession();

if (session) {
    recoverySession = true;
}

form.addEventListener('submit', async (event) => {

    event.preventDefault();

    const password = document.getElementById('password').value;

    const confirmation =
        document.getElementById('confirm-password').value;

    if (password !== confirmation) {
        message.textContent = 'Passwords do not match.';
        return;
    }

    if (!recoverySession) {
        message.textContent =
            'Invalid or expired recovery link.';
        return;
    }

    try {

        await updatePassword(password);

        message.textContent = 'Password successfully updated!';

        setTimeout(() => {
            window.location.href = 'login.html';
        }, 1500);

    } catch (error) {

        message.textContent = error.message;

    }

});
