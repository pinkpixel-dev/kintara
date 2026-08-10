-- Every install starts as a single-user install.
--
-- Reading progress, favourites, and annotations are keyed by user, so reads
-- need a user to resolve against before sessions exist. This seeds that user
-- rather than making user_id nullable, so the multi-user path added later is
-- the same code path rather than a second one.
--
-- The password hash is empty on purpose. Argon2 verification against an empty
-- hash always fails, so this account cannot be logged into until a password is
-- set. It is a local owner record, not a usable credential.

INSERT INTO users (username, password_hash, is_admin)
VALUES ('local', '', 1);
