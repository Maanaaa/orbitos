# OrbitOS

**Tes serveurs, comme un OS.** Un superviseur qui ressemble à macOS, dans le navigateur : fenêtres, Dock, Spotlight, widgets… au-dessus de **SSH**. Rien à installer sur les serveurs.

[Site](https://maanaaa.github.io/orbitos/) · [Démarrer](#démarrer) · [Configuration](#configuration) · [Sécurité](#sécurité) · Licence MIT

> *A browser-based, macOS-like control panel for your Linux servers, over plain SSH (agentless): Docker, files, nginx domains, one-click game/voice/bot hosting, Backrest/restic backups. French UI.*

## Démarrer

Prérequis : Docker (avec compose) sur la machine qui héberge OrbitOS, et un accès SSH par clé à tes serveurs (n'importe quel Linux ; Docker, nginx, ufw… sont détectés et optionnels).

```bash
git clone https://github.com/Maanaaa/orbitos && cd orbitos
cp .env.example .env        # choisis ORBIT_PASSWORD
docker compose up -d --build
# → http://localhost:8080
```

Au premier lancement, un accueil guidé propose : nom de l'instance, fuseau horaire, serveurs (les alias de `~/.ssh/config` sont détectés, d'autres s'ajoutent dans l'interface) et modules à garder. Tout se modifie ensuite dans **Réglages**.

### Sur un serveur (accès distant)

OrbitOS ouvre un shell sur tes machines : ne l'expose jamais directement.

1. Dossier SSH dédié, par ex. `/opt/orbitos/ssh/` avec `config`, `known_hosts` et une clé dont la partie publique est dans les `authorized_keys` des serveurs à superviser. Dans `.env` : `ORBIT_SSH_DIR=/opt/orbitos/ssh`.
2. `ORBIT_HOSTS=orbitos.example.com` (liste blanche des noms d'hôte, anti DNS-rebinding).
3. Un reverse proxy TLS devant `127.0.0.1:8080` (WebSockets activés, `proxy_read_timeout 1h`), protégé par un **SSO** (Authentik, Authelia…) ou un **VPN**. L'app Domaines sait générer ce vhost, forward-auth Authentik compris.

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
| **Réglages** | Nom de l'instance, fuseau et domaine par défaut, **modules activés ou non**, intégrations (GitHub, Portainer), installation de Backrest et ajout de dépôts restic, mot de passe. Accueil guidé au premier lancement. |

**⌘K** : Spotlight (apps, conteneurs, domaines, serveurs, actions comme « Shell dans X » ou « Logs de Y »).

**⌘K** : Spotlight (apps, conteneurs, domaines, serveurs, actions comme « Shell dans X » ou « Logs de Y »).

## Configuration

### Variables d'environnement

| Variable | Défaut | Rôle |
| :--- | :--- | :--- |
| `ORBIT_PASSWORD` | généré au 1er lancement (affiché dans les logs) | Mot de passe de connexion. S'il est défini, il ne se change pas depuis l'interface. |
| `ORBIT_HTTP_PORT` | `8080` | Port local (lié à `127.0.0.1`). |
| `ORBIT_HOSTS` | `localhost,127.0.0.1` | Noms d'hôte acceptés. |
| `ORBIT_SSH_DIR` | `~/.ssh` | Dossier SSH monté **en lecture seule**. |
| `ORBIT_READONLY` | `0` | `1` = consultation seule, aucune action ne modifie les serveurs. |
| `TZ` | `Etc/UTC` | Fuseau du conteneur (celui des apps hébergées se règle dans Réglages). |

### Dans l'interface (Réglages)

- **Modules** : coupe ce dont tu n'as pas besoin. Hébergement, Sauvegarde, Doctor, Bouclier et Services sont aussi bloqués côté API.
- **Intégrations** : token GitHub *fine-grained* (Contents : lecture) pour les sites et bots depuis un dépôt privé ; Portainer (URL, clé `ptr_…`, endpoint, **serveur géré**) pour que sites et applications deviennent des stacks Portainer, sinon `docker compose` est utilisé.
- **Sauvegarde** : pour chaque serveur, installe Backrest en un clic (conteneur lié à `127.0.0.1:9898`, dossiers de l'hôte montés en lecture seule sous `/data/…`, dépôts locaux dans `/srv/restic`), puis ajoute un dépôt restic : **Backblaze B2, S3 compatible, dossier local ou rest-server**. Backrest l'initialise ; le mot de passe de chiffrement généré n'est affiché qu'une fois, note-le. Un Backrest existant est détecté et piloté tel quel (y compris avec authentification).

Toutes les données d'OrbitOS (serveurs ajoutés, réglages, journal, secrets en `0600`, clés d'hôte mémorisées) vivent dans le volume `orbitos-data`.

## Sécurité

- **Accès** : lié à `127.0.0.1` ; mot de passe comparé à temps constant avec limitation des tentatives ; cookie de session signé `HttpOnly` + `SameSite=Strict` ; liste blanche du header `Host` ; en-tête `X-Orbit` obligatoire sur toute mutation (anti-CSRF) ; `Origin` vérifiée sur les WebSockets. Changer le mot de passe déconnecte les autres sessions.
- **SSH** : clés montées en lecture seule, jamais copiées ; clés d'hôte **vérifiées strictement** contre `known_hosts` (un serveur jamais vu est mémorisé au premier contact, comme `accept-new`).
- **Commandes** : paramètres validés (noms Docker, domaines, unités, chemins) et échappés pour le shell ; secrets transmis par stdin, jamais en argument visible dans `ps`.
- **Garde-fous** : sauvegarde horodatée dans `/var/backups/orbitos/` avant toute écriture ; `nginx -t` avant chaque reload avec rollback ; corbeille serveur au lieu de suppressions définitives ; copie de `config.json` avant toute modification de Backrest ; restaurations dans un dossier neuf ; confirmation pour chaque action destructive.
- Utilisateur non-root : `sudo -n` est utilisé automatiquement s'il est disponible sans mot de passe.

## Déploiement continu (optionnel)

`.github/workflows/deploy.yml` vérifie le code à chaque push et pull request. Sur `main`, il déploie **seulement si la variable de dépôt `DEPLOY_HOST` existe** (un fork ne déploie jamais) :

1. Copier `deploy/orbitos-deploy` dans `/usr/local/bin/` (`chmod 755`) et écrire `/etc/orbitos-deploy.conf` (`COMPOSE_FILE`, `ENV_FILE`, `HEALTH_URL`, `HEALTH_HOST` : voir l'en-tête du script).
2. Clé dédiée restreinte au script dans `authorized_keys` :
   `restrict,command="/usr/local/bin/orbitos-deploy" ssh-ed25519 AAAA… github-actions-orbitos`
3. Secrets GitHub `DEPLOY_SSH_KEY` et `DEPLOY_KNOWN_HOSTS`, variables `DEPLOY_HOST` et `DEPLOY_USER`.

Chaque déploiement construit une image candidate (la prod n'est pas touchée si le build échoue), sauvegarde les sources, recrée le conteneur, contrôle la santé et **revient à l'image précédente** en cas d'échec.

## Développement

```bash
npm install && (cd web && npm install)
ORBIT_PASSWORD=dev PORT=4011 npm run dev   # API sur :4011 (données dans ./data)
cd web && npm run dev                      # interface sur http://localhost:5173
```

```
server/            API Fastify + WebSockets
  ssh.js           registre des serveurs, pool ssh2, clés d'hôte, exec/PTY/SFTP/flux
  settings.js      réglages de l'instance et modules
  modules/         system · docker · files · nginx · doctor · sites · apps · catalog · backrest · github · portainer
web/src/
  os/              gestionnaire de fenêtres, Dock, barre de menus, Spotlight, accueil
  apps/            une app par fichier (chargées à la demande)
site/              site vitrine (GitHub Pages)
deploy/            script de déploiement continu
```

Ajouter un jeu ou un service au catalogue d'Hébergement : un objet dans `server/modules/catalog.js` (image, ports, volumes, réglages → variables d'environnement, console). Les contributions sont bienvenues.

## Licence

[MIT](LICENSE)
