import { supabase } from './supabase.js';

const navbarToggle = document.getElementById('navbarToggle');
const navbarMenu = document.getElementById('navbarMenu');
const accountLink = document.getElementById('account-link');
const accountAvatar = document.getElementById('account-avatar');
const accountIcon = document.getElementById('account-icon');
const accountEditIndicator = document.getElementById('account-edit-indicator');
const leaderboardList = document.getElementById('leaderboard-list');
const leaderboardPeriodButtons = document.querySelectorAll('.card-10__filter-btn[data-period]');
const leaderboardCurrency = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2
});
let leaderboardRequestId = 0;
let selectedLeaderboardPeriod = 'month';

function createLeaderboardRow(entry, index) {
    const rank = Number(entry.rank_number);
    const variant = rank <= 3 ? ['gold', 'silver', 'bronze'][rank - 1] : '';
    const row = document.createElement('li');
    row.className = `card-10__row${variant ? ` card-10__row--${variant}` : ''}`;

    const rankWrap = document.createElement('span');
    rankWrap.className = 'card-10__rank-wrap';
    rankWrap.append(Object.assign(document.createElement('span'), {
        className: 'card-10__rank',
        textContent: String(rank)
    }));

    const avatar = document.createElement('span');
    avatar.className = `card-10__avatar card-10__avatar--${Math.min(index + 1, 5)}`;
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = String(entry.username).slice(0, 2).toUpperCase();

    const who = document.createElement('span');
    who.className = 'card-10__who';
    const name = document.createElement('span');
    name.className = 'card-10__name';
    name.textContent = entry.username;
    const role = document.createElement('span');
    role.className = 'card-10__role';
    role.textContent = 'Paper portfolio';
    who.append(name, role);

    const pnl = Number(entry.pnl);
    const returnPercent = Number(entry.return_percent);
    const scoreWrap = document.createElement('span');
    scoreWrap.className = 'card-10__score-wrap';
    const score = document.createElement('span');
    score.className = 'card-10__score';
    score.textContent = `${pnl > 0 ? '+' : ''}${leaderboardCurrency.format(pnl)}`;
    const returnValue = document.createElement('span');
    returnValue.className = `card-10__delta card-10__delta--${returnPercent > 0 ? 'up' : returnPercent < 0 ? 'down' : 'flat'}`;
    returnValue.textContent = `${returnPercent > 0 ? '+' : ''}${returnPercent.toFixed(2)}%`;
    scoreWrap.append(score, returnValue);

    row.append(rankWrap, avatar, who, scoreWrap);
    return row;
}

async function setLeaderboardPeriod(period) {
    const requestId = ++leaderboardRequestId;
    selectedLeaderboardPeriod = period;
    leaderboardPeriodButtons.forEach((button) => {
        const isSelected = button.dataset.period === period;
        button.classList.toggle('card-10__filter-btn--active', isSelected);
        button.setAttribute('aria-pressed', String(isSelected));
    });

    const loadingState = document.createElement('li');
    loadingState.className = 'card-10__empty';
    loadingState.textContent = 'Loading leaderboard…';
    leaderboardList.replaceChildren(loadingState);

    try {
        const { data, error } = await supabase.rpc('get_paper_leaderboard', {
            p_period: period
        });
        if (error) throw error;
        if (requestId !== leaderboardRequestId) return;

        if (!data?.length) {
            const emptyState = document.createElement('li');
            emptyState.className = 'card-10__empty';
            emptyState.textContent = 'No paper traders have ranked yet.';
            leaderboardList.replaceChildren(emptyState);
            return;
        }

        leaderboardList.replaceChildren(
            ...data.map((entry, index) => createLeaderboardRow(entry, index))
        );
    } catch (error) {
        if (requestId !== leaderboardRequestId) return;
        console.error('Unable to load the paper trading leaderboard:', error);
        const errorState = document.createElement('li');
        errorState.className = 'card-10__empty';
        errorState.textContent = 'Leaderboard is temporarily unavailable.';
        leaderboardList.replaceChildren(errorState);
    }
}

leaderboardPeriodButtons.forEach((button) => {
    button.addEventListener('click', () => {
        setLeaderboardPeriod(button.dataset.period);
    });
});

setLeaderboardPeriod(
    [...leaderboardPeriodButtons].find((button) => button.getAttribute('aria-pressed') === 'true')?.dataset.period
        ?? 'month'
);
window.setInterval(() => setLeaderboardPeriod(selectedLeaderboardPeriod), 60 * 60 * 1000);

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
