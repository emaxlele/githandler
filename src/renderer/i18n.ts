/**
 * Bilingual user interface: Italian is the source language, the catalogue maps it to English.
 *
 * Every visible string goes through this module. A key containing `{0}`, `{1}`… is a template:
 * the numbers follow the order in which the runtime values appear, so a translation may move them.
 * The lookup is exact first; templates are tried after, longest literal first.
 */
export type Locale = "it" | "en";

/** Preference stored in the settings; `auto` follows the system language. */
export type LocalePreference = "auto" | Locale;

export const LOCALE_STORAGE_KEY = "githandler.locale";

const EN: Record<string, string> = {
	Apri: "Open",
	Clona: "Clone",
	Cartella: "Folder",
	Aggiorna: "Refresh",
	Annulla: "Undo",
	"nessun repository": "no repository",
	"Nessun repository aperto.": "No repository open.",
	Live: "Live",
	Changes: "Changes",
	"All Commits": "All Commits",
	Branches: "Branches",
	Remotes: "Remotes",
	Tags: "Tags",
	Staged: "Staged",
	Unstage: "Unstage",
	Unstaged: "Unstaged",
	Stage: "Stage",
	"Seleziona un file.": "Select a file.",
	"includi non staged (-a)": "include unstaged (-a)",
	"File Tree": "File Tree",
	Blame: "Blame",
	Terminale: "Terminal",
	Unified: "Unified",
	Affiancato: "Side by side",
	"Seleziona un commit.": "Select a commit.",
	"File tree": "File tree",
	Comprimi: "Collapse",
	"Seleziona un file dall'albero.": "Select a file from the tree.",
	"chi ha scritto ogni riga, dal più recente":
		"who wrote each line, most recent first",
	"Seleziona un file da Changes o da un commit.":
		"Select a file from Changes or from a commit.",
	Interrompi: "Stop",
	"Apri un repository…": "Open a repository…",
	"Crea un repository…": "Create a repository…",
	"Clona da URL…": "Clone from URL…",
	"Clona da un account…": "Clone from an account…",
	"La cartella di base è": "The base folder is",
	": da lì partono i dialog e i cloni, poi si naviga dove serve. Si cambia nelle impostazioni.":
		": dialogs and clones start there, then you navigate wherever you need. You can change it in settings.",
	Impostazioni: "Settings",
	Aspetto: "Appearance",
	"Colori, densità e dimensione del testo. Il tema «Automatico» segue il sistema; «OLED» usa il nero assoluto.":
		"Colours, density and text size. The «Automatic» theme follows the system; «OLED» uses true black.",
	Tema: "Theme",
	"Automatico (sistema)": "Automatic (system)",
	Scuro: "Dark",
	Chiaro: "Light",
	"OLED (nero)": "OLED (black)",
	Densità: "Density",
	Comoda: "Comfortable",
	Compatta: "Compact",
	"Dimensione del testo": "Text size",
	Piccola: "Small",
	Normale: "Normal",
	Grande: "Large",
	nuovo: "new",
	eliminato: "deleted",
	rinominato: "renamed",
	"rinominato da {0}": "renamed from {0}",
	copiato: "copied",
	"tipo cambiato": "type changed",
	binario: "binary",
	modificato: "modified",
	"Chiudi la scheda": "Close the tab",
	"Sto leggendo il remoto…": "Reading the remote…",
	"nessun tag": "no tags",
	"{0} copia · {1} su {2}": "{0} copy · {1} of {2}",
	"{0} copie · {1} su {2}": "{0} copies · {1} of {2}",
	"{0} · risolvi": "{0} · resolve",
	"Risolvi i conflitti": "Resolve conflicts",
	"Scegli per ogni file la versione da tenere, oppure correggi il risultato e segnalo come risolto. «Continua» riprende l'operazione quando non resta nessun conflitto.":
		"Choose the version to keep for each file, or fix the result and mark it resolved. «Continue» resumes the operation when no conflict is left.",
	"Usa mio": "Use mine",
	"Usa loro": "Use theirs",
	"Segna risolto": "Mark resolved",
	"Risultato del file": "File result",
	"Applica le scelte": "Apply choices",
	"Salva il testo": "Save text",
	Continua: "Continue",
	"Nessun conflitto: puoi continuare.": "No conflicts: you can continue.",
	"Conflitto {0}": "Conflict {0}",
	Mio: "Mine",
	Loro: "Theirs",
	Entrambi: "Both",
	Base: "Base",
	base: "base",
	mio: "mine",
	loro: "theirs",
	"Il file non ha più marcatori: correggi il testo e segnalo come risolto.":
		"The file has no markers left: fix the text and mark it resolved.",
	"Scegli una versione per ogni conflitto.":
		"Choose a version for every conflict.",
	"Scelte applicate. Segna il file come risolto quando hai finito.":
		"Choices applied. Mark the file as resolved when you are done.",
	"Testo salvato. Segna il file come risolto quando hai finito.":
		"Text saved. Mark the file as resolved when you are done.",
	"Operazione completata.": "Operation completed.",
	"Operazione fermata dai conflitti: scegli qui sotto la versione da tenere.":
		"The operation stopped on conflicts: choose the version to keep below.",
	"Dettaglio del conflitto": "Conflict details",
	Conflitti: "Conflicts",
	"Merge in corso": "Merge in progress",
	"Rebase in corso": "Rebase in progress",
	"Cherry-pick in corso": "Cherry-pick in progress",
	"{0} · annulla": "{0} · abort",
	"{0}+ commit — scorri per caricarne altri":
		"{0}+ commits — scroll to load more",
	"{0} commit": "{0} commits",
	"elenco troncato dal repository": "list truncated by the repository",
	"nessun account": "no account",
	Lingua: "Language",
	"Lingua dell'interfaccia": "Interface language",
	"La lingua dell'interfaccia. «Automatica» segue quella del sistema.":
		"The interface language. «Automatic» follows the system one.",
	"Automatica (sistema)": "Automatic (system)",
	"Cartella di base": "Base folder",
	"Da qui partono «Apri», «Crea» e «Clona». Non è un limite: nella finestra di scelta si può navigare ovunque.":
		'"Open", "Create" and "Clone" start here. It is not a limit: the picker lets you navigate anywhere.',
	"Scegli…": "Choose…",
	"API per l'AI (server MCP)": "AI API (MCP server)",
	"Il server espone solo i comandi consentiti qui, e la policy viene riletta a ogni richiesta. Il default è spento: un agente collegato non vede nulla finché non lo si abilita.":
		"The server exposes only the commands allowed here, and the policy is re-read on every request. The default is off: a connected agent sees nothing until you enable it.",
	Spente: "Off",
	"— nessun comando": "— no commands",
	"Solo lettura": "Read only",
	"— stato, storia, diff, blame": "— status, history, diff, blame",
	Tutte: "All",
	"— anche i comandi che scrivono": "— including the commands that write",
	Selettivi: "Selected",
	"— scegli i comandi": "— choose the commands",
	"— ramo e modifiche": "— branch and changes",
	history: "history",
	"— ricerca nella storia": "— search in the history",
	"— dettaglio e diff di un commit": "— details and diff of a commit",
	"— diff del working tree": "— working tree diff",
	"— chi ha scritto ogni riga": "— who wrote each line",
	Scrittura: "Writing",
	"— mette i file in stage": "— stages the files",
	"— toglie dallo stage": "— removes from the index",
	"— crea un commit": "— creates a commit",
	"— crea un ramo": "— creates a branch",
	"— cambia ramo": "— switches branch",
	"File non tracciati": "Untracked files",
	"Prima di cancellarli conserva una copia, così Annulla li ripristina":
		"Before deleting them, keep a copy so Undo can restore them",
	"Limite per operazione (MB)": "Limit per operation (MB)",
	"File per operazione": "Files per operation",
	"Spazio totale (MB)": "Total space (MB)",
	"Le copie sono oggetti Git (": "The copies are Git objects (",
	"): compresse, deduplicate e mai inviate al remoto. Oltre i limiti lo scarto si ferma; quando lo spazio totale è pieno si eliminano per prime le copie più vecchie.":
		"): compressed, deduplicated and never sent to the remote. Past the limits the discard stops; when the total space is full, the oldest copies are deleted first.",
	Salva: "Save",
	"Lo stash salva modifiche e file non tracciati e lascia il working tree pulito. Riprendere uno stash lo rimette sui file; «Pop» lo applica e lo elimina.":
		"A stash saves changes and untracked files and leaves the working tree clean. Restoring a stash puts it back on the files; «Pop» applies it and deletes it.",
	"Salva stash": "Save stash",
	Chiudi: "Close",
	"«Aggiorna» esegue": "«Refresh» runs",
	": scarica e allinea i submodule al commit registrato.":
		": downloads the submodules and aligns them to the recorded commit.",
	"Crea un repository": "Create a repository",
	"nella cartella scelta. Se compili nome e email diventano l'identità":
		"in the chosen folder. If you fill in name and email they become the",
	"del repository; vuoti, restano quelli globali di Git.":
		"identity of the repository; empty, they stay Git's global ones.",
	locale: "local",
	"Cartella genitore": "Parent folder",
	"Sfoglia…": "Browse…",
	"Nome del repository": "Repository name",
	"Nome (facoltativo)": "Name (optional)",
	"Email (facoltativa)": "Email (optional)",
	Crea: "Create",
	"Clona un repository": "Clone a repository",
	"Un URL HTTPS, SSH o un percorso locale. Il repository prende il nome dalla sua ultima parte e finisce nella cartella scelta.":
		"An HTTPS or SSH URL, or a local path. The repository takes its name from the last part of the URL and lands in the chosen folder.",
	"URL del repository": "Repository URL",
	"Account collegati": "Linked accounts",
	"Il token serve per elencare i repository e per clonare quelli privati; GitHandler non lo scrive su disco. Tre strade, dalla più semplice:":
		"The token is used to list repositories and clone private ones; GitHandler never writes it to disk. Three paths, from the simplest:",
	"Accedi con il token del computer": "Sign in with the computer's token",
	"usa un token che hai già (GitHub CLI o credential helper di Git);":
		"uses a token you already have (GitHub CLI or a Git credential helper);",
	"Accedi con il browser": "Sign in with the browser",
	"apre il browser e richiede un Client ID OAuth registrato;":
		"opens the browser and requires a registered OAuth client ID;",
	"Crea un token sul sito…": "Create a token on the website…",
	"apre la pagina dei token e poi lo incolli qui sotto.":
		"opens the token page and then you paste it below.",
	Nuovo: "New",
	Modificato: "Modified",
	"Non tracciato": "Untracked",
	Eliminato: "Deleted",
	Rinominato: "Renamed",
	Copiato: "Copied",
	"Tipo cambiato": "Type changed",
	Conflitto: "Conflict",
	Ignorato: "Ignored",
	Rimuovi: "Remove",
	Provider: "Provider",
	Host: "Host",
	Utente: "User",
	"Indirizzo API": "API address",
	"Client ID OAuth (per l'accesso dal browser)":
		"OAuth client ID (for browser sign-in)",
	"Crea…": "Create…",
	Token: "Token",
	"Accedi con il browser (serve il Client ID)":
		"Sign in with the browser (client ID required)",
	"Crea un token sul sito e incollalo…":
		"Create a token on the website and paste it…",
	"Etichetta (facoltativa)": "Label (optional)",
	"Salva account": "Save account",
	"Repository dell'account": "Account repositories",
	"Carica elenco": "Load list",
	"Carica altri": "Load more",
	"Clona in": "Clone into",
	"Apri un file del repository": "Open a repository file",
	"File tracciati in HEAD. Doppio clic per aprire con l'applicazione associata.":
		"Files tracked in HEAD. Double-click to open with the associated application.",
	"Apri nel browser": "Open in the browser",
	"GitHub Actions": "GitHub Actions",
	"Ultime esecuzioni del repository. «Ri-esegui» ripete i job falliti; «Annulla» ferma un'esecuzione in corso.":
		"Latest runs of the repository. «Re-run» repeats the failed jobs; «Cancel» stops a running one.",
	Esecuzioni: "Runs",
	Titolo: "Title",
	Valore: "Value",
	Conferma: "Confirm",
	"Apri un repository": "Open a repository",
	"Clona un repository da un URL o da un account":
		"Clone a repository from a URL or from an account",
	"Apri la cartella del repository nel gestore file":
		"Open the repository folder in the file manager",
	"git push (mai con forza)": "git push (never forced)",
	"Stash: salva e riprendi": "Stash: save and restore",
	"Annulla l'ultima operazione": "Undo the last operation",
	"Annulla l'operazione sospesa": "Abort the suspended operation",
	"Commit in anticipo (↑) e in ritardo (↓) rispetto al ramo remoto":
		"Commits ahead (↑) and behind (↓) the remote branch",
	"Account usato per questo repository: clic per cambiarlo":
		"Account used for this repository: click to change it",
	"Il repository viene riletto quando cambia sul disco (--watch)":
		"The repository is re-read when it changes on disk (--watch)",
	"Repository aperti": "Open repositories",
	"Apri un altro repository": "Open another repository",
	"Permessi delle API e copia dei file non tracciati":
		"API permissions and copy of untracked files",
	"File modificati nel working tree e pronti per il commit":
		"Files changed in the working tree, ready to be committed",
	"Storia dei commit del ramo attuale":
		"Commit history of the current branch",
	"Nuovo ramo": "New branch",
	"Cerca nella storia": "Search the history",
	"nome del ramo": "branch name",
	Filter: "Filter",
	"Togli il filtro": "Clear the filter",
	"Toglie dallo staging tutti i file, senza perdere le modifiche":
		"Removes every file from the staging area without losing the changes",
	"Aggiunge allo staging tutte le modifiche tracciate":
		"Stages every tracked change",
	"Messaggio di commit (Ctrl+Invio per confermare)":
		"Commit message (Ctrl+Enter to confirm)",
	"Crea il commit con i file in staging e il messaggio scritto":
		"Commit the staged files with the written message",
	"Trascina per ridimensionare il pannello": "Drag to resize the panel",
	"Dettagli e modifiche del commit selezionato":
		"Details and changes of the selected commit",
	"Albero dei file del commit selezionato":
		"File tree of the selected commit",
	"Chi ha cambiato ogni riga del file selezionato":
		"Who changed each line of the selected file",
	"Terminale Git nella cartella del repository":
		"Git terminal in the repository folder",
	"Formato del diff": "Diff format",
	"Una colonna, come git diff": "One column, like git diff",
	"Prima e dopo affiancati": "Before and after side by side",
	"Riduci il pannello": "Collapse the panel",
	"Apri il pannello in una finestra separata":
		"Open the panel in a separate window",
	"Comprime o espande tutte le cartelle dell'albero":
		"Collapses or expands every folder in the tree",
	"comando nella cartella del repository": "command in the repository folder",
	"Interrompi il comando": "Stop the command",
	"Sceglie una cartella già presente sul disco e la apre in una scheda":
		"Picks a folder already on disk and opens it in a tab",
	"Inizializza un repository nuovo in una cartella scelta da te":
		"Initializes a new repository in a folder you choose",
	"Clona un repository indicando l'URL Git e la cartella di destinazione":
		"Clones a repository given the Git URL and the destination folder",
	"Sceglie un repository dagli account collegati e lo clona":
		"Picks a repository from the linked accounts and clones it",
	"~ (home dell'utente)": "~ (user home)",
	"Sceglie la cartella di base per dialog e cloni":
		"Chooses the base folder for dialogs and clones",
	"Chiude senza salvare le modifiche": "Closes without saving the changes",
	"Salva le impostazioni su disco": "Saves the settings to disk",
	"Messaggio (facoltativo)": "Message (optional)",
	"Salva le modifiche correnti in uno stash e pulisce il working tree":
		"Saves the current changes in a stash and cleans the working tree",
	"Chiude l'elenco degli stash": "Closes the stash list",
	"Aggiorna e inizializza i submodule del repository":
		"Updates and initializes the repository submodules",
	"Chiude l'elenco dei submodule": "Closes the submodule list",
	"Sceglie la cartella in cui creare il nuovo repository":
		"Chooses the folder where the new repository is created",
	"nuovo-progetto": "new-project",
	"Chiude senza creare nulla": "Closes without creating anything",
	"Crea il repository nella cartella indicata":
		"Creates the repository in the chosen folder",
	"https://host/proprietario/repository.git":
		"https://host/owner/repository.git",
	"Sceglie la cartella in cui clonare il repository":
		"Chooses the folder where the repository is cloned",
	"Chiude senza clonare nulla": "Closes without cloning anything",
	"Clona il repository nella cartella indicata":
		"Clones the repository in the chosen folder",
	"Svuota i campi per collegare un altro account":
		"Clears the fields to link another account",
	"Toglie l'account da GitHandler; il token resta nel credential helper di Git, se ne hai uno":
		"Removes the account from GitHandler; the token stays in the Git credential helper, if you have one",
	facoltativo: "optional",
	"Apre la pagina dove registrare un'applicazione OAuth e ottenere il Client ID (dato pubblico, non un segreto)":
		"Opens the page where you register an OAuth application and get the client ID (public data, not a secret)",
	"incollalo qui dopo averlo creato sul sito":
		"paste it here after creating it on the website",
	"Il token creato a mano sul sito del provider. Resta in memoria per questa sessione, non viene scritto su disco.":
		"The token created by hand on the provider website. It stays in memory for this session and is never written to disk.",
	"Cerca un token già presente su questo computer: prima GitHub CLI (gh auth token), poi il credential helper di Git. Se lo trova, collega l'account senza chiedere altro.":
		"Looks for a token already on this computer: first GitHub CLI (gh auth token), then the Git credential helper. If it finds one, it links the account without asking anything else.",
	"OAuth device flow: apre il browser e aspetta l'autorizzazione. Richiede un Client ID OAuth registrato: senza, il provider non può restituire il token.":
		"OAuth device flow: opens the browser and waits for authorization. It requires a registered OAuth client ID; without it the provider cannot return a token.",
	"Apre la pagina del provider dove creare un token a mano, con le autorizzazioni già indicate. Poi incollalo nel campo Token.":
		"Opens the provider page where you create a token by hand, with the scopes already listed. Then paste it into the Token field.",
	"Salva l'account e il token inserito (se c'è). Il token non viene scritto su disco.":
		"Saves the account and the token you entered (if any). The token is never written to disk.",
	"Legge dall'API del provider i repository dell'account selezionato: serve il token":
		"Reads the repositories of the selected account from the provider API: the token is required",
	"Filtra per nome…": "Filter by name…",
	"Carica la pagina successiva dell'elenco dei repository":
		"Loads the next page of the repository list",
	"Chiude il dialogo; un accesso dal browser ancora in attesa viene fermato":
		"Closes the dialog; a browser sign-in still waiting is stopped",
	"Filtra per percorso…": "Filter by path…",
	"Apre il file nel browser del provider, nel ramo attuale (Gitea compreso)":
		"Opens the file in the provider website, on the current branch (Gitea included)",
	"Apre il file dal disco con l'applicazione associata":
		"Opens the file from disk with the associated application",
	"Chiude l'elenco senza aprire niente":
		"Closes the list without opening anything",
	"Rilegge da GitHub le ultime esecuzioni dei workflow":
		"Re-reads the latest workflow runs from GitHub",
	"Chiude la finestra delle esecuzioni": "Closes the runs window",
	"Chiude senza confermare": "Closes without confirming",
	"Conferma il valore inserito": "Confirms the entered value",
	Progetto: "Project",
	Vista: "View",
	"Rami e sincronizzazione": "Branches and sync",
	"Account collegati…": "Linked accounts…",
	"Impostazioni…": "Settings…",
	"Apri la cartella del repository": "Open the repository folder",
	Invio: "Enter",
	"Mostra le modifiche": "Show the changes",
	"Mostra tutti i commit": "Show all commits",
	"Togli il filtro dalla storia": "Clear the history filter",
	"Diff affiancato": "Side-by-side diff",
	"Diff a una colonna": "One-column diff",
	"Riduci o espandi il pannello": "Collapse or expand the panel",
	"Apri il pannello in una finestra": "Open the panel in a window",
	"Pannello: dettaglio del commit": "Panel: commit details",
	"Pannello: file del commit": "Panel: commit files",
	"Pannello: blame": "Panel: blame",
	"Pannello: terminale": "Panel: terminal",
	"Cerca un comando…": "Search a command…",
	"Cerca un comando": "Search a command",
	"Nessun comando corrisponde.": "No command matches.",
	"↑ ↓ per scorrere · Invio per eseguire · Esc per chiudere":
		"↑ ↓ to scroll · Enter to run · Esc to close",
	"Scorciatoie da tastiera": "Keyboard shortcuts",
	"Apre la palette dei comandi": "Opens the command palette",
	"Apre un repository dal disco": "Opens a repository from disk",
	"Rilegge il repository": "Re-reads the repository",
	"Pannello: commit, file, blame, terminale":
		"Panel: commit, files, blame, terminal",
	"Crea il commit con il messaggio scritto":
		"Creates the commit with the written message",
	"Mostra questo elenco": "Shows this list",
	"Chiude la finestra aperta o il menu": "Closes the open window or menu",
	"Nessuna copia conservata.": "No copy kept.",
	"Repository senza commit: crea il primo dalla scheda Modifiche.":
		"Repository without commits: create the first one from the Changes tab.",
	Ricerca: "Search",
	"Nessun commit per «{0}».": "No commit for «{0}».",
	"{0} risultati": "{0} results",
	Storia: "History",
	"{0} (Ctrl+Z)": "{0} (Ctrl+Z)",
	"Niente da annullare": "Nothing to undo",
	"Vai al commit di {0} · tasto destro per le operazioni":
		"Go to the commit of {0} · right-click for operations",
	"Nessuna modifica nel working tree": "No changes in the working tree",
	"{0} file con modifiche · {1} in stage, {2} fuori":
		"{0} files changed · {1} staged, {2} unstaged",
	"Changes — nessuna modifica nel working tree":
		"Changes — no changes in the working tree",
	"Changes — {0} file con modifiche ({1} in stage, {2} fuori)":
		"Changes — {0} files changed ({1} staged, {2} unstaged)",
	"Nessun file nello stage.": "No files staged.",
	"Nessuna modifica.": "No changes.",
	"Togli dallo stage": "Remove from stage",
	"Aggiungi allo stage": "Add to stage",
	"Scarta le modifiche": "Discard the changes",
	"File tree · commit": "File tree · commit",
	"File tree · working tree": "File tree · working tree",
	"Nessun file.": "No files.",
	"Copia lo SHA completo ({0})": "Copy the full SHA ({0})",
	"committer {0}": "committer {0}",
	"Committer: {0} <{1}> · {2}": "Committer: {0} <{1}> · {2}",
	"{0} genitori": "{0} parents",
	"Commit iniziale, senza genitori": "Initial commit, no parents",
	"Parent: {0}": "Parent: {0}",
	"{0} righe aggiunte, {1} rimosse": "{0} lines added, {1} removed",
	"{0} file": "{0} files",
	"{0} cartelle": "{0} folders",
	"{0} binari": "{0} binary",
	"repository non riaperto: {0}": "repository not reopened: {0}",
	"repository attivo non riselezionato: {0}":
		"active repository not reselected: {0}",
	"Nessun repository indicato per il pannello dei dettagli.":
		"No repository given for the details panel.",
	Aggiornamento: "Refreshing",
	"Dettaglio commit": "Commit details",
	Commit: "Commit",
	"Righe del commit": "Commit lines",
	"Lettura del diff…": "Reading the diff…",
	Diff: "Diff",
	"Commit senza modifiche ai file.": "Commit with no file changes.",
	"Diff non disponibile.": "Diff not available.",
	"1 altro file non mostrato: aprile nel File Tree.":
		"1 more file not shown: open it in the File Tree.",
	"{0} altri file non mostrati: aprili nel File Tree.":
		"{0} more files not shown: open them in the File Tree.",
	"Nessuna differenza.": "No differences.",
	"Nessuna modifica da applicare alla selezione.":
		"No change to apply to the selection.",
	"Stage parziale": "Partial stage",
	"Unstage parziale": "Partial unstage",
	"Seleziona un file da Modifiche o dal File Tree.":
		"Select a file from Changes or from the File Tree.",
	"Lettura del blame…": "Reading the blame…",
	"impostazioni non disponibili:": "settings not available:",
	"Scartare le modifiche di {0}? Le modifiche tracciate si ripristinano con Annulla; i file non tracciati vengono conservati come oggetti Git.":
		"Discard the changes to {0}? Tracked changes can be restored with Undo; untracked files are kept as Git objects.",
	"Scartare le modifiche di {0}? Le modifiche tracciate si ripristinano con Annulla, ma i file non tracciati vengono eliminati definitivamente.":
		"Discard the changes to {0}? Tracked changes can be restored with Undo, but untracked files are permanently deleted.",
	Scarta: "Discard",
	"Operazione annullata.": "Operation undone.",
	"Scrivi un messaggio di commit.": "Write a commit message.",
	"Commit creato.": "Commit created.",
	"Checkout {0}": "Checkout {0}",
	"Fetch in corso…": "Fetching…",
	"Fetch completato.": "Fetch completed.",
	"Copiato negli appunti.": "Copied to the clipboard.",
	"Copia non riuscita: {0}": "Copy failed: {0}",
	"Apri file": "Open file",
	"Mostra file": "Reveal file",
	"Salva copia": "Save copy",
	"Copia salvata in {0}.": "Copy saved to {0}.",
	"Salva una copia del file com'era nel commit…":
		"Save a copy of the file as it was in the commit…",
	"Estrae dal commit i byte di allora e li salva dove scegli tu.":
		"Extracts the bytes as they were in the commit and saves them where you choose.",
	"Copia percorso": "Copy path",
	"Copia negli appunti il percorso del file dentro il repository.":
		"Copies the file path inside the repository to the clipboard.",
	"Apri con l'applicazione associata": "Open with the associated application",
	"Apre il file dal disco con il programma predefinito del sistema.":
		"Opens the file from disk with the system default program.",
	"Mostra nella cartella": "Reveal in folder",
	"Apre la cartella che contiene il file e lo seleziona.":
		"Opens the folder that contains the file and selects it.",
	"Salva una copia…": "Save a copy…",
	"Copia il file in una cartella scelta da te, fuori dal repository.":
		"Copies the file to a folder you choose, outside the repository.",
	"Commit non presente nella storia caricata.":
		"Commit not in the loaded history.",
	"Vai al commit": "Go to the commit",
	"Porta la vista della storia al commit puntato da questo riferimento.":
		"Moves the history view to the commit this reference points to.",
	"{0} è il ramo attuale": "{0} is the current branch",
	"Checkout di {0}": "Checkout {0}",
	"Sposta HEAD e il working tree su questo ramo locale.":
		"Moves HEAD and the working tree to this local branch.",
	"Merge di {0} nel ramo attuale": "Merge {0} into the current branch",
	"Unisce questo ramo nel ramo attuale, con un commit di merge.":
		"Merges this branch into the current branch, with a merge commit.",
	"Rebase del ramo attuale su {0}": "Rebase the current branch onto {0}",
	"Riapplica i commit del ramo attuale sopra questo ramo.":
		"Reapplies the commits of the current branch on top of this branch.",
	"Rinomina…": "Rename…",
	"Cambia il nome del ramo locale.": "Changes the local branch name.",
	"Elimina {0}": "Delete {0}",
	"Elimina solo il riferimento: i commit restano nella storia.":
		"Deletes only the reference: the commits stay in the history.",
	"Crea {0} e passa a quel ramo": "Create {0} and switch to it",
	"Crea un ramo locale che segue il remoto e ci passa sopra.":
		"Creates a local branch tracking the remote and switches to it.",
	"Copia nome": "Copy name",
	"Copia negli appunti il nome del ramo o del tag.":
		"Copies the branch or tag name to the clipboard.",
	"Copia SHA": "Copy SHA",
	"Copia negli appunti l'identificativo completo del commit.":
		"Copies the full commit identifier to the clipboard.",
	"Unire {0} nel ramo attuale?": "Merge {0} into the current branch?",
	"Merge di {0}": "Merge {0}",
	"Merge completato.": "Merge completed.",
	"Riscrivere il ramo attuale sopra {0}? La storia locale cambia.":
		"Rewrite the current branch onto {0}? The local history changes.",
	"Rebase su {0}": "Rebase onto {0}",
	"Rebase completato.": "Rebase completed.",
	"Rinomina il ramo": "Rename the branch",
	"Nuovo nome per {0}": "New name for {0}",
	Rinomina: "Rename",
	"Eliminare il ramo locale {0}?": "Delete the local branch {0}?",
	"Ramo eliminato.": "Branch deleted.",
	"Portare HEAD sul commit {0}? Il ramo non si sposta: si lavora con HEAD staccato (l'operazione è annullabile).":
		"Move HEAD to commit {0}? The branch does not move: you work with a detached HEAD (the operation can be undone).",
	"HEAD su {0}, staccato dal ramo.": "HEAD on {0}, detached from the branch.",
	"Applicare {0} sul ramo attuale?": "Apply {0} to the current branch?",
	"Cherry-pick completato.": "Cherry-pick completed.",
	"Nome del ramo che punta a {0}": "Name of the branch pointing to {0}",
	"Ramo {0}": "Branch {0}",
	"Ramo {0} creato.": "Branch {0} created.",
	"Unire il commit {0} nel ramo attuale?":
		"Merge commit {0} into the current branch?",
	"Riscrivere il ramo attuale sopra il commit {0}? La storia locale cambia.":
		"Rewrite the current branch onto commit {0}? The local history changes.",
	"Le modifiche non committate e i commit successivi spariranno dal ramo.":
		"Uncommitted changes and later commits will disappear from the branch.",
	"I commit successivi escono dal ramo, le modifiche restano in stage.":
		"Later commits leave the branch, the changes stay staged.",
	"I commit successivi escono dal ramo, le modifiche restano nel working tree.":
		"Later commits leave the branch, the changes stay in the working tree.",
	"Reset {0} di {1} a {2}?\n\n{3}": "Reset ({0}) of {1} to {2}?\n\n{3}",
	"Reset {0}": "Reset ({0})",
	"Reset {0} completato.": "Reset ({0}) completed.",
	"Pull in corso…": "Pulling…",
	"Pull completato.": "Pull completed.",
	"Push in corso…": "Pushing…",
	"Push completato.": "Push completed.",
	"Annullare il {0} in corso e tornare allo stato precedente?":
		"Abort the running {0} and go back to the previous state?",
	"Annulla operazione": "Abort operation",
	"Nessuno stash.": "No stash.",
	Applica: "Apply",
	Elimina: "Delete",
	"Applica stash": "Apply stash",
	"Pop stash": "Pop stash",
	"Elimina stash": "Delete stash",
	"Eliminare stash@{{0}}?": "Delete stash@{0}?",
	"Nessun submodule.": "No submodules.",
	"comando in corso… Interrompi per fermarlo":
		"command running… Stop to end it",
	"Modifiche salvate nello stash.": "Changes saved to the stash.",
	"File da salvare": "Files to save",
	Tutti: "All",
	Nessuno: "None",
	"Con una parte dei file, gli altri restano nel working tree.":
		"With only some files selected, the others stay in the working tree.",
	"Nessun file da salvare.": "No files to save.",
	"Scegli almeno un file da mettere nello stash.":
		"Choose at least one file to put in the stash.",
	"Stash salvato per {0} file.": "Stash saved for {0} files.",
	"Stash salvato per un file.": "Stash saved for one file.",
	"Aggiornamento dei submodule…": "Updating submodules…",
	"Submodule aggiornati.": "Submodules updated.",
	"Interruzione: {0}": "Stopped: {0}",
	"Apri la cartella": "Open the folder",
	"Apre la cartella del repository nel gestore file del sistema.":
		"Opens the repository folder in the system file manager.",
	"Copia negli appunti il percorso completo della cartella.":
		"Copies the full folder path to the clipboard.",
	"Apri il repository nel browser": "Open the repository in the browser",
	"Apre la pagina web del repository, se il remoto è un servizio conosciuto.":
		"Opens the repository web page, if the remote is a known service.",
	Browser: "Browser",
	"Apri un file del repository…": "Open a repository file…",
	"Mostra l'elenco dei file tracciati e apre quello scelto dal disco.":
		"Shows the tracked files and opens the chosen one from disk.",
	"Sincronizza con l'originale (merge)…": "Sync with the original (merge)…",
	"Porta nella tua copia i commit del repository originale, unendoli con un merge.":
		"Brings the original repository commits into your copy, joining them with a merge.",
	"Sincronizza con l'originale (rebase)…": "Sync with the original (rebase)…",
	"Porta i commit dell'originale e riapplica i tuoi sopra, senza commit di merge.":
		"Brings the original commits and reapplies yours on top, without a merge commit.",
	"Esporta HEAD in un archivio zip…": "Export HEAD as a zip…",
	"Crea uno zip con i file del commit corrente, senza cartella .git.":
		"Creates a zip with the files of the current commit, without the .git folder.",
	"GitHub Actions…": "GitHub Actions…",
	"Elenca le esecuzioni dei workflow di GitHub per il ramo corrente.":
		"Lists the GitHub workflow runs for the current branch.",
	"Chiude la scheda; il repository resta sul disco.":
		"Closes the tab; the repository stays on disk.",
	"Mostra nel pannello i dettagli e le modifiche di questo commit.":
		"Shows the details and changes of this commit in the panel.",
	"Checkout di questo commit (HEAD staccato)":
		"Checkout this commit (detached HEAD)",
	"Porta il working tree su questo commit senza spostare nessun ramo: HEAD resta staccato.":
		"Moves the working tree to this commit without moving any branch: HEAD stays detached.",
	"Crea ramo da qui…": "Create branch here…",
	"Crea un nuovo ramo che parte da questo commit.":
		"Creates a new branch starting from this commit.",
	"Merge di questo commit nel ramo attuale":
		"Merge this commit into the current branch",
	"Unisce questo commit nel ramo attuale, con un commit di merge.":
		"Merges this commit into the current branch, with a merge commit.",
	"Rebase del ramo attuale su questo commit":
		"Rebase the current branch onto this commit",
	"Riapplica i commit del ramo attuale sopra questo commit.":
		"Reapplies the commits of the current branch on top of this commit.",
	"Reset soft a questo commit": "Soft reset to this commit",
	"Sposta il ramo qui lasciando le modifiche in staging.":
		"Moves the branch here, leaving the changes staged.",
	"Reset mixed a questo commit": "Mixed reset to this commit",
	"Sposta il ramo qui lasciando le modifiche fuori dallo staging.":
		"Moves the branch here, leaving the changes unstaged.",
	"Reset hard a questo commit": "Hard reset to this commit",
	"Sposta il ramo qui e scarta le modifiche non committate: irreversibile.":
		"Moves the branch here and discards uncommitted changes: irreversible.",
	"Cherry-pick sul ramo attuale": "Cherry-pick onto the current branch",
	"Copia questo commit sopra il ramo attuale come nuovo commit.":
		"Copies this commit on top of the current branch as a new commit.",
	"Apri il commit nel browser": "Open the commit in the browser",
	"Apre la pagina web del commit sul provider del remoto.":
		"Opens the commit web page on the remote provider.",
	"Copia messaggio": "Copy message",
	"Copia negli appunti il titolo del commit.":
		"Copies the commit subject to the clipboard.",
	"home dell'utente": "user home",
	"Nome del repository non valido: niente barre o caratteri di controllo.":
		"Invalid repository name: no slashes or control characters.",
	"Dove creare il repository": "Where to create the repository",
	"Nome ed email dell'identità vanno insieme, oppure tutti e due vuoti.":
		"Identity name and email go together, or both stay empty.",
	Creazione: "Creating",
	"Repository creato.": "Repository created.",
	"URL non riconosciuto.": "Unrecognized URL.",
	"Destinazione: {0}": "Destination: {0}",
	"Destinazione: <cartella scelta>/{0}": "Destination: <chosen folder>/{0}",
	"Incolla l'URL del repository.": "Paste the repository URL.",
	"Dove clonare il repository": "Where to clone the repository",
	"Clone in corso…": "Cloning…",
	Clone: "Clone",
	Rete: "Network",
	"Enumerazione oggetti": "Enumerating objects",
	"Conteggio oggetti": "Counting objects",
	"Compressione oggetti": "Compressing objects",
	"Scrittura oggetti": "Writing objects",
	"Ricezione oggetti": "Receiving objects",
	"Risoluzione delta": "Resolving deltas",
	"Aggiornamento file": "Updating files",
	"Checkout file": "Checking out files",
	"Estrazione oggetti": "Unpacking objects",
	"Repository clonato.": "Repository cloned.",
	"Apre la pagina di verifica e attende l'autorizzazione":
		"Opens the verification page and waits for authorization",
	"Questo provider non ha l'accesso dal browser: usa il token":
		"This provider has no browser sign-in: use the token",
	"Questo provider non ha l'accesso dal browser: usa il token.":
		"This provider has no browser sign-in: use the token.",
	"Scegli un provider.": "Choose a provider.",
	"Per l'accesso dal browser serve un Client ID OAuth registrato: senza, il provider non può rilasciare il token. Usa «Accedi con il token del computer», oppure «Crea un token sul sito e incollalo…».":
		"Browser sign-in requires a registered OAuth client ID: without it the provider cannot issue the token. Use «Sign in with the computer's token», or «Create a token on the website and paste it…».",
	"Attendo l'autorizzazione nel browser…":
		"Waiting for authorization in the browser…",
	"Codice: {0} — inseriscilo nella pagina che si apre.":
		"Code: {0} — enter it on the page that opens.",
	"Cerco un token già presente sulla macchina…":
		"Looking for a token already on the machine…",
	"Token trovato in GitHub CLI.": "Token found in GitHub CLI.",
	"Token trovato nel credential helper di Git.":
		"Token found in the Git credential helper.",
	"Account collegato dal browser.": "Account linked from the browser.",
	Account: "Account",
	"Token disponibile; Git lo conserva nel suo archivio.":
		"Token available; Git keeps it in its store.",
	"Token in memoria: Git non ha un credential helper, quindi vale per questa sessione.":
		"Token in memory: Git has no credential helper, so it lasts for this session.",
	"Nessun token in memoria: se Git lo ha in archivio viene usato quello.":
		"No token in memory: if Git has one in its store, that one is used.",
	"Nessun token: inseriscilo per elencare e clonare i repository privati.":
		"No token: enter it to list and clone private repositories.",
	"Nessun account.": "No accounts.",
	"Account salvato.": "Account saved.",
	"Account salvato: manca il token, quindi l'elenco dei repository non è disponibile.":
		"Account saved: the token is missing, so the repository list is unavailable.",
	"Scegli un account da rimuovere.": "Choose an account to remove.",
	"Account rimosso.": "Account removed.",
	"Scegli un account: serve il suo token per leggere l'elenco.":
		"Choose an account: its token is needed to read the list.",
	Repository: "Repositories",
	"Elenco non disponibile: leggi il messaggio.":
		"List unavailable: read the message.",
	"{0} repository.": "{0} repositories.",
	"Nessun elenco caricato.": "No list loaded.",
	"Nessun repository corrisponde al filtro.":
		"No repository matches the filter.",
	Destinazione: "Destination",
	"Clonare {0} in {1}?": "Clone {0} into {1}?",
	"Questo repository non risulta un fork: non c'è un originale con cui sincronizzarsi.":
		"This repository is not a fork: there is no original to sync with.",
	Unire: "Merge",
	"Rebasare il ramo attuale su": "Rebase the current branch onto",
	"{0} {1}/{2}? Le modifiche non committate possono fermare l'operazione; niente viene forzato.":
		"{0} {1}/{2}? Uncommitted changes may stop the operation; nothing is forced.",
	"Sincronizza fork": "Sync fork",
	Rilettura: "Re-reading",
	"Remoto «upstream» aggiunto ({0}). {1} è {2} commit avanti a {3}.":
		"«upstream» remote added ({0}). {1} is {2} commits ahead of {3}.",
	"{0} è {1} commit avanti a {2}.": "{0} is {1} commits ahead of {2}.",
	"Esporta zip": "Export zip",
	"Archivio salvato in {0}.": "Archive saved to {0}.",
	"Leggo l'elenco dei file…": "Reading the file list…",
	"File del repository": "Repository files",
	"Nessun file tracciato.": "No tracked files.",
	"Nessun file corrisponde al filtro.": "No file matches the filter.",
	"L'elenco è troncato dal repository.":
		"The list is truncated by the repository.",
	"Doppio clic per aprirlo dal disco; tasto destro per le altre azioni.":
		"Double-click to open it from disk; right-click for other actions.",
	"mostrati i primi {0}": "showing the first {0}",
	"Leggo le esecuzioni…": "Reading the runs…",
	"Nessuna esecuzione.": "No runs.",
	"Annulla l'esecuzione in corso su GitHub.":
		"Cancels the running execution on GitHub.",
	"Avvia di nuovo questo workflow con gli stessi parametri.":
		"Starts this workflow again with the same inputs.",
	"Apre l'esecuzione su GitHub nel browser.":
		"Opens the run on GitHub in the browser.",
	"{0} esecuzioni.": "{0} runs.",
	"Annullare questa esecuzione?": "Cancel this run?",
	"Esecuzione annullata.": "Run cancelled.",
	"Esecuzione ri-avviata.": "Run restarted.",
	"Accesso non riuscito.": "Sign-in failed.",
	"Accesso fatto.": "Signed in.",
	"Impostazioni salvate.": "Settings saved.",
	"Scelgo una cartella già presente sul disco e la apre in una scheda.":
		"Picks a folder already on disk and opens it in a tab.",
	"Aggiornamento automatico: {0}": "Automatic refresh: {0}",
	"Repository aggiornato da fuori.": "Repository updated from outside.",
	"(nessun messaggio)": "(no message)",
	"Righe non ancora committate": "Lines not committed yet",
	"Elemento mancante: #{0}": "Missing element: #{0}",
	"Richieste aperte sul servizio del repository. Se ne crea una da due rami già inviati con Push; «Apri» mostra la pagina web della richiesta.":
		'Requests open on the repository service. Create one from two branches already pushed; "Open" shows the request page.',
	Aperte: "Open",
	"author: · file: · regex: · change: · diff: · lines:1,40:file":
		"author: · file: · regex: · change: · diff: · lines:1,40:file",
	"1 risultato": "1 result",
	"Ogni spostamento di HEAD, dal più recente: commit, checkout, reset, rebase. «Vai al commit» apre quel commit nel pannello; non cambia il repository.":
		'Every move of HEAD, newest first: commit, checkout, reset, rebase. "Go to the commit" opens that commit in the panel; it does not change the repository.',
	"Aggiornamenti di HEAD": "HEAD updates",
	"Rilegge la coda del reflog": "Re-reads the reflog tail",
	"Chiude la finestra del reflog": "Closes the reflog window",
	"Leggo il reflog…": "Reading the reflog…",
	"Reflog vuoto.": "Empty reflog.",
	"{0} voci.": "{0} entries.",
	"Apre questo commit nel pannello dei dettagli.":
		"Opens this commit in the details panel.",
	"SHA del commit": "Commit SHA",
	"Uno SHA è fatto di cifre esadecimali: per esempio 1a2b3c4.":
		"A SHA is made of hexadecimal digits, for example 1a2b3c4.",
	"Mostra gli spostamenti di HEAD e ne apre un commit.":
		"Shows the moves of HEAD and opens one of its commits.",
	"Vai al commit per SHA…": "Go to commit by SHA…",
	"Dettagli ↗": "Details ↗",
	"Cerca nel contenuto…": "Search in content…",
	"I dettagli sono in una finestra separata: clic per portarla davanti":
		"Details are in a separate window: click to bring it to the front",
	"Cerca nel contenuto": "Search in content",
	"Cerca nei file tracciati con git grep. Il testo è letterale salvo «Espressione regolare»; clic su un risultato per aprirlo nell'app del sistema.":
		"Searches tracked files with git grep. The text is literal unless «Regular expression»; click a result to open it in the system app.",
	Cerca: "Search",
	"Testo da cercare": "Text to search",
	Espressione: "Expression",
	"Espressione regolare": "Regular expression",
	"Distingui maiuscole": "Case sensitive",
	"Chiude la ricerca nel contenuto": "Closes the content search",
	"Apre il file con l'app del sistema.":
		"Opens the file with the system app.",
	"Scrivi un testo da cercare.": "Type some text to search.",
	"Cerco nei file…": "Searching files…",
	"Nessun risultato.": "No results.",
	"Primi {0} risultati: restringi la ricerca.":
		"First {0} results: narrow the search.",
	"{0} risultato.": "{0} result.",
	"{0} risultati.": "{0} results.",
	Controlli: "Checks",
	"Legge gli esiti dei controlli sul commit in testa alla richiesta.":
		"Reads the check results on the head commit of the request.",
	"Il servizio non ha indicato il commit in testa a questa richiesta.":
		"The service did not report the head commit of this request.",
	"Leggo i controlli…": "Reading the checks…",
	"{0} falliti": "{0} failed",
	"{0} in corso": "{0} pending",
	"Nessun controllo.": "No checks.",
	"Apre il controllo nel browser.": "Opens the check in the browser.",
	Nuova: "New",
	"Ramo di partenza": "Source branch",
	"Ramo di arrivo": "Target branch",
	Descrizione: "Description",
	"Apri l'elenco": "Open the list",
	"Apre nel browser l'elenco delle pull request del repository":
		"Opens the repository pull request list in the browser",
	"Rilegge dal servizio le pull request aperte":
		"Re-reads the open pull requests from the service",
	"Apre la pull request sul servizio":
		"Opens the pull request on the service",
	"Chiude la finestra delle pull request": "Closes the pull requests window",
	"Leggo le pull request…": "Reading the pull requests…",
	"Nessuna pull request aperta.": "No open pull request.",
	"{0} aperte.": "{0} open.",
	bozza: "draft",
	"Apre la pull request nel browser.":
		"Opens the pull request in the browser.",
	"Servono titolo e due rami: quello di partenza e quello di arrivo.":
		"A title and two branches are required: source and target.",
	"Pull request #{0} creata.": "Pull request #{0} created.",
	"Elenca le pull request aperte e ne crea una da due rami già inviati.":
		"Lists the open pull requests and creates one from two pushed branches.",
	"Merge request": "Merge request",
};

const EXACT = new Map<string, string>();
interface Template {
	pattern: RegExp;
	order: string[];
	value: string;
}
const TEMPLATES: Template[] = [];

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

for (const [key, value] of Object.entries(EN)) {
	if (/\{\d+\}/.test(key)) {
		const pieces = key.split(/(\{\d+\})/);
		const order: string[] = [];
		let source = "^";
		for (const piece of pieces) {
			const placeholder = /^\{(\d+)\}$/.exec(piece);
			if (placeholder) {
				source += "([\\s\\S]+?)";
				order.push(placeholder[1]!);
			} else {
				source += escapeRegExp(piece);
			}
		}
		TEMPLATES.push({ pattern: new RegExp(`${source}\$`), order, value });
	} else {
		EXACT.set(key, value);
	}
}
// A longer key is more specific: "X into the current branch" before "X".
TEMPLATES.sort((a, b) => b.pattern.source.length - a.pattern.source.length);

let locale: Locale = "it";

export function currentLocale(): Locale {
	return locale;
}

export function localeTag(): string {
	return locale === "it" ? "it-IT" : "en-US";
}

export function setLocale(next: Locale): void {
	locale = next;
	if (typeof document !== "undefined") document.documentElement.lang = next;
}

/** Read-only view of the catalogue: used by the tests to check completeness. */
export function catalogue(): Readonly<Record<string, string>> {
	return EN;
}

export function resolveLocale(
	preference: LocalePreference | undefined
): Locale {
	if (preference === "it" || preference === "en") return preference;
	const languages = navigator.languages?.length
		? navigator.languages
		: [navigator.language];
	return languages.some((tag) => tag.toLowerCase().startsWith("it"))
		? "it"
		: "en";
}

function fill(template: Template, match: RegExpExecArray): string {
	const values = new Map<string, string>();
	template.order.forEach((index, position) => {
		values.set(index, match[position + 1] ?? "");
	});
	return template.value.replace(
		/\{(\d+)\}/g,
		(all, index: string) => values.get(index) ?? all
	);
}

/** Italian text in the current language. Unknown text is returned unchanged. */
export function t(text: string): string {
	if (locale === "it") return text;
	const exact = EXACT.get(text);
	if (exact !== undefined) return exact;
	for (const template of TEMPLATES) {
		const match = template.pattern.exec(text);
		if (match) return fill(template, match);
	}
	return text;
}

/** Exact lookup only: cheap enough for the thousands of nodes a history page creates. */
export function tExact(text: string): string {
	if (locale === "it") return text;
	return EXACT.get(text) ?? text;
}

/** Text and attributes of the static markup. Runs once, before data is rendered. */
export function translateStatic(root: ParentNode = document): void {
	document.documentElement.lang = locale;
	if (locale === "it") return;
	const skip = new Set([
		"SCRIPT",
		"STYLE",
		"TEXTAREA",
		"CODE",
		"PRE",
		"SAMP",
	]);
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
		acceptNode(node: Node): number {
			const parent = node.parentElement;
			if (!parent || skip.has(parent.tagName))
				return NodeFilter.FILTER_REJECT;
			return (node.nodeValue ?? "").trim()
				? NodeFilter.FILTER_ACCEPT
				: NodeFilter.FILTER_REJECT;
		},
	});
	const nodes: Text[] = [];
	while (walker.nextNode()) nodes.push(walker.currentNode as Text);
	for (const node of nodes) {
		const value = node.nodeValue ?? "";
		const key = value.trim().replace(/\s+/g, " ");
		const translated = EXACT.get(key);
		if (translated !== undefined) node.nodeValue = translated;
	}
	const elements: Element[] =
		root instanceof Element
			? [root, ...root.querySelectorAll("*")]
			: [...(root as Document).querySelectorAll("*")];
	for (const element of elements) {
		for (const attribute of ["title", "placeholder", "aria-label"]) {
			const value = element.getAttribute(attribute);
			if (!value) continue;
			const translated = EXACT.get(value.trim().replace(/\s+/g, " "));
			if (translated !== undefined)
				element.setAttribute(attribute, translated);
		}
	}
}
