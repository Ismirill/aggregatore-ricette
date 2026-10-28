-- Documenti sincronizzati: k = impronta del codice ricettario, id = ricetta (o "_cats"), t = ora di modifica sul dispositivo,
-- s = ora di arrivo sul server (per scaricare solo le novità), del = cancellata, data = ricetta cifrata (AES-GCM) in base64
CREATE TABLE IF NOT EXISTS docs (k TEXT NOT NULL, id TEXT NOT NULL, t INTEGER NOT NULL, s INTEGER NOT NULL, del INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL DEFAULT '', PRIMARY KEY (k, id));
CREATE INDEX IF NOT EXISTS docs_ks ON docs (k, s);

-- Account (Firebase Authentication): ogni utente ha il suo codice ricettario, cifrato con una chiave del server
CREATE TABLE IF NOT EXISTS users (uid TEXT PRIMARY KEY, email TEXT, name TEXT, provider TEXT, code TEXT NOT NULL, created INTEGER, seen INTEGER);
-- Passaggio dell'accesso dal sito all'app Android: codice a 6 cifre valido 10 minuti
CREATE TABLE IF NOT EXISTS handoff (code TEXT PRIMARY KEY, data TEXT NOT NULL, exp INTEGER NOT NULL);
