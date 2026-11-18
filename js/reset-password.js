
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

form.addEventListener('submit', async (event) => {

    event.preventDefault();

    const password = document.getElementById('password').value;

    const confirmation =
        document.getElementById('confirm-password').value;

    if (password !== confirmation) {
        message.textContent = 'Les mots de passe ne correspondent pas.';
        return;
    }

    if (!recoverySession) {
        message.textContent =
            'Le lien de vérification est invalide ou a expiré.';
        return;
    }

    try {

        await updatePassword(password);

        message.textContent = 'Mot de passe modifié avec succès.';

        setTimeout(() => {
            window.location.href = 'login.html';
        }, 1500);

    } catch (error) {

        message.textContent = error instanceof Error
            ? error.message
            : 'Impossible de modifier le mot de passe. Veuillez réessayer.';

    }

});
