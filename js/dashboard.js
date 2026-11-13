
import { supabase } from './supabase.js';
import { logout } from './auth.js';

// Vérifier si l'utilisateur est connecté
const { data: { session }, error } =
    await supabase.auth.getSession();

if (error || !session) {
    window.location.replace('login.html');
} else {
    console.log('Connected user:', session.user.email);
}

// Déconnexion
document.getElementById('logout-btn')
    .addEventListener('click', async () => {
        try {
            await logout();
            window.location.replace('login.html');
        } catch (error) {
            console.error(error);
            alert('Unable to logout.');
        }
    });
