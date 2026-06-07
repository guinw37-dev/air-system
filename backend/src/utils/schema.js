// Branch slugs use dashes (e.g. "acme-co") but Postgres schema names use
// underscores (e.g. "acme_co"). Always convert before using a slug as a schema
// name / search_path, otherwise `SET search_path TO "acme-co"` targets a schema
// that does not exist.
function slugToSchema(slug) {
  const schema = String(slug || '').replace(/-/g, '_').toLowerCase();
  // Schema names are interpolated into SQL (cannot be parameterized), so
  // whitelist strictly — defense-in-depth against a dirty slug ever reaching an
  // identifier (SQL injection boundary).
  if (!/^[a-z0-9_]{1,63}$/.test(schema)) {
    throw new Error(`invalid schema name from slug: ${JSON.stringify(slug)}`);
  }
  return schema;
}

// Resolve the effective schema for a client (branch) row: prefer the stored
// schema_name column, fall back to the slug, and normalize either way.
function branchSchema(client) {
  return slugToSchema(client && (client.schema_name || client.slug));
}

module.exports = { slugToSchema, branchSchema };
