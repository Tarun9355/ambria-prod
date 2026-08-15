// ═══ DELETE A CLIENT (admin) ═══
//
// Shared by the Client Tracker (Manage → Settings → Clients) and the Summary footer, because two
// hand-written copies of an irreversible operation drift — and the copy that drifts is the one
// that forgets a guard.
//
// This is a HARD delete: the row leaves `client_ledger` and takes the client's sessions, draft and
// history with it. saveClientLedger's second argument is the deleted-id list it turns into
// deleteRow calls; the plumbing had existed unused until this.
//
// What it deliberately does NOT delete: event orders. They are matched to a client by clientId, so
// they outlive the row — but they are IMS's copy of the job, not ours to remove. The confirm counts
// them and says they will be orphaned, so the decision is made with open eyes rather than silently.

/**
 * The same delete, for a selection.
 *
 * Not a loop over makeDeleteClient: that would ask N times, and — worse — write the ledger N times.
 * Each write is a full save, so ten deletes would be ten racing saves of a list each copy believed
 * it knew the shape of, and the last one home would restore whatever the others had removed. One
 * confirm, one write, one deleted-id list.
 */
export function makeDeleteClients({
  clientLedger,
  saveClientLedger,
  eventOrders,
  activeClientId,
  setActiveClientId,
  startNewDeal,
  askConfirm,
  showMsg,
  onDeleted,
}) {
  return (list) => {
    const clients = (list || []).filter((c) => c?.id);
    if (!clients.length) return;
    const ids = new Set(clients.map((c) => c.id));
    const n = clients.length;

    const sessions = clients.reduce((sum, c) => sum + (c.sessions || []).length, 0);
    const booked = clients.filter((c) => c.status === "booked").length;
    const orders = (eventOrders || []).filter((e) => ids.has(e.clientId)).length;

    const bits = [sessions ? `${sessions} saved session${sessions === 1 ? "" : "s"} in total` : "no saved sessions"];
    // Booked means signed. Deleting one in a batch is the mistake this line exists to catch.
    if (booked) bits.push(`${booked} of them ${booked === 1 ? "is" : "are"} marked BOOKED`);
    if (orders) bits.push(`${orders} event order${orders === 1 ? "" : "s"} will be left without a client`);

    askConfirm(
      `Delete ${n} client${n === 1 ? "" : "s"} permanently?`,
      () => {
        // Same resurrection guard as the single delete: if the open deal is in the batch, the deal
        // has to be CLOSED, not just unlinked, or the auto-save mints it straight back.
        if (ids.has(activeClientId)) {
          if (startNewDeal) startNewDeal(); else setActiveClientId?.(null);
        }
        saveClientLedger((clientLedger || []).filter((x) => !ids.has(x.id)), [...ids]);
        showMsg?.(`Deleted ${n} client${n === 1 ? "" : "s"}`, "green");
        onDeleted?.(clients);
      },
      {
        yesLabel: `Delete ${n} forever`,
        note: `${bits.join(" · ")}. This cannot be undone — mark them Dead instead if you only want them out of the way.`,
      },
    );
  };
}

export function makeDeleteClient({
  clientLedger,
  saveClientLedger,
  eventOrders,
  activeClientId,
  setActiveClientId,
  startNewDeal,
  askConfirm,
  showMsg,
  onDeleted,
}) {
  return (c) => {
    if (!c?.id) return;
    const sessions = (c.sessions || []).length;
    const orders = (eventOrders || []).filter((e) => e.clientId === c.id).length;

    const bits = [sessions ? `${sessions} saved session${sessions === 1 ? "" : "s"}` : "no saved sessions"];
    if (c.status === "booked") bits.push("this client is marked BOOKED");
    if (orders) bits.push(`${orders} event order${orders === 1 ? "" : "s"} will be left without a client`);

    askConfirm(
      `Delete "${c.name}" permanently?`,
      () => {
        // Deleting the client the builder is sitting on has to close the DEAL, not merely drop the
        // id. Clearing activeClientId alone was a resurrection: the background auto-save runs off
        // clientName plus the loaded build, and with no id to find, saveSession treats it as a
        // brand-new deal and mints a fresh CLI_ row carrying the same name, details and build —
        // fifteen seconds later the client is back in the tracker, which is what it looked like.
        //
        // The reset lives on ctx (startNewDeal) so both call sites share one copy. The bare
        // setActiveClientId is the fallback for a caller that has not been given it.
        if (activeClientId === c.id) {
          if (startNewDeal) startNewDeal(); else setActiveClientId?.(null);
        }
        saveClientLedger((clientLedger || []).filter((x) => x.id !== c.id), [c.id]);
        showMsg?.(`Deleted ${c.name}`, "green");
        onDeleted?.(c);
      },
      {
        yesLabel: "Delete forever",
        note: `${bits.join(" · ")}. This cannot be undone — mark the client Dead instead if you only want it out of the way.`,
      },
    );
  };
}
