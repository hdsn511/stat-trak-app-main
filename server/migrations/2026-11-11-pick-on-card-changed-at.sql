-- When a pick last swapped on/off the Picks card (not its first appearance). Powers "Changes today".
ALTER TABLE pick_results ADD COLUMN IF NOT EXISTS on_card_changed_at timestamptz;
