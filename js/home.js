import { supabase } from './supabase.js';

const navbarToggle = document.getElementById('navbarToggle');
const navbarMenu = document.getElementById('navbarMenu');
const accountLink = document.getElementById('account-link');
const accountAvatar = document.getElementById('account-avatar');
const accountIcon = document.getElementById('account-icon');
const accountEditIndicator = document.getElementById('account-edit-indicator');

if (navbarToggle && navbarMenu) {
    navbarToggle.addEventListener('click', () => {
        navbarToggle.classList.toggle('is-active');
        navbarMenu.classList.toggle('is-active');
        const isExpanded = navbarToggle.getAttribute('aria-expanded') === 'true';
        navbarToggle.setAttribute('aria-expanded', String(!isExpanded));
    });
}

const { data: { session }, error: sessionError } =
    await supabase.auth.getSession();

if (sessionError) {
    console.error('Unable to load the account session:', sessionError);
} else if (session) {
    accountLink.href = 'pages/profile.html';
    accountLink.setAttribute('aria-label', 'Edit profile');
    accountLink.title = 'Edit profile';
    accountEditIndicator.hidden = false;

    const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('avatar_path, updated_at')
        .eq('id', session.user.id)
        .maybeSingle();

    if (profileError) {
        console.error('Unable to load the profile photo:', profileError);
    } else if (profile?.avatar_path) {
        const avatarUrl = supabase.storage
            .from('avatars')
            .getPublicUrl(profile.avatar_path).data.publicUrl;
        accountAvatar.src = `${avatarUrl}?v=${encodeURIComponent(profile.updated_at)}`;
        accountAvatar.hidden = false;
        accountIcon.hidden = true;
    }
}
