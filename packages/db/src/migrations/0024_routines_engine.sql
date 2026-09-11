-- VS-220: in-flight wake for overlap skip, and updated_at for CRUD.
-- `routines` is not referenced by FK, so no -- ac:foreign_keys_off rebuild.
ALTER TABLE routines ADD COLUMN in_flight_wake_id TEXT;
ALTER TABLE routines ADD COLUMN updated_at TEXT;
