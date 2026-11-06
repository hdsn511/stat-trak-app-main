-- Whether a Projects pick was on the Picks card. The server sets it each time the card
-- is served, for unstarted games only, so at kickoff it freezes to "was on the card
-- when the game started". The card's W-L counts these rows only: NFL re-picks during
-- the week, and a pick swapped off on Tuesday was never on the card for the game.
ALTER TABLE pick_results ADD COLUMN IF NOT EXISTS on_card boolean;
