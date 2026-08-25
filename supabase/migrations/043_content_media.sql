-- ============================================================
-- 043_content_media.sql
--
-- Adds the `content-media` Supabase Storage bucket used by the
-- "Conteúdo e Redes Sociais" module for post images/videos.
--
-- Mirrors `chat-media` (migration 023) and `flow-media` (016/020) —
-- same account-scoped storage RLS shape, uploaded/deleted through the
-- existing src/lib/storage/upload-media.ts helper unchanged (just a
-- new bucket id). Kept as its own bucket (not reusing chat-media) so a
-- future per-bucket retention/size policy can diverge without
-- touching chat attachments.
--
-- Path convention (same as chat-media/flow-media):
--   content-media/account-<account_id>/<timestamp>-<basename>.<ext>
-- Public bucket so published posts' media URLs are fetchable without
-- auth (both by us for preview and, eventually, by the social
-- platforms' APIs at publish time).
--
-- Images + video only (no documents/audio — this bucket is post media,
-- not chat attachments). 16 MB cap, matching chat-media/flow-media.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- ============================================================
-- 1. content-media storage bucket
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'content-media',
  'content-media',
  TRUE,
  16777216, -- 16 MB, matching chat-media/flow-media
  ARRAY[
    'image/png', 'image/jpeg', 'image/webp',
    'video/mp4', 'video/3gpp'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ============================================================
-- 2. Storage RLS — account-scoped writes, public reads
--
-- Same predicate shape as migration 023: writes are allowed when the
-- path's first segment is `account-<account_id>` for an account the
-- caller belongs to. Reads are public.
-- ============================================================
DROP POLICY IF EXISTS "Content media is publicly readable" ON storage.objects;
CREATE POLICY "Content media is publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'content-media');

DROP POLICY IF EXISTS "Members can upload content media" ON storage.objects;
CREATE POLICY "Members can upload content media"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'content-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Members can update content media" ON storage.objects;
CREATE POLICY "Members can update content media"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'content-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Members can delete content media" ON storage.objects;
CREATE POLICY "Members can delete content media"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'content-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );
