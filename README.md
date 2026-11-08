# OrbitOS

Un superviseur de serveurs qui ressemble à un OS, dans le navigateur. Fenêtres, dock, Spotlight, widgets… au-dessus de **SSH** : rien à installer sur les serveurs.

## Démarrage

```bash
# 1. Une seule fois : faire pointer orbitos.mana vers le Mac
echo "127.0.0.1 orbitos.mana" | sudo tee -a /etc/hosts

# 2. Lancer (le vhost orbitos.mana démarre avec le conteneur)
docker compose up -d --build

# 3. Ouvrir http://orbitos.mana  (mot de passe : ORBIT_PASSWORD dans .env)
```

Le conteneur contient **nginx** (vhost `orbitos.mana`, WebSockets inclus) devant le serveur Node. `restart: unless-stopped` : il redémarre avec Docker Desktop.

> **Port 80 déjà pris ?** Mets `ORBIT_HTTP_PORT=8080` dans `.env` (→ http://orbitos.mana:8080).

## Applications

| App | Ce qu'elle fait |
| :--- | :--- |
| **Finder** | Fichiers via SFTP : hôte, volumes Docker, **système de fichiers des conteneurs** (`/proc/<pid>/root`). Upload en glisser-déposer, téléchargement (dossier → .tar.gz), aperçu des images, renommer, corbeille. |
| **Éditeur** | CodeMirror, coloration nginx/yaml/json/js/sh/Dockerfile, ⌘S. Sauvegarde horodatée avant chaque écriture. Sous `/etc/nginx` : `nginx -t` puis reload, **rollback automatique** si le test échoue. |
| **Terminal** | Onglets, shell SSH sur n'importe quel serveur, shell dans un conteneur (`docker exec`), « ouvrir un terminal ici ». |
| **Docker** | Conteneurs groupés par stack (logs, shell, fichiers, env avec secrets masqués, ports exposés signalés), **stacks de toutes sources** (Portainer, /root, /opt), images (pull, nettoyage des orphelines), volumes (taille, non rattachés). |
| **Domaines** | Tous les vhosts nginx avec santé des upstreams, SSL, noindex, SSO. Vérification externe DNS + HTTP + HTTPS. **Assistant « Nouveau domaine »** : proxy vers un conteneur, site statique ou redirection, HTTPS Let's Encrypt, noindex, forward-auth Authentik, aperçu de la config en direct. Activer/désactiver, supprimer (corbeille), renouveler les certificats. |
| **Hébergement** | **Applications** : catalogue en un clic — Minecraft Java/Bedrock, TeamSpeak 3/6, Garry's Mod, BeamMP (BeamNG), Valheim, Palworld, Factorio, Satisfactory, bot Discord depuis GitHub (Node, Bun, Python ou Dockerfile), ou n'importe quelle image Docker. Ports publics attribués automatiquement (port standard si libre), règles ufw, volumes nommés `app-<id>-*`, console de commandes (RCON / stdin), logs en direct, identifiants TeamSpeak récupérés dans les logs, sauvegardes/restaurations dans `/var/backups/orbitos/apps/`. **Sites web** : héberge un dépôt GitHub : détection (Vite, Astro, Next export, CRA… ou Dockerfile), build dans un conteneur jetable, vhost + SSL, déploiement en un clic, historique et retour arrière, rollback automatique si un conteneur ne répond pas. Sites Docker = stacks Portainer. Token GitHub fine-grained (Contents : lecture). |
| **Sauvegarde** | Pilote Backrest (et donc restic) par son API, via SSH : plans existants avec dernière/prochaine exécution, instantanés du dépôt, historique, « Sauvegarder maintenant ». Création/modification de plans (volumes Docker, apps OrbitOS, dossiers ; chemins traduits d'après les montages du conteneur Backrest), copie `config.json.bak_orbitos_*` avant chaque écriture. Restauration toujours dans un dossier neuf (`/tmp/orbitos-restore/…`). Détecte les verrous restic qui bloquent la rétention et propose `unlock`. |
| **Moniteur** | CPU (par cœur), mémoire, swap, réseau, disques en temps réel, processus (SIGTERM), `docker stats`. |
| **Console** | Logs en direct : conteneurs, unités systemd, journal, logs nginx. Filtre, erreurs uniquement, pause, suivi. |
| **Doctor** | Diagnostic : conteneurs fantômes, vhosts qui pointent vers un port mort, ports publiés par Docker qui contournent UFW, certificats, swap/disque/charge, images orphelines, volumes non rattachés, apt. Score de santé, renvoi vers l'app concernée, constats ignorables. |
| **Services** | systemd (start/stop/restart/logs), timers, cron traduit en clair. |
| **Bouclier** | Exposition réelle à Internet, règles UFW, CrowdSec et fail2ban (débannir), config SSH, mises à jour en attente. |
| **Serveurs** | Les alias de `~/.ssh/config` + ceux ajoutés dans l'interface, test de connexion, droits (root/sudo/docker). |
| **Journal** | Chaque action qui modifie un serveur est consignée, export Markdown. |

**⌘K** : Spotlight (apps, conteneurs, domaines, serveurs, actions comme « Shell dans X » ou « Logs de Y »).

## Sécurité

- **Accès** : lié à `127.0.0.1` uniquement ; mot de passe (comparaison à temps constant, limitation des tentatives) ; cookie de session signé `HttpOnly` + `SameSite=Strict` ; liste blanche du header `Host` (anti DNS-rebinding) ; en-tête `X-Orbit` obligatoire sur toute mutation (anti-CSRF) ; vérification de l'`Origin` sur les WebSockets.
- **SSH** : `~/.ssh` monté **en lecture seule**, les clés ne sont jamais copiées. Les clés d'hôte sont **vérifiées strictement** contre `known_hosts` : si une clé a changé, la connexion est refusée. Un serveur jamais vu est accepté au premier contact puis mémorisé (comme `StrictHostKeyChecking=accept-new`).
- **Commandes** : tous les paramètres sont validés (noms Docker, domaines, unités, chemins) et échappés pour le shell.
- **Garde-fous** : sauvegarde horodatée dans `/var/backups/orbitos/` avant toute écriture ; `nginx -t` avant chaque reload avec rollback ; aucune suppression définitive (corbeille serveur dans `/var/backups/orbitos/trash/`) ; chemins système protégés ; confirmation pour chaque action destructive.
- **Lecture seule** : `ORBIT_READONLY=1` dans `.env` bloque toutes les mutations.
- Utilisateur non-root (ex. `ubuntu`) : `sudo -n` est utilisé automatiquement quand il est disponible sans mot de passe.

## Déploiement continu (GitHub Actions)

Le workflow `.github/workflows/deploy.yml` vérifie le code à chaque push et pull request. Sur `main`, il déploie **si la variable de dépôt `DEPLOY_HOST` existe** (les forks ne déploient jamais) :

1. Copier `deploy/orbitos-deploy` dans `/usr/local/bin/` sur le serveur (`chmod 755`) et écrire `/etc/orbitos-deploy.conf` (`COMPOSE_FILE`, `ENV_FILE`, `HEALTH_URL`, `HEALTH_HOST` : voir l'en-tête du script).
2. Générer une clé dédiée et la restreindre au script dans `authorized_keys` :
   `restrict,command="/usr/local/bin/orbitos-deploy" ssh-ed25519 AAAA… github-actions-orbitos`
3. Sur GitHub : secrets `DEPLOY_SSH_KEY` (clé privée) et `DEPLOY_KNOWN_HOSTS` (`ssh-keyscan` vérifié), variables `DEPLOY_HOST` et `DEPLOY_USER`.

À chaque déploiement : build d'une image candidate (la prod n'est pas touchée si le build échoue), sauvegarde des sources dans `/var/backups/orbitos-src/`, recréation du conteneur, contrôle de santé et **retour automatique à l'image précédente** s'il échoue. Les fichiers propres au serveur (`ssh/`, `.env`, `compose.yml`, `local/`) ne sont jamais écrasés.

## Développement

```bash
npm install && (cd web && npm install)
ORBIT_PASSWORD=dev PORT=4011 npm run dev   # API sur :4011 (données dans ./data)
cd web && npm run dev                      # interface sur http://localhost:5173
```

```
server/            API Fastify + WebSockets
  ssh.js           registre des serveurs, pool ssh2, vérification des clés d'hôte, exec/PTY/SFTP
  modules/         system · docker · files · nginx · doctor · sites · apps · catalog · backrest
  journal.js       journal des actions (JSONL)
web/src/
  os/              gestionnaire de fenêtres, dock, barre de menus, Spotlight, composants
  apps/            une app par fichier (chargées à la demande)
docker/            vhost nginx orbitos.mana + entrypoint
```

## Pistes suivantes

Dumps des bases avant sauvegarde, Database Studio (Postgres/MariaDB/SQLite des conteneurs), gestionnaire de `.env`, mode maintenance par site, serveurs de jeu à la demande.
