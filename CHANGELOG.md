# Changelog

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
