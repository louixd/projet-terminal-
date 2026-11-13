import { supabase } from './supabase.js';

const form = document.getElementById('profile-form');
const usernameInput = document.getElementById('username');
const avatarFileInput = document.getElementById('avatar-file');
const avatarPreview = document.getElementById('avatar-preview');
const avatarPlaceholder = document.getElementById('avatar-placeholder');
const saveButton = document.getElementById('save-profile');
const removeAvatarButton = document.getElementById('remove-avatar');
const message = document.getElementById('profile-message');
const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const maxAvatarSize = 5 * 1024 * 1024;
let currentUser;
let currentAvatarPath = null;
let previewObjectUrl = null;

const { data: { user }, error: userError } = await supabase.auth.getUser();

if (userError) {
    message.textContent = userError.message;
    form.hidden = true;
} else if (!user) {
    window.location.replace('login.html');
} else {
    currentUser = user;
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
        message.textContent = 'Choose a PNG, JPEG or WebP image smaller than 5 MB.';
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
        message.textContent = 'Username must be 3–24 letters, numbers or underscores.';
        return;
    }

    const avatarFile = avatarFileInput.files?.[0];
    if (avatarFile && (!allowedTypes.has(avatarFile.type) || avatarFile.size > maxAvatarSize)) {
        message.textContent = 'Choose a PNG, JPEG or WebP image smaller than 5 MB.';
        return;
    }

    saveButton.disabled = true;
    message.textContent = 'Saving profile...';

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
        message.textContent = 'Profile updated.';
    } catch (error) {
        message.textContent = error?.code === '23505'
            ? 'That username is already taken.'
            : error instanceof Error
                ? error.message
                : 'Unable to save the profile. Please try again.';
    } finally {
        saveButton.disabled = false;
    }
});

removeAvatarButton.addEventListener('click', async () => {
    if (!currentUser || !currentAvatarPath) return;
    if (!window.confirm('Remove your profile photo?')) return;

    removeAvatarButton.disabled = true;
    saveButton.disabled = true;
    message.textContent = 'Removing photo...';
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
        message.textContent = 'Profile photo removed.';
    } catch (error) {
        if (storageRemoved) {
            avatarPreview.hidden = true;
            avatarPlaceholder.hidden = false;
        }
        message.textContent = error instanceof Error
            ? error.message
            : 'Unable to remove the profile photo. Please try again.';
    } finally {
        removeAvatarButton.disabled = false;
        saveButton.disabled = false;
    }
});

window.addEventListener('pagehide', () => {
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
});
