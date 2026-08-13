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
