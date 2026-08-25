# Cubely — application avec données persistantes

## Démarrage local

Node.js 22+ est requis. Sous Windows, double-cliquez sur `start-cubely.cmd`. Vous pouvez aussi lancer `npm run dev`, puis ouvrir `http://localhost:3000`.

Ne double-cliquez pas sur `index.html` : une page ouverte avec une URL `file://` ne peut pas joindre l’API ni la base de données.

La base SQLite persistante est créée dans `data/cubely.db` (ou à l’emplacement fourni dans `DATABASE_PATH`). Elle contient les utilisateurs, hashes de mots de passe scrypt, sessions révocables, compétitions, inscriptions et ordre des matchs.

## Production

SQLite convient au développement local et à un hébergement avec disque persistant. Les fonctions Vercel n’offrent pas de disque durable : avant toute mise en production Vercel, configurez une base SQL persistante (Postgres, par exemple) et remplacez l’adaptateur SQLite par l’adaptateur Postgres correspondant. Ne déployez jamais `data/cubely.db` dans Git.
