-- VS-325. The weaver agent's stored default name was `Conductor` before the product rename of the
-- role's display name. A new workspace already creates its weaver as `Weaver`
-- (`ensureConductor`), so this only repairs workspaces created earlier. The `name` is not a
-- CHECK-constrained or referenced value; a plain row-data UPDATE suffices. Only the untouched
-- default is renamed — a weaver someone deliberately named something else keeps that name.
UPDATE agents SET name = 'Weaver' WHERE kind = 'weaver' AND name = 'Conductor';
