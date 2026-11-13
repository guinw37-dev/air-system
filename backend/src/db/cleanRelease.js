// Return a pooled client with the server's default search_path.
//
// Branch-scoped work pins `SET search_path TO "<branch>", public` on a pooled
// client. That setting lives as long as the CONNECTION, not the checkout, so a
// client handed back unchanged makes the next public-scope query on it (apex
// login, super-admin user management, ...) read the branch's tables instead of
// public. Every place that sets a search_path must hand the client back through
// here (or through txClient's wrapped release).

// For callers that own the release: await releaseClean(client).
async function releaseClean(client) {
  try {
    await client.query('RESET search_path');
  } catch (err) {
    client.release(err);            // can't prove the session is clean → drop the connection
    return;
  }
  client.release();
}

// For clients handed to callers who call client.release() themselves (txClient):
// swap release for one that resets first. Callers keep calling it synchronously
// after their last awaited query, so the RESET never overlaps another query.
function resetOnRelease(client) {
  const release = client.release;   // pg-pool's per-checkout release (guards double release)
  client.release = (err) => {
    client.release = release;       // a second call reaches pg-pool's own guard
    if (err) return release(err);
    client.query('RESET search_path').then(() => release(), (e) => release(e));
    return undefined;
  };
  return client;
}

module.exports = { releaseClean, resetOnRelease };
