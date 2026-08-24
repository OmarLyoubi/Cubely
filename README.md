# Cubely — publication

Cette version est un site statique : aucun `npm install` ni compilation n’est nécessaire.

## Option recommandée : Vercel

1. Créez un compte sur https://vercel.com avec GitHub, GitLab ou une adresse e-mail.
2. Placez ce dossier dans un dépôt GitHub, puis cliquez sur **Add New → Project** dans Vercel.
3. Importez le dépôt. Vercel détectera automatiquement le site statique : ne définissez ni commande de build, ni dossier de sortie.
4. Cliquez sur **Deploy**. Une URL HTTPS publique sera fournie.

Le fichier `vercel.json` active des en-têtes de sécurité adaptés au site et autorise la caméra uniquement depuis le domaine publié.

## Publication sans GitHub

Vous pouvez aussi déposer directement ce dossier sur Netlify Drop : https://app.netlify.com/drop. Le dossier doit contenir `index.html`, `style.css`, `enhancements.css`, `hero-cube.css` et `app.js`.

## Important avant une vraie mise en production

La version actuelle est une démo front-end. Les comptes et les résultats sauvegardés sont locaux au navigateur. Une plateforme multi-joueurs nécessite un backend (authentification, base de données, WebSocket et WebRTC) avant d’accepter de vraies compétitions.
