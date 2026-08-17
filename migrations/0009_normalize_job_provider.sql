-- Keep legacy databases normalized if the previous migration was partially
-- applied before the migration marker was written.

UPDATE check_jobs
SET provider = CASE WHEN provider = 'globalping' THEN 'globalping' ELSE 'worker' END;
