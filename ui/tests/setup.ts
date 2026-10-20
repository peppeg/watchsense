// Chiave dei segreti fissa per i test: nessun file secret.key generato nella cartella data/
// del progetto (i test che provano il file della chiave tolgono la variabile).
process.env.WATCHSENSE_SECRET_KEY ||= '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff'
