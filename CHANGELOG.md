# Changelog

## 2026-11-13 — Miglioramento aggiornamento icone PWA
- Impostata la rivalidazione delle risorse di branding e del manifest su Firebase Hosting, per ridurre l'uso di icone obsolete dalla cache HTTP.
- Configurato Angular Service Worker per precaricare le icone e scaricarne le nuove versioni durante gli aggiornamenti dell'app.
- Mantenuto il manifest a URL stabile e aggiornata la versione delle risorse grafiche per favorire un nuovo controllo del browser.
- Limite di piattaforma: l'icona sulla schermata Home è gestita da Android/iOS; l'aggiornamento senza reinstallazione non può essere garantito, specialmente su iPhone.

## 2026-11-13 — Icona dell'app installabile
- Configurata la nuova icona Football Squad Manager per l'installazione su Android e iPhone.
- Aggiunta icona PNG dedicata e aggiornato il manifest della PWA, mantenendo l'icona SVG.
- Aggiunto il riferimento Apple Touch Icon e il versionamento delle risorse per ridurre il rischio di cache obsolete.
- Le installazioni esistenti potrebbero mantenere temporaneamente l'icona precedente fino all'aggiornamento del sistema o a una nuova installazione.
