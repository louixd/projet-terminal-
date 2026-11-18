import { supabase } from './supabase.js';

const authNotice = document.getElementById('paper-auth-notice');
const content = document.getElementById('paper-content');
const orderForm = document.getElementById('paper-order-form');
const symbolInput = document.getElementById('paper-symbol');
const quantityInput = document.getElementById('paper-quantity');
const leverageInput = document.getElementById('paper-leverage');
const buyButton = document.getElementById('paper-buy-button');
const limitPriceInput = document.getElementById('paper-limit-price');
const takeProfitInput = document.getElementById('paper-take-profit');
const stopLossInput = document.getElementById('paper-stop-loss');
const estimatedTotal = document.getElementById('paper-estimated-total');
const message = document.getElementById('paper-message');
const positionsList = document.getElementById('paper-positions');
const pendingOrdersList = document.getElementById('paper-pending-orders');
const pendingOrdersSection = document.getElementById('paper-pending-orders-section');
const pendingOrderCount = document.getElementById('paper-pending-order-count');
const tradesList = document.getElementById('paper-trades');
const positionCount = document.getElementById('paper-position-count');
const panel = document.getElementById('paper-panel');
const panelTitle = document.getElementById('paper-mode-title');
const positionsTitle = document.getElementById('paper-positions-title');
const buyTrigger = document.getElementById('open-buy-panel');
const sellTrigger = document.getElementById('open-sell-panel');
const closePanelButton = document.getElementById('close-paper-panel');

const formatCurrency = new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2
});
const formatQuantity = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 6 });
let isAuthenticated = false;
let lastPanelTrigger = buyTrigger;

function openPanel(mode, trigger) {
    lastPanelTrigger = trigger;
    panelTitle.textContent = mode === 'buy' ? 'Acheter' : 'Vendre';
    positionsTitle.textContent = mode === 'buy' ? 'Positions ouvertes' : 'Choisis une position à fermer';
    orderForm.hidden = mode === 'sell';
    panel.hidden = false;
    panel.setAttribute('aria-hidden', 'false');
    closePanelButton.focus();
}

function closePanel() {
    panel.hidden = true;
    panel.setAttribute('aria-hidden', 'true');
    lastPanelTrigger.focus();
}

buyTrigger.addEventListener('click', () => openPanel('buy', buyTrigger));
sellTrigger.addEventListener('click', () => openPanel('sell', sellTrigger));
closePanelButton.addEventListener('click', closePanel);
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) closePanel();
});

function updateEstimatedTotal() {
    const limitPrice = Number(limitPriceInput.value);
    const quantity = Number(quantityInput.value);
    estimatedTotal.textContent = Number.isFinite(limitPrice * quantity) && limitPrice > 0 && quantity > 0
        ? formatCurrency.format(limitPrice * quantity)
        : '—';
}

limitPriceInput.addEventListener('input', updateEstimatedTotal);
quantityInput.addEventListener('input', updateEstimatedTotal);

function setMessage(text, kind = '') {
    message.textContent = text;
    message.className = `paper-message${kind ? ` paper-message--${kind}` : ''}`;
}

function makeElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

function formatPnl(value) {
    const amount = Number(value);
    return `${amount > 0 ? '+' : ''}${formatCurrency.format(amount)}`;
}

function setPnlClass(element, value) {
    const amount = Number(value);
    element.classList.toggle('is-positive', amount > 0);
    element.classList.toggle('is-negative', amount < 0);
}

function renderPositions(positions) {
    positionsList.replaceChildren();
    positionCount.textContent = String(positions.length);

    if (positions.length === 0) {
        positionsList.append(makeElement('li', 'paper-empty', 'Aucune position ouverte.'));
        return;
    }

    for (const position of positions) {
        const row = makeElement('li', 'paper-position');
        const top = makeElement('div', 'paper-position__top');
        const symbol = makeElement('span', 'paper-position__symbol', position.symbol);
        const leverage = makeElement('span', 'paper-position__leverage', `${position.leverage}×`);
        top.append(symbol, leverage);

        const bottom = makeElement('div', 'paper-position__bottom');
        const details = makeElement('div', 'paper-position__details');
        details.append(
            makeElement('span', '', `${formatQuantity.format(Number(position.quantity))} action(s) · entrée ${formatCurrency.format(Number(position.entry_price))}`),
            makeElement('span', '', `Cours ${formatCurrency.format(Number(position.current_price))} · liquidation ${formatCurrency.format(Number(position.liquidation_price))}`)
        );
        const pnl = makeElement('span', 'paper-position__pnl', formatPnl(position.unrealized_pnl));
        setPnlClass(pnl, position.unrealized_pnl);

        const bracketsForm = makeElement('form', 'paper-position-levels');
        const takeProfit = makePriceInput('Take profit · USD', position.take_profit_price);
        const stopLoss = makePriceInput('Stop loss · USD', position.stop_loss_price);
        const saveBrackets = makeElement('button', 'paper-button paper-button--secondary', 'Enregistrer TP / SL');
        saveBrackets.type = 'submit';
        bracketsForm.append(takeProfit.label, stopLoss.label, saveBrackets);
        bracketsForm.addEventListener('submit', (event) => {
            event.preventDefault();
            submitTrade({
                action: 'set_brackets',
                position_id: position.id,
                take_profit: takeProfit.input.value || null,
                stop_loss: stopLoss.input.value || null
            }, saveBrackets);
        });

        const sellLimitForm = makeElement('form', 'paper-position-levels paper-position-levels--sell');
        const sellLimit = makePriceInput('Vendre à partir de · USD', position.limit_exit_price);
        const placeSellLimit = makeElement('button', 'paper-button paper-button--sell', 'Enregistrer la vente limite');
        placeSellLimit.type = 'submit';
        sellLimitForm.append(
            sellLimit.label,
            makeElement('span', 'paper-order-hint', 'Laisser vide annule la vente limite en attente.'),
            placeSellLimit
        );
        sellLimitForm.addEventListener('submit', (event) => {
            event.preventDefault();
            submitTrade({
                action: 'sell_limit',
                position_id: position.id,
                limit_price: sellLimit.input.value || null
            }, placeSellLimit);
        });

        const sellButton = makeElement('button', 'paper-button paper-button--sell', 'Vendre au marché');
        sellButton.type = 'button';
        sellButton.setAttribute('aria-label', `Vendre ${position.symbol} au marché et fermer la position`);
        sellButton.addEventListener('click', () => submitTrade({
            action: 'sell',
            position_id: position.id
        }, sellButton));

        bottom.append(details, pnl);
        row.append(top, bottom, bracketsForm, sellLimitForm, sellButton);
        positionsList.append(row);
    }
}

function makePriceInput(labelText, value) {
    const label = makeElement('label', 'paper-level-input');
    label.append(makeElement('span', '', labelText));
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0.000001';
    input.max = '1000000';
    input.step = '0.000001';
    input.inputMode = 'decimal';
    input.value = value == null ? '' : String(value);
    input.placeholder = 'Facultatif';
    label.append(input);
    return { label, input };
}

function renderPendingOrders(orders) {
    pendingOrdersList.replaceChildren();
    pendingOrderCount.textContent = String(orders.length);
    pendingOrdersSection.hidden = orders.length === 0;

    for (const order of orders) {
        const row = makeElement('li', 'paper-position');
        const details = makeElement('div', 'paper-position__details');
        details.append(
            makeElement('strong', 'paper-position__symbol', `${order.symbol} · achat limite`),
            makeElement('span', '', `${formatQuantity.format(Number(order.quantity))} unité(s) à ${formatCurrency.format(Number(order.limit_price))}`),
            makeElement('span', '', `Marge réservée : ${formatCurrency.format(Number(order.reserved_margin))}`)
        );
        const cancel = makeElement('button', 'paper-button paper-button--sell', 'Annuler l’ordre');
        cancel.type = 'button';
        cancel.addEventListener('click', () => submitTrade({
            action: 'cancel_limit',
            order_id: order.id
        }, cancel));
        row.append(details, cancel);
        pendingOrdersList.append(row);
    }
}

function renderTrades(trades) {
    tradesList.replaceChildren();
    if (trades.length === 0) {
        tradesList.append(makeElement('li', 'paper-empty', 'Ton historique apparaîtra ici.'));
        return;
    }

    const actionLabels = {
        buy: 'Achat',
        sell: 'Vente',
        liquidation: 'Liquidation'
    };

    for (const trade of trades) {
        const row = makeElement('li', 'paper-trade');
        const details = makeElement('span', 'paper-trade__details');
        const action = actionLabels[trade.action] ?? trade.action;
        const date = new Intl.DateTimeFormat('fr-FR', {
            dateStyle: 'short',
            timeStyle: 'short'
        }).format(new Date(trade.created_at));
        details.append(
            makeElement('strong', '', `${action} · ${trade.symbol}`),
            makeElement('span', '', `${formatQuantity.format(Number(trade.quantity))} action(s) · ${date}`)
        );
        const pnl = trade.realized_pnl == null
            ? ''
            : formatPnl(trade.realized_pnl);
        const pnlElement = makeElement('span', 'paper-trade__pnl', pnl);
        if (pnl) setPnlClass(pnlElement, trade.realized_pnl);
        row.append(details, pnlElement);
        tradesList.append(row);
    }
}

function renderPortfolio(portfolio) {
    const initialBalance = Number(portfolio.initial_balance);
    const cashBalance = Number(portfolio.cash_balance);
    const equity = Number(portfolio.equity);
    const totalPnl = equity - initialBalance;

    document.getElementById('paper-equity').textContent = formatCurrency.format(equity);
    document.getElementById('paper-cash').textContent = formatCurrency.format(cashBalance);
    const pnlElement = document.getElementById('paper-total-pnl');
    pnlElement.textContent = formatPnl(totalPnl);
    setPnlClass(pnlElement, totalPnl);

    const snapshotTime = portfolio.last_snapshot_at;
    document.getElementById('paper-updated-at').textContent = snapshotTime
        ? `Dernière mise à jour : ${new Intl.DateTimeFormat('fr-FR', {
            dateStyle: 'short',
            timeStyle: 'short',
            timeZone: 'UTC'
        }).format(new Date(snapshotTime))} UTC`
        : 'Les cours et les ordres sont vérifiés chaque minute.';

    renderPositions(portfolio.positions ?? []);
    renderPendingOrders(portfolio.pending_orders ?? []);
    renderTrades(portfolio.trades ?? []);
}

async function loadPortfolio() {
    const { data, error } = await supabase.rpc('get_paper_portfolio');
    if (error) throw error;
    renderPortfolio(data);
}

async function getFunctionError(error, data) {
    if (typeof data?.error === 'string') return data.error;
    if (error?.context instanceof Response) {
        try {
            const responseBody = await error.context.clone().json();
            if (typeof responseBody?.error === 'string') return responseBody.error;
        } catch {
            return error.message;
        }
    }
    return error?.message ?? 'La transaction simulée a échoué.';
}

async function submitTrade(order, button) {
    if (!isAuthenticated) return;

    button.disabled = true;
    setMessage('Vérification du cours et enregistrement…');
    try {
        const { data, error } = await supabase.functions.invoke('paper-trade', { body: order });
        if (error) throw new Error(await getFunctionError(error, data));
        if (data?.error) throw new Error(data.error);

        const executedOrder = data?.order;
        let resultMessage;
        if (order.action === 'buy') {
            resultMessage = executedOrder.status === 'pending'
                ? `Achat limite ${executedOrder.symbol} en attente à ${formatCurrency.format(Number(executedOrder.limit_price))}.`
                : `${executedOrder.symbol} acheté à ${formatCurrency.format(Number(executedOrder.price))}.`;
        } else if (order.action === 'sell_limit') {
            if (executedOrder.status === 'cancelled') {
                resultMessage = 'Vente limite annulée.';
            } else if (executedOrder.status === 'pending') {
                resultMessage = `Vente limite enregistrée à ${formatCurrency.format(Number(executedOrder.limit_exit_price))}.`;
            } else {
                resultMessage = `Position vendue à ${formatCurrency.format(Number(executedOrder.price))} · P&L ${formatPnl(executedOrder.realized_pnl)}.`;
            }
        } else if (order.action === 'set_brackets') {
            resultMessage = executedOrder.brackets_triggered
                ? `Un seuil était déjà atteint. Position fermée à ${formatCurrency.format(Number(executedOrder.price))}.`
                : 'Niveaux TP / SL enregistrés.';
        } else if (order.action === 'cancel_limit') {
            resultMessage = 'Ordre limite annulé; la marge réservée est libérée.';
        } else {
            resultMessage = `Position fermée à ${formatCurrency.format(Number(executedOrder.price))} · P&L ${formatPnl(executedOrder.realized_pnl)}.`;
        }
        setMessage(resultMessage, 'success');

        try {
            await loadPortfolio();
        } catch (refreshError) {
            console.error('Paper order succeeded, but the portfolio could not refresh:', refreshError);
            setMessage(`${resultMessage} Actualisation du portefeuille impossible; recharge la page.`, 'error');
        }
    } catch (error) {
        console.error('Paper trade request failed:', error);
        setMessage(error instanceof Error ? error.message : 'La transaction simulée a échoué.', 'error');
    } finally {
        button.disabled = false;
    }
}

orderForm.addEventListener('submit', (event) => {
    event.preventDefault();
    submitTrade({
        action: 'buy',
        symbol: symbolInput.value,
        quantity: quantityInput.value,
        leverage: leverageInput.value,
        max_price: limitPriceInput.value,
        take_profit: takeProfitInput.value || null,
        stop_loss: stopLossInput.value || null
    }, buyButton);
});

const { data: { session }, error: sessionError } = await supabase.auth.getSession();
if (sessionError) {
    authNotice.hidden = false;
    authNotice.textContent = 'Impossible de vérifier la session. Recharge la page ou reconnecte-toi.';
    console.error('Unable to verify the paper trading session:', sessionError);
} else if (!session) {
    authNotice.hidden = false;
} else {
    isAuthenticated = true;
    content.hidden = false;
    try {
        await loadPortfolio();
    } catch (error) {
        console.error('Unable to load the paper portfolio:', error);
        setMessage(error instanceof Error ? error.message : 'Impossible de charger le portefeuille.', 'error');
    }

    window.setInterval(async () => {
        try {
            await loadPortfolio();
        } catch (error) {
            console.error('Unable to refresh the paper portfolio:', error);
            setMessage(error instanceof Error ? error.message : 'Impossible d’actualiser le portefeuille.', 'error');
        }
    }, 60 * 1000);
}
