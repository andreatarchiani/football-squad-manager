# Changelog

## 2026-11-20 — Match Center e interfaccia più accattivante

- **Miglioramento:** trasformata la Home in un pannello prepartita con stemma della squadra selezionata, avversario modificabile, confronto VS e riepilogo di modulo, giocatori e stato della formazione. Rifiniti anche navigazione, profondità dei pannelli, intestazioni, pulsanti e riflessi LED, mantenendo invariati dati e funzioni sportive.

## 2026-11-20 — Restyling completo stile stadio LED

- **Modifica:** rinnovata l'interfaccia di tutto Football Squad Manager seguendo il riferimento visivo fornito: barra superiore con logo e titolo, menu laterale con sfondo stadio, fari e pallone, cornice centrale doppia con LED azzurri, pannelli blu notte, pulsanti e menu coordinati su Home, Squadre, Giocatori e partita. Mantenute le funzionalità esistenti e la disposizione della formazione.

## 2026-11-20 — Interfaccia futuristica con LED

- **Miglioramento:** aggiunti sottili effetti LED ai bordi dei pannelli, ai menu desktop e mobile, ai pulsanti, ai selettori e al tabellone della partita; introdotte superfici vetro scuro e animazioni lente con rispetto della preferenza di movimento ridotto, mantenendo la palette sobria e senza modificare le funzionalità.

## 2026-11-20 — Colori più equilibrati

- **Miglioramento:** ridotta la saturazione della grafica Stadium in tutta l'app, con blu notte e blu petrolio più morbidi, rossi meno intensi, bordi discreti e ombre più leggere per menu, pulsanti, pannelli, selettori e schermata partita, mantenendo invariata la struttura e le funzionalità.

## 2026-11-19 — Interfaccia Stadium Neon

- **Modifica:** rinnovata l'interfaccia di Football Squad Manager ispirandosi al dashboard calcistico di riferimento: navigazione laterale e mobile, icone, intestazioni, pulsanti, menu a tendina, schede Squadre/Giocatori, Home, schermata partita, accesso e Centro Assistenza condividono ora pannelli blu notte, bordi luminosi azzurri e accenti rossi per gli avversari e le azioni critiche. Conservate le funzionalità e la disposizione della formazione.

## 2026-11-17 — Centro Assistenza integrato

- **Nuova funzionalità:** le segnalazioni bug testuali vengono inviate direttamente dall'app a Firestore sul piano Spark, senza email, file `.eml` o backend esterno.
- **Miglioramento:** l'account `squadmanagersupport@gmail.com` visualizza le segnalazioni in una dashboard riservata con ricerca, filtri e aggiornamento degli stati (Da leggere, In lavorazione, Risolto).
- **Modifica:** gli allegati sono temporaneamente disabilitati nel modulo segnalazioni per mantenere la gestione semplice e compatibile con il piano gratuito.

## 2026-11-17 — Icona squadra personalizzata

- **Caricamento immagine squadra:** aggiunto un pulsante tra le icone predefinite per scegliere un'immagine dal dispositivo e usarla come icona della squadra.
- **Ottimizzazione automatica:** l'immagine viene adattata a 256×256 prima del salvataggio per ridurre dimensioni e peso.
- **Pubblicazione corretta:** alleggeriti gli stili della schermata Squadre per consentire alla build di produzione di includere il nuovo caricamento immagine.
- **Anteprima immediata:** dopo il caricamento l'immagine viene mostrata subito nel riquadro e compare la conferma “Immagine caricata correttamente”, prima di premere Salva.
- **Aggiornamento istantaneo della preview:** il riquadro ora mostra sempre l'ultima immagine appena selezionata, senza restare sulla precedente.

## 2026-11-14 — Aggiornamenti Football Squad Manager

- **Capitano e vicecapitano:** possibilità di assegnare i ruoli ai giocatori, con fasce identificative C e VC nella rosa.
- **Icona assist:** aggiunta l'icona della scarpa per identificare gli assist dei giocatori.
- **Assistente vocale migliorato:** riconoscimento più affidabile dei comandi vocali completi, compresi quelli con più azioni e numeri di maglia.
