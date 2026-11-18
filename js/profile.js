import { supabase } from './supabase.js';
import { forgotPassword, logout } from './auth.js';
import { getTheme, setTheme } from './theme.js';

const form = document.getElementById('profile-form');
const usernameInput = document.getElementById('username');
const emailInput = document.getElementById('profile-email');
const avatarFileInput = document.getElementById('avatar-file');
const avatarPreview = document.getElementById('avatar-preview');
const avatarPlaceholder = document.getElementById('avatar-placeholder');
const saveButton = document.getElementById('save-profile');
const removeAvatarButton = document.getElementById('remove-avatar');
const changePasswordButton = document.getElementById('change-password');
const logoutButton = document.getElementById('logout');
const switchAccountButton = document.getElementById('switch-account');
const deleteAccountButton = document.getElementById('delete-account');
const themeToggleButton = document.getElementById('profile-theme-toggle');
const themeLabel = document.getElementById('profile-theme-label');
const message = document.getElementById('profile-message');
const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const maxAvatarSize = 5 * 1024 * 1024;
let currentUser;
let currentAvatarPath = null;
let previewObjectUrl = null;

function updateThemeLabel(theme) {
    themeLabel.textContent = theme === 'light' ? 'Mode clair' : 'Mode sombre';
}

const currentTheme = getTheme();
themeToggleButton.checked = currentTheme === 'light';
updateThemeLabel(currentTheme);

themeToggleButton.addEventListener('change', () => {
    const nextTheme = themeToggleButton.checked ? 'light' : 'dark';

    try {
        setTheme(nextTheme);
        updateThemeLabel(nextTheme);
        message.textContent = nextTheme === 'light'
            ? 'Le mode clair est activé sur Tradio.'
            : 'Le mode sombre est activé sur Tradio.';
    } catch (error) {
        const theme = getTheme();
        themeToggleButton.checked = theme === 'light';
        updateThemeLabel(theme);
        message.textContent = error instanceof Error
            ? error.message
            : 'Impossible d’enregistrer le thème choisi.';
    }
});

const { data: { user }, error: userError } = await supabase.auth.getUser();

if (userError) {
    message.textContent = userError.message;
    form.hidden = true;
} else if (!user) {
    window.location.replace('login.html');
} else {
    currentUser = user;
    emailInput.value = user.email ?? '';
    const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('username, avatar_path, updated_at')
        .eq('id', user.id)
        .maybeSingle();

    if (profileError) {
        message.textContent = profileError.message;
    } else if (profile) {
        usernameInput.value = profile.username ?? '';
        currentAvatarPath = profile.avatar_path;
        removeAvatarButton.hidden = !currentAvatarPath;
        if (currentAvatarPath) {
            avatarPreview.src = supabase.storage
                .from('avatars')
                .getPublicUrl(currentAvatarPath).data.publicUrl
                + `?v=${encodeURIComponent(profile.updated_at)}`;
            avatarPreview.hidden = false;
            avatarPlaceholder.hidden = true;
        }
    }
}

avatarFileInput.addEventListener('change', () => {
    const file = avatarFileInput.files?.[0];
    if (!file) return;

    if (!allowedTypes.has(file.type) || file.size > maxAvatarSize) {
        avatarFileInput.value = '';
        message.textContent = 'Choisissez une image PNG, JPEG ou WebP de moins de 5 Mo.';
        return;
    }

    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = URL.createObjectURL(file);
    avatarPreview.src = previewObjectUrl;
    avatarPreview.hidden = false;
    avatarPlaceholder.hidden = true;
    message.textContent = '';
});

form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!currentUser) return;

    const username = usernameInput.value.trim();
    if (username && !/^[A-Za-z0-9_]{3,24}$/.test(username)) {
        message.textContent = 'Le nom doit contenir 3 à 24 lettres, chiffres ou tirets bas.';
        return;
    }

    const avatarFile = avatarFileInput.files?.[0];
    if (avatarFile && (!allowedTypes.has(avatarFile.type) || avatarFile.size > maxAvatarSize)) {
        message.textContent = 'Choisissez une image PNG, JPEG ou WebP de moins de 5 Mo.';
        return;
    }

    saveButton.disabled = true;
    message.textContent = 'Enregistrement du profil…';

    try {
        let avatarPath = currentAvatarPath;
        if (avatarFile) {
            avatarPath = `${currentUser.id}/avatar`;
            const { error: uploadError } = await supabase.storage
                .from('avatars')
                .upload(avatarPath, avatarFile, {
                    cacheControl: '3600',
                    contentType: avatarFile.type,
                    upsert: true
                });
            if (uploadError) throw uploadError;
        }

        const { error: saveError } = await supabase
            .from('profiles')
            .upsert({
                id: currentUser.id,
                username: username || null,
                avatar_path: avatarPath,
                updated_at: new Date().toISOString()
            }, { onConflict: 'id' });

        if (saveError) throw saveError;

        currentAvatarPath = avatarPath;
        removeAvatarButton.hidden = !currentAvatarPath;
        if (avatarFile && previewObjectUrl) {
            URL.revokeObjectURL(previewObjectUrl);
            previewObjectUrl = null;
            avatarPreview.src = supabase.storage
                .from('avatars')
                .getPublicUrl(avatarPath).data.publicUrl
                + `?v=${Date.now()}`;
        }
        message.textContent = 'Profil mis à jour.';
    } catch (error) {
        message.textContent = error?.code === '23505'
            ? 'Ce nom d’utilisateur est déjà pris.'
            : error instanceof Error
                ? error.message
                : 'Impossible d’enregistrer le profil. Veuillez réessayer.';
    } finally {
        saveButton.disabled = false;
    }
});

changePasswordButton.addEventListener('click', async () => {
    if (!currentUser?.email) {
        message.textContent = 'Aucune adresse e-mail n’est associée à ce compte.';
        return;
    }

    changePasswordButton.disabled = true;
    message.textContent = 'Envoi du lien de vérification…';

    try {
        await forgotPassword(currentUser.email);
        message.textContent = 'Lien envoyé. Consultez votre boîte e-mail pour vérifier votre adresse et choisir un nouveau mot de passe.';
    } catch (error) {
        message.textContent = error instanceof Error
            ? error.message
            : 'Impossible d’envoyer le lien. Veuillez réessayer.';
    } finally {
        changePasswordButton.disabled = false;
    }
});

async function signOutAndNavigate(destination) {
    logoutButton.disabled = true;
    switchAccountButton.disabled = true;
    message.textContent = 'Déconnexion…';

    try {
        await logout();
        window.location.replace(destination);
    } catch (error) {
        message.textContent = error instanceof Error
            ? error.message
            : 'Impossible de vous déconnecter. Veuillez réessayer.';
        logoutButton.disabled = false;
        switchAccountButton.disabled = false;
    }
}

logoutButton.addEventListener('click', () => {
    signOutAndNavigate('../index.html');
});

switchAccountButton.addEventListener('click', () => {
    signOutAndNavigate('login.html');
});

deleteAccountButton.addEventListener('click', async () => {
    if (!currentUser || !window.confirm('Supprimer définitivement votre compte ? Cette action est irréversible.')) return;

    deleteAccountButton.disabled = true;
    logoutButton.disabled = true;
    switchAccountButton.disabled = true;
    message.textContent = 'Suppression du compte…';

    try {
        if (currentAvatarPath) {
            const { error: avatarError } = await supabase.storage
                .from('avatars')
                .remove([currentAvatarPath]);
            if (avatarError) throw avatarError;
        }

        const { error: deleteError } = await supabase.rpc('delete_current_user');
        if (deleteError) throw deleteError;

        const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });
        if (signOutError) {
            message.textContent = 'Votre compte a été supprimé, mais la session locale n’a pas pu être effacée. Fermez cette page.';
            return;
        }

        window.location.replace('../index.html');
    } catch (error) {
        message.textContent = error instanceof Error
            ? error.message
            : 'Impossible de supprimer le compte. Veuillez réessayer.';
        deleteAccountButton.disabled = false;
        logoutButton.disabled = false;
        switchAccountButton.disabled = false;
    }
});

removeAvatarButton.addEventListener('click', async () => {
    if (!currentUser || !currentAvatarPath) return;
    if (!window.confirm('Supprimer votre photo de profil ?')) return;

    removeAvatarButton.disabled = true;
    saveButton.disabled = true;
    message.textContent = 'Suppression de la photo…';
    let storageRemoved = false;

    try {
        const { error: removeError } = await supabase.storage
            .from('avatars')
            .remove([currentAvatarPath]);
        if (removeError) throw removeError;
        storageRemoved = true;

        const { error: updateError } = await supabase
            .from('profiles')
            .update({
                avatar_path: null,
                updated_at: new Date().toISOString()
            })
            .eq('id', currentUser.id);
        if (updateError) throw updateError;

        currentAvatarPath = null;
        avatarFileInput.value = '';
        if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
        previewObjectUrl = null;
        avatarPreview.removeAttribute('src');
        avatarPreview.hidden = true;
        avatarPlaceholder.hidden = false;
        removeAvatarButton.hidden = true;
        message.textContent = 'Photo de profil supprimée.';
    } catch (error) {
        if (storageRemoved) {
            avatarPreview.hidden = true;
            avatarPlaceholder.hidden = false;
        }
        message.textContent = error instanceof Error
            ? error.message
            : 'Impossible de supprimer la photo de profil. Veuillez réessayer.';
    } finally {
        removeAvatarButton.disabled = false;
        saveButton.disabled = false;
    }
});

window.addEventListener('pagehide', () => {
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
});
