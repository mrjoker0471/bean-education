-- Phase 3D: conversation-scoped teaching preferences for Riishe chat.
--
-- Additive, backward-compatible change: two NULLABLE columns on the existing
-- RiisheChatTurn table. No data is rewritten, no row is dropped, and no
-- existing column changes type. SQLite supports ADD COLUMN directly; the
-- migration is safe to replay on any database that already ran the Phase 3B
-- baseline (20261121000000_phase3b_personal_learning_intelligence).
--
-- Semantics:
--   tutorMode        — the RiisheTutorMode in force when an ASSISTANT turn was
--                      produced (null on user turns and on legacy rows; null
--                      is displayed as the EXPLAIN default).
--   responseLanguage — the RiisheResponseLanguage (including 'auto') in force
--                      when an ASSISTANT turn was produced (null on user turns
--                      and on legacy rows; null is displayed as 'auto').
--
-- History is preserved verbatim: older conversations keep NULL, so reloading
-- them falls back to the documented defaults without touching stored content.
ALTER TABLE "RiisheChatTurn" ADD COLUMN "tutorMode" TEXT;
ALTER TABLE "RiisheChatTurn" ADD COLUMN "responseLanguage" TEXT;
