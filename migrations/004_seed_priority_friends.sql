-- Seed Maddie's priority friends list
-- These people will get more frequent check-in reminders (2 weeks vs 4 weeks)

-- Function to insert or update a person
CREATE OR REPLACE FUNCTION upsert_priority_friend(
  p_name TEXT,
  p_aliases TEXT[],
  p_relationship TEXT,
  p_priority TEXT
) RETURNS VOID AS $$
BEGIN
  -- Try to find existing person by name
  IF EXISTS (SELECT 1 FROM people WHERE LOWER(name) = LOWER(p_name)) THEN
    UPDATE people
    SET priority_level = p_priority,
        aliases = p_aliases,
        relationship = p_relationship,
        updated_at = NOW()
    WHERE LOWER(name) = LOWER(p_name);
  ELSE
    INSERT INTO people (name, aliases, relationship, priority_level, created_at, updated_at)
    VALUES (p_name, p_aliases, p_relationship, p_priority, NOW(), NOW());
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Insert or update each priority friend
SELECT upsert_priority_friend('Mom', ARRAY[]::TEXT[], 'family', 'high');
SELECT upsert_priority_friend('Dad', ARRAY[]::TEXT[], 'family', 'high');
SELECT upsert_priority_friend('Davis', ARRAY[]::TEXT[], 'family', 'high');
SELECT upsert_priority_friend('Katie', ARRAY['Maddie''s sister']::TEXT[], 'family', 'high');
SELECT upsert_priority_friend('Addi', ARRAY['Addison']::TEXT[], 'friend', 'high');
SELECT upsert_priority_friend('Grace', ARRAY[]::TEXT[], 'friend', 'high');
SELECT upsert_priority_friend('Claire', ARRAY[]::TEXT[], 'friend', 'high');
SELECT upsert_priority_friend('Ellie', ARRAY[]::TEXT[], 'friend', 'high');
SELECT upsert_priority_friend('Abigail', ARRAY[]::TEXT[], 'friend', 'high');
SELECT upsert_priority_friend('Ashton', ARRAY[]::TEXT[], 'friend', 'high');
SELECT upsert_priority_friend('MPL', ARRAY[]::TEXT[], 'friend', 'high');
SELECT upsert_priority_friend('Sophie', ARRAY[]::TEXT[], 'friend', 'high');
SELECT upsert_priority_friend('St Clair', ARRAY['St. Clair']::TEXT[], 'friend', 'high');
SELECT upsert_priority_friend('Kylie', ARRAY[]::TEXT[], 'friend', 'high');
SELECT upsert_priority_friend('Maddie Hutchins', ARRAY[]::TEXT[], 'friend', 'high');
SELECT upsert_priority_friend('Nati', ARRAY[]::TEXT[], 'friend', 'high');
SELECT upsert_priority_friend('Liv Cleary', ARRAY[]::TEXT[], 'friend', 'high');
SELECT upsert_priority_friend('Liv Lamb', ARRAY[]::TEXT[], 'friend', 'high');
SELECT upsert_priority_friend('Jamie Winslett', ARRAY['Jamie']::TEXT[], 'friend', 'high');
SELECT upsert_priority_friend('Fleming', ARRAY[]::TEXT[], 'friend', 'high');
SELECT upsert_priority_friend('Lily Horsley', ARRAY['Lily']::TEXT[], 'friend', 'high');

-- Clean up the helper function
DROP FUNCTION upsert_priority_friend(TEXT, TEXT[], TEXT, TEXT);
