-- Archivos más grandes: el depósito de archivos de usuarios ya no fija su propio tope de 50 MB;
-- manda el límite global del proyecto (Supabase → Storage → Settings → «Upload file size limit»).
-- Plan gratis: máximo 50 MB por archivo. Plan Pro: hasta 500 GB (la app acepta hasta 5 GB).
update storage.buckets set file_size_limit = null where id = 'user-files';
