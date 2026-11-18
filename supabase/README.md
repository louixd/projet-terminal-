# Portefeuille simulé

## Comportement

- Chaque compte reçoit un portefeuille de 10 000 USD virtuels.
- La première version accepte les tickers d’actions américaines, les positions longues et le levier de 1× à 10×.
- « Acheter » ouvre une position; « Vendre » ferme la position choisie.
- La marge est réservée à l’ouverture. Une position est liquidée si sa perte atteint cette marge. Les frais, dividendes, intérêts et le glissement ne sont pas simulés.
- Les ordres et soldes sont stockés dans Supabase et isolés par utilisateur. Le classement public ne montre que le pseudonyme et les résultats agrégés.
- Les cours de position et le classement sont recalculés toutes les heures. Week et Month utilisent respectivement les 7 et 30 derniers jours.
- Le widget TradingView et le ticket d’ordre utilisent deux flux séparés. Le ticker du widget n’est pas synchronisé avec le ticket.

Il s’agit uniquement d’une simulation, pas d’un service de courtage ni d’un conseil financier.

## Déploiement Supabase

1. Appliquer les migrations du dossier `supabase/migrations`.
2. Créer une clé [Twelve Data](https://twelvedata.com/) et vérifier que le forfait choisi autorise l’usage et l’affichage des cotations dans l’application. Les quotas dépendent du nombre de symboles actifs et des appels d’ordres; le forfait gratuit peut ne pas suffire pour plusieurs positions ouvertes.
3. Dans **Supabase → Edge Functions → Secrets**, définir `TWELVE_DATA_API_KEY` et `PAPER_TRADING_CRON_SECRET`.
4. Dans **Supabase Vault**, créer un secret nommé `paper_trading_cron_secret` avec exactement la même valeur que `PAPER_TRADING_CRON_SECRET`. Ne pas mettre cette valeur dans le dépôt ni dans le navigateur.
5. Déployer les fonctions `paper-trade` et `refresh-paper-market`.
6. Dans l’éditeur SQL Supabase, lancer `select public.schedule_hourly_paper_market_refresh();` pour activer le cron horaire.

La migration crée les tables, les politiques RLS, les fonctions sécurisées et le planificateur. Si le secret Vault n’existe pas lors de son application, l’étape 6 est nécessaire après sa création. L’URL du projet utilisée par le cron doit correspondre à l’URL Supabase de `js/supabase.js`.

Les clés Twelve Data et cron doivent rester côté serveur. Les mises à jour horaires ne commencent qu’après le déploiement des fonctions, l’application des migrations et la configuration des secrets.
